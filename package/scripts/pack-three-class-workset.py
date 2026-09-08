#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import stat
import sys
import tempfile
import zipfile
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 1
PROTOCOL_VERSION = "db-three-class-workset-v1"
MANIFEST_NAME = "workset_manifest.json"
ZIP_PREFIX = "three_class_workset_"
ZIP_SUFFIX = ".zip"
EXPECTED_PROVENANCE = {
    "provenance/analysis_input.json",
    "provenance/analysis_input.manifest.json",
}


class PackagingError(ValueError):
    pass


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def pretty_json(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise PackagingError(f"duplicate JSON object key: {key}")
        result[key] = value
    return result


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_bytes().decode("utf-8"), object_pairs_hook=reject_duplicate_keys)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, PackagingError) as error:
        raise PackagingError(f"invalid JSON in {path}: {error}") from error


def ensure_regular(path: Path, description: str) -> None:
    try:
        mode = path.lstat().st_mode
    except OSError as error:
        raise PackagingError(f"{description} is unavailable: {path}: {error}") from error
    if stat.S_ISLNK(mode):
        raise PackagingError(f"symlink is not allowed in transport: {path}")
    if not stat.S_ISREG(mode):
        raise PackagingError(f"transport member must be a regular file: {path}")


def ensure_directory(path: Path, description: str) -> None:
    try:
        mode = path.lstat().st_mode
    except OSError as error:
        raise PackagingError(f"{description} is unavailable: {path}: {error}") from error
    if stat.S_ISLNK(mode):
        raise PackagingError(f"symlink is not allowed in transport: {path}")
    if not stat.S_ISDIR(mode):
        raise PackagingError(f"{description} must be a directory: {path}")


def safe_archive_path(value: str) -> None:
    if not value or value.startswith("/") or "\\" in value:
        raise PackagingError(f"unsafe archive path: {value!r}")
    parts = value.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        raise PackagingError(f"unsafe archive path: {value!r}")
    if Path(value).as_posix() != value:
        raise PackagingError(f"unsafe archive path: {value!r}")


def request_files(workspace: Path) -> list[tuple[str, Path]]:
    root = workspace / "request"
    ensure_directory(root, "request transport root")
    discovered: list[tuple[str, Path]] = []
    pending = [root]
    while pending:
        current = pending.pop()
        try:
            entries = sorted(current.iterdir(), key=lambda item: item.name)
        except OSError as error:
            raise PackagingError(f"cannot enumerate request transport: {current}: {error}") from error
        for entry in entries:
            try:
                mode = entry.lstat().st_mode
            except OSError as error:
                raise PackagingError(f"cannot inspect request transport member: {entry}: {error}") from error
            if stat.S_ISLNK(mode):
                raise PackagingError(f"symlink is not allowed in transport: {entry}")
            if stat.S_ISDIR(mode):
                pending.append(entry)
                continue
            if not stat.S_ISREG(mode):
                raise PackagingError(f"transport member must be a regular file: {entry}")
            relative = entry.relative_to(workspace).as_posix()
            safe_archive_path(relative)
            discovered.append((relative, entry))
    discovered.sort(key=lambda item: item[0])
    if len({relative for relative, _ in discovered}) != len(discovered):
        raise PackagingError("duplicate transport member path")
    return discovered


def provenance_files(workspace: Path) -> list[tuple[str, Path]]:
    root = workspace / "provenance"
    ensure_directory(root, "provenance transport root")
    discovered: list[tuple[str, Path]] = []
    for entry in sorted(root.iterdir(), key=lambda item: item.name):
        mode = entry.lstat().st_mode
        if stat.S_ISLNK(mode):
            raise PackagingError(f"symlink is not allowed in transport: {entry}")
        if not stat.S_ISREG(mode):
            raise PackagingError(f"provenance transport must contain only regular files: {entry}")
        relative = entry.relative_to(workspace).as_posix()
        safe_archive_path(relative)
        discovered.append((relative, entry))
    actual = {relative for relative, _ in discovered}
    if actual != EXPECTED_PROVENANCE:
        missing = sorted(EXPECTED_PROVENANCE - actual)
        extra = sorted(actual - EXPECTED_PROVENANCE)
        raise PackagingError(f"provenance transport boundary mismatch: missing={missing}, extra={extra}")
    return discovered


def member_entry(relative: str, path: Path) -> dict[str, Any]:
    ensure_regular(path, f"transport member {relative}")
    data = path.read_bytes()
    return {"path": relative, "sha256": sha256(data), "bytes": len(data)}


