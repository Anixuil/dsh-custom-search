/**
 * Manifest validation for dsh-custom-search.
 *
 * Checks the things a bundle has to get right to load at all:
 *   1. package.json declares dsh.bundle.patch and that file exists,
 *   2. cordis.patch.yml follows the loader's patch dialect,
 *   3. every key the patch writes into the plugin row exists in the plugin's
 *      Config schema — a typo there is silently dropped by the loader,
 *   4. the browser half satisfies the client-modules contract, so the Plugins
 *      page actually mounts a config page for this row.
 *
 * Everything in (4) fails SILENTLY at runtime: a wrong factory id, slot key, or
 * configForms namespace leaves the row with nothing but a toggle, and nothing
 * reports an error. Hence the assertions.
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
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

// --- browser half ---------------------------------------------------------
// A plugin's settings page is NOT derived from its Config schema: the Plugins
// page only renders a page some browser half registered. These checks cover the
// contract that registration has to satisfy, none of which fails loudly — a
// wrong factory id or slot key just means the row silently keeps its toggle.
const clientSrc = read('client.js')
const clientDecl = pkg.dsh?.client
assert.ok(clientDecl, 'package.json 缺 dsh.client —— 插件页不会挂载任何页面')
assert.equal(clientDecl.platform, 'web', 'dsh.client.platform 必须是 "web"，否则 client-modules 直接跳过该包')
ok('package.json 声明 dsh.client.platform = web')

const clientExport = pkg.exports?.['./client']
const clientRel = typeof clientExport === 'string' ? clientExport : clientExport?.default
assert.ok(typeof clientRel === 'string', 'exports["./client"] 必须是字符串或 { default: string }')
assert.ok(exists(clientRel.slice(2)), `exports["./client"] 指向的 ${clientRel} 不存在`)
assert.ok(pkg.files.includes('client.js'), 'files 必须包含 client.js，否则发布包里没有浏览器半侧')
ok(`exports["./client"] -> ${clientRel}（文件存在且在 files 白名单内）`)

new vm.Script(clientSrc, { filename: 'client.js' })
ok('client.js 通过 JS 语法解析')

const factoryId = clientSrc.match(/__ModuleLoader__\s*\.\s*load\s*\(\s*\{[\s\S]*?\bid\s*:\s*(['"])([^'"]+)\1/)
assert.ok(factoryId, 'client.js 必须用 __ModuleLoader__.load({ id, factory }) 注册工厂')
assert.equal(
  factoryId[2],
  pkg.name,
  `factory id 必须等于包名（${pkg.name}）——浏览器半侧只会挂到 specifier 恰为包名的那一行`,
)
ok(`factory id 与包名一致（${factoryId[2]}）`)

const slotName = clientSrc.match(/slots\.inject\(\s*'([^']+)'/)
assert.equal(slotName?.[1], 'plugins.row.config', '页面必须注册进 plugins.row.config，行上才会出现「配置」控件')
ok('注册进 plugins.row.config')

const rowKeyConst = clientSrc.match(/ROW_KEY\s*=\s*'([^']+)'/)
assert.ok(rowKeyConst, 'client.js 必须声明 ROW_KEY')
assert.equal(
  rowKeyConst[1],
  `${pkg.name}#${pluginRow.id}`,
  `slot key 必须是 <包名>#<行 id>，即 ${pkg.name}#${pluginRow.id}`,
)
ok(`slot key 与包名 + 行 id 一致（${rowKeyConst[1]}）`)

const rowIdConst = clientSrc.match(/ROW_ID\s*=\s*'([^']+)'/)
assert.ok(rowIdConst, 'client.js 必须声明 ROW_ID')
assert.equal(rowIdConst[1], pluginRow.id, `configForms 用的命名空间是行 id，必须等于 patch 行 id「${pluginRow.id}」`)
ok(`configForms 命名空间与 patch 行 id 一致（${rowIdConst[1]}）`)

assert.ok(/whileServed\(\s*\[\s*ROW_ID\s*\]/u.test(clientSrc), '页面应经 configForms.whileServed 跟随 Host 提供的命名空间')
ok('页面经 configForms.whileServed 跟随命名空间')

const clientInject = clientDecl.inject ?? []
for (const dep of ['@deepseek-ai/dsh-client-ui-settings', '@deepseek-ai/dsh-client-ui-plugin-manager']) {
  assert.ok(clientInject.includes(dep), `dsh.client.inject 缺 ${dep}：槽位与 configForms 的提供方要先加载`)
}
ok('dsh.client.inject 覆盖槽位与 configForms 的提供方')

// Every require must resolve: the frozen shell module table, or a declared external.
// An unresolvable request throws at materialization and the page never mounts.
const PLATFORM_MODULES = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
])
const externals = new Set(clientDecl.external ?? [])
const requires = [...clientSrc.matchAll(/\brequire\(\s*(['"])([^'"]+)\1\s*\)/gu)].map((m) => m[2])
for (const spec of requires) {
  assert.ok(
    PLATFORM_MODULES.has(spec) || externals.has(spec),
    `client.js require("${spec}") 既不在平台模块表里，也没在 dsh.client.external 里声明`,
  )
}
ok(`client.js 的 ${requires.length} 个 require 全部命中平台模块表`)

// The page must expose a control for every field the schema declares, or a
// field becomes unreachable from the GUI again.
const listOf = (match) => [...(match?.[1] ?? '').matchAll(/'([^']+)'/gu)].map((item) => item[1])
const exposed = new Set([
  ...listOf(clientSrc.match(/TEXT_FIELDS\s*=\s*\[([\s\S]*?)\]/u)),
  ...listOf(clientSrc.match(/NUMBER_FIELDS\s*=\s*\[([\s\S]*?)\]/u)),
  clientSrc.match(/API_KEY_FIELD\s*=\s*'([^']+)'/u)?.[1],
].filter(Boolean))
for (const key of declared) {
  assert.ok(exposed.has(key), `Config 字段 "${key}" 在客户端表单里没有控件`)
}
ok(`Config 的 ${declared.size} 个字段都有对应的表单控件`)

// The engine table is duplicated on purpose (a client module cannot reach the
// host half's source), so drift here is silent — pin it against engines.js.
const clientEngines = [
  ...clientSrc.matchAll(/\{\s*id:\s*'([^']+)',\s*label:\s*'[^']*',\s*apiKeyEnv:\s*(null|'[^']*')\s*\}/gu),
].map((m) => ({ id: m[1], apiKeyEnv: m[2] === 'null' ? null : m[2].slice(1, -1) }))
const { ENGINES } = await import('../engines.js')
assert.deepEqual(clientEngines.map((engine) => engine.id), Object.keys(ENGINES), '客户端引擎清单顺序或成员与 engines.js 不一致')
for (const engine of clientEngines) {
  assert.equal(
    engine.apiKeyEnv,
    ENGINES[engine.id].apiKeyEnv,
    `引擎 ${engine.id} 的凭证变量名与 engines.js 不一致`,
  )
}
ok(`客户端引擎清单与 engines.js 一致（${clientEngines.length} 个，含凭证变量名）`)

// A label missing from one dictionary renders as the raw key in that language.
const dictKeys = (name) => {
  const block = clientSrc.match(new RegExp(`const ${name} = \\{([\\s\\S]*?)\\n {4}\\}`, 'u'))
  assert.ok(block, `client.js 里找不到 ${name} 词典`)
  return new Set([...block[1].matchAll(/^ {6}([A-Za-z]\w*):/gmu)].map((m) => m[1]))
}
const zhKeys = dictKeys('zh')
const enKeys = dictKeys('en')
assert.deepEqual([...zhKeys].sort(), [...enKeys].sort(), 'zh 与 en 词典的键必须一一对应')
ok(`zh / en 词典键对齐（各 ${zhKeys.size} 条）`)

console.log(`\n全部 ${checked.length} 项清单校验通过。`)
