"""Seed the prebuilt WASM rule sets (rulesets/*) into Supabase storage + the programs table.

Repo-root entry point (Implementation_plan.md §12); the implementation lives in
backend/scripts/seed_rulesets.py and runs with the backend's settings (backend/.env).
Run it with the backend's Python environment, e.g. backend/.venv.
"""
import runpy
import sys
from pathlib import Path

TARGET = Path(__file__).resolve().parents[1] / "backend" / "scripts" / "seed_rulesets.py"

if __name__ == "__main__":
    sys.argv[0] = str(TARGET)
    runpy.run_path(str(TARGET), run_name="__main__")
