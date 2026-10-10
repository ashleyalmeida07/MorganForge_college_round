"""Verity offline verifier — trust nothing but the chain and math.

  python backend/scripts/verity_cli.py verify <request_pda> [--rpc URL] [--api URL]
      Reads Request / Receipt / Attestations straight from Solana, downloads the
      program, input and output blobs from their deterministic public URLs,
      re-hashes everything, re-executes the WASM locally with wasmtime and checks
      the provider's Ed25519 receipt signature.

  python backend/scripts/verity_cli.py evidence <bundle.zip>
      Verifies an evidence bundle fully offline: hashes in request.json /
      receipt.json vs the bundled files, local re-execution, receipt signature.

Exit code 0 = every check passed, 1 = at least one FAIL, 2 = usage / setup error.
"""
import argparse
import asyncio
import io
import json
import os
import sys
import zipfile
from pathlib import Path
from typing import Any, Iterable

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
_cwd = os.getcwd()
os.chdir(BACKEND_DIR)  # so pydantic-settings picks up backend/.env
try:
    from app.config import settings  # noqa: E402
finally:
    os.chdir(_cwd)

from app.chain.signer import receipt_message, verify_receipt  # noqa: E402
from app.engine.runner import run as run_wasm  # noqa: E402
from app.utils import sha256_hex  # noqa: E402

PASS, FAIL, SKIP, INFO, WARN = "PASS", "FAIL", "SKIP", "INFO", "WARN"


class Report:
    def __init__(self, title: str):
        self.title = title
        self.rows: list[tuple[str, str, str]] = []

    def add(self, check: str, result: str, detail: str = "") -> None:
        self.rows.append((check, result, detail))

    def ok(self, check: str, cond: bool, detail_ok: str = "", detail_bad: str = "") -> bool:
        self.add(check, PASS if cond else FAIL, detail_ok if cond else detail_bad)
        return cond

    @property
    def failed(self) -> bool:
        return any(r[1] == FAIL for r in self.rows)

    def print(self) -> None:
        w1 = max([len(r[0]) for r in self.rows] + [5])
        line = "-" * (w1 + 2 + 6 + 2 + 70)
        print()
        print(self.title)
        print(line)
        print(f"{'CHECK'.ljust(w1)}  RESULT  DETAIL")
        print(line)
        for check, result, detail in self.rows:
            print(f"{check.ljust(w1)}  {result.ljust(6)}  {detail}")
        print(line)
        print("OVERALL:", "FAIL" if self.failed else "PASS")


def short(h: str | None, n: int = 16) -> str:
    if not h:
        return "-"
    return h if len(h) <= n * 2 else f"{h[:n]}..{h[-6:]}"


# ====================================================================== verify (online)

