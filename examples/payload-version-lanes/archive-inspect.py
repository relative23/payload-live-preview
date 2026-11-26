"""Inspect a PLP archive without extracting or executing package code.

This records each packed file and both public module conditions. Links and
paths outside npm's package directory are refused before installation.
"""
import hashlib
import json
import pathlib
import sys
import tarfile

archive = pathlib.Path(sys.argv[1]).resolve(strict=True)
files = {}
contents = {}
total = 0
with tarfile.open(archive, "r:gz") as packed:
    for entry in packed.getmembers():
        path = pathlib.PurePosixPath(entry.name)
        if path.is_absolute() or ".." in path.parts or path.parts[0:1] != ("package",):
            raise ValueError("Archive member is outside the package directory")
        if entry.isdir():
            continue
        if not entry.isfile() or entry.name in contents:
            raise ValueError("Archive contains a link, special file or duplicate")
        if entry.size > 8 * 1024 * 1024:
            raise ValueError("Unexpectedly large packed file")
        total += entry.size
        if total > 50 * 1024 * 1024:
            raise ValueError("Unexpectedly large candidate package")
        data = packed.extractfile(entry).read()
        relative = str(path.relative_to("package"))
        contents[entry.name] = data
        files[relative] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}

manifest = json.loads(contents["package/package.json"])
if manifest.get("name") != "payload-live-preview":
    raise ValueError("Archive does not identify payload-live-preview")
if not isinstance(manifest.get("version"), str):
    raise ValueError("Candidate has no version")
for hook in ["preinstall", "install", "postinstall", "prepare", "prepack", "postpack"]:
    if manifest.get("scripts", {}).get(hook):
        raise ValueError("Candidate declares an unexpected lifecycle hook: " + hook)

def runtime_target(value):
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return runtime_target(value.get("default"))
    raise ValueError("Public export has no runtime target")

entries = {}
for export in [".", "./plugin", "./server", "./react", "./vue"]:
    value = manifest.get("exports", {}).get(export)
    if not isinstance(value, dict):
        raise ValueError("Candidate is missing a required public export: " + export)
    entries[export] = {}
    for condition in ["import", "require"]:
        if condition == "require" and export in ["./react", "./vue"] and condition not in value:
            continue
        target = runtime_target(value.get(condition))
        relative = target.removeprefix("./")
        if not target.startswith("./") or relative not in files:
            raise ValueError("Public export does not name a packed file")
        entries[export][condition] = relative

data = archive.read_bytes()
print(json.dumps({
    "name": manifest["name"],
    "version": manifest["version"],
    "sha256": hashlib.sha256(data).hexdigest(),
    "sha512Integrity": "sha512-" + __import__("base64").b64encode(hashlib.sha512(data).digest()).decode(),
    "archiveBytes": len(data),
    "packedBytes": total,
    "fileCount": len(files),
    "publicEntries": entries,
    "files": dict(sorted(files.items())),
}, indent=2))
