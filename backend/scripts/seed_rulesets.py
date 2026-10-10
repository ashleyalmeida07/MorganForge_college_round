"""Seed prebuilt WASM rule sets into Supabase (storage + programs table) and IPFS.

For every crate directory under rulesets/ (repo root), the script looks for a
built module, in order:
    rulesets/<crate>/*.wasm
    rulesets/<crate>/target/wasm32-unknown-unknown/release/*.wasm
    rulesets/target/wasm32-unknown-unknown/release/<crate>.wasm   (cargo workspace)
plus an optional rulesets/<crate>/meta.json:
    {name, description, version, language, input_schema, output_schema, example_input}
and rulesets/<crate>/src/lib.rs as the published source.

Uploads   programs/{hash}.wasm  and  programs/{hash}.src.txt,
pins the wasm to IPFS (if Pinata is configured) and upserts the programs row.

Usage:
    python backend/scripts/seed_rulesets.py
    python backend/scripts/seed_rulesets.py --dir path/to/rulesets --only payroll --dry-run
"""
import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent
sys.path.insert(0, str(BACKEND_DIR))
_cwd = os.getcwd()
os.chdir(BACKEND_DIR)  # so pydantic-settings picks up backend/.env
try:
    from app.config import settings  # noqa: E402,F401
finally:
    os.chdir(_cwd)

from app.db import BUCKET_PROGRAMS, table, upload_blob  # noqa: E402
from app.engine.runner import run as run_wasm  # noqa: E402
from app.engine.runner import validate_module  # noqa: E402
from app.ipfs import gateway_url, pin_bytes  # noqa: E402
from app.utils import canonical, sha256_hex  # noqa: E402

WASM_TARGET = Path("target") / "wasm32-unknown-unknown" / "release"


def find_wasm(crate: Path) -> Path | None:
    stem = crate.name.replace("-", "_")
    candidates: list[Path] = []
    candidates += sorted(crate.glob("*.wasm"))
    candidates += sorted((crate / WASM_TARGET).glob("*.wasm"))
    ws = crate.parent / WASM_TARGET
    for name in (f"{stem}.wasm", f"{crate.name}.wasm"):
        if (ws / name).exists():
            candidates.append(ws / name)
    if not candidates:
        return None
    for c in candidates:  # prefer a file named after the crate
        if c.stem in (stem, crate.name):
            return c
    return candidates[0]


def load_meta(crate: Path) -> dict[str, Any]:
    p = crate / "meta.json"
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"invalid JSON in {p}: {exc}") from exc


def seed_one(crate: Path, args: argparse.Namespace) -> str:
    wasm_path = find_wasm(crate)
    if wasm_path is None:
        return "skip (no built .wasm — run cargo build --release --target wasm32-unknown-unknown)"

    wasm = wasm_path.read_bytes()
    program_hash = sha256_hex(wasm)
    meta = load_meta(crate)
    name = meta.get("name") or crate.name.replace("_", " ").replace("-", " ").title()

    if not args.no_validate:
        info = validate_module(wasm)
        print(f"    module ok: exports={info.get('exports')} size={info.get('size')}")
        example = meta.get("example_input")
        if example is not None:
            res = run_wasm(wasm, canonical(example), expected_program_hash=bytes.fromhex(program_hash))
            print(f"    example -> {res.output_bytes[:160].decode('utf-8', 'replace')} "
                  f"(fuel {res.fuel_used})")

    src_path = crate / "src" / "lib.rs"
    source = src_path.read_bytes() if src_path.exists() else None

    print(f"    wasm   : {wasm_path} ({len(wasm)} bytes)")
    print(f"    hash   : {program_hash}")
    if args.dry_run:
        return "dry-run"

    wasm_uri = upload_blob(BUCKET_PROGRAMS, f"{program_hash}.wasm", wasm, "application/wasm")
    source_uri = None
    if source is not None:
        source_uri = upload_blob(BUCKET_PROGRAMS, f"{program_hash}.src.txt", source, "text/plain; charset=utf-8")

    cid = None if args.no_ipfs else pin_bytes(wasm, f"verity-{crate.name}-{program_hash[:12]}.wasm")
    if cid:
        print(f"    ipfs   : {cid}  {gateway_url(cid)}")

    row: dict[str, Any] = {
        "program_hash": program_hash,
        "name": name,
        "description": meta.get("description"),
        "version": meta.get("version") or "1.0.0",
        "language": meta.get("language") or "rust",
        "input_schema": meta.get("input_schema"),
        "output_schema": meta.get("output_schema"),
        "example_input": meta.get("example_input"),
        "wasm_uri": wasm_uri,
        "wasm_size": len(wasm),
    }
    if source_uri:
        row["source_uri"] = source_uri
    if cid:
        row["ipfs_cid"] = cid  # never overwrite an existing CID with null
    table("programs").upsert(row, on_conflict="program_hash").execute()
    return f"seeded '{name}'"


def main() -> int:
    ap = argparse.ArgumentParser(description="Seed WASM rule sets into Verity")
    ap.add_argument("--dir", default=str(REPO_ROOT / "rulesets"), help="rulesets directory")
    ap.add_argument("--only", action="append", default=None, help="only this crate dir name (repeatable)")
    ap.add_argument("--skip", action="append", default=["template", "target"],
                    help="crate dir names to skip (default: template, target)")
    ap.add_argument("--dry-run", action="store_true", help="validate + hash only, no uploads")
    ap.add_argument("--no-validate", action="store_true", help="skip wasmtime validation / example run")
    ap.add_argument("--no-ipfs", action="store_true", help="skip Pinata pinning")
    args = ap.parse_args()

    root = Path(args.dir).resolve()
    if not root.is_dir():
        print(f"ERROR: {root} is not a directory", file=sys.stderr)
        return 2

    crates = sorted(p for p in root.iterdir() if p.is_dir() and not p.name.startswith("."))
    if args.only:
        crates = [c for c in crates if c.name in set(args.only)]
    else:
        crates = [c for c in crates if c.name not in set(args.skip)]
    if not crates:
        print(f"no rule-set crates found in {root}")
        return 1

    failures = 0
    for crate in crates:
        print(f"[{crate.name}]")
        try:
            print(f"  -> {seed_one(crate, args)}")
        except Exception as exc:
            failures += 1
            print(f"  -> FAILED: {type(exc).__name__}: {exc}")
    print(f"\n{len(crates) - failures}/{len(crates)} rule sets processed without errors")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
