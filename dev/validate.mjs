/**
 * Manifest validation for dsh-custom-search.
 *
 * Checks the things a bundle has to get right to load at all:
 *   1. package.json declares dsh.bundle.patch and that file exists,
 *   2. cordis.patch.yml follows the loader's patch dialect,
 *   3. every key the patch writes into the plugin row exists in the plugin's
 *      Config schema — a typo there is silently dropped by the loader,
 *   4. the browser half satisfies the client-modules contract, so the Plugins
 *      page actually mounts a config page for this row,
 *   5. the patch distinguishes rows this bundle OWNS (`insert:`) from rows it
 *      merely overrides — getting that wrong makes the bundle uninstallable.
 *
 * Everything in (4) and (5) fails SILENTLY at runtime: a wrong factory id, slot
 * key, or configForms namespace leaves the row with nothing but a toggle, and a
 * foreign row declared under `insert:` looks fine until the user clicks 卸载.
 * Hence the assertions.
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

// --- which rows this bundle OWNS vs. merely overrides ---------------------
// The plugin manager attributes only a bundle's `insert:` rows to that bundle
// (`bundleRows`), and refuses to uninstall while any of them is still mounted
// (`bundle-in-use`). Rows declared by another bundle — `web` and
// `web-search-deepseek` here, both inserted by `@deepseek-ai/dsh-base` — must
// therefore be plain top-level overrides. Put them under `insert:` instead and
// two things break at once, both silently until the user clicks 卸载:
//   1. `applyEntryPatches` appends them as EXTRA rows (ids are already taken),
//      so the tree ends up with duplicate `web` / `web-search-deepseek` rows;
//   2. those duplicates' originals stay mounted forever, so the uninstall check
//      can never pass.
const insertRows = patches.flatMap((entry) => entry?.insert ?? [])
const overrideRows = patches.filter((entry) => entry?.insert === undefined)

for (const row of insertRows) {
  assert.equal(
    row.name,
    pkg.name,
    `insert 行 "${row.id}" 的 name 是 ${row.name}，不是本包 —— 别的组合包已经在声明它了，` +
      '放进 insert 会多出一行同名副本，并让本组合包永远无法卸载',
  )
}
ok(`insert 只声明本包自己的行（${insertRows.map((row) => row.id).join(', ')}）`)

// The loader composes every layer against an EMPTY base (`applyEntryPatches([], …)`),
// so a bundle's `insert:` list is exactly what it contributes to the tree — and
// exactly what `bundleRows` reports back to the uninstall check. Reproduce that
// call here so the invariant is pinned rather than argued.
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

const contributed = applyEntryPatches([], patches)
assert.deepEqual(
  contributed.map((row) => row.id),
  insertRows.map((row) => row.id),
  '本组合包贡献给树的行必须恰好等于它的 insert 行 —— 这是卸载检查的依据',
)
ok(`本组合包只贡献 ${contributed.length} 行（${contributed.map((row) => row.id).join(', ')}）`)

// End to end over a stand-in for the real layer below: the `web` and
// `web-search-deepseek` rows as `@deepseek-ai/dsh-base` declares them (mirrored
// from its cordis.patch.yml). Our layer must OVERRIDE those rows in place —
// one row each, patched — never append copies.
const baseLayer = [
  {
    insert: [
      { id: 'web', name: '@deepseek-ai/dsh-web', config: { searchProvider: 'deepseek-official', fetchProvider: 'http' } },
      { id: 'web-search-deepseek', name: '@deepseek-ai/dsh-web-search-deepseek', config: { apiKeyEnv: 'DEEPSEEK_API_KEY' } },
    ],
  },
]
const composed = applyEntryPatches(applyEntryPatches([], baseLayer), patches)
for (const id of ['custom-search', 'web', 'web-search-deepseek']) {
  assert.equal(composed.filter((row) => row.id === id).length, 1, `合成后 "${id}" 必须只有一行`)
}
assert.equal(
  composed.find((row) => row.id === 'web').config.searchProvider,
  'custom-search',
  'web 行必须被就地改为指向本 provider',
)
assert.equal(composed.find((row) => row.id === 'web-search-deepseek').disabled, true)
assert.equal(
  composed.find((row) => row.id === 'web-search-deepseek').config.apiKeyEnv,
  'DEEPSEEK_API_KEY',
  '只写 disabled 的覆盖不应清掉该行原有的 config',
)
ok('覆盖层叠在 dsh-base 之上：3 行各一份，web 指向本 provider，官方 provider 被关停')

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

const clientConst = (name) => {
  const match = clientSrc.match(new RegExp(`\\b${name}\\s*=\\s*'([^']+)'`, 'u'))
  assert.ok(match, `client.js 必须声明 ${name}`)
  return match[1]
}

// The page offers two entry points and both are needed: `plugins.item` is the
// card that opens this plugin's own page (the shape the official settings pages
// use, and the only one reachable without opening the bundle first), while
// `plugins.row.config` is the 配置 control the page puts on a row — and only
// when a registration exists for `<package name>#<row id>`.
assert.equal(clientConst('ITEM_SLOT'), 'plugins.item', 'ITEM_SLOT 必须是插件页的卡片槽')
assert.equal(clientConst('ROW_SLOT'), 'plugins.row.config', 'ROW_SLOT 必须是行的配置槽')
ok(`两个入口的槽位正确（${clientConst('ITEM_SLOT')} + ${clientConst('ROW_SLOT')}）`)

const rowKey = clientConst('ROW_KEY')
assert.equal(
  rowKey,
  `${pkg.name}#${pluginRow.id}`,
  `row 槽的 key 必须是 <包名>#<行 id>，即 ${pkg.name}#${pluginRow.id}`,
)
ok(`row 槽 key 与包名 + 行 id 一致（${rowKey}）`)

const rowId = clientConst('ROW_ID')
assert.equal(rowId, pluginRow.id, `configForms 用的命名空间是行 id，必须等于 patch 行 id「${pluginRow.id}」`)
ok(`configForms 命名空间与 patch 行 id 一致（${rowId}）`)

assert.ok(
  /whileServed\(\s*\[\s*ROW_ID\s*\]/u.test(clientSrc),
  '挂载应经 configForms.whileServed 跟随 Host 提供的命名空间',
)
// Anchored to a line of its own so the `mount` DECLARATION (which begins with
// `function`) is not counted as one of its own call sites.
const mounts = [...clientSrc.matchAll(/^[ \t]+mount\(\s*ctx,\s*card,\s*(\w+)/gmu)].map((match) => match[1])
assert.deepEqual(mounts, ['ITEM_SLOT', 'ROW_SLOT'], '两个入口都必须挂载，缺一个就少一个配置入口')
ok(`两个入口都经 configForms.whileServed 挂载（${mounts.join(' + ')}）`)

// --- browser half: actually run it ----------------------------------------
// The checks above read the source's shape. These RUN it: the factory is
// materialized with a stub `require`, `apply(ctx)` is driven against a fake
// context, and the registrations it makes are inspected. A throw anywhere in
// here is exactly what makes the page silently absent in the browser, where
// `dsh-client-modules` records the failure and mounts nothing at all.
const makeStore = () => {
  let value = null
  return { getSnapshot: () => value, set: (next) => { value = next }, subscribe: () => () => {} }
}
const uiStub = {
  settingsTextField: (name) => ({ kind: 'text', name }),
  settingsNumberField: (name) => ({ kind: 'number', name }),
  SettingsFormModel: class {
    constructor(scope, specs, secrets) {
      this.scope = scope
      this.specs = specs
      this.secrets = secrets
    }
    shell() {
      return { available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false }
    }
    field() {
      return { text: '', overridden: false, invalid: false }
    }
    bind(project) {
      const store = makeStore()
      store.set(project())
      return store
    }
    actions() {
      return { save: () => {}, discard: () => {}, edit: () => {}, resetField: () => {} }
    }
    dispose() {}
  },
  SettingsForm: (props) => props,
  SettingsValueField: (props) => props,
  SettingsSecretField: (props) => props,
  Pill: (props) => props,
}

const scopeStub = {
  value: { engine: 'brave', apiKeyEnv: '' },
  subscribe: () => () => {},
  getSnapshot() {
    return this.value
  },
}

const registrations = []
const fakeCtx = {
  locale: { bind: () => (key) => key, register: () => () => {} },
  effect: (run) => run(),
  configForms: {
    get: () => scopeStub,
    whileServed: (_namespaces, register) => register(new Set([rowId])),
  },
  slots: {
    inject: (_name, register) => register(),
    register: (options, component) => {
      registrations.push({ options, component })
      return () => {}
    },
  },
  remote: {
    credentials: {
      describe: async () => ({ ok: true, value: {} }),
      set: async () => ({ ok: true }),
    },
  },
}

let loaded
vm.runInContext(clientSrc, vm.createContext({
  window: { __ModuleLoader__: { load: (request) => { loaded = request } } },
  console,
}), { filename: 'client.js' })
assert.ok(loaded, 'client.js 必须调用 window.__ModuleLoader__.load')
assert.equal(loaded.id, pkg.name)

const mod = loaded.factory((spec) => {
  if (spec === 'react') return { createElement: () => null, Fragment: 'Fragment' }
  if (spec === '@deepseek-ai/dsh-client-ui-primitives') return uiStub
  throw new Error(`client.js require("${spec}") 未被 stub 覆盖`)
})
mod.apply(fakeCtx)
ok('client.js 的 apply(ctx) 能在 stub 上下文里跑完')

assert.equal(registrations.length, 2, `apply 应给两个槽各注册一次，实际 ${registrations.length} 次`)
const forSlot = (name) => registrations.filter((entry) => entry.options.name === name)
const itemReg = forSlot('plugins.item')
const rowReg = forSlot('plugins.row.config')
assert.equal(itemReg.length, 1, 'plugins.item 应注册恰好一次')
assert.equal(rowReg.length, 1, 'plugins.row.config 应注册恰好一次')

// The card is a LIST slot, so it is addressed by `id`; the row config is a
// KEYED slot, so it is addressed by `key`.
assert.equal(itemReg[0].options.id, clientConst('ITEM_ID'), 'plugins.item 必须带 id 寻址')
assert.equal(rowReg[0].options.key, rowKey, 'plugins.row.config 必须带 key 寻址')

// The card's id doubles as its artwork key, and the official cards already own
// four ids. Reusing one would leave two cards answering the same `only: id`.
const RESERVED_ITEM_IDS = ['shell', 'agent-loop', 'subagent', 'web-search']
assert.ok(
  !RESERVED_ITEM_IDS.includes(clientConst('ITEM_ID')),
  `卡片 id「${clientConst('ITEM_ID')}」被官方卡片占用：${RESERVED_ITEM_IDS.join(' / ')}`,
)

// The card needs a title, and it must be read through the dictionary so it
// follows the active locale.
assert.equal(typeof itemReg[0].options.label, 'function', 'plugins.item 必须带 label')
assert.equal(itemReg[0].options.label(), 'title', 'label 应读词典的 title')
assert.equal(itemReg[0].options.locale, clientConst('NS'), '注册应带本页的词典命名空间')

// One form, both entry points.
assert.equal(itemReg[0].component, rowReg[0].component, '两个入口必须渲染同一个组件')

// The injected face names the store under `hooks.<key>`, and the page exposes
// it to the component as `props.use<Key>`; a mismatch is silent. Reading the
// prop name back out of the source is what makes this checkable.
const face = itemReg[0].options.inject()
const hookKey = Object.keys(face.hooks ?? {})[0]
assert.ok(hookKey, 'inject() 必须暴露一个 hooks.<key> 供组件读取')
const propName = `use${hookKey.charAt(0).toUpperCase()}${hookKey.slice(1)}`
assert.ok(
  new RegExp(`props\\.${propName}\\s*\\(`, 'u').test(clientSrc),
  `组件必须用 props.${propName}() 读注入的 store，否则表单永远读不到状态`,
)
for (const action of ['save', 'discard', 'edit', 'resetField']) {
  assert.equal(typeof face[action], 'function', `inject() 必须暴露 ${action}，组件把它当作 props.${action}`)
}
ok(`两个入口共用一份表单（props.${propName} + save/discard/edit/resetField）`)

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
