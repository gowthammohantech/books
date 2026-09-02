#!/usr/bin/env python3
"""Seed a company (tenant) with realistic data for every module.

    python scripts/seed_company.py --list
    python scripts/seed_company.py --company "Acme Ltd" --create          # dry run
    python scripts/seed_company.py --company "Acme Ltd" --create --confirm
    python scripts/seed_company.py --company acme-ltd --confirm

WHAT THIS IS. A front door, not an implementation. Every decision that needs to
know the domain -- resolving a company by id/name/slug, creating the workspace,
what "use-case-wise data" means per module, how the ledger must balance -- lives
in TypeScript, in apps/api/prisma/seedCompany.ts, next to the Prisma schema and
the posting engine that already own those rules. This script resolves the repo,
picks a runner, forwards the arguments and propagates the exit code.

That split is deliberate. Re-implementing tenant resolution here would mean two
definitions of "which company did you mean" in two languages, drifting apart;
and this file would need a database driver, a connection string parser and a
requirements.txt in a repo that has no Python tooling at all. It has no
third-party dependencies and never opens a database connection.

DESTRUCTIVE. Seeding an existing workspace WIPES its business data first --
invoices, purchases, contacts, accounts, journal entries, non-owner staff. So
nothing is written unless you pass --confirm; without it you get a dry run that
reports exactly what would be deleted.

Exit codes (from seedCompany.ts):
    0 ok · 1 error · 2 company not found · 3 ambiguous name
    4 bad argument · 5 refused · 130 interrupted
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

TS_ENTRYPOINT = "prisma/seedCompany.ts"
JS_ENTRYPOINT = "dist/prisma/seedCompany.js"

EXIT_ERROR = 1
EXIT_INTERRUPTED = 130


def find_repo_root() -> Path:
    """Walk up from this file looking for the monorepo root.

    Anchored on __file__ rather than the working directory so the script works
    when invoked from anywhere -- including by an editor or a CI step that sets
    cwd somewhere unrelated.
    """
    here = Path(__file__).resolve()
    for candidate in (here.parent, *here.parents):
        if (candidate / "package.json").is_file() and (
            candidate / "apps" / "api" / "prisma" / "schema.prisma"
        ).is_file():
            return candidate
    sys.exit(
        "Could not locate the repository root above "
        f"{here}.\nExpected a directory holding both package.json and "
        "apps/api/prisma/schema.prisma."
    )


def find_ts_runner(repo_root: Path) -> list[str]:
    """Return an argv prefix that runs ts-node.

    Prefers the workspace-local binary over `npx`: npx re-resolves the same
    file, costs a second or two, and can stop to ask about installing a package
    that is missing. On Windows the local binary is ts-node.cmd, which
    CreateProcess runs directly -- no shell needed.
    """
    binary = "ts-node.cmd" if os.name == "nt" else "ts-node"
    local = repo_root / "node_modules" / ".bin" / binary
    if local.is_file():
        return [str(local)]

    npx = shutil.which("npx")  # resolves npx.cmd via PATHEXT on Windows
    if npx:
        return [npx, "ts-node"]

    sys.exit(
        "ts-node was not found. Run `npm ci` at the repository root, or use "
        "--docker to run the compiled seeder inside the api container."
    )


def build_docker_command(repo_root: Path, forwarded: list[str]) -> list[str]:
    """Compose the docker-compose invocation the Makefile uses.

    Note this runs the COMPILED entrypoint, not ts-node: the production api
    image installs with --omit=dev and has no TypeScript toolchain, so
    `npx ts-node` inside the container would fail. That means the image must
    have been built after seedCompany.ts was added.
    """
    docker = shutil.which("docker")
    if not docker:
        sys.exit("--docker requires the docker CLI on PATH.")
    return [
        docker,
        "compose",
        "--env-file",
        str(repo_root / "docker" / ".env"),
        "-f",
        str(repo_root / "docker" / "docker-compose.yml"),
        "exec",
        "api",
        "node",
        JS_ENTRYPOINT,
        *forwarded,
    ]


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="seed_company.py",
        description="Seed one company (tenant) with data for every module.",
        epilog=(
            "Without --confirm this is a dry run: it resolves the company, "
            "reports what would be deleted, and writes nothing."
        ),
    )
    p.add_argument(
        "-c",
        "--company",
        metavar="ID|NAME|SLUG",
        help="Which company to seed. Matched on id, then slug, then exact name "
        "(case-insensitive). Never a substring: a name matching more than one "
        "company is refused rather than guessed.",
    )
    p.add_argument(
        "--create",
        action="store_true",
        help="Create the company if it does not exist, then seed it.",
    )
    p.add_argument("--owner-email", metavar="EMAIL", help="Owner for a created company.")
    p.add_argument(
        "--owner-password",
        metavar="PW",
        help="Password for a created owner (default Demo123$).",
    )
    p.add_argument(
        "--country",
        default="IN",
        help="Ledger country pack (default IN). Only IN is supported today: the "
        "seeded content is India-specific.",
    )
    p.add_argument(
        "-y",
        "--confirm",
        action="store_true",
        help="Actually write. WITHOUT THIS NOTHING IS WRITTEN.",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Explicitly request the default behaviour. Ignored if --confirm is given.",
    )
    p.add_argument("--list", action="store_true", help="List companies and exit.")
    p.add_argument("--json", action="store_true", help="Emit a JSON result as the last line.")
    p.add_argument(
        "--docker",
        action="store_true",
        help="Run inside the api container instead of locally.",
    )
    p.add_argument("-v", "--verbose", action="store_true", help="Print the command being run.")
    return p


def forwarded_args(ns: argparse.Namespace) -> list[str]:
    """Translate the Python namespace into seedCompany.ts flags."""
    if ns.list:
        return ["--list-tenants"]

    out = ["--company", ns.company]
    if ns.create:
        out.append("--create")
    if ns.owner_email:
        out += ["--owner-email", ns.owner_email]
    if ns.owner_password:
        out += ["--owner-password", ns.owner_password]
    if ns.country:
        out += ["--country", ns.country]
    if ns.confirm:
        out.append("--confirm")
    if ns.json:
        out.append("--json")
    return out


def main() -> int:
    parser = build_parser()
    ns = parser.parse_args()

    if ns.list and ns.company:
        parser.error("--list takes no --company.")
    if not ns.list and not ns.company:
        parser.error("--company is required (or --list).")
    if ns.confirm and ns.dry_run:
        # Not an error worth stopping for, but say which one won.
        print("Both --confirm and --dry-run given; --confirm wins.", file=sys.stderr)

    repo_root = find_repo_root()
    api_dir = repo_root / "apps" / "api"
    forwarded = forwarded_args(ns)

    if ns.docker:
        cmd: list[str] = build_docker_command(repo_root, forwarded)
        cwd = repo_root
    else:
        cmd = [*find_ts_runner(repo_root), TS_ENTRYPOINT, *forwarded]
        # cwd is apps/api so Prisma Client finds apps/api/.env and the schema on
        # its own. This script deliberately does not read DATABASE_URL itself --
        # the seeder connects the same way the application does. An explicit
        # DATABASE_URL already in the environment still wins, which is how CI
        # points it at a scratch database.
        cwd = api_dir

    if ns.verbose:
        print(f"$ {subprocess.list2cmdline(cmd)}", file=sys.stderr)
        print(f"  (cwd {cwd})", file=sys.stderr)

    try:
        # shell=False with a list argv: correct for .cmd on Windows via
        # CreateProcess, and it means a company name containing spaces, quotes
        # or an ampersand needs no escaping and cannot be reinterpreted.
        #
        # stdout/stderr are deliberately NOT captured, so the child inherits the
        # console and its progress output streams live rather than arriving in
        # one lump at the end. --json still works: the envelope is the last line.
        return subprocess.run(cmd, cwd=str(cwd)).returncode
    except FileNotFoundError as exc:
        print(f"Could not run {cmd[0]}: {exc}", file=sys.stderr)
        return EXIT_ERROR
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        return EXIT_INTERRUPTED


if __name__ == "__main__":
    sys.exit(main())
