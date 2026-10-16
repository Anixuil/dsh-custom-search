/**
 * Reproduce the Host's uninstall gate for a bundle's own patch.
 *
 * The Plugins page refuses to remove a bundle with
 * `其他配置仍在使用这个组合包的组件，请先停用它们` (= error code `bundle-in-use`)
 * when any row the bundle CONTRIBUTES is still mounted. A bundle contributes
 * exactly what its patch's `insert:` adds — the loader composes every layer
 * against an EMPTY base (`applyEntryPatches([], …)`), so a top-level
 * non-insert entry finds nothing to patch and is skipped, while `insert:`
 * always lands. A row in `insert:` that another package already declares
 * therefore pins a copy of that foreign row permanently in the tree, and the
 * bundle can never be uninstalled. The failure is silent: the plugin keeps
 * working, only the uninstall button stops working.
 *
 * Usage:
 *   node bundle-rows.mjs <bundle-patch.yml> [own-package-name]
 *
 * `own-package-name` defaults to the `name` in the `package.json` sitting next
 * to the patch, which is the bundle's own package. Every `insert:` row must
 * carry that name; anything else is a foreign row and a bug.
 *
 * Point it at an installed copy to diagnose a live profile, e.g.
 *   node bundle-rows.mjs "$HOME/.dsh/profiles/desktop/node_modules/<pkg>/cordis.patch.yml"
 *
 * Exit code is 1 when a foreign row is claimed, so it can gate a release.
 */
import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'

// Mirrors applyEntryPatches from @deepseek-ai/dsh-app-boot.
function applyEntryPatches(data, patchList) {
  data = structuredClone(data)
  const entryMap = new Map()
  const buildMap = (entries) => {
    for (const entry of entries) {
      if (entry.id) entryMap.set(entry.id, entry)
      if (entry.group && Array.isArray(entry.config)) buildMap(entry.config)
    }
  }
  buildMap(data)
  for (const patch of patchList) {
    const { id, insert, name, ...overrides } = patch
    if (insert) {
      if (id) {
        const target = entryMap.get(id)
        if (!target || !target.group) continue
        if (!Array.isArray(target.config)) target.config = []
        target.config.push(...insert)
      } else data.push(...insert)
      buildMap(insert)
      continue
    }
    if (!id) continue
    const target = entryMap.get(id)
    if (!target || (name && name !== target.name)) continue
    for (const [key, value] of Object.entries(overrides)) {
      if (key !== 'id') target[key] = value
    }
  }
  return data
}

// A patch file's top level is a SEQUENCE (one document). `loadAll` would wrap
// that sequence in an extra array, and every element would then look like an
// entry with no `insert` and be silently skipped — reporting zero rows.
function readPatch(file) {
  const loaded = yaml.load(fs.readFileSync(file, 'utf8'))
  return Array.isArray(loaded) ? loaded : [loaded]
}

const [patchFile, ownArg] = process.argv.slice(2)
if (patchFile === undefined) {
  console.error('用法: node bundle-rows.mjs <bundle-patch.yml> [own-package-name]')
  process.exit(2)
}

let own = ownArg
if (own === undefined) {
  try {
    own = JSON.parse(fs.readFileSync(path.join(path.dirname(patchFile), 'package.json'), 'utf8')).name
  } catch {
    console.error('读不到同目录的 package.json，请在第二个参数里给出包名')
    process.exit(2)
  }
}

const patches = readPatch(patchFile)
const rows = applyEntryPatches([], patches)
const foreign = rows.filter((row) => row.name !== own)

console.log(`组合包 patch : ${patchFile}`)
console.log(`本包名       : ${own}`)
console.log(`顶层条目     : ${JSON.stringify(patches.map((p) => (Array.isArray(p.insert) ? { insert: p.insert.length } : { id: p.id })))}`)
console.log(`\nbundleRows 报告 ${rows.length} 行（这些就是卸载检查的依据）:`)
for (const row of rows) {
  console.log(`  - id=${row.id}  name=${row.name}${row.name === own ? '' : '   <- 不属于本包'}`)
}
console.log(`\n结论: 卸载${foreign.length ? `会被 bundle-in-use 拒绝 ✗（${foreign.map((r) => r.id).join(', ')} 由别的包声明）` : '可以通过检查 ✓'}`)
process.exit(foreign.length ? 1 : 0)
