"""Apply supabase/migrations/*.sql (in filename order) to the database in DATABASE_URL.

Usage (from anywhere):
    python backend/scripts/apply_migration.py            # all migrations
    python backend/scripts/apply_migration.py --file 0001_init.sql
    python backend/scripts/apply_migration.py --url postgresql://...

The migrations are idempotent, so re-running is safe.
"""
import argparse
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent
MIGRATIONS_DIR = REPO_ROOT / "supabase" / "migrations"

sys.path.insert(0, str(BACKEND_DIR))
_cwd = os.getcwd()
os.chdir(BACKEND_DIR)  # so pydantic-settings picks up backend/.env
try:
    from app.config import settings  # noqa: E402
finally:
    os.chdir(_cwd)

import psycopg  # noqa: E402


def _redact(url: str) -> str:
    if "@" not in url or "://" not in url:
        return url
    scheme, rest = url.split("://", 1)
    creds, host = rest.rsplit("@", 1)
    user = creds.split(":", 1)[0]
    return f"{scheme}://{user}:***@{host}"


def main() -> int:
    ap = argparse.ArgumentParser(description="Apply Verity SQL migrations")
    ap.add_argument("--url", default=None, help="Postgres URL (defaults to DATABASE_URL from backend/.env)")
    ap.add_argument("--dir", default=str(MIGRATIONS_DIR), help="migrations directory")
    ap.add_argument("--file", action="append", default=None,
                    help="apply only this migration file name (repeatable)")
    args = ap.parse_args()

    url = args.url or os.environ.get("DATABASE_URL") or settings.database_url
    if not url:
        print("ERROR: DATABASE_URL is not set (backend/.env or --url).", file=sys.stderr)
        return 2

    mig_dir = Path(args.dir)
    files = sorted(mig_dir.glob("*.sql"))
    if args.file:
        wanted = set(args.file)
        files = [f for f in files if f.name in wanted]
    if not files:
        print(f"ERROR: no migrations found in {mig_dir}", file=sys.stderr)
        return 2

    print(f"database: {_redact(url)}")
    if ":6543" in url:
        print("note: port 6543 is the Supabase pooler (transaction mode); prepared statements disabled.")

    # prepare_threshold=None: never use server-side prepared statements (required by
    # PgBouncer/Supavisor in transaction mode). With no params psycopg sends the
    # file as a simple query, so multi-statement scripts and DO $$ blocks work.
    with psycopg.connect(url, autocommit=True, prepare_threshold=None, connect_timeout=20) as conn:
        for f in files:
            sql = f.read_text(encoding="utf-8")
            print(f"applying {f.name} ({len(sql)} bytes) ...", end=" ", flush=True)
            try:
                with conn.cursor() as cur:
                    cur.execute(sql)
            except psycopg.Error as exc:
                print("FAILED")
                print(f"  {type(exc).__name__}: {exc}", file=sys.stderr)
                return 1
            print("ok")

        with conn.cursor() as cur:
            cur.execute(
                "select table_name from information_schema.tables "
                "where table_schema = 'public' order by table_name"
            )
            tables = [r[0] for r in cur.fetchall()]
    print("public tables:", ", ".join(tables))
    return 0


if __name__ == "__main__":
    sys.exit(main())
