"""Generate the backend's Solana keypairs (provider, admin, 3 verifiers).

Writes backend/keys/{provider,admin,verifier1,verifier2,verifier3}.json in
solana-keygen format (JSON array of the 64 secret-key bytes) and prints the
matching .env lines. backend/keys/ is gitignored — never commit it.

Usage:
    python backend/scripts/gen_keypairs.py            # refuses to overwrite
    python backend/scripts/gen_keypairs.py --force    # regenerate everything
    python backend/scripts/gen_keypairs.py --print    # print env lines for existing files
"""
import argparse
import json
import sys
from pathlib import Path

from solders.keypair import Keypair

BACKEND_DIR = Path(__file__).resolve().parents[1]
KEYS_DIR = BACKEND_DIR / "keys"
NAMES = ["provider", "admin", "verifier1", "verifier2", "verifier3"]


def _to_list(kp: Keypair) -> list[int]:
    return list(bytes(kp))


def _load(path: Path) -> Keypair:
    return Keypair.from_bytes(bytes(json.loads(path.read_text(encoding="utf-8"))))


def _print_env(kps: dict[str, Keypair]) -> None:
    compact = lambda o: json.dumps(o, separators=(",", ":"))  # noqa: E731
    verifiers = [_to_list(kps[n]) for n in NAMES if n.startswith("verifier")]
    print("\n# ---- paste into backend/.env (and Render env vars) ----")
    print(f"PROVIDER_KEYPAIR_JSON={compact(_to_list(kps['provider']))}")
    print(f"VERIFIER_KEYPAIRS_JSON={compact(verifiers)}")
    print(f"ADMIN_KEYPAIR_JSON={compact(_to_list(kps['admin']))}")
    print("\n# ---- public keys ----")
    for n in NAMES:
        print(f"{n:10s} {kps[n].pubkey()}")
    print("\nFund them on devnet, e.g.: solana airdrop 2 <ADMIN_PUBKEY> --url devnet")
    print("then run: python backend/scripts/bootstrap_chain.py")


def main() -> int:
    ap = argparse.ArgumentParser(description="Generate Verity backend keypairs")
    ap.add_argument("--force", action="store_true", help="overwrite existing key files")
    ap.add_argument("--print", dest="print_only", action="store_true",
                    help="only print env lines for the existing key files")
    ap.add_argument("--dir", default=str(KEYS_DIR), help="output directory (default backend/keys)")
    args = ap.parse_args()

    out = Path(args.dir)
    paths = {n: out / f"{n}.json" for n in NAMES}

    if args.print_only:
        missing = [str(p) for p in paths.values() if not p.exists()]
        if missing:
            print("ERROR: missing key files: " + ", ".join(missing), file=sys.stderr)
            return 1
        _print_env({n: _load(p) for n, p in paths.items()})
        return 0

    existing = [str(p) for p in paths.values() if p.exists()]
    if existing and not args.force:
        print("Refusing to overwrite existing key files (use --force, or --print to show them):",
              file=sys.stderr)
        for p in existing:
            print(f"  {p}", file=sys.stderr)
        return 1

    out.mkdir(parents=True, exist_ok=True)
    kps: dict[str, Keypair] = {}
    for n, p in paths.items():
        kp = Keypair()
        p.write_text(json.dumps(_to_list(kp)), encoding="utf-8")
        kps[n] = kp
        print(f"wrote {p}")

    _print_env(kps)
    return 0


if __name__ == "__main__":
    sys.exit(main())
