#!/usr/bin/env python3
import hashlib, json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
errors = []
for rel, meta in manifest["files"].items():
    p = ROOT / rel
    if not p.is_file():
        errors.append(f"missing: {rel}")
        continue
    raw = p.read_bytes()
    got = hashlib.sha256(raw).hexdigest()
    if got != meta["sha256"]:
        errors.append(f"sha mismatch: {rel}: {got} != {meta['sha256']}")
    if len(raw) != meta["bytes"]:
        errors.append(f"size mismatch: {rel}")
    if p.suffix == ".json":
        try:
            json.loads(raw)
        except Exception as exc:
            errors.append(f"invalid json: {rel}: {exc}")
if errors:
    print("FAIL")
    for e in errors: print("-", e)
    raise SystemExit(1)
print(f"OK: {len(manifest['files'])} files")
