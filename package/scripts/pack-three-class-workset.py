#!/usr/bin/env python3
"""Create and inspect the five-member three-class workset transport ZIP."""

from __future__ import annotations

import argparse
import base64
import json
import os
import stat
import sys
import tempfile
import zipfile
from pathlib import Path
from typing import Any


EXPECTED_NAMES = (
    "PROMPT.md",
    "RULES.md",
    "HISTORY.json",
    "ITEMS.json",
    "response.schema.json",
)


class ArchiveError(ValueError):
    pass


def ensure_regular(path: Path, description: str) -> None:
    try:
        mode = path.lstat().st_mode
    except OSError as error:
        raise ArchiveError(f"{description} is unavailable: {path}: {error}") from error
    if stat.S_ISLNK(mode):
        raise ArchiveError(f"symlink is not allowed: {path}")
    if not stat.S_ISREG(mode):
        raise ArchiveError(f"{description} must be a regular file: {path}")


def ensure_output_absent(path: Path) -> None:
    try:
        path.lstat()
    except FileNotFoundError:
        return
    except OSError as error:
        raise ArchiveError(f"cannot inspect output path {path}: {error}") from error
    raise ArchiveError(f"refusing to overwrite existing output: {path}")


def safe_archive_path(name: str) -> None:
    if (
        not name
        or name.startswith("/")
        or name.startswith("\\")
        or "\\" in name
        or (len(name) >= 2 and name[1] == ":")
    ):
        raise ArchiveError(f"unsafe archive path: {name!r}")
    parts = name.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        raise ArchiveError(f"unsafe archive path: {name!r}")


def zip_mode(info: zipfile.ZipInfo) -> int:
    return (info.external_attr >> 16) & 0xFFFF


def assert_regular_zip_member(info: zipfile.ZipInfo) -> None:
    safe_archive_path(info.filename)
    mode = zip_mode(info)
    if info.is_dir() or info.filename.endswith("/") or stat.S_ISDIR(mode):
        raise ArchiveError(f"directory entry is not allowed: {info.filename}")
    if stat.S_ISLNK(mode):
        raise ArchiveError(f"symlink entry is not allowed: {info.filename}")
    file_type = stat.S_IFMT(mode)
    if file_type not in (0, stat.S_IFREG):
        raise ArchiveError(f"non-regular ZIP member is not allowed: {info.filename}")


def read_archive(path: Path) -> list[dict[str, Any]]:
    ensure_regular(path, "workset ZIP")
    try:
        with zipfile.ZipFile(path, "r") as archive:
            infos = archive.infolist()
            names = [info.filename for info in infos]
            if len(names) != len(set(names)):
                raise ArchiveError("ZIP contains duplicate member names")
            members: list[dict[str, Any]] = []
            for info in infos:
                assert_regular_zip_member(info)
                members.append({
                    "name": info.filename,
                    "data": base64.b64encode(archive.read(info)).decode("ascii"),
                })
            return members
    except zipfile.BadZipFile as error:
        raise ArchiveError(f"invalid ZIP: {error}") from error
    except OSError as error:
        raise ArchiveError(f"could not read ZIP: {error}") from error


def package(args: argparse.Namespace) -> dict[str, Any]:
    output = args.output.resolve()
    ensure_output_absent(output)
    sources = {
        "PROMPT.md": args.prompt,
        "RULES.md": args.rules,
        "HISTORY.json": args.history,
        "ITEMS.json": args.items,
        "response.schema.json": args.schema,
    }
    for name, source in sources.items():
        ensure_regular(source, name)
        safe_archive_path(name)

    output_parent = output.parent
    try:
        output_parent.lstat()
    except OSError as error:
        raise ArchiveError(f"output parent is unavailable: {output_parent}: {error}") from error
    if not output_parent.is_dir():
        raise ArchiveError(f"output parent must be a directory: {output_parent}")

    temporary_name: str | None = None
    try:
        descriptor, temporary_name = tempfile.mkstemp(prefix=f".{output.name}.", dir=str(output_parent))
        os.close(descriptor)
        with zipfile.ZipFile(temporary_name, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for name in EXPECTED_NAMES:
                info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o644 << 16
                archive.writestr(info, sources[name].read_bytes())
        try:
            os.link(temporary_name, output)
        except FileExistsError as error:
            raise ArchiveError(f"refusing to overwrite existing output: {output}") from error
        os.unlink(temporary_name)
        temporary_name = None
        members = read_archive(output)
        if [member["name"] for member in members] != list(EXPECTED_NAMES):
            raise ArchiveError("generated ZIP member boundary mismatch")
        return {"zip_path": str(output), "member_count": len(members)}
    except OSError as error:
        raise ArchiveError(f"ZIP generation failed: {error}") from error
    finally:
        if temporary_name is not None:
            try:
                os.unlink(temporary_name)
            except FileNotFoundError:
                pass


def main() -> int:
    parser = argparse.ArgumentParser(description="Create or inspect a three-class workset ZIP")
    subparsers = parser.add_subparsers(dest="command", required=True)

    package_parser = subparsers.add_parser("package")
    package_parser.add_argument("--output", type=Path, required=True)
    package_parser.add_argument("--prompt", type=Path, required=True)
    package_parser.add_argument("--rules", type=Path, required=True)
    package_parser.add_argument("--history", type=Path, required=True)
    package_parser.add_argument("--items", type=Path, required=True)
    package_parser.add_argument("--schema", type=Path, required=True)

    inspect_parser = subparsers.add_parser("inspect")
    inspect_parser.add_argument("--input", type=Path, required=True)

    args = parser.parse_args()
    try:
        if args.command == "package":
            result = package(args)
        else:
            result = {"members": read_archive(args.input.resolve())}
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (ArchiveError, OSError) as error:
        print(f"ERROR: ARCHIVE_FAILED: {error}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