def verify_zip(zip_path: Path, expected: dict[str, Path]) -> None:
    try:
        with zipfile.ZipFile(zip_path, "r") as archive:
            infos = archive.infolist()
            names = [info.filename for info in infos]
            if len(names) != len(set(names)):
                raise PackagingError("ZIP contains duplicate members")
            expected_names = sorted(expected)
            if names != expected_names:
                raise PackagingError(f"ZIP member boundary mismatch: expected={expected_names}, actual={names}")
            for info in infos:
                safe_archive_path(info.filename)
                mode = (info.external_attr >> 16) & 0xFFFF
                if stat.S_ISLNK(mode) or info.is_dir():
                    raise PackagingError(f"ZIP member is not a regular file: {info.filename}")
                source = expected[info.filename]
                source_bytes = source.read_bytes()
                archive_bytes = archive.read(info.filename)
                if len(archive_bytes) != len(source_bytes) or sha256(archive_bytes) != sha256(source_bytes):
                    raise PackagingError(f"ZIP member bytes differ from source: {info.filename}")
    except zipfile.BadZipFile as error:
        raise PackagingError(f"generated ZIP is invalid: {error}") from error


def package(workspace: Path) -> dict[str, Any]:
    workspace = workspace.resolve()
    ensure_directory(workspace, "workspace")
    manifest_path = workspace / MANIFEST_NAME
    try:
        manifest_path.lstat()
    except FileNotFoundError:
        pass
    else:
        raise PackagingError(f"refusing to overwrite existing workset manifest: {manifest_path}")

    readme = workspace / "README_FIRST.md"
    ensure_regular(readme, "README_FIRST.md")
    provenance = provenance_files(workspace)
    request = request_files(workspace)
    request_manifest = workspace / "request" / "manifest.json"
    ensure_regular(request_manifest, "request/manifest.json")
    request_value = read_json(request_manifest)
    request_id = request_value.get("request_id") if isinstance(request_value, dict) else None
    if not isinstance(request_id, str) or len(request_id) != 64 or any(character not in "0123456789abcdef" for character in request_id):
        raise PackagingError("request/manifest.json has an invalid request_id")

    source_files: dict[str, Path] = {
        "README_FIRST.md": readme,
        **dict(provenance),
        **dict(request),
    }
    if len(source_files) != 1 + len(provenance) + len(request):
        raise PackagingError("duplicate transport member path")
    for relative in source_files:
        safe_archive_path(relative)
    members = [member_entry(relative, source_files[relative]) for relative in sorted(source_files)]
    preimage = {
        "schema_version": SCHEMA_VERSION,
        "protocol_version": PROTOCOL_VERSION,
        "request_id": request_id,
        "members": members,
    }
    workset_id = sha256(canonical_json(preimage))
    manifest = {**preimage, "workset_id": workset_id}
    zip_path = workspace / f"{ZIP_PREFIX}{workset_id}{ZIP_SUFFIX}"
    try:
        zip_path.lstat()
    except FileNotFoundError:
        pass
    else:
        raise PackagingError(f"refusing to overwrite existing workset ZIP: {zip_path}")

    try:
        with manifest_path.open("xb") as handle:
            handle.write(pretty_json(manifest))
    except FileExistsError as error:
        raise PackagingError(f"refusing to overwrite existing workset manifest: {manifest_path}") from error

    archive_sources = {**source_files, MANIFEST_NAME: manifest_path}
    temp_name: str | None = None
    zip_created = False
    try:
        fd, temp_name = tempfile.mkstemp(prefix=f".{zip_path.name}.", dir=str(workspace))
        os.close(fd)
        with zipfile.ZipFile(temp_name, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for relative in sorted(archive_sources):
                info = zipfile.ZipInfo(relative, date_time=(2026, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o644 << 16
                archive.writestr(info, archive_sources[relative].read_bytes())
        os.replace(temp_name, zip_path)
        temp_name = None
        zip_created = True
        verify_zip(zip_path, archive_sources)
    except (OSError, PackagingError) as error:
        if zip_created:
            try:
                zip_path.unlink()
            except FileNotFoundError:
                pass
        try:
            manifest_path.unlink()
        except FileNotFoundError:
            pass
        if isinstance(error, OSError):
            raise PackagingError(f"ZIP generation failed: {error}") from error
        raise
    finally:
        if temp_name is not None:
            try:
                os.unlink(temp_name)
            except FileNotFoundError:
                pass

    return {
        "workset_id": workset_id,
        "request_id": request_id,
        "manifest_path": str(manifest_path),
        "zip_path": str(zip_path),
        "member_count": len(members),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Package a DB three-class workset")
    parser.add_argument("--workspace", type=Path, required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(package(args.workspace), ensure_ascii=False, indent=2))
        return 0
    except (PackagingError, OSError) as error:
        print(f"ERROR: PACKAGING_FAILED: {error}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
