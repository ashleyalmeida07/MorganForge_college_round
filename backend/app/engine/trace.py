"""Execution-trace Merkle commitments (TRACE_V2).

A run produces an ordered list of *steps*:

    step 0        the canonical input bytes
    step 1..n     checkpoint records emitted by the rule set's optional ``trace()``
                  export (one canonical-JSON line per intermediate state)
    step n+1      the canonical output bytes

    leaf_i     = sha256(b"VERITY_TRACE_LEAF_V2" || u32le(i) || sha256(step_i))
    node       = sha256(0x01 || left || right)        (an odd node is carried up as-is)
    trace_root = sha256(b"VERITY_TRACE_V2" || u32le(leaf_count) || merkle_root)

Two executions that disagree can compare leaves and point at the *first divergent
step* (e.g. "month 7 balance") instead of only "the outputs differ"; a Merkle proof
for that leaf ties it to the trace_root committed on chain.

Byte-identical implementations: frontend/src/lib/trace.ts and the offline CLI.
Fuel is not part of the root (the browser cannot meter fuel); it is committed
separately in the receipt and compared by verifiers on chain.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any

TRACE_VERSION = "TRACE_V2"
LEAF_DOMAIN = b"VERITY_TRACE_LEAF_V2"
ROOT_DOMAIN = b"VERITY_TRACE_V2"
NODE_PREFIX = b"\x01"
MAX_PUBLISHED_STEP_BYTES = 2048  # checkpoint data larger than this is published as hash only


def _h(b: bytes) -> bytes:
    return hashlib.sha256(b).digest()


def split_checkpoints(ndjson: bytes) -> list[bytes]:
    """NDJSON from the rule set's trace() export -> list of checkpoint records."""
    return [line for line in bytes(ndjson).split(b"\n") if line]


def steps_of(input_bytes: bytes, checkpoints: list[bytes], output_bytes: bytes) -> list[bytes]:
    return [bytes(input_bytes), *[bytes(c) for c in checkpoints], bytes(output_bytes)]


def leaf_hash(index: int, step: bytes) -> bytes:
    return _h(LEAF_DOMAIN + int(index).to_bytes(4, "little") + _h(step))


def leaves_of(steps: list[bytes]) -> list[bytes]:
    return [leaf_hash(i, s) for i, s in enumerate(steps)]


def _levels(leaves: list[bytes]) -> list[list[bytes]]:
    if not leaves:
        raise ValueError("trace must contain at least one leaf")
    levels = [list(leaves)]
    while len(levels[-1]) > 1:
        cur = levels[-1]
        nxt = [_h(NODE_PREFIX + cur[i] + cur[i + 1]) for i in range(0, len(cur) - 1, 2)]
        if len(cur) % 2:
            nxt.append(cur[-1])
        levels.append(nxt)
    return levels


def merkle_root(leaves: list[bytes]) -> bytes:
    return _levels(leaves)[-1][0]


def root_from_leaves(leaves: list[bytes]) -> bytes:
    return _h(ROOT_DOMAIN + len(leaves).to_bytes(4, "little") + merkle_root(leaves))


def trace_root(input_bytes: bytes, checkpoints: list[bytes], output_bytes: bytes) -> bytes:
    return root_from_leaves(leaves_of(steps_of(input_bytes, checkpoints, output_bytes)))


def merkle_proof(leaves: list[bytes], index: int) -> list[dict[str, str]]:
    """Sibling path for leaf `index`: [{"side": "left"|"right", "hash": hex}, ...]."""
    if not 0 <= index < len(leaves):
        raise IndexError("leaf index out of range")
    proof: list[dict[str, str]] = []
    idx = index
    for level in _levels(leaves)[:-1]:
        sib = idx ^ 1
        if sib < len(level):
            proof.append({"side": "left" if sib < idx else "right", "hash": level[sib].hex()})
        idx //= 2
    return proof


