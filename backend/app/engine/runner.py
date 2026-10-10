"""Deterministic WASM execution engine (wasmtime, fuel-metered, zero host imports).

Rule-set ABI (see Implementation_plan.md section 9.1):
    exports  memory
             alloc(len: i32) -> i32
             compute(ptr: i32, len: i32) -> i32   # pointer to [u32 LE len][output bytes]
    imports  none

trace_root = sha256(b"TRACE_V1" + sha256(input) + sha256(output) + fuel_used.to_bytes(8, "little"))

The wasmtime Python API changed across releases (fuel: ``add_fuel``/``fuel_consumed``
vs ``set_fuel``/``get_fuel``; memory: ``data_ptr`` vs ``read``/``write``), so every
version-sensitive call goes through a small defensive helper below.
"""
from __future__ import annotations

import ctypes
import hashlib
import json
import logging
import threading
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any

import wasmtime

from app.config import settings

logger = logging.getLogger("verity.engine")

TRACE_DOMAIN = b"TRACE_V1"
MAX_OUTPUT_BYTES = 4 * 1024 * 1024          # 4 MB output cap
MAX_INPUT_BYTES = 8 * 1024 * 1024           # refuse absurd inputs before touching the VM
MAX_MEMORY_BYTES = 256 * 1024 * 1024        # linear-memory cap per execution (if supported)
REQUIRED_EXPORTS = ("memory", "alloc", "compute")
_MODULE_CACHE_SIZE = 16
_U32 = 0xFFFFFFFF


# ---------------------------------------------------------------- exceptions


class ProgramHashMismatch(Exception):
    """sha256(wasm_bytes) does not equal the program hash committed on chain."""


class InputHashMismatch(Exception):
    """sha256(input_bytes) does not equal the input hash committed on chain."""


class ExecutionError(Exception):
    """The module is invalid, trapped, ran out of fuel, or produced bad output."""


@dataclass
class ExecResult:
    output_bytes: bytes
    output: Any
    output_hash: bytes
    trace_root: bytes
    fuel_used: int

    @property
    def output_hash_hex(self) -> str:
        return self.output_hash.hex()

    @property
    def trace_root_hex(self) -> str:
        return self.trace_root.hex()


# ---------------------------------------------------------------- hashing


def _sha256(b: bytes) -> bytes:
    return hashlib.sha256(b).digest()


def compute_trace_root(input_bytes: bytes, output_bytes: bytes, fuel_used: int) -> bytes:
    return _sha256(
        TRACE_DOMAIN
        + _sha256(input_bytes)
        + _sha256(output_bytes)
        + int(fuel_used).to_bytes(8, "little")
    )


# ---------------------------------------------------------------- engine / module cache

_engine_lock = threading.Lock()
_engine: wasmtime.Engine | None = None
_module_cache: "OrderedDict[bytes, wasmtime.Module]" = OrderedDict()
_module_lock = threading.Lock()


def _get_engine() -> wasmtime.Engine:
    global _engine
    if _engine is None:
        with _engine_lock:
            if _engine is None:
                cfg = wasmtime.Config()
                cfg.consume_fuel = True
                # Determinism hardening where the binding exposes the knobs.
                for attr, value in (
                    ("cranelift_nan_canonicalization", True),
                    ("wasm_threads", False),
                ):
                    try:
                        setattr(cfg, attr, value)
                    except Exception:  # attribute missing in this wasmtime version
                        pass
                _engine = wasmtime.Engine(cfg)
    return _engine


def _compile(wasm_bytes: bytes) -> wasmtime.Module:
    key = _sha256(wasm_bytes)
    with _module_lock:
        mod = _module_cache.get(key)
        if mod is not None:
            _module_cache.move_to_end(key)
            return mod
    try:
        mod = wasmtime.Module(_get_engine(), wasm_bytes)
    except Exception as e:  # WasmtimeError / ValueError on malformed binaries
        raise ExecutionError(f"invalid wasm module: {e}") from e
    with _module_lock:
        _module_cache[key] = mod
        _module_cache.move_to_end(key)
        while len(_module_cache) > _MODULE_CACHE_SIZE:
            _module_cache.popitem(last=False)
    return mod


