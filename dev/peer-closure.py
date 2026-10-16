"""Can the running Harness actually supply every package this plugin declares?

The host half lazily imports `@deepseek-ai/*` packages it must NOT install itself
and must NOT shadow: `dsh-app-boot` routes those requests to the installation's
own copy, but only when the name is listed in a `peerDependencies` of an ancestor
directory (see `profile-resolution-bootstrap.js`'s `routeLinked`). A name that is
declared yet absent from the installation scope resolves nowhere, and the failure
is silent by construction — the import is inside a `try/catch` by design, so the
feature behind it just disappears. 0.4.0 exists because of exactly that.

`dev/validate.mjs` reconciles the declared peers against the source's imports,
which catches a *missing* declaration. This script answers the other half, which
only the shipped installation can answer: is every declared name actually
supplied? It reads the installation's dependency graph out of `app.asar` and
walks it the way `collectInstallationScopePackages` does.

Usage:
    python dev/peer-closure.py            # check every peer of this plugin
    python dev/peer-closure.py --all      # also list every @deepseek-ai/* in scope
Exit status is 1 when a peer cannot be supplied.
"""
import json
import os
import posixpath
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from asar import ASAR, load_header, walk  # noqa: E402

UNPACKED = ASAR + ".unpacked"
PLUGIN_MANIFEST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "package.json")
APP_MANIFEST = "dsh/package.json"


def read_entry(entry, path):
    """Read one archived file, falling back to the unpacked side when it has no offset."""
    if entry.get("unpacked") or "offset" not in entry:
        with open(os.path.join(UNPACKED, path.replace("/", os.sep)), "rb") as handle:
            return handle.read()
    with open(ASAR, "rb") as handle:
        handle.seek(data_start + int(entry["offset"]))
        return handle.read(int(entry["size"]))


def resolve_from(anchor_dir, name, present):
    """Node's node_modules lookup: walk up from the anchor until a manifest appears."""
    current = anchor_dir
    while True:
        candidate = posixpath.join(current, "node_modules", name, "package.json")
        if candidate in present:
            return candidate
        parent = posixpath.dirname(current)
        if parent == current:
            return None
        current = parent


def dependency_names(manifest):
    return list(manifest.get("dependencies", {})) + list(manifest.get("peerDependencies", {}))


header, data_start = load_header(ASAR)
present = {path for path, _ in walk(header) if path.endswith("/package.json") or path == "package.json"}
if APP_MANIFEST not in present:
    print(f"找不到 {APP_MANIFEST}：app.asar 的布局变了", file=sys.stderr)
    raise SystemExit(2)

cache = {}


def manifest_of(path):
    if path not in cache:
        cache[path] = json.loads(read_entry(entries[path], path).decode("utf-8"))
    return cache[path]


entries = {path: entry for path, entry in walk(header) if path in present}
application = manifest_of(APP_MANIFEST)
print(f"安装包清单 : {application.get('name')}@{application.get('version')}")

# The same breadth-first walk collectInstallationScopePackages performs: the
# installation supplies its whole dependency closure, transitive included.
scope = {application.get("name"): posixpath.dirname(APP_MANIFEST)}
declarers = {application.get("name"): APP_MANIFEST}
queue = [APP_MANIFEST]
while queue:
    anchor = queue.pop(0)
    for name in dependency_names(manifest_of(anchor)):
        if name in scope:
            continue
        found = resolve_from(posixpath.dirname(anchor), name, present)
        if found is None:
            continue
        scope[name] = posixpath.dirname(found)
        declarers[name] = anchor
        queue.append(found)
print(f"安装作用域 : {len(scope)} 个包")
print()

with open(PLUGIN_MANIFEST, encoding="utf-8") as handle:
    plugin = json.load(handle)
peers = list(plugin.get("peerDependencies", {}))
if not peers:
    print("插件没有声明任何 peerDependencies —— 它的 @deepseek-ai/* 导入都会被拦在本机之外。")
    raise SystemExit(1)

failed = []
print(f"{plugin.get('name')}@{plugin.get('version')} 声明的 {len(peers)} 个 peer：")
for name in peers:
    directory = scope.get(name)
    if directory is None:
        failed.append(name)
        print(f"  ✗ {name}")
        print("      安装包里没有这个包 —— 声明了也路由不过去，导入会 ERR_MODULE_NOT_FOUND")
        continue
    optional = plugin.get("peerDependenciesMeta", {}).get(name, {}).get("optional") is True
    print(f"  ✓ {name}{'（optional）' if optional else ''}")
    print(f"      目录    : {directory}")
    print(f"      被谁声明: {declarers.get(name, '(直接)')}")

if "--all" in sys.argv:
    print()
    print("安装作用域内的全部 @deepseek-ai/* 包：")
    for name in sorted(entry for entry in scope if entry.startswith("@deepseek-ai/")):
        print(f"  {name}")

print()
if failed:
    print(f"{len(failed)} 个 peer 无法被安装包供给：{', '.join(failed)}")
    raise SystemExit(1)
print(f"全部 {len(peers)} 个 peer 都能被当前安装包供给 ✓（范围一律写 \"*\"，否则升级会被拒装）")
