#!/usr/bin/env bash
# Build every rule set to wasm32 and prove it is deterministic across engines
# (Implementation_plan.md §17): each rule set runs its example + N seeded random inputs in
# wasmtime (the backend engine, backend/app/engine/runner.py) and in V8 (the browser engine,
# same calls as frontend/src/lib/verify.ts); outputs and trace checkpoints must be identical.
#
# Usage: rulesets/build_all.sh            build, copy <name>.wasm into each crate dir, check
#        rulesets/build_all.sh --check    build to target/ only, report drift vs the committed
#                                         .wasm (program hashes), then check the committed .wasm
#        rulesets/build_all.sh --no-build check the committed .wasm only
# Env:   VECTORS=24 (random inputs per rule set), PYTHON=python3
#
# A rebuilt .wasm has a new program_hash: re-run backend/scripts/seed_rulesets.py, and for
# payroll also scripts/setup-zk.mjs (PAYROLL_PROGRAM_HASH) — see programs/verity_core/DEPLOYMENT.md.
set -euo pipefail

cd "$(dirname "$0")"
MODE="${1:-build}"
VECTORS="${VECTORS:-24}"
PYTHON="${PYTHON:-$(command -v python3 || command -v python)}"
TARGET=wasm32-unknown-unknown

sha() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

if [[ "$MODE" != "--no-build" ]]; then
  rustup target add "$TARGET" >/dev/null 2>&1 || true
  cargo build --release --target "$TARGET"
  drift=0
  for meta in */meta.json; do
    name="$(dirname "$meta")"
    built="target/$TARGET/release/$name.wasm"
    [[ -f "$built" ]] || { echo "!! $name: $built not produced"; exit 1; }
    if [[ "$MODE" == "--check" ]]; then
      if [[ "$(sha "$built")" != "$(sha "$name/$name.wasm")" ]]; then
        echo "drift  $name: fresh build $(sha "$built" | cut -c1-16)... != committed $(sha "$name/$name.wasm" | cut -c1-16)..."
        drift=1
      else
        echo "same   $name $(sha "$built" | cut -c1-16)..."
      fi
    else
      cp "$built" "$name/$name.wasm"
      echo "built  $name $(sha "$name/$name.wasm")"
    fi
  done
  if [[ "$MODE" == "--check" && $drift == 1 ]]; then
    echo "note: rustc/toolchain differences change the bytes (and the program hash); the committed .wasm is what is registered on chain."
  fi
fi

results="$(mktemp -t verity-determinism.XXXXXX.json 2>/dev/null || mktemp)"
trap 'rm -f "$results"' EXIT
"$PYTHON" scripts/determinism.py --out "$results" --vectors "$VECTORS"
node scripts/determinism.mjs "$results"