def verify_proof(leaf: bytes, proof: list[dict[str, str]], leaf_count: int, expected_root: bytes) -> bool:
    node = leaf
    for p in proof:
        sib = bytes.fromhex(p["hash"])
        node = _h(NODE_PREFIX + sib + node) if p["side"] == "left" else _h(NODE_PREFIX + node + sib)
    return _h(ROOT_DOMAIN + int(leaf_count).to_bytes(4, "little") + node) == expected_root


def first_divergence(a: list[bytes] | list[str], b: list[bytes] | list[str]) -> int | None:
    """Index of the first differing leaf (or the shorter length if one is a prefix)."""
    norm = lambda x: x.hex() if isinstance(x, (bytes, bytearray)) else str(x).lower()  # noqa: E731
    for i, (x, y) in enumerate(zip(a, b)):
        if norm(x) != norm(y):
            return i
    return None if len(a) == len(b) else min(len(a), len(b))


def _label(step: bytes) -> tuple[str | None, Any]:
    try:
        obj = json.loads(step.decode("utf-8"))
        if isinstance(obj, dict) and "step" in obj:
            return str(obj["step"]), obj.get("state")
    except (UnicodeDecodeError, json.JSONDecodeError):
        pass
    return None, None


def trace_document(
    input_bytes: bytes,
    checkpoints: list[bytes],
    output_bytes: bytes,
    *,
    request_pda: str | None = None,
    program_hash: str | None = None,
) -> dict[str, Any]:
    """Publishable trace (stored next to the output blob as outputs/{pda}.trace.json)."""
    steps = steps_of(input_bytes, checkpoints, output_bytes)
    leaves = leaves_of(steps)
    out: list[dict[str, Any]] = []
    for i, (s, leaf) in enumerate(zip(steps, leaves)):
        kind = "input" if i == 0 else "output" if i == len(steps) - 1 else "checkpoint"
        item: dict[str, Any] = {"index": i, "kind": kind, "step_hash": _h(s).hex(), "leaf": leaf.hex()}
        if kind == "checkpoint":
            label, state = _label(s)
            item["label"] = label
            if len(s) <= MAX_PUBLISHED_STEP_BYTES:
                item["data"] = s.decode("utf-8", "replace")
                item["state"] = state
        out.append(item)
    return {
        "version": TRACE_VERSION,
        "request_pda": request_pda,
        "program_hash": program_hash,
        "input_hash": _h(bytes(input_bytes)).hex(),
        "output_hash": _h(bytes(output_bytes)).hex(),
        "leaf_count": len(leaves),
        "merkle_root": merkle_root(leaves).hex(),
        "trace_root": root_from_leaves(leaves).hex(),
        "steps": out,
    }


def check_document(doc: dict[str, Any]) -> dict[str, Any]:
    """Recompute a published trace's root from its leaves; also re-derive each leaf
    from the step hash. Returns {"ok", "trace_root", "errors"}."""
    errors: list[str] = []
    steps = doc.get("steps") or []
    leaves: list[bytes] = []
    for i, s in enumerate(steps):
        try:
            sh = bytes.fromhex(s["step_hash"])
            leaf = bytes.fromhex(s["leaf"])
        except (KeyError, ValueError):
            errors.append(f"step {i}: malformed")
            continue
        if _h(LEAF_DOMAIN + i.to_bytes(4, "little") + sh) != leaf:
            errors.append(f"step {i}: leaf != H(index, step_hash)")
        if "data" in s and _h(str(s["data"]).encode("utf-8")).hex() != s["step_hash"]:
            errors.append(f"step {i}: data does not hash to step_hash")
        leaves.append(leaf)
    root = root_from_leaves(leaves).hex() if leaves else None
    if root and doc.get("trace_root") and root != str(doc["trace_root"]).lower():
        errors.append("recomputed root != document trace_root")
    return {"ok": not errors and root is not None, "trace_root": root, "errors": errors}
