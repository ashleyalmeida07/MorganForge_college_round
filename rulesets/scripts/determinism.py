"""wasmtime side of the determinism check (run by rulesets/build_all.sh).

For every rule set (a directory with meta.json + <name>.wasm) it executes the example input and
N seeded random inputs generated from meta.json's input_schema in the backend's own engine
(backend/app/engine/runner.py: wasmtime, fuel metered, no imports) and writes the results to a
JSON file. determinism.mjs then re-runs every case in V8 (the browser's WebAssembly engine)
with the exact ABI calls of frontend/src/lib/verify.ts and compares byte for byte.

Usage: python rulesets/scripts/determinism.py --out results.json [--vectors 24]
Needs: wasmtime==<backend pin>, pydantic-settings (pip install -r backend/requirements.txt works too).
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import random
import struct
import sys
from pathlib import Path
from typing import Any

RULESETS = Path(__file__).resolve().parents[1]
BACKEND = RULESETS.parent / "backend"
sys.path.insert(0, str(BACKEND))

from app.engine import runner  # noqa: E402
from app.utils import canonical  # noqa: E402

INT_SPAN = 10**7  # default spread for unbounded integers


def checkpoints_digest(checkpoints: list[bytes] | tuple[bytes, ...]) -> str:
    h = hashlib.sha256()
    for c in checkpoints:
        h.update(struct.pack("<I", len(c)) + bytes(c))
    return h.hexdigest()


def gen_value(schema: dict[str, Any], rng: random.Random, depth: int = 0) -> Any:
    t = schema.get("type")
    if "enum" in schema:
        return rng.choice(schema["enum"])
    if t == "integer":
        lo = int(schema.get("minimum", -INT_SPAN))
        hi = int(schema.get("maximum", lo + INT_SPAN if lo >= 0 else INT_SPAN))
        # bias towards the edges: boundaries catch overflow / rounding divergences
        return rng.choice([lo, hi, rng.randint(lo, hi), rng.randint(lo, min(hi, lo + 1000))])
    if t == "boolean":
        return rng.random() < 0.5
    if t == "string":
        return "".join(rng.choice("abcxyz é€😀\"\\") for _ in range(rng.randint(0, 12)))
    if t == "array":
        lo = int(schema.get("minItems", 0))
        hi = min(int(schema.get("maxItems", lo + 40)), lo + 40)
        return [gen_value(schema.get("items", {"type": "integer"}), rng, depth + 1) for _ in range(rng.randint(lo, hi))]
    if t == "object" and depth < 4:
        props: dict[str, Any] = schema.get("properties", {})
        required = set(schema.get("required", []))
        return {k: gen_value(v, rng, depth + 1) for k, v in props.items() if k in required or rng.random() < 0.7}
    return None


def cases_for(meta: dict[str, Any], name: str, n: int) -> list[Any]:
    out = []
    if meta.get("example_input") is not None:
        out.append(meta["example_input"])
    schema = meta.get("input_schema")
    if schema:
        rng = random.Random(f"verity-determinism:{name}")
        out += [gen_value(schema, rng) for _ in range(n)]
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", required=True)
    ap.add_argument("--vectors", type=int, default=24, help="random inputs per rule set (plus the example)")
    args = ap.parse_args()

    report = []
    for meta_path in sorted(RULESETS.glob("*/meta.json")):
        name = meta_path.parent.name
        wasm_path = meta_path.parent / f"{name}.wasm"
        if not wasm_path.exists():
            print(f"!! {name}: {wasm_path.name} missing (run build_all.sh without --no-build)", file=sys.stderr)
            return 2
        wasm = wasm_path.read_bytes()
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        cases = []
        for inp in cases_for(meta, name, args.vectors):
            data = canonical(inp)
            case: dict[str, Any] = {"input_b64": base64.b64encode(data).decode()}
            try:
                r = runner.run(wasm, data)
                case.update(output_sha256=r.output_hash.hex(), checkpoints_sha256=checkpoints_digest(r.checkpoints),
                            checkpoints=len(r.checkpoints), fuel_used=r.fuel_used, trace_root=r.trace_root.hex())
            except runner.ExecutionError as e:
                case["error"] = str(e)[:200]
            cases.append(case)
        ok = sum(1 for c in cases if "error" not in c)
        print(f"wasmtime  {name:<18} {hashlib.sha256(wasm).hexdigest()[:16]}...  {ok}/{len(cases)} cases executed")
        report.append({"ruleset": name, "wasm": str(wasm_path.relative_to(RULESETS)), "cases": cases})

    Path(args.out).write_text(json.dumps(report, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
