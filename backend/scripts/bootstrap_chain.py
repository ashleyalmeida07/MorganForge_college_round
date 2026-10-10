"""Idempotent on-chain bootstrap for the Verity program (devnet).

  1. print balances of admin / provider / verifier keys (from backend/.env)
  2. airdrop to low-balance keys on devnet/testnet (failures tolerated)
  3. initialize Config if missing (or --update-config to change params)
  4. register + stake the provider
  5. register (or re-activate) the verifiers

Usage:
    python backend/scripts/bootstrap_chain.py
    python backend/scripts/bootstrap_chain.py --min-provider-stake 0.1 --quorum 2 --window 60
    python backend/scripts/bootstrap_chain.py --no-airdrop --provider-stake 0.5
"""
import argparse
import asyncio
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
_cwd = os.getcwd()
os.chdir(BACKEND_DIR)  # so pydantic-settings picks up backend/.env
try:
    from app.config import settings  # noqa: E402
finally:
    os.chdir(_cwd)

from app.chain.client import ChainError, get_chain  # noqa: E402
from app.chain.keys import admin_keypair, provider_keypair, verifier_keypairs  # noqa: E402
from app.utils import explorer_tx  # noqa: E402

LAMPORTS_PER_SOL = 1_000_000_000


def sol(lamports: int | None) -> str:
    return f"{(lamports or 0) / LAMPORTS_PER_SOL:.4f} SOL"


def lamports(x_sol: float) -> int:
    return int(round(x_sol * LAMPORTS_PER_SOL))


def tx(label: str, sig: str) -> None:
    print(f"  {label}: {sig}")
    print(f"    {explorer_tx(sig, settings.cluster)}")


def chain_err(label: str, exc: Exception) -> None:
    print(f"  !! {label} failed: {exc}")
    if isinstance(exc, ChainError):
        if exc.code:
            print(f"     anchor error: {exc.code}")
        for line in (exc.logs or [])[-12:]:
            print(f"     | {line}")


def airdrop_allowed() -> bool:
    c = (settings.cluster or "").lower()
    rpc = (settings.solana_rpc_url or "").lower()
    return c in ("devnet", "testnet", "localnet", "localhost") or "devnet" in rpc or "testnet" in rpc \
        or "localhost" in rpc or "127.0.0.1" in rpc


