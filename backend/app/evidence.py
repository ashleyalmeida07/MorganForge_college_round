"""Evidence bundle (zip) for offline audit of a single request."""
from __future__ import annotations

import asyncio
import io
import json
import zipfile
from datetime import datetime, timezone
from typing import Any

from app.config import settings
from app.routes.common import (
    blob_uris,
    build_artifacts,
    build_timeline,
    compute_integrity,
    db_audit_rows,
    decorate_program,
    expected_hashes,
    fetch_blob,
    load_bundle,
)
from app.utils import explorer_addr, explorer_tx, sha256_hex


def _json_bytes(obj: Any) -> bytes:
    return json.dumps(obj, indent=2, sort_keys=True, default=str, ensure_ascii=False).encode("utf-8")


def _verify_md(pda: str, exp: dict[str, Any], uris: dict[str, Any], integrity: dict[str, Any],
               files: dict[str, str], tx_sigs: list[str], commitment: dict[str, Any] | None) -> str:
    cluster = settings.cluster

    def v(x: Any) -> str:
        return str(x) if x not in (None, "") else "(not available)"

    lines = [
        f"# Verity evidence bundle — request `{pda}`",
        "",
        f"Generated: {datetime.now(timezone.utc).isoformat()}  ",
        f"Cluster: `{cluster}`  ",
        f"Program (verity_core): `{settings.program_id}`  ",
        f"Request account: {explorer_addr(pda, cluster)}",
        "",
        "This bundle lets anyone re-check the computation **without trusting the Verity backend**.",
        "The authoritative commitments live on Solana; every file here can be re-hashed and compared.",
        "",
        "## 1. Expected commitments",
        "",
        f"Source of expected values: **{exp.get('source')}** (`chain` = read live from the Solana account).",
        "",
        "| Commitment | Value |",
        "|---|---|",
        f"| program_hash (sha256 of program.wasm) | `{v(exp.get('program_hash'))}` |",
        f"| input_hash (sha256 of input.json) | `{v(exp.get('input_hash'))}` |",
        f"| input_uri_hash (sha256 of the string `{v(uris.get('input'))}`) | `{v(exp.get('input_uri_hash'))}` |",
        f"| output_hash (sha256 of output.json) | `{v(exp.get('output_hash'))}` |",
        f"| trace_root | `{v(exp.get('trace_root'))}` |",
        f"| fuel_used | `{v(exp.get('fuel_used'))}` |",
        f"| provider (receipt signer) | `{v(exp.get('provider'))}` |",
        f"| receipt signature (ed25519, hex) | `{v(exp.get('signature'))}` |",
        "",
        "## 2. Server-side integrity result at bundle time",
        "",
        f"Overall: **{integrity.get('overall')}**",
        "",
        "| Check | Status |",
        "|---|---|",
        f"| program.wasm hash | {integrity.get('program', {}).get('status')} |",
        f"| input.json hash | {integrity.get('input', {}).get('status')} |",
        f"| input URI hash | {integrity.get('input_uri', {}).get('status')} |",
        f"| output.json hash | {integrity.get('output', {}).get('status')} |",
        f"| receipt signature | {integrity.get('receipt_signature', {}).get('status')} |",
        f"| requester input commitment | {integrity.get('input_commitment', {}).get('status')} |",
        "",
        "Do not trust this table — re-run the checks below yourself.",
        "",
        "## 3. Re-check file hashes",
        "",
        "```bash",
        "sha256sum program.wasm input.json output.json      # Linux",
        "shasum -a 256 program.wasm input.json output.json  # macOS",
        "Get-FileHash -Algorithm SHA256 program.wasm        # Windows PowerShell",
        "```",
        "",
        "Compare each digest with the table in section 1. `input.json` and `output.json` are stored as",
        "canonical JSON bytes (keys sorted, no whitespace, UTF-8), so they must be hashed **as-is**.",
        "",
        "## 4. Re-check the input URI commitment",
        "",
        "```python",
        "import hashlib",
        f"print(hashlib.sha256(b\"{v(uris.get('input'))}\").hexdigest())  # == input_uri_hash",
        "```",
        "",
        "## 5. Re-execute the program",
        "",
        "Rule-set ABI: the module has no imports and exports `memory`, `alloc(len) -> ptr` and",
        "`compute(ptr, len) -> ptr`, where the result pointer addresses `[u32 little-endian length][output bytes]`.",
        "",
        "```python",
        "import hashlib, wasmtime",
        "wasm = open('program.wasm','rb').read(); inp = open('input.json','rb').read()",
        "cfg = wasmtime.Config(); cfg.consume_fuel = True",
        "eng = wasmtime.Engine(cfg); st = wasmtime.Store(eng); FUEL = " + str(settings.fuel_limit) + "; st.set_fuel(FUEL)",
        "inst = wasmtime.Linker(eng).instantiate(st, wasmtime.Module(eng, wasm))",
        "ex = inst.exports(st); mem = ex['memory']",
        "p = ex['alloc'](st, len(inp)); mem.write(st, inp, p)",
        "o = ex['compute'](st, p, len(inp))",
        "n = int.from_bytes(mem.read(st, o, o + 4), 'little'); out = bytes(mem.read(st, o + 4, o + 4 + n))",
        "fuel = FUEL - st.get_fuel()   # read BEFORE calling trace()",
        "print('output_hash', hashlib.sha256(out).hexdigest(), 'fuel_used', fuel)",
        "# TRACE_V2: Merkle root over [input, checkpoints..., output]",
        "cps = []",
        "if 'trace' in [e.name for e in wasmtime.Module(eng, wasm).exports]:",
        "    t = ex['trace'](st); tn = int.from_bytes(mem.read(st, t, t + 4), 'little')",
        "    cps = [l for l in bytes(mem.read(st, t + 4, t + 4 + tn)).split(b'\n') if l]",
        "h = lambda b: hashlib.sha256(b).digest()",
        "steps = [inp, *cps, out]",
        "lvl = [h(b'VERITY_TRACE_LEAF_V2' + i.to_bytes(4, 'little') + h(s)) for i, s in enumerate(steps)]",
        "n_leaves = len(lvl)",
        "while len(lvl) > 1:",
        "    lvl = [h(b'\x01' + lvl[i] + lvl[i + 1]) for i in range(0, len(lvl) - 1, 2)] + ([lvl[-1]] if len(lvl) % 2 else [])",
        "print('trace_root', h(b'VERITY_TRACE_V2' + n_leaves.to_bytes(4, 'little') + lvl[0]).hex())",
        "```",
        "",
        "`trace.json` is the provider's published trace: every step's hash and Merkle leaf, plus the",
        "checkpoint data. Comparing its leaves with your own run pinpoints the first divergent step.",
        "",
        "Browsers can do the same with `WebAssembly.instantiate(wasm, {})` (fuel is not metered there, so",
        "compare `output_hash` and `trace_root`; fuel is compared by the on-chain verifiers).",
        "",
        "## 6. Re-check signatures",
        "",
        "### 6.1 Provider's receipt signature",
        "",
        "The provider signs `b\"VERITY_RECEIPT_V1\" + request_pda(32 bytes) + program_hash(32) + input_hash(32)",
        "+ output_hash(32) + trace_root(32) + fuel_used(u64 little-endian)` with its Ed25519 key.",
        "",
        "```python",
        "import base58, nacl.signing",
        f"msg = (b'VERITY_RECEIPT_V1' + base58.b58decode('{pda}')",
        f"       + bytes.fromhex('{v(exp.get('program_hash'))}') + bytes.fromhex('{v(exp.get('input_hash'))}')",
        f"       + bytes.fromhex('{v(exp.get('output_hash'))}') + bytes.fromhex('{v(exp.get('trace_root'))}')",
        f"       + int('{v(exp.get('fuel_used'))}').to_bytes(8, 'little'))",
        f"nacl.signing.VerifyKey(base58.b58decode('{v(exp.get('provider'))}')).verify(msg, bytes.fromhex('{v(exp.get('signature'))}'))",
        "```",
        "",
        "The same check was enforced on-chain through the Ed25519 precompile when the receipt was submitted.",
        "",
        "### 6.2 Requester's input commitment (off-chain, see `input_commitment.json`)",
        "",
        "Before `create_request` was ever sent, the requester's wallet signed",
        "`b\"VERITY_INPUT_V1\" + program_hash(32) + input_hash(32) + input_uri_hash(32)` — proof of exactly what",
        "was asked for, independent of reading the chain.",
        "",
        "```python",
        "import base58, nacl.signing",
        f"msg = (b'VERITY_INPUT_V1' + bytes.fromhex('{v((commitment or {}).get('program_hash'))}')",
        f"       + bytes.fromhex('{v((commitment or {}).get('input_hash'))}')",
        f"       + bytes.fromhex('{v((commitment or {}).get('input_uri_hash'))}'))",
        f"nacl.signing.VerifyKey(base58.b58decode('{v((commitment or {}).get('requester_pubkey'))}'))"
        f".verify(msg, base58.b58decode('{v((commitment or {}).get('signature'))}'))",
        "```",
        "",
        "## 7. Re-check the hash-chained audit log",
        "",
        "`audit_log.json` holds every off-chain audit row for this request. Each row satisfies",
        "`row_hash = sha256_hex(prev_hash.encode() + canonical_json(payload))` (genesis prev_hash = 64 zeros).",
        "Rows here are a filtered subset, so verify that each row's own `row_hash` recomputes from its",
        "`prev_hash` + payload; the full chain head is periodically anchored on-chain via `anchor_audit_root`.",
        "",
        "```python",
        "import json, hashlib",
        "canon = lambda o: json.dumps(o, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()",
        "for r in json.load(open('audit_log.json')):",
        "    assert hashlib.sha256(r['prev_hash'].encode() + canon(r['payload'])).hexdigest() == r['row_hash'], r['seq']",
        "```",
        "",
        "## 8. On-chain transactions",
        "",
    ]
    if tx_sigs:
        lines += [f"- {explorer_tx(s, cluster)}" for s in tx_sigs]
    else:
        lines.append("- (none indexed yet)")
    lines += ["", "## 9. Files in this bundle (sha256)", "", "| File | sha256 |", "|---|---|"]
    lines += [f"| {name} | `{digest}` |" for name, digest in sorted(files.items())]
    lines.append("")
    return "\n".join(lines)


