#!/usr/bin/env python3
"""Create a deterministic transport ZIP for a keyword-candidate handoff."""

from __future__ import annotations

import argparse
import json
import os
import stat
import sys
import tempfile
import zipfile
from pathlib import Path


EXPECTED_NAMES = (
    "prompt.txt",
    "PROMPT_CONTRACT_v1.md",
    "candidate_generation_request.json",
    "candidate_view.json",
    "pre_evaluation.json",
    "evaluation_policy.json",
    "taxonomy.json",
    "source_dataset.json",
    "candidate-proposal.schema.json",
    "common.schema.json",
    "handoff_manifest.json",
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


def ensure_directory(path: Path, description: str) -> None:
    try:
        mode = path.lstat().st_mode
    except OSError as error:
        raise ArchiveError(f"{description} is unavailable: {path}: {error}") from error
    if stat.S_ISLNK(mode) or not stat.S_ISDIR(mode):
        raise ArchiveError(f"{description} must be a directory: {path}")


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
    if any(part in {"", ".", ".."} for part in name.split("/")):
        raise ArchiveError(f"unsafe archive path: {name!r}")


def read_archive_names(path: Path) -> list[str]:
    ensure_regular(path, "handoff ZIP")
    try:
        with zipfile.ZipFile(path, "r") as archive:
            infos = archive.infolist()
            names = [info.filename for info in infos]
            if len(names) != len(set(names)):
                raise ArchiveError("ZIP contains duplicate member names")
            for info in infos:
                safe_archive_path(info.filename)
                mode = (info.external_attr >> 16) & 0xFFFF
                if info.is_dir() or info.filename.endswith("/") or stat.S_ISDIR(mode) or stat.S_ISLNK(mode):
                    raise ArchiveError(f"non-regular ZIP member is not allowed: {info.filename}")
            return names
    except zipfile.BadZipFile as error:
        raise ArchiveError(f"invalid ZIP: {error}") from error
    except OSError as error:
        raise ArchiveError(f"could not read ZIP: {error}") from error


def package(args: argparse.Namespace) -> dict[str, object]:
    input_dir = args.input_dir.resolve()
    output = args.output.resolve()
    ensure_directory(input_dir, "handoff input directory")
    ensure_output_absent(output)

    actual_names = sorted(member.name for member in input_dir.iterdir())
    if actual_names != sorted(EXPECTED_NAMES):
        raise ArchiveError("handoff input file set does not match the required archive members")
    sources = {name: input_dir / name for name in EXPECTED_NAMES}
    for name, source in sources.items():
        safe_archive_path(name)
        ensure_regular(source, name)

    ensure_directory(output.parent, "output parent")
    temporary_name: str | None = None
    linked_output = False
    completed = False
    try:
        descriptor, temporary_name = tempfile.mkstemp(prefix=f".{output.name}.", dir=str(output.parent))
        os.close(descriptor)
        with zipfile.ZipFile(temporary_name, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for name in EXPECTED_NAMES:
                info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = (stat.S_IFREG | 0o644) << 16
                archive.writestr(info, sources[name].read_bytes())
        try:
            os.link(temporary_name, output)
        except FileExistsError as error:
            raise ArchiveError(f"refusing to overwrite existing output: {output}") from error
        linked_output = True
        os.unlink(temporary_name)
        temporary_name = None
        if read_archive_names(output) != list(EXPECTED_NAMES):
            raise ArchiveError("generated ZIP member boundary mismatch")
        completed = True
        return {"zip_path": str(output), "member_count": len(EXPECTED_NAMES)}
    except OSError as error:
        raise ArchiveError(f"ZIP generation failed: {error}") from error
    finally:
        if temporary_name is not None:
            try:
                os.unlink(temporary_name)
            except OSError:
                pass
        if linked_output and not completed:
            try:
                output.unlink()
            except OSError:
                pass


def main() -> int:
    parser = argparse.ArgumentParser(description="Create a keyword-candidate handoff ZIP")
    subparsers = parser.add_subparsers(dest="command", required=True)
    package_parser = subparsers.add_parser("package")
    package_parser.add_argument("--input-dir", type=Path, required=True)
    package_parser.add_argument("--output", type=Path, required=True)
    inspect_parser = subparsers.add_parser("inspect")
    inspect_parser.add_argument("--input", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.command == "package":
            result = package(args)
        else:
            result = {"members": read_archive_names(args.input.resolve())}
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (ArchiveError, OSError) as error:
        print(f"ERROR: ARCHIVE_FAILED: {error}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