async def run(args: argparse.Namespace) -> int:
    chain = get_chain()
    admin = admin_keypair()
    provider = provider_keypair()
    verifiers = verifier_keypairs()

    print(f"rpc      : {settings.solana_rpc_url}")
    print(f"program  : {settings.program_id}")
    print(f"cluster  : {settings.cluster}")
    if admin is None:
        print("ERROR: no admin keypair (ADMIN_KEYPAIR_JSON / PROVIDER_KEYPAIR_JSON) configured.", file=sys.stderr)
        return 2

    keys: list[tuple[str, object]] = [("admin", admin)]
    if provider is not None and provider.pubkey() != admin.pubkey():
        keys.append(("provider", provider))
    elif provider is not None:
        print("note: provider keypair == admin keypair")
    for i, v in enumerate(verifiers, 1):
        keys.append((f"verifier{i}", v))

    # ---------------------------------------------------------------- balances + airdrops
    print("\n== balances")
    min_bal = lamports(args.min_balance)
    low: list[tuple[str, object]] = []
    for name, kp in keys:
        try:
            bal = await chain.get_balance(kp.pubkey())
        except Exception as exc:
            print(f"  {name:10s} {kp.pubkey()}  <balance error: {exc}>")
            continue
        flag = "  (low)" if bal < min_bal else ""
        print(f"  {name:10s} {kp.pubkey()}  {sol(bal)}{flag}")
        if bal < min_bal:
            low.append((name, kp))

    if low and not args.no_airdrop:
        if not airdrop_allowed():
            print("  airdrops are only attempted on devnet/testnet/localnet — fund these keys manually.")
        else:
            print(f"\n== airdrops ({args.airdrop_sol} SOL each)")
            for name, kp in low:
                try:
                    sig = await chain.airdrop(kp.pubkey(), lamports(args.airdrop_sol))
                    print(f"  {name:10s} airdrop ok: {sig}")
                except Exception as exc:
                    print(f"  {name:10s} airdrop failed (rate limited? use https://faucet.solana.com): {exc}")
            await asyncio.sleep(3)
            for name, kp in low:
                try:
                    print(f"  {name:10s} now {sol(await chain.get_balance(kp.pubkey()))}")
                except Exception:
                    pass

    # ---------------------------------------------------------------- config
    print("\n== config")
    params = dict(
        min_provider_stake=lamports(args.min_provider_stake),
        min_dispute_stake=lamports(args.min_dispute_stake),
        challenge_window_secs=int(args.window),
        required_attestations=int(args.quorum),
    )
    cfg = await chain.get_config()
    if cfg is None:
        print(f"  config missing -> initialize {params}")
        try:
            tx("initialize", await chain.initialize(admin, **params))
        except Exception as exc:
            chain_err("initialize", exc)
            return 1
        cfg = await chain.get_config()
    else:
        print(f"  config exists at {cfg.get('pda')}")
        if args.update_config:
            if cfg.get("authority") != str(admin.pubkey()):
                print("  !! admin keypair is not the config authority; cannot update config")
            else:
                print(f"  update_config {params}")
                try:
                    tx("update_config", await chain.update_config(admin, **params))
                except Exception as exc:
                    chain_err("update_config", exc)
                cfg = await chain.get_config()
    if cfg:
        for k in ("authority", "min_provider_stake", "min_dispute_stake", "challenge_window_secs",
                  "required_attestations", "request_count", "verifier_count", "audit_root_count"):
            print(f"  {k:22s} {cfg.get(k)}")
    if cfg and cfg.get("authority") != str(admin.pubkey()):
        print(f"  !! WARNING: config authority {cfg.get('authority')} != admin {admin.pubkey()}; "
              "verifier registration will fail")

    # ---------------------------------------------------------------- provider
    print("\n== provider")
    if provider is None:
        print("  no PROVIDER_KEYPAIR_JSON configured; skipping")
    else:
        prov = await chain.get_provider(provider.pubkey())
        if prov is None:
            try:
                tx("register_provider", await chain.register_provider(provider))
            except Exception as exc:
                chain_err("register_provider", exc)
            prov = await chain.get_provider(provider.pubkey())
        current = int((prov or {}).get("stake") or 0)
        target = lamports(args.provider_stake)
        min_stake = int((cfg or {}).get("min_provider_stake") or 0)
        if target < min_stake:
            print(f"  note: --provider-stake {sol(target)} < min_provider_stake {sol(min_stake)}; using minimum")
            target = min_stake
        if prov is not None and current < target:
            amount = target - current
            print(f"  staking {sol(amount)} (current {sol(current)}, target {sol(target)})")
            try:
                tx("stake_provider", await chain.stake_provider(provider, amount))
            except Exception as exc:
                chain_err("stake_provider", exc)
            prov = await chain.get_provider(provider.pubkey())
        if prov:
            print(f"  provider {provider.pubkey()} stake={sol(prov.get('stake'))} active={prov.get('active')} "
                  f"completed={prov.get('completed')} slashed={prov.get('slashed')}")
        if not args.no_db:
            try:
                from app.chain.indexer import sync_provider

                await sync_provider(str(provider.pubkey()))
                print("  synced provider row to database")
            except Exception as exc:
                print(f"  (db sync skipped: {exc})")

    # ---------------------------------------------------------------- verifiers
    print("\n== verifiers")
    if not verifiers:
        print("  no VERIFIER_KEYPAIRS_JSON configured; skipping")
    for i, v in enumerate(verifiers, 1):
        pk = v.pubkey()
        rec = await chain.get_verifier_record(pk)
        try:
            if rec is None:
                tx(f"register_verifier{i}", await chain.register_verifier(admin, pk))
            elif not rec.get("active"):
                tx(f"set_verifier_active{i}", await chain.set_verifier_active(admin, pk, True))
            else:
                print(f"  verifier{i} {pk} already registered (attestations={rec.get('attestations')})")
        except Exception as exc:
            chain_err(f"verifier{i}", exc)

    print("\ndone.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Bootstrap the Verity program on devnet")
    ap.add_argument("--min-provider-stake", type=float, default=0.1, help="SOL (default 0.1)")
    ap.add_argument("--min-dispute-stake", type=float, default=0.05, help="SOL (default 0.05)")
    ap.add_argument("--window", type=int, default=60, help="challenge window seconds (default 60)")
    ap.add_argument("--quorum", type=int, default=2, help="required attestations (default 2)")
    ap.add_argument("--provider-stake", type=float, default=0.3,
                    help="target provider stake in SOL (default 0.3, i.e. survives slashes)")
    ap.add_argument("--update-config", action="store_true", help="apply params to an existing config")
    ap.add_argument("--min-balance", type=float, default=0.5, help="airdrop below this many SOL (default 0.5)")
    ap.add_argument("--airdrop-sol", type=float, default=1.0, help="SOL per airdrop (default 1)")
    ap.add_argument("--no-airdrop", action="store_true")
    ap.add_argument("--no-db", action="store_true", help="skip syncing the provider row into Supabase")
    ap.add_argument("--rpc", default=None, help="override SOLANA_RPC_URL")
    args = ap.parse_args()
    if args.rpc:
        settings.solana_rpc_url = args.rpc
    return asyncio.run(run(args))


if __name__ == "__main__":
    sys.exit(main())