async def build_evidence_zip(request_pda: str) -> tuple[bytes, str] | None:
    b = await load_bundle(request_pda)
    if b is None:
        return None
    pda = b["pda"]
    exp, uris = expected_hashes(b), blob_uris(b)

    has_receipt = bool(b.get("chain_receipt") or b.get("receipt"))
    (wasm, _), (inp, _), (out, _), (trace, _), (src, _), audit_rows, integrity = await asyncio.gather(
        fetch_blob(uris["wasm"]),
        fetch_blob(uris["input"]),
        fetch_blob(uris["output"]) if has_receipt else asyncio.sleep(0, result=(None, None)),
        fetch_blob(uris["trace"]) if has_receipt else asyncio.sleep(0, result=(None, None)),
        fetch_blob(uris["source"]) if uris.get("source") else asyncio.sleep(0, result=(None, None)),
        asyncio.to_thread(db_audit_rows, pda, 5000),
        compute_integrity(b),
    )
    timeline = build_timeline(b, audit_rows)

    tx_sigs: list[str] = []
    for item in timeline:
        s = item.get("tx_sig")
        if s and s not in tx_sigs:
            tx_sigs.append(s)

    entries: dict[str, bytes] = {}
    if wasm is not None:
        entries["program.wasm"] = wasm
    if src is not None:
        entries["program.src.txt"] = src
    if inp is not None:
        entries["input.json"] = inp
    if out is not None:
        entries["output.json"] = out
    if trace is not None:
        entries["trace.json"] = trace
    entries["receipt.json"] = _json_bytes({"chain": b.get("chain_receipt"), "db": b.get("receipt")})
    entries["attestations.json"] = _json_bytes(b.get("attestations") or [])
    entries["dispute.json"] = _json_bytes({"chain": b.get("chain_dispute"), "db": b.get("dispute")})
    entries["request.json"] = _json_bytes({"chain": b.get("chain"), "db": b.get("row")})
    entries["input_commitment.json"] = _json_bytes(b.get("input_commitment"))
    entries["program.json"] = _json_bytes(decorate_program(b.get("program")))
    entries["timeline.json"] = _json_bytes(timeline)
    entries["audit_log.json"] = _json_bytes(audit_rows)
    entries["integrity.json"] = _json_bytes(integrity)
    entries["artifacts.json"] = _json_bytes(build_artifacts(b))
    entries["transactions.json"] = _json_bytes(
        [{"signature": s, "explorer": explorer_tx(s, settings.cluster)} for s in tx_sigs]
    )

    digests = {name: sha256_hex(data) for name, data in entries.items()}
    entries["VERIFY.md"] = _verify_md(pda, exp, uris, integrity, digests, tx_sigs, b.get("input_commitment")).encode(
        "utf-8"
    )
    manifest = {
        "request_pda": pda,
        "program_id": settings.program_id,
        "cluster": settings.cluster,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "expected": exp,
        "files": digests,
    }
    entries["manifest.json"] = _json_bytes(manifest)

    def _zip() -> bytes:
        buf = io.BytesIO()
        root = f"verity-evidence-{pda[:12]}"
        with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for name, data in entries.items():
                zf.writestr(f"{root}/{name}", data)
        return buf.getvalue()

    data = await asyncio.to_thread(_zip)
    return data, f"verity-evidence-{pda}.zip"
