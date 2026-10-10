"""Pytest setup: make `app` importable and load backend/.env regardless of cwd."""
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

_cwd = os.getcwd()
os.chdir(BACKEND_DIR)  # pydantic-settings reads ".env" relative to cwd at import time
try:
    import app.config  # noqa: E402,F401
finally:
    os.chdir(_cwd)


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "devnet: end-to-end scenario against a live deployment + Solana devnet (needs VERITY_E2E=1)",
    )
