"""Deploy or upgrade a Solana program without the Solana CLI (Implementation_plan.md §15.3).

Talks to the upgradeable BPF loader (BPFLoaderUpgradeab1e11111111111111111111111) directly with
solders + solana-py, i.e. what `solana program deploy` does under the hood:
  1. create a buffer account and InitializeBuffer
  2. Write the .so in chunks
  3. first deploy: create the program account + DeployWithMaxDataLen
     upgrade:      Upgrade (program data <- buffer), rent refunded to the payer
It sends writes in small parallel windows, but it is still far slower than the CLI (which
streams over QUIC); prefer scripts/deploy_program.sh, keep this for CI or no-CLI machines.

Usage (backend venv has solana + solders):
  python scripts/deploy_program.py <program.so> <payer.json> <program-keypair.json> \\
      [--url http://127.0.0.1:8899] [--max-len BYTES] [--yes]
The payer is also the upgrade authority. Mainnet is refused.
"""
from __future__ import annotations

import argparse
import json
import struct
import sys
import time
from pathlib import Path

from solana.rpc.api import Client
from solana.rpc.commitment import Confirmed
from solana.rpc.types import TxOpts
from solders.instruction import AccountMeta, Instruction
from solders.keypair import Keypair
from solders.message import Message
from solders.pubkey import Pubkey
from solders.system_program import CreateAccountParams, create_account
from solders.sysvar import CLOCK, RENT
from solders.transaction import Transaction

LOADER = Pubkey.from_string("BPFLoaderUpgradeab1e11111111111111111111111")
SYSTEM = Pubkey.from_string("11111111111111111111111111111111")
CHUNK = 900            # bytes per Write; a whole tx must fit in 1232 bytes
WINDOW = 16            # writes in flight before waiting for confirmations
BUFFER_META = 37       # UpgradeableLoaderState::Buffer header: tag u32 + Option<Pubkey>
PROGRAM_LEN = 36       # UpgradeableLoaderState::Program: tag u32 + programdata Pubkey
PROGRAMDATA_META = 45  # ProgramData header: tag u32 + slot u64 + Option<Pubkey>

# UpgradeableLoaderInstruction (bincode: u32 LE variant tag, then fields)
IX_INITIALIZE_BUFFER, IX_WRITE, IX_DEPLOY, IX_UPGRADE = 0, 1, 2, 3


def load_kp(path: str) -> Keypair:
    return Keypair.from_bytes(bytes(json.loads(Path(path).read_text())))


def send(client: Client, ixs: list[Instruction], signers: list[Keypair], confirm: bool = True):
    payer = signers[0]
    bh = client.get_latest_blockhash(Confirmed).value.blockhash
    tx = Transaction(signers, Message.new_with_blockhash(ixs, payer.pubkey(), bh), bh)
    sig = client.send_transaction(tx, opts=TxOpts(skip_confirmation=True, preflight_commitment=Confirmed)).value
    if confirm:
        wait(client, [sig])
    return sig


def wait(client: Client, sigs: list, timeout: float = 90.0) -> None:
    pending = list(sigs)
    deadline = time.monotonic() + timeout
    while pending:
        statuses = client.get_signature_statuses(pending).value
        still = []
        for sig, st in zip(pending, statuses):
            if st is None or st.confirmation_status is None:
                still.append(sig)
            elif st.err is not None:
                raise RuntimeError(f"transaction {sig} failed: {st.err}")
        pending = still
        if pending:
            if time.monotonic() > deadline:
                raise TimeoutError(f"{len(pending)} transaction(s) not confirmed: {pending[:3]}")
            time.sleep(0.5)