def _find_urls(obj: Any) -> Iterable[str]:
    if isinstance(obj, dict):
        for v in obj.values():
            yield from _find_urls(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _find_urls(v)
    elif isinstance(obj, str) and obj.startswith(("http://", "https://")):
        yield obj


class BlobFetcher:
    """Resolves deterministic storage URIs to public URLs and downloads them."""

    def __init__(self, request_pda: str, api: str | None):
        import httpx

        self.http = httpx.Client(timeout=30.0, follow_redirects=True)
        self.request_pda = request_pda
        self.api = api.rstrip("/") if api else None
        self._api_urls: list[str] | None = None

    def _artifact_urls(self) -> list[str]:
        if self._api_urls is None:
            self._api_urls = []
            if self.api:
                try:
                    r = self.http.get(f"{self.api}/requests/{self.request_pda}/artifacts")
                    if r.status_code == 200:
                        self._api_urls = list(_find_urls(r.json()))
                except Exception as exc:
                    print(f"warning: could not query {self.api}: {exc}", file=sys.stderr)
        return self._api_urls

    def url_for(self, uri: str) -> str | None:
        if settings.supabase_url:
            from app.db import public_url

            return public_url(uri)
        for u in self._artifact_urls():
            if u.split("?", 1)[0].endswith("/" + uri):
                return u
        return None

    def get(self, uri: str) -> tuple[bytes | None, str]:
        url = self.url_for(uri)
        if not url:
            return None, f"no public URL for {uri} (set SUPABASE_URL or --api)"
        try:
            r = self.http.get(url)
        except Exception as exc:
            return None, f"download error: {exc}"
        if r.status_code != 200:
            return None, f"HTTP {r.status_code} for {url}"
        return r.content, url


async def cmd_verify(args: argparse.Namespace) -> int:
    if args.rpc:
        settings.solana_rpc_url = args.rpc
    if args.program_id:
        settings.program_id = args.program_id
    if args.supabase_url:
        settings.supabase_url = args.supabase_url.rstrip("/")

    from app.chain.client import get_chain

    pda = args.request_pda
    chain = get_chain()
    rep = Report(f"Verity verification of request {pda}\nrpc={settings.solana_rpc_url} program={settings.program_id}")

    req = await chain.get_request(pda)
    if not rep.ok("request account on chain", req is not None, f"status={req and req.get('status')}",
                  "request account not found"):
        rep.print()
        return 1
    receipt = await chain.get_receipt(pda)
    attestations = await chain.list_attestations(pda)
    cfg = await chain.get_config()
    dispute = await chain.get_dispute(pda)

    program_hash = req["program_hash"]
    input_hash = req["input_hash"]
    rep.add("status", INFO, f"{req.get('status')} (settled={req.get('settled')})")
    rep.add("requester", INFO, str(req.get("requester")))
    rep.add("provider", INFO, str(req.get("provider") or "-"))

    fetch = BlobFetcher(pda, args.api)

    # ---- program
    wasm, src = fetch.get(f"programs/{program_hash}.wasm")
    if wasm is None:
        rep.add("program blob", FAIL, src)
    else:
        got = sha256_hex(wasm)
        rep.ok("program hash", got == program_hash, short(got), f"got {short(got)} != chain {short(program_hash)}")

    # ---- input
    input_uri = f"inputs/{input_hash}.json"
    rep.ok("input_uri_hash", sha256_hex(input_uri.encode()) == req.get("input_uri_hash"),
           f"sha256('{input_uri}')", "chain input_uri_hash does not commit to the deterministic URI")
    input_bytes, src = fetch.get(input_uri)
    if input_bytes is None:
        rep.add("input blob", FAIL, src)
    else:
        got = sha256_hex(input_bytes)
        rep.ok("input hash", got == input_hash, short(got),
               f"INPUT TAMPERED: got {short(got)} != chain {short(input_hash)}")

    # ---- receipt + output
    output_bytes = None
    if receipt is None:
        rep.add("receipt", SKIP, "no receipt on chain yet")
    else:
        rep.ok("receipt provider == request provider", receipt.get("provider") == req.get("provider"),
               str(receipt.get("provider")), f"{receipt.get('provider')} != {req.get('provider')}")
        output_bytes, src = fetch.get(f"outputs/{pda}.json")
        if output_bytes is None:
            rep.add("output blob", FAIL, src)
        else:
            got = sha256_hex(output_bytes)
            rep.ok("output hash", got == receipt["output_hash"], short(got),
                   f"OUTPUT TAMPERED: got {short(got)} != chain {short(receipt['output_hash'])}")

        try:
            msg = receipt_message(pda, bytes.fromhex(program_hash), bytes.fromhex(input_hash),
                                  bytes.fromhex(receipt["output_hash"]), bytes.fromhex(receipt["trace_root"]),
                                  int(receipt["fuel_used"]))
            sig_ok = verify_receipt(receipt["provider"], msg, bytes.fromhex(receipt["signature"]))
            rep.ok("receipt signature (ed25519)", sig_ok, f"signed by {receipt['provider']}", "invalid signature")
        except Exception as exc:
            rep.add("receipt signature (ed25519)", FAIL, f"error: {exc}")

    # ---- local re-execution
    if wasm is not None and input_bytes is not None:
        try:
            res = run_wasm(wasm, input_bytes, fuel_limit=settings.fuel_limit)
            rep.add("local re-execution", INFO,
                    f"output_hash={short(res.output_hash.hex())} fuel={res.fuel_used}")
            if receipt is not None:
                rep.ok("re-exec output_hash == receipt", res.output_hash.hex() == receipt["output_hash"],
                       short(res.output_hash.hex()),
                       f"local {short(res.output_hash.hex())} != receipt {short(receipt['output_hash'])}")
                rep.ok("re-exec trace_root == receipt", res.trace_root.hex() == receipt["trace_root"],
                       short(res.trace_root.hex()),
                       f"local {short(res.trace_root.hex())} != receipt {short(receipt['trace_root'])}")
                rep.ok("re-exec fuel_used == receipt", res.fuel_used == int(receipt["fuel_used"]),
                       str(res.fuel_used), f"local {res.fuel_used} != receipt {receipt['fuel_used']}")
            if output_bytes is not None:
                rep.ok("re-exec output bytes == stored output", res.output_bytes == output_bytes,
                       f"{len(output_bytes)} bytes", "stored output differs from local execution")
                if args.show_output:
                    print("output:", res.output_bytes.decode("utf-8", "replace"))
        except Exception as exc:
            rep.add("local re-execution", FAIL, f"{type(exc).__name__}: {exc}")
    else:
        rep.add("local re-execution", SKIP, "program or input blob unavailable")

    # ---- attestations / quorum
    quorum = int((cfg or {}).get("required_attestations") or 0)
    counted_match = sum(1 for a in attestations if a.get("counted") and a.get("matches"))
    counted_mismatch = sum(1 for a in attestations if a.get("counted") and not a.get("matches"))
    for a in attestations:
        rep.add(f"attestation {short(a.get('verifier'), 6)}", INFO,
                f"matches={a.get('matches')} counted={a.get('counted')} output={short(a.get('output_hash'))}")
    if receipt is not None:
        res_label = f"{counted_match} match / {counted_mismatch} mismatch (quorum {quorum})"
        if quorum and counted_match >= quorum:
            rep.add("verifier quorum", PASS, res_label)
        elif quorum and counted_mismatch >= quorum:
            rep.add("verifier quorum", FAIL, res_label + " — verifiers reject the receipt")
        else:
            rep.add("verifier quorum", WARN, res_label + " — pending")
    if dispute:
        rep.add("dispute", INFO, f"status={dispute.get('status')} challenger={dispute.get('challenger')} "
                                 f"claimed={short(dispute.get('claimed_output_hash'))}")
    if req.get("status") == "Rejected":
        rep.add("final status", FAIL, "request was Rejected on chain (provider slashed)")
    elif req.get("status") == "Verified":
        rep.add("final status", PASS, "Verified on chain")

    rep.print()
    return 1 if rep.failed else 0


# ====================================================================== evidence (offline)

def _find_key(obj: Any, names: tuple[str, ...]) -> Any:
    """Depth-first search for the first scalar value under any of `names`."""
    if isinstance(obj, dict):
        for n in names:
            v = obj.get(n)
            if v is not None and not isinstance(v, (dict, list)):
                return v
        for v in obj.values():
            found = _find_key(v, names)
            if found is not None:
                return found
    elif isinstance(obj, list):
        for v in obj:
            found = _find_key(v, names)
            if found is not None:
                return found
    return None


def _pick_file(files: dict[str, bytes], prefer_names: list[str], prefixes: tuple[str, ...],
               dirs: tuple[str, ...]) -> tuple[str, bytes] | None:
    by_base = {Path(n).name: n for n in files}
    for p in prefer_names:
        if p in by_base:
            return by_base[p], files[by_base[p]]
    for name, data in files.items():
        base = Path(name).name.lower()
        parent = Path(name).parent.name.lower()
        if base in ("request.json", "receipt.json", "manifest.json", "attestations.json"):
            continue
        if base.endswith(".json") and (base.startswith(prefixes) or parent in dirs):
            return name, data
    return None


def cmd_evidence(args: argparse.Namespace) -> int:
    path = Path(args.zip)
    if not path.exists():
        print(f"ERROR: {path} not found", file=sys.stderr)
        return 2
    with zipfile.ZipFile(io.BytesIO(path.read_bytes())) as zf:
        files = {i.filename: zf.read(i) for i in zf.infolist() if not i.is_dir()}

    rep = Report(f"Verity evidence bundle {path.name} ({len(files)} files)")

    def load_json(base: str) -> Any:
        for n, d in files.items():
            if Path(n).name == base:
                try:
                    return json.loads(d)
                except Exception:
                    return None
        return None

    request = load_json("request.json") or {}
    receipt = load_json("receipt.json") or {}
    manifest = load_json("manifest.json")
    rep.ok("request.json present", bool(request), "", "missing or invalid")
    rep.add("receipt.json present", PASS if receipt else WARN, "" if receipt else "missing (no receipt yet?)")

    # optional manifest {"files": {name: sha256}}
    if isinstance(manifest, dict) and isinstance(manifest.get("files"), dict):
        for name, h in manifest["files"].items():
            match = next((d for n, d in files.items() if n == name or Path(n).name == Path(name).name), None)
            if match is None:
                rep.add(f"manifest: {name}", FAIL, "file missing from bundle")
            elif isinstance(h, str) and len(h) == 64:
                got = sha256_hex(match)
                rep.ok(f"manifest: {name}", got == h.lower(), short(got), f"{short(got)} != {short(h)}")

    pda = _find_key(request, ("request_pda", "pda")) or _find_key(receipt, ("request_pda", "request"))
    program_hash = _find_key(request, ("program_hash",))
    input_hash = _find_key(request, ("input_hash",))
    output_hash = _find_key(receipt, ("output_hash",))
    trace_root = _find_key(receipt, ("trace_root",))
    fuel_used = _find_key(receipt, ("fuel_used",))
    signature = _find_key(receipt, ("signature",))
    provider = _find_key(receipt, ("provider_pubkey", "provider")) or _find_key(request, ("provider_pubkey", "provider"))
    rep.add("request_pda", INFO, str(pda or "-"))

    wasm_item = next(((n, d) for n, d in files.items() if n.lower().endswith(".wasm")), None)
    input_item = _pick_file(files, [f"{input_hash}.json"] if input_hash else [], ("input",), ("inputs",))
    output_item = _pick_file(files, [f"{pda}.json"] if pda else [], ("output",), ("outputs",))

    if wasm_item is None:
        rep.add("program file", FAIL, "no .wasm in bundle")
    elif program_hash:
        got = sha256_hex(wasm_item[1])
        rep.ok("program hash", got == str(program_hash).lower(), f"{wasm_item[0]} {short(got)}",
               f"{short(got)} != request {short(program_hash)}")
    if input_item is None:
        rep.add("input file", FAIL, "no input JSON in bundle")
    elif input_hash:
        got = sha256_hex(input_item[1])
        rep.ok("input hash", got == str(input_hash).lower(), f"{input_item[0]} {short(got)}",
               f"INPUT TAMPERED: {short(got)} != request {short(input_hash)}")
    if output_item is None:
        rep.add("output file", SKIP if not receipt else FAIL, "no output JSON in bundle")
    elif output_hash:
        got = sha256_hex(output_item[1])
        rep.ok("output hash", got == str(output_hash).lower(), f"{output_item[0]} {short(got)}",
               f"OUTPUT TAMPERED: {short(got)} != receipt {short(output_hash)}")

    if wasm_item and input_item:
        try:
            res = run_wasm(wasm_item[1], input_item[1], fuel_limit=settings.fuel_limit)
            rep.add("local re-execution", INFO, f"output_hash={short(res.output_hash.hex())} fuel={res.fuel_used}")
            if output_hash:
                rep.ok("re-exec output_hash == receipt", res.output_hash.hex() == str(output_hash).lower(),
                       short(res.output_hash.hex()), f"{short(res.output_hash.hex())} != {short(output_hash)}")
            if trace_root:
                rep.ok("re-exec trace_root == receipt", res.trace_root.hex() == str(trace_root).lower(),
                       short(res.trace_root.hex()), f"{short(res.trace_root.hex())} != {short(trace_root)}")
            if fuel_used is not None:
                rep.ok("re-exec fuel_used == receipt", res.fuel_used == int(fuel_used),
                       str(res.fuel_used), f"{res.fuel_used} != {fuel_used}")
            if output_item:
                rep.ok("re-exec output bytes == bundled output", res.output_bytes == output_item[1],
                       f"{len(output_item[1])} bytes", "bundled output differs from local execution")
        except Exception as exc:
            rep.add("local re-execution", FAIL, f"{type(exc).__name__}: {exc}")
    else:
        rep.add("local re-execution", SKIP, "program or input missing")

    if all(v is not None for v in (pda, program_hash, input_hash, output_hash, trace_root, fuel_used,
                                   signature, provider)):
        try:
            sig_bytes = bytes.fromhex(str(signature))
            msg = receipt_message(str(pda), bytes.fromhex(str(program_hash)), bytes.fromhex(str(input_hash)),
                                  bytes.fromhex(str(output_hash)), bytes.fromhex(str(trace_root)), int(fuel_used))
            # the signed message embeds request_pda, so a valid signature also proves
            # the receipt was issued for this exact request (replay protection)
            rep.ok("receipt signature (ed25519)", verify_receipt(str(provider), msg, sig_bytes),
                   f"signed by {provider} for {short(str(pda), 8)}", "invalid signature")
        except Exception as exc:
            rep.add("receipt signature (ed25519)", FAIL, f"error: {exc}")
    elif receipt:
        rep.add("receipt signature (ed25519)", SKIP, "receipt fields incomplete in bundle")

    rep.print()
    return 1 if rep.failed else 0


def main() -> int:
    ap = argparse.ArgumentParser(prog="verity_cli", description="Verity offline verifier")
    sub = ap.add_subparsers(dest="cmd", required=True)

    v = sub.add_parser("verify", help="verify a request against the chain + public blobs")
    v.add_argument("request_pda")
    v.add_argument("--rpc", default=None, help="Solana RPC URL (default SOLANA_RPC_URL)")
    v.add_argument("--api", default=None, help="Verity API base URL (used to locate blobs if SUPABASE_URL unset)")
    v.add_argument("--program-id", default=None, help="override PROGRAM_ID")
    v.add_argument("--supabase-url", default=None, help="override SUPABASE_URL for public blob URLs")
    v.add_argument("--show-output", action="store_true", help="print the re-computed output JSON")

    e = sub.add_parser("evidence", help="verify an evidence bundle zip fully offline")
    e.add_argument("zip")

    args = ap.parse_args()
    if args.cmd == "verify":
        return asyncio.run(cmd_verify(args))
    return cmd_evidence(args)


if __name__ == "__main__":
    sys.exit(main())
