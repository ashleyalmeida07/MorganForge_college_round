#!/usr/bin/env bash
# Deploy / upgrade a Verity Solana program with the Solana CLI (Implementation_plan.md §15,
# programs/verity_core/DEPLOYMENT.md). Builds happen in CI (anchor build); this script only
# ships a built .so and runs the post-deploy setup.
#
# Usage:
#   scripts/deploy_program.sh core [--so path/verity_core.so] [--url devnet|localhost|<rpc>] [--setup] [--smoke] [--yes]
#   scripts/deploy_program.sh zk   [--so path/verity_zk_verifier.so] [--url ...] [--setup] [--yes]
#
#   --setup  core: scripts/setup-devnet.mjs (config, provider stake, verifiers; idempotent)
#            zk:   scripts/setup-zk.mjs with PAYROLL_PROGRAM_HASH = sha256(rulesets/payroll/payroll.wasm)
#   --smoke  core: scripts/smoke-test.mjs (zk: scripts/zk-smoke.mjs) after deploying
#   --yes    do not ask for confirmation
#
# Keys (gitignored): programs/verity_core/keys/deployer.json (payer + upgrade authority) and
# keys/<program>-keypair.json (program id). Deploys go over TPU/QUIC (no --use-rpc): buffer
# writes over the public RPC hit 429 rate limits.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORE="$ROOT/programs/verity_core"
KEYS="$CORE/keys"

which="${1:-}"
shift || true
case "$which" in
  core) name=verity_core ;;
  zk)   name=verity_zk_verifier ;;
  *) sed -n '2,20p' "$0"; exit 2 ;;
esac

so="$CORE/target/deploy/$name.so"
url=devnet
setup=0 smoke=0 yes=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --so) so="$2"; shift 2 ;;
    --url) url="$2"; shift 2 ;;
    --setup) setup=1; shift ;;
    --smoke) smoke=1; shift ;;
    --yes) yes=1; shift ;;
    *) echo "unknown option $1"; exit 2 ;;
  esac
done

command -v solana >/dev/null || { echo "solana CLI not found (install Agave, or use scripts/deploy_program.py)"; exit 1; }
deployer="$KEYS/deployer.json"
program_kp="$KEYS/$name-keypair.json"
for f in "$so" "$deployer" "$program_kp"; do [[ -f "$f" ]] || { echo "missing $f"; exit 1; }; done

program_id="$(solana address -k "$program_kp")"
declared="$(sed -n 's/^declare_id!("\([^"]*\)");/\1/p' "$CORE/programs/$name/src/lib.rs")"
if [[ "$program_id" != "$declared" ]]; then
  echo "program keypair $program_id does not match declare_id! $declared in programs/$name/src/lib.rs"
  exit 1
fi

case "$url" in devnet|localhost|mainnet-beta|testnet) rpc_flag=(-u "$url") ;; *) rpc_flag=(--url "$url") ;; esac
if [[ "$url" == mainnet-beta ]]; then echo "refusing to deploy to mainnet from this script"; exit 1; fi

authority="$(solana address -k "$deployer")"
echo "program   : $name $program_id"
echo "binary    : $so ($(wc -c < "$so") bytes, sha256 $(sha256sum "$so" 2>/dev/null | cut -c1-16 || shasum -a 256 "$so" | cut -c1-16)...)"
echo "cluster   : $url"
echo "authority : $authority ($(solana balance "${rpc_flag[@]}" -k "$deployer" "$authority" 2>/dev/null || echo '? SOL'))"
if solana program show "${rpc_flag[@]}" "$program_id" >/dev/null 2>&1; then echo "mode      : upgrade"; else echo "mode      : first deploy"; fi

if [[ $yes -ne 1 ]]; then
  read -r -p "Deploy? [y/N] " answer
  [[ "$answer" == [yY]* ]] || { echo "aborted"; exit 1; }
fi

solana program deploy "$so" --program-id "$program_kp" \
  --upgrade-authority "$deployer" -k "$deployer" "${rpc_flag[@]}" --with-compute-unit-price 50000

export DEPLOYER_KEYPAIR="$deployer"
case "$url" in
  devnet) export RPC_URL=https://api.devnet.solana.com ;;
  localhost) export RPC_URL=http://127.0.0.1:8899 ;;
  *) export RPC_URL="$url" ;;
esac

cd "$CORE"
[[ -d node_modules ]] || npm ci --no-audit --no-fund
if [[ $setup -eq 1 ]]; then
  if [[ "$which" == core ]]; then
    node scripts/setup-devnet.mjs
  else
    PAYROLL_PROGRAM_HASH="$(sha256sum "$ROOT/rulesets/payroll/payroll.wasm" | cut -d' ' -f1)" node scripts/setup-zk.mjs
  fi
fi
if [[ $smoke -eq 1 ]]; then
  if [[ "$which" == core ]]; then node scripts/smoke-test.mjs; else node scripts/zk-smoke.mjs; fi
fi
echo "done: https://explorer.solana.com/address/$program_id?cluster=$url"