def _func_arity(ext_type: Any) -> tuple[int, int] | None:
    params = getattr(ext_type, "params", None)
    results = getattr(ext_type, "results", None)
    if params is None or results is None:
        return None
    try:
        return len(list(params)), len(list(results))
    except Exception:
        return None


def _inspect(module: wasmtime.Module) -> tuple[list[str], list[str], dict[str, Any]]:
    imports = [f"{getattr(i, 'module', '?')}.{getattr(i, 'name', '?')}" for i in module.imports]
    exports: list[str] = []
    types: dict[str, Any] = {}
    for e in module.exports:
        exports.append(e.name)
        types[e.name] = e.type
    return imports, exports, types


def _check_abi(imports: list[str], exports: list[str], types: dict[str, Any]) -> None:
    if imports:
        raise ExecutionError(f"module must have zero imports, found: {', '.join(imports)}")
    missing = [n for n in REQUIRED_EXPORTS if n not in exports]
    if missing:
        raise ExecutionError(f"module is missing required exports: {', '.join(missing)}")
    if not isinstance(types["memory"], wasmtime.MemoryType):
        raise ExecutionError("export 'memory' is not a memory")
    for name, want in (("alloc", (1, 1)), ("compute", (2, 1))):
        t = types[name]
        if not isinstance(t, wasmtime.FuncType):
            raise ExecutionError(f"export '{name}' is not a function")
        arity = _func_arity(t)
        if arity is not None and arity != want:
            raise ExecutionError(
                f"export '{name}' has signature ({arity[0]} params -> {arity[1]} results), "
                f"expected ({want[0]} -> {want[1]})"
            )


def validate_module(wasm_bytes: bytes) -> dict:
    """Compile and check the rule-set ABI. Raises ExecutionError when invalid."""
    if not wasm_bytes:
        raise ExecutionError("empty wasm module")
    module = _compile(bytes(wasm_bytes))
    imports, exports, types = _inspect(module)
    _check_abi(imports, exports, types)
    return {"exports": exports, "imports": imports, "size": len(wasm_bytes)}


# ---------------------------------------------------------------- version-tolerant helpers


def _set_fuel(store: wasmtime.Store, amount: int) -> None:
    if hasattr(store, "set_fuel"):
        store.set_fuel(amount)
    elif hasattr(store, "add_fuel"):
        store.add_fuel(amount)
    else:  # pragma: no cover - extremely old binding
        raise ExecutionError("this wasmtime version does not support fuel metering")


def _fuel_used(store: wasmtime.Store, limit: int) -> int:
    if hasattr(store, "get_fuel"):
        try:
            return int(limit - store.get_fuel())
        except Exception:
            pass
    if hasattr(store, "fuel_consumed"):
        consumed = store.fuel_consumed()
        if consumed is not None:
            return int(consumed)
    raise ExecutionError("unable to read fuel consumption from wasmtime store")


def _fuel_remaining(store: wasmtime.Store, limit: int) -> int | None:
    try:
        return limit - _fuel_used(store, limit)
    except Exception:
        return None


def _apply_limits(store: wasmtime.Store) -> None:
    if hasattr(store, "set_limits"):
        try:
            store.set_limits(memory_size=MAX_MEMORY_BYTES)
        except Exception as e:  # signature differs between versions
            logger.debug("store.set_limits unavailable: %s", e)


def _mem_size(mem: wasmtime.Memory, store: wasmtime.Store) -> int:
    return int(mem.data_len(store))


def _mem_read(mem: wasmtime.Memory, store: wasmtime.Store, start: int, length: int) -> bytes:
    size = _mem_size(mem, store)
    if start < 0 or length < 0 or start + length > size:
        raise ExecutionError(
            f"out-of-bounds memory read [{start}, {start + length}) (memory size {size})"
        )
    if hasattr(mem, "read"):
        return bytes(mem.read(store, start, start + length))
    base = ctypes.addressof(mem.data_ptr(store).contents)
    return ctypes.string_at(base + start, length)


