/**
 * Manifest validation for dsh-custom-search.
 *
 * Checks the three things a bundle has to get right to load at all:
 *   1. package.json declares dsh.bundle.patch and that file exists,
 *   2. cordis.patch.yml follows the loader's patch dialect,
 *   3. every key the patch writes into the plugin row exists in the plugin's
 *      Config schema — a typo there is silently dropped by the loader.
 */
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import yaml from 'js-yaml'

const ROOT = path.resolve('..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const exists = (rel) => fs.existsSync(path.join(ROOT, rel))

const checked = []
const ok = (line) => { checked.push(line); console.log('  ✓', line) }

// --- package.json ---------------------------------------------------------
const pkg = JSON.parse(read('package.json'))
assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml')
assert.ok(exists(pkg.dsh.bundle.patch.slice(2)), 'dsh.bundle.patch 指向的文件必须存在')
ok('package.json 声明 dsh.bundle.patch，且目标文件存在')

assert.equal(pkg.type, 'module', 'ESM 插件需要 type: module')
assert.ok(pkg.exports?.['.'], 'exports["."] 必须指向入口')
assert.ok(exists(pkg.exports['.'].slice(2)), '入口文件必须存在')
assert.ok(pkg.exports['./locale/*.json'], 'locale 通配导出缺失时面板读不到标题')
ok('exports 覆盖入口与 locale/*.json')

assert.ok(pkg.icon && exists(pkg.icon.slice(2)), 'icon 路径必须存在')
assert.ok(/^\.\//u.test(pkg.icon), 'icon 必须是相对清单目录的路径')
assert.ok(fs.statSync(path.join(ROOT, pkg.icon.slice(2))).size < 256 * 1024, 'icon 须小于 256 KiB')
ok(`icon.svg 存在且体积合规（${fs.statSync(path.join(ROOT, 'icon.svg')).size} 字节）`)

assert.ok(pkg.files.includes('index.js') && pkg.files.includes('engines.js'))
assert.ok(pkg.files.includes('cordis.patch.yml'), 'files 必须包含 patch，否则安装后层会缺失')
assert.ok(pkg.files.includes('locale/*.json'))
ok('files 白名单包含 patch、代码与 locale')

for (const lang of ['zh', 'en']) {
  const locale = JSON.parse(read(`locale/${lang}.json`))
  assert.ok(locale.meta?.title, `${lang}.json 缺 meta.title`)
  assert.ok(locale.meta?.description, `${lang}.json 缺 meta.description`)
}
ok('locale/zh.json 与 locale/en.json 元数据完整')

// --- cordis.patch.yml -----------------------------------------------------
const patches = yaml.load(read('cordis.patch.yml'))
assert.ok(Array.isArray(patches), 'patch 顶层必须是 YAML 数组')
ok(`cordis.patch.yml 是合法 YAML 数组（${patches.length} 个条目）`)

const inserts = patches.flatMap((entry) => entry?.insert ?? [])
const rows = [...inserts, ...patches.filter((entry) => entry?.id !== undefined)]
const byId = new Map(rows.map((row) => [row.id, row]))

for (const row of rows) {
  assert.ok(row.id, '每个 patch 行都需要 id')
  assert.ok(row.name ?? row.disabled !== undefined, `行 ${row.id} 既没有 name 也没有 disabled`)
  assert.ok(!('insert' in row), `行 ${row.id} 不应再嵌套 insert`)
}
ok('每个 patch 行都有 id，且形式合法')

const pluginRow = byId.get('custom-search')
assert.ok(pluginRow, '缺少 custom-search 行')
assert.equal(pluginRow.name, pkg.name, 'patch 行 name 必须等于包名，否则 loader 会警告并跳过')
ok(`插件行 id=custom-search 指向包名 ${pkg.name}`)

const webRow = byId.get('web')
assert.ok(webRow, '缺少 web 行 — 没有它接口不会切到本 provider')
assert.equal(webRow.name, '@deepseek-ai/dsh-web')
assert.equal(webRow.config?.searchProvider, 'custom-search', 'web.searchProvider 必须指向本 provider')
assert.equal(webRow.config?.fetchProvider, 'http', '整行替换会丢掉 fetchProvider，必须重新声明')
ok('web 行同时声明 searchProvider 与 fetchProvider（整行替换语义）')

assert.equal(byId.get('web-search-deepseek')?.disabled, true, '官方 provider 应被关闭以避免歧义')
ok('官方 web-search-deepseek 行已关闭，避免 WEB_PROVIDER_AMBIGUOUS')

// --- patch config vs. the plugin's Config schema --------------------------
const { Config, PROVIDER_ID } = await import('../index.js')
assert.equal(PROVIDER_ID, 'custom-search', 'provider id 必须与 patch 里的 searchProvider 一致')
ok(`provider id 与 patch 的 searchProvider 一致（${PROVIDER_ID}）`)

const schemaJson = JSON.parse(JSON.stringify(Config.toJSON()))
const declared = new Set()
const secrets = new Set()
for (const ref of Object.values(schemaJson.refs)) {
  if (ref.type !== 'object' || !ref.dict) continue
  for (const [key, id] of Object.entries(ref.dict)) {
    declared.add(key)
    if (schemaJson.refs[id]?.meta?.role === 'secret') secrets.add(key)
  }
}
const written = Object.keys(pluginRow.config ?? {})
for (const key of written) {
  assert.ok(declared.has(key), `patch 写了 Config 里不存在的字段 "${key}" — loader 会静默丢弃`)
}
ok(`patch 的 ${written.length} 个配置项全部存在于 Config schema`)

for (const key of declared) {
  // Secret literals are deliberately absent: a key typed into the settings form
  // is persisted to the profile patch, never to the bundle.
  if (secrets.has(key)) continue
  assert.ok(written.includes(key), `Config 字段 "${key}" 未在 patch 中给出默认值`)
}
ok(`Config 的非密文字段（${declared.size - secrets.size}/${declared.size}）都在 patch 中有默认值`)
ok(`密文字段不进 patch：${[...secrets].join(', ')}`)

// The loader must accept the patch's literals as-is.
Config(pluginRow.config)
ok('patch 的配置能通过 Config 校验')

console.log(`\n全部 ${checked.length} 项清单校验通过。`)