def write_ix(buffer: Pubkey, authority: Pubkey, offset: int, chunk: bytes) -> Instruction:
    data = struct.pack("<IIQ", IX_WRITE, offset, len(chunk)) + chunk
    return Instruction(LOADER, data, [AccountMeta(buffer, False, True), AccountMeta(authority, True, False)])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("so")
    ap.add_argument("payer", help="payer + upgrade authority keypair (solana-keygen JSON)")
    ap.add_argument("program_keypair", help="program id keypair (solana-keygen JSON)")
    ap.add_argument("--url", default="https://api.devnet.solana.com")
    ap.add_argument("--max-len", type=int, default=None, help="first deploy: program data capacity (default 2x)")
    ap.add_argument("--yes", action="store_true")
    args = ap.parse_args()

    if "mainnet" in args.url:
        print("refusing to deploy to mainnet from this script", file=sys.stderr)
        return 2
    client = Client(args.url, commitment=Confirmed)
    payer = load_kp(args.payer)
    program = load_kp(args.program_keypair)
    data = Path(args.so).read_bytes()
    programdata, _ = Pubkey.find_program_address([bytes(program.pubkey())], LOADER)
    existing = client.get_account_info(program.pubkey()).value
    upgrade = existing is not None
    if upgrade and existing.owner != LOADER:
        print(f"{program.pubkey()} exists but is not an upgradeable program", file=sys.stderr)
        return 1
    if upgrade:
        pd = client.get_account_info(programdata).value
        capacity = len(pd.data) - PROGRAMDATA_META if pd else 0
        if len(data) > capacity:
            print(f"program grew to {len(data)} bytes > programdata capacity {capacity}; extend it first "
                  "(solana program extend) or deploy under a new id", file=sys.stderr)
            return 1
    max_len = args.max_len or len(data) * 2

    print(f"{'upgrade' if upgrade else 'deploy'} {program.pubkey()} <- {args.so} ({len(data)} bytes) on {args.url}")
    print(f"payer/authority {payer.pubkey()} balance {client.get_balance(payer.pubkey()).value / 1e9:.4f} SOL")
    if not args.yes and input("continue? [y/N] ").strip().lower() not in ("y", "yes"):
        return 1

    # 1) buffer
    buffer = Keypair()
    buffer_len = BUFFER_META + len(data)
    rent = client.get_minimum_balance_for_rent_exemption(buffer_len).value
    send(client, [
        create_account(CreateAccountParams(from_pubkey=payer.pubkey(), to_pubkey=buffer.pubkey(),
                                           lamports=rent, space=buffer_len, owner=LOADER)),
        Instruction(LOADER, struct.pack("<I", IX_INITIALIZE_BUFFER),
                    [AccountMeta(buffer.pubkey(), False, True), AccountMeta(payer.pubkey(), False, False)]),
    ], [payer, buffer])
    print(f"buffer {buffer.pubkey()} created ({buffer_len} bytes)")

    # 2) chunks, WINDOW at a time
    offsets = list(range(0, len(data), CHUNK))
    for i in range(0, len(offsets), WINDOW):
        sigs = [send(client, [write_ix(buffer.pubkey(), payer.pubkey(), off, data[off:off + CHUNK])], [payer], confirm=False)
                for off in offsets[i:i + WINDOW]]
        wait(client, sigs)
        done = min(len(data), offsets[min(i + WINDOW, len(offsets)) - 1] + CHUNK)
        print(f"\rwrote {done}/{len(data)} bytes", end="", flush=True)
    print()
    on_chain = bytes(client.get_account_info(buffer.pubkey()).value.data)[BUFFER_META:]
    if on_chain != data:
        print("buffer contents differ from the .so; aborting (buffer left for `solana program close`)", file=sys.stderr)
        return 1

    # 3) deploy or upgrade
    if upgrade:
        ix = Instruction(LOADER, struct.pack("<I", IX_UPGRADE), [
            AccountMeta(programdata, False, True),
            AccountMeta(program.pubkey(), False, True),
            AccountMeta(buffer.pubkey(), False, True),
            AccountMeta(payer.pubkey(), False, True),    # spill: receives the buffer's rent
            AccountMeta(RENT, False, False),
            AccountMeta(CLOCK, False, False),
            AccountMeta(payer.pubkey(), True, False),    # upgrade authority
        ])
        sig = send(client, [ix], [payer])
    else:
        rent_prog = client.get_minimum_balance_for_rent_exemption(PROGRAM_LEN).value
        ixs = [
            create_account(CreateAccountParams(from_pubkey=payer.pubkey(), to_pubkey=program.pubkey(),
                                               lamports=rent_prog, space=PROGRAM_LEN, owner=LOADER)),
            Instruction(LOADER, struct.pack("<IQ", IX_DEPLOY, max_len), [
                AccountMeta(payer.pubkey(), True, True),
                AccountMeta(programdata, False, True),
                AccountMeta(program.pubkey(), False, True),
                AccountMeta(buffer.pubkey(), False, True),
                AccountMeta(RENT, False, False),
                AccountMeta(CLOCK, False, False),
                AccountMeta(SYSTEM, False, False),
                AccountMeta(payer.pubkey(), True, False),  # upgrade authority
            ]),
        ]
        sig = send(client, ixs, [payer, program])
    print(f"{'UPGRADED' if upgrade else 'DEPLOYED'} {program.pubkey()} tx {sig}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