def _mem_write(mem: wasmtime.Memory, store: wasmtime.Store, data: bytes, start: int) -> None:
    size = _mem_size(mem, store)
    if start < 0 or start + len(data) > size:
        raise ExecutionError(
            f"out-of-bounds memory write [{start}, {start + len(data)}) (memory size {size})"
        )
    if hasattr(mem, "write"):
        mem.write(store, data, start)
        return
    base = ctypes.addressof(mem.data_ptr(store).contents)
    ctypes.memmove(base + start, data, len(data))


def _is_out_of_fuel(exc: BaseException, store: wasmtime.Store, limit: int) -> bool:
    code = getattr(exc, "trap_code", None)
    if code is not None and "fuel" in str(code).lower():
        return True
    if "fuel" in str(exc).lower():
        return True
    remaining = _fuel_remaining(store, limit)
    return remaining is not None and remaining <= 0


# ---------------------------------------------------------------- run


def run(
    wasm_bytes: bytes,
    input_bytes: bytes,
    expected_program_hash: bytes | None = None,
    expected_input_hash: bytes | None = None,
    fuel_limit: int | None = None,
) -> ExecResult:
    """Execute a rule set on `input_bytes` (passed verbatim). Synchronous / CPU-bound."""
    wasm_bytes = bytes(wasm_bytes)
    input_bytes = bytes(input_bytes)

    if expected_program_hash is not None and _sha256(wasm_bytes) != bytes(expected_program_hash):
        raise ProgramHashMismatch(
            f"program hash mismatch: expected {bytes(expected_program_hash).hex()}, "
            f"got {_sha256(wasm_bytes).hex()}"
        )
    if expected_input_hash is not None and _sha256(input_bytes) != bytes(expected_input_hash):
        raise InputHashMismatch(
            f"input hash mismatch: expected {bytes(expected_input_hash).hex()}, "
            f"got {_sha256(input_bytes).hex()}"
        )
    if len(input_bytes) > MAX_INPUT_BYTES:
        raise ExecutionError(f"input too large ({len(input_bytes)} bytes > {MAX_INPUT_BYTES})")

    limit = int(fuel_limit or settings.fuel_limit)
    if limit <= 0:
        raise ExecutionError("fuel limit must be positive")

    module = _compile(wasm_bytes)
    imports, exports, types = _inspect(module)
    _check_abi(imports, exports, types)

    store = wasmtime.Store(_get_engine())
    _apply_limits(store)
    _set_fuel(store, limit)

    try:
        linker = wasmtime.Linker(_get_engine())  # NO WASI, NO host functions
        instance = linker.instantiate(store, module)
        ex = instance.exports(store)
        memory = ex["memory"]
        alloc = ex["alloc"]
        compute = ex["compute"]
        if not isinstance(memory, wasmtime.Memory):
            raise ExecutionError("export 'memory' is not a memory instance")

        in_len = len(input_bytes)
        in_ptr = int(alloc(store, in_len)) & _U32
        _mem_write(memory, store, input_bytes, in_ptr)

        out_ptr = int(compute(store, in_ptr, in_len)) & _U32
        out_len = int.from_bytes(_mem_read(memory, store, out_ptr, 4), "little")
        if out_len > MAX_OUTPUT_BYTES:
            raise ExecutionError(f"output too large ({out_len} bytes > {MAX_OUTPUT_BYTES})")
        output_bytes = _mem_read(memory, store, out_ptr + 4, out_len)
        fuel_used = _fuel_used(store, limit)
    except ExecutionError:
        raise
    except (wasmtime.Trap, wasmtime.WasmtimeError) as e:
        if _is_out_of_fuel(e, store, limit):
            raise ExecutionError("out of fuel") from e
        raise ExecutionError(f"wasm trap: {e}") from e
    except (KeyError, TypeError, ValueError, OverflowError) as e:
        raise ExecutionError(f"ABI violation: {e}") from e

    if not output_bytes:
        raise ExecutionError("program produced empty output")
    try:
        output = json.loads(output_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise ExecutionError(f"program output is not valid UTF-8 JSON: {e}") from e

    return ExecResult(
        output_bytes=output_bytes,
        output=output,
        output_hash=_sha256(output_bytes),
        trace_root=compute_trace_root(input_bytes, output_bytes, fuel_used),
        fuel_used=fuel_used,
    )
