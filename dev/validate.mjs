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

// --- host-half imports vs. the manifest's peerDependencies ----------------
// A bundle installed into a profile resolves `@deepseek-ai/*` from the running
// dsh installation — but only through the resolver dsh-app-boot installs, and
// only for names the manifest declares. An undeclared one is not "optional": it
// is unresolvable, and the consequence is invisible from the UI. The plugin
// loads, the provider works, and exactly the feature behind that import is
// missing. That is how the connectivity probe shipped broken once already:
// `@deepseek-ai/dsh-typert-protocol` resolved nowhere, `installProbe` bowed out
// silently, and the settings page simply said the Host had no probe.
const hostSources = [['index.js', read('index.js')], ['engines.js', read('engines.js')]]
const imported = new Set()
for (const [, source] of hostSources) {
  for (const match of source.matchAll(/(?:import\s*\(\s*|from\s+)['"](@deepseek-ai\/[^'"]+)['"]/gu)) imported.add(match[1])
}
assert.ok(imported.size >= 4, `应至少导入 4 个 @deepseek-ai 包，实际找到 ${imported.size} 个`)
const peers = new Set(Object.keys(pkg.peerDependencies ?? {}))
const undeclared = [...imported].filter((name) => !peers.has(name)).sort()
assert.deepEqual(
  undeclared,
  [],
  `宿主半侧导入了却没声明 peerDependencies 的包（运行时解析不到，功能会静默缺失）：${undeclared.join(', ')}`,
)
ok(`宿主半侧导入的 ${imported.size} 个 @deepseek-ai 包全部声明为 peerDependencies`)

// A peer the code no longer imports is a promise the manifest does not keep.
const stalePeers = [...peers].filter((name) => !imported.has(name)).sort()
assert.deepEqual(stalePeers, [], `peerDependencies 里有代码不再导入的条目：${stalePeers.join(', ')}`)
ok('peerDependencies 没有过期条目')

// `*` is deliberate: dsh-app-boot evaluates @deepseek-ai/dsh-* peers against the
// running version, so any pinned range turns the next Harness upgrade into a
// refused installation that needs an exact-version exemption.
for (const [name, range] of Object.entries(pkg.peerDependencies ?? {})) {
  assert.equal(range, '*', `${name} 的 peer 范围应为 *，否则升级 dsh 后会被兼容性检查拦下`)
}
ok('peer 范围全为 *：升级 dsh 后不会被兼容性检查拦下')

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

// The page offers three entry points and all three are needed, because each one
// is gated by its own registration and an unregistered slot renders as nothing
// rather than as an error:
//
// - `plugins.bundle.config` is the form on this package's own page. The page
//   pulls that section out of the tree entirely unless a registration for the
//   package name is on its ledger (`configured: ledger.bundles.has(pkg.name)`),
//   so a missing registration is exactly a page that is a title over a blank.
// - `plugins.item` is the card that opens a page of this plugin's own (the shape
//   the official settings pages use, and the only one reachable without opening
//   the bundle first).
// - `plugins.row.config` is the 配置 control the page puts on a row — and only
//   when a registration exists for `<package name>#<row id>`.
assert.equal(clientConst('BUNDLE_SLOT'), 'plugins.bundle.config', 'BUNDLE_SLOT 必须是包页的配置槽')
assert.equal(clientConst('ITEM_SLOT'), 'plugins.item', 'ITEM_SLOT 必须是插件页的卡片槽')
assert.equal(clientConst('ROW_SLOT'), 'plugins.row.config', 'ROW_SLOT 必须是行的配置槽')
ok(
  `三个入口的槽位正确（${clientConst('BUNDLE_SLOT')} + ${clientConst('ITEM_SLOT')} + ${clientConst('ROW_SLOT')}）`,
)

// The bundle slot is keyed by package name while the row slot is keyed by
// `<package name>#<row id>`: serving one does not serve the other, so both the
// name and the composed row key have to be right.
assert.equal(clientConst('PKG_NAME'), pkg.name, 'PKG_NAME 必须等于包名：包页的槽按包名寻址')
ok(`包页槽按包名寻址（${clientConst('PKG_NAME')}）`)

assert.ok(
  /mount\(\s*ctx,\s*card,\s*BUNDLE_SLOT,\s*\{\s*key:\s*PKG_NAME\s*\}/u.test(clientSrc),
  'BUNDLE_SLOT 必须按 PKG_NAME 注册：包页用 entryKey = pkg.name 取这一条',
)
ok('包页槽按 PKG_NAME 注册')

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
assert.deepEqual(mounts, ['BUNDLE_SLOT', 'ITEM_SLOT', 'ROW_SLOT'], '三个入口都必须挂载，缺一个就少一个配置入口')
ok(`三个入口都经 configForms.whileServed 挂载（${mounts.join(' + ')}）`)

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

// --- browser half: actually render it --------------------------------------
// Everything above RUNS `apply(ctx)`, but none of it ever CALLS a component.
// That is precisely the gap this closes: a component that throws while
// rendering is contained by the slot runtime, retired from its cell, and then
// drawn as nothing at all — so the symptom is a page that is silently blank,
// with no message anywhere. The stub below builds a real element tree and
// expands function components, so the page component's body runs for real,
// including the paths that only execute on the way to a form.
const ELEMENT = Symbol('react.element')

/** Values the next `useState` calls should settle on, so a panel can be rendered in a non-initial state. */
const pendingState = []
const reactStub = {
  Fragment: 'Fragment',
  createElement: (type, props, ...children) => ({
    [ELEMENT]: true,
    type,
    props: { ...(props ?? {}), children: children.length === 0 ? undefined : children },
  }),
  // This renders once, so a setter never has to do anything; the initial value
  // comes from the queue when one was staged for this call.
  useState: (initial) => [
    pendingState.length > 0 ? pendingState.shift() : (typeof initial === 'function' ? initial() : initial),
    () => {},
  ],
  useEffect: () => {},
  useRef: (initial) => ({ current: initial }),
  useMemo: (factory) => factory(),
  useCallback: (callback) => callback,
}

/**
 * Render a node the way React would: call every function component, follow the
 * children of host ones, and collect every type encountered along the way.
 * @param node - the element, array of elements, or leaf.
 * @param seen - accumulator of element types.
 * @returns the element types in render order.
 */
const expand = (node, seen = []) => {
  if (Array.isArray(node)) {
    for (const child of node) expand(child, seen)
    return seen
  }
  if (node === null || node === undefined || typeof node !== 'object' || node[ELEMENT] !== true) return seen
  seen.push(node.type)
  // A stub primitive is a string marker standing in for a host component: it
  // renders its children, so they are walked too. A real component is called.
  if (typeof node.type === 'function') expand(node.type(node.props), seen)
  else expand(node.props?.children, seen)
  return seen
}

/** Readable name for an element type, for assertions and messages. */
const typeName = (type) => (typeof type === 'string' ? type : type?.name || '(anonymous)')

/**
 * Resolve a dictionary key to the Chinese template the plugin ships.
 *
 * Identity `t` proves a tree rendered; it cannot prove what the page *says*,
 * because every placeholder stays unfilled. This reads the real template out of
 * `client.js`, so a rendered line can be compared with the sentence a user sees.
 * @param key - the dictionary key the component asked for.
 * @returns the template, or the key when it is missing.
 */
const zhTemplate = (key) => {
  const match = new RegExp(`^\\s+${key}: '((?:[^'\\\\]|\\\\.)*)',`, 'mu').exec(clientSrc)
  return match === undefined ? key : match[1].replace(/\\'/gu, "'")
}

/**
 * Collect every string a tree renders.
 *
 * `expand` proves a tree renders; this reads what it says. The connectivity
 * report is the plugin's only user-facing evidence about the outside world, so
 * "it rendered" is not the property worth asserting — the details are.
 * @param node - the element, array, or leaf.
 * @param out - accumulator of text fragments.
 * @returns the fragments in render order.
 */
const textOf = (node, out = []) => {
  if (Array.isArray(node)) {
    for (const child of node) textOf(child, out)
    return out
  }
  if (typeof node === 'string') {
    out.push(node)
    return out
  }
  if (node === null || node === undefined || typeof node !== 'object' || node[ELEMENT] !== true) return out
  if (typeof node.type === 'function') textOf(node.type(node.props), out)
  else textOf(node.props?.children, out)
  return out
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
    /** An unedited field reads back the value the scope already holds. */
    field(name) {
      const current = { engine: 'brave', apiKeyEnv: '', maxResults: '8', timeoutMs: '15000' }
      return { text: current[name] ?? '', overridden: false, invalid: false }
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
  // String markers, not functions: these are host components, and calling one
  // would swallow its children and hide everything inside it from `expand`.
  SettingsForm: 'SettingsForm',
  SettingsValueField: 'SettingsValueField',
  SettingsSecretField: 'SettingsSecretField',
  Pill: 'Pill',
  Button: 'Button',
  StateDot: 'StateDot',
  Tag: 'Tag',
}

const scopeStub = {
  value: { engine: 'brave', apiKeyEnv: '' },
  subscribe: () => () => {},
  getSnapshot() {
    return this.value
  },
}

const registrations = []
const mountCalls = []
const unmountCalls = []
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
    $mount: (contribution) => {
      mountCalls.push(contribution)
      return Promise.resolve(() => { unmountCalls.push(contribution) })
    },
  },
  get: () => undefined,
}

let loaded
vm.runInContext(clientSrc, vm.createContext({
  window: { __ModuleLoader__: { load: (request) => { loaded = request } } },
  console,
}), { filename: 'client.js' })
assert.ok(loaded, 'client.js 必须调用 window.__ModuleLoader__.load')
assert.equal(loaded.id, pkg.name)

const mod = loaded.factory((spec) => {
  if (spec === 'react') return reactStub
  if (spec === '@deepseek-ai/dsh-client-ui-primitives') return uiStub
  throw new Error(`client.js require("${spec}") 未被 stub 覆盖`)
})
mod.apply(fakeCtx)
// Mounting the probe settles on a microtask, so let it land before the probe
// assertions below read what apply() did.
await new Promise((resolve) => setTimeout(resolve, 0))
ok('client.js 的 apply(ctx) 能在 stub 上下文里跑完')

assert.equal(registrations.length, 3, `apply 应给三个槽各注册一次，实际 ${registrations.length} 次`)
const forSlot = (name) => registrations.filter((entry) => entry.options.name === name)
const bundleReg = forSlot('plugins.bundle.config')
const itemReg = forSlot('plugins.item')
const rowReg = forSlot('plugins.row.config')
assert.equal(bundleReg.length, 1, 'plugins.bundle.config 应注册恰好一次')
assert.equal(itemReg.length, 1, 'plugins.item 应注册恰好一次')
assert.equal(rowReg.length, 1, 'plugins.row.config 应注册恰好一次')

// The bundle config is a KEYED slot addressed by package name, the card is a
// LIST slot addressed by `id`, and the row config is a KEYED slot addressed by
// `<package name>#<row id>`. Registering one of the keyed slots does not serve
// the other — different keys, different pages.
assert.equal(bundleReg[0].options.key, pkg.name, 'plugins.bundle.config 必须按包名寻址')
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

// One form, all three entry points.
assert.equal(bundleReg[0].component, itemReg[0].component, '包页与卡片必须渲染同一个组件')
assert.equal(itemReg[0].component, rowReg[0].component, '卡片与行配置必须渲染同一个组件')

// The package page calls this slot with only `{ view: "page" }` — no `form`
// prop (only ItemDetail and RowDetail pass one). The component therefore has to
// take its state from the injected store; reading a passed-in form would leave
// the package page, which is the primary entry point, empty.
assert.ok(
  !/props\.form\b/u.test(clientSrc),
  '组件不能依赖 props.form：包页调用该槽时不传 form',
)
ok('包页不传 form，组件自持状态')

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
ok(`三个入口共用一份表单（props.${propName} + save/discard/edit/resetField）`)

// --- the page component, rendered -----------------------------------------
// Everything up to here proves the registrations are shaped right. This proves
// the component they point at actually renders. A component that throws is
// contained by the slot runtime, retired from its cell, and drawn as nothing at
// all — so "renders" is the property that has to be asserted, and a page that
// is blank with no message anywhere is the failure it guards against.
const Card = itemReg[0].component
const noop = () => {}
const pageState = face.hooks[hookKey].getSnapshot()
const pageProps = {
  view: 'page',
  t: (key) => key,
  [propName]: (select) => select(pageState),
  save: noop,
  discard: noop,
  edit: noop,
  resetField: noop,
  testConnection: async () => ({ local: [], remote: { status: 'unavailable' } }),
}

let pageTypes
assert.doesNotThrow(() => {
  pageTypes = expand(Card(pageProps)).map(typeName)
}, 'page 视图渲染抛错：组件一抛错就会被槽运行时退役，整块配置区显示为空白')

for (const expected of ['SettingsForm', 'SettingsValueField', 'SettingsSecretField', 'Button']) {
  assert.ok(pageTypes.includes(expected), `page 视图的渲染树里缺少 ${expected}`)
}
const fieldCount = pageTypes.filter((name) => name === 'SettingsValueField').length
assert.ok(fieldCount >= 11, `page 视图应渲染至少 11 个值字段（schema 的非密文字段），实际 ${fieldCount}`)
ok(`page 视图渲染成功（${fieldCount} 个值字段 + 密钥控件 + 连接面板）`)

// The summary view is the list card's one-liner: one string, and no form. It
// still gets the hook, because the component reads it above its view branch —
// hooks cannot be called conditionally, so every view sends the same one.
assert.equal(
  Card({ view: 'summary', t: (key) => key, [propName]: (select) => select(pageState) }),
  'summary',
  'summary 视图必须返回词典的 summary 文案',
)
ok('summary 视图只返回一行文案')

// A settled probe report, so the branches that only render once something has
// run — the check lines, the per-attempt detail and the source list — execute
// too. The detail rows are the whole point of the report: a bare "failed" tells
// a user nothing they can act on, while the status code, the host and the
// credential origin separate a bad key from a wrong endpoint from a key that was
// never resolved.
// Staging is a function because the stub re-invokes function components on every
// traversal: `expand` and `textOf` each render the tree once, so both need the
// report armed before they run.
const reportedReport = {
  local: [
    { level: 'ok', key: 'chkEngineOk', vars: { v: 'Brave Search' } },
    { level: 'bad', key: 'chkKeyMissing', vars: { v: 'BRAVE_API_KEY' } },
  ],
  dirty: true,
  remote: {
    status: 'ok',
    count: 2,
    elapsedMs: 12,
    engineLabel: 'Brave Search',
    attempts: [
      {
        engine: 'brave',
        engineLabel: 'Brave Search',
        method: 'GET',
        endpoint: 'https://api.example.test/res/v1/web/search',
        status: 200,
        ms: 12,
        ok: true,
        count: 2,
        credential: 'credential',
        ref: 'BRAVE_API_KEY',
      },
    ],
    sources: [{ title: 'Alpha', url: 'https://example.test/a' }],
  },
}
const stageReport = () => pendingState.push(reportedReport, false)

let reportedTypes
let reportedText
assert.doesNotThrow(() => {
  stageReport()
  const tree = Card({ ...pageProps, t: zhTemplate })
  reportedTypes = expand(tree).map(typeName)
  stageReport()
  reportedText = textOf(tree).join(' | ')
}, '带探针报告时 page 视图渲染抛错')
assert.ok(reportedTypes.includes('Button'), '带报告的连接面板应仍渲染按钮')
ok('带探针报告时 page 视图渲染成功（检查行 + 请求明细 + 来源列表）')

// The details actually reach the page: the status line, the host, and where the
// key came from — with placeholders filled, so this is the sentence a user reads.
assert.match(reportedText, /HTTP 200 · 12 ms/u, '报告必须写出状态码与往返耗时')
assert.match(reportedText, /GET https:\/\/api\.example\.test\/res\/v1\/web\/search/u, '报告必须写出方法与脱敏端点')
assert.match(reportedText, /密钥来源：凭据服务（BRAVE_API_KEY）/u, '报告必须写出密钥来源与引用名')
ok('报告明细（状态码 / 方法 / 端点 / 密钥来源）真的渲染出来了')

// Every credential origin the Host can report must have a dictionary entry;
// a missing one drops the line silently, and that line is the fix instruction.
// Keys are read in both spellings: an identifier-shaped one is unquoted, the
// hyphenated ones cannot be.
const keySourceBlock = clientSrc.slice(
  clientSrc.indexOf('const KEY_SOURCE_OF'),
  clientSrc.indexOf('}', clientSrc.indexOf('const KEY_SOURCE_OF')),
)
const clientKeySources = [...keySourceBlock.matchAll(/^\s*'?([a-z-]+)'?:/gmu)].map((match) => match[1])
const hostKeySources = ['literal', 'credential', 'launch-environment', 'process-env', 'none', 'not-needed']
for (const source of hostKeySources) {
  assert.ok(clientKeySources.includes(source), `客户端 KEY_SOURCE_OF 缺少宿主会报的来源 "${source}"`)
  assert.ok(read('index.js').includes(`'${source}'`), `index.js 里找不到来源字面量 "${source}"：两半已经说不到一起了`)
}
ok(`密钥来源两端一致（${hostKeySources.length} 种）`)

// A registration that injected no probe still renders — as a plain form.
const bareProps = { ...pageProps }
delete bareProps.testConnection
let bareTypes
assert.doesNotThrow(() => {
  bareTypes = expand(Card(bareProps)).map(typeName)
}, '未注入 testConnection 时 page 视图渲染抛错')
assert.ok(!bareTypes.includes('Button'), '没有探针时不应出现测试连接按钮')
ok('未注入探针时仍渲染为普通表单')

// The page component must take every hook through its props (`use<Key>` is
// injected, not called), so the number of hooks it calls cannot depend on which
// view it renders — a conditional or view-dependent hook chain is rejected by
// React, and the panel's own hooks now live on its own fiber.
const cardBody = clientSrc.slice(
  clientSrc.indexOf('function CustomSearchCard(props)'),
  clientSrc.indexOf('const inject = ', clientSrc.indexOf('function CustomSearchCard(props)')),
)
assert.ok(cardBody.length > 0, '必须能找到 CustomSearchCard 的函数体')
assert.ok(
  !/React\.use[A-Z]/u.test(cardBody),
  'CustomSearchCard 自身不得调用 React hook：hook 数量必须与视图无关',
)
ok('页面组件不自带 React hook（hook 一律经 props 注入）')

// `testConnection` is the button's whole payload, so its report shape is
// checked directly: the local pass always answers, and never rejects.
const probeReport = await face.testConnection('')
assert.ok(
  Array.isArray(probeReport.local) && probeReport.local.length >= 2,
  `testConnection 必须返回本地检查清单，实际 ${probeReport.local?.length} 项`,
)
assert.ok(
  probeReport.local.some((row) => row.key === 'chkEngineOk'),
  '已配置的 brave 引擎应通过引擎检查',
)
assert.ok(
  probeReport.local.some((row) => row.key === 'chkKeyMissing'),
  '未配置密钥时应给出 chkKeyMissing，而不是静默通过',
)
assert.equal(typeof probeReport.dirty, 'boolean', 'testConnection 必须报告草稿是否未保存')
assert.ok(probeReport.remote !== undefined, 'testConnection 必须报告远端一栏（不可用时为 unavailable）')
for (const row of probeReport.local) {
  assert.ok(typeof row.key === 'string' && typeof row.level === 'string', '每条本地检查都要有 key 与 level')
}
ok(`testConnection 返回本地检查清单（${probeReport.local.length} 项，remote=${probeReport.remote.status}）`)

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

// --- why the probe is unavailable, said out loud --------------------------
// This panel used to answer every one of five different failures with the same
// sentence, and that sentence blamed the Host — the one party the page cannot
// observe. A mount *the page itself* refused therefore read as the Host's
// fault, which is both wrong and completely unactionable. Three of the four
// causes are page-observable, so each has to reach the screen with its reason
// attached.
const blockOf = (marker) => clientSrc.slice(clientSrc.indexOf(marker), clientSrc.indexOf('}', clientSrc.indexOf(marker)))
const absenceEntries = [...blockOf('const ABSENCE_KEY_OF').matchAll(/^\s*'?([a-z-]+)'?:\s*'([A-Za-z]+)'/gmu)]
  .map((match) => [match[1], match[2]])
assert.equal(absenceEntries.length, 4, `ABSENCE_KEY_OF 应有 4 个成因，实际 ${absenceEntries.length}`)

// Both directions: a cause the panel can report with no sentence would render
// the key itself, and a sentence with no cause is dead code that pretends to
// cover something. `pending` is excluded because it deliberately keeps the
// generic wording — an in-flight mount has no cause to name yet.
const emittedCauses = new Set(
  [
    ...clientSrc
      .slice(clientSrc.indexOf('function describeProbeAbsence'), clientSrc.indexOf('function mountProbe'))
      .matchAll(/cause:\s*'([a-z-]+)'/gu),
  ].map((match) => match[1]),
)
emittedCauses.delete('pending')
assert.deepEqual(
  [...emittedCauses].sort(),
  absenceEntries.map(([cause]) => cause).sort(),
  'describeProbeAbsence 报的成因与 ABSENCE_KEY_OF 的句子对不上',
)

for (const [cause, key] of absenceEntries) {
  assert.ok(zhKeys.has(key), `zh 词典缺少探针缺席文案 ${key}（成因 ${cause}）`)
  assert.ok(enKeys.has(key), `en 词典缺少探针缺席文案 ${key}（成因 ${cause}）`)
}

// One staged pair per traversal: `Card` itself consumes none, and each of
// `expand`/`textOf` invokes the panel's two `useState` calls once. Staging twice
// for one traversal leaves a residue that shifts every later render by one.
const reportedAbsence = (remote) => {
  pendingState.push({ local: [], dirty: false, remote }, false)
  const tree = Card({ ...pageProps, t: zhTemplate })
  return textOf(tree).join(' | ')
}

const absenceSentences = new Set()
for (const [cause, key] of absenceEntries) {
  const detail = cause === 'refused' ? 'gateway/invocation-unavailable: no active Remote method exports this endpoint' : cause === 'unreadable' ? 'customSearchProbe' : cause === 'missing-method' ? 'test' : undefined
  const text = reportedAbsence({ status: 'unavailable', cause, ...(detail === undefined ? {} : { message: detail }) })
  // Compared against the real template up to its placeholder, so this is the
  // sentence a user reads rather than "something rendered".
  const literal = zhTemplate(key).split('{v}')[0]
  assert.ok(text.includes(literal), `成因 ${cause} 应渲染「${literal}」，实际渲染：${text}`)
  if (detail !== undefined) assert.ok(text.includes(detail), `成因 ${cause} 必须把原因原样带出来，实际渲染：${text}`)
  assert.ok(!text.includes(zhTemplate('probeUnavailable')), `成因 ${cause} 不该再用那句含糊话`)
  absenceSentences.add(text)
}
assert.equal(absenceSentences.size, absenceEntries.length, '四个成因必须渲染成四句不同的话')
ok(`探针缺席的 4 种成因各自渲染成不同的句子（含原因原文）`)

// --- test-connection probe: the two hand-written declarations -------------
// The panel reaches the Host's probe through a Remote call. Neither half can
// generate its declaration — this package has no build step — so both are
// written by hand, and nothing at runtime cross-checks them: a namespace typo
// leaves the panel quietly reporting "local checks only". These assertions are
// that cross-check.
const indexSrc = read('index.js')
const pluginModule = await import('../index.js')
const contribution = mod.PROBE_CONTRIBUTION

assert.ok(contribution, 'client.js 必须导出 PROBE_CONTRIBUTION')
assert.equal(contribution.package, pkg.name, 'contribution.package 决定贡献归属，必须等于包名')
assert.equal(
  mod.PROBE_NAMESPACE,
  pluginModule.PROBE_NAMESPACE,
  `两半的探针命名空间必须一致（宿主侧是 ${pluginModule.PROBE_NAMESPACE}）`,
)
ok(`探针命名空间两半一致（${mod.PROBE_NAMESPACE}）`)

const descriptors = contribution.descriptors ?? []
assert.equal(descriptors.length, 1, 'contribution 只描述一个方法')
const probeDescriptor = descriptors[0]
assert.equal(probeDescriptor.namespace, pluginModule.PROBE_NAMESPACE, 'descriptor.namespace 与宿主服务键不一致')
assert.equal(probeDescriptor.service, pluginModule.PROBE_NAMESPACE, 'descriptor.service 指向的宿主服务名不一致')
assert.equal(probeDescriptor.method, mod.PROBE_METHOD, 'descriptor.method 与导出的方法名不一致')
assert.equal(probeDescriptor.invocation?.kind, 'direct', '源模式发现只支持 kind: direct 的直达方法')
assert.equal(
  probeDescriptor.id,
  `${pkg.name}#${pluginModule.PROBE_NAMESPACE}/${mod.PROBE_METHOD}`,
  'descriptor.id 必须形如 <包名>#<命名空间>/<方法>',
)

// `$mount` refuses the whole contribution when a parameter lacks a strict codec
// marker. It never runs that codec — the call sends positional JSON keyed by
// `wire` — so the marker is the entire contract.
assert.equal(probeDescriptor.parameters?.length, 1, '探针有一个业务参数：搜索词')
const probeParameter = probeDescriptor.parameters[0]
assert.equal(probeParameter.codec?.mode, 'strict', '$mount 要求每个参数都带 strict codec 标记')
assert.equal(probeParameter.source, 'json', '搜索词按位置传 JSON，source 必须是 json')
assert.equal(probeParameter.wire, probeParameter.name, 'wire 与 name 相同：源模式按名字装 args')
ok('探针 descriptor 满足 $mount 的形状要求（直达 / strict codec / id 形式）')

// The wire name must equal the Host method's own parameter name: source-mode
// discovery derives the parameter list from that function's source text, and
// rejects defaults, destructuring and rest parameters outright.
const hostSignature = indexSrc.match(/async\s+test\s*\(([^)]*)\)/u)
assert.ok(hostSignature, 'index.js 里找不到探针方法 async test(...)')
const hostParams = hostSignature[1].split(',').map((part) => part.trim()).filter((part) => part.length > 0)
assert.ok(
  hostParams.length > 0 && hostParams.every((name) => /^[$A-Z_a-z][$\w]*$/u.test(name)),
  `探针方法参数必须是简单标识符（无默认值/解构/rest），实际是「${hostSignature[1]}」`,
)
assert.deepEqual(hostParams, [probeParameter.name], `宿主方法参数名与 descriptor 不一致（宿主：${hostParams.join(', ')}）`)
ok(`宿主方法参数名与 descriptor 一致（${hostParams.join(', ')}）`)

// The prototype marker is what source-mode discovery actually reads.
assert.equal(
  pluginModule.PROBE_MARKER_KEY,
  '@deepseek-ai/dsh-typert-protocol/remote-methods',
  '原型标记键必须与 Gateway 读取的常量逐字相同',
)
const marker = pluginModule.PROBE_METHODS.find((entry) => entry.method === mod.PROBE_METHOD)
assert.ok(marker, `PROBE_METHODS 里缺少 ${mod.PROBE_METHOD} 的标记`)
assert.equal(marker.invocation?.kind, 'direct', '标记的 invocation.kind 必须与 descriptor 一致')
ok('宿主侧 Remote 标记与页面侧 descriptor 描述同一个端点')

// The probe rides the Remote service, so the page must declare that dependency
// and actually hand the contribution over.
assert.ok(mod.inject.includes('remote'), 'inject 必须含 remote：$mount 挂在它上面')
assert.equal(mountCalls.length, 1, `apply 应把探针交给 remote.$mount 恰好一次，实际 ${mountCalls.length} 次`)
assert.equal(mountCalls[0]?.package, pkg.name, '$mount 收到的是本包的 contribution')
ok('apply 把探针 contribution 交给 remote.$mount')

// A key used by the page but missing from a dictionary renders as its raw name
// in that language — how a half-translated panel shows up.
const valueFields = [
  ...listOf(clientSrc.match(/TEXT_FIELDS\s*=\s*\[([\s\S]*?)\]/u)),
  ...listOf(clientSrc.match(/NUMBER_FIELDS\s*=\s*\[([\s\S]*?)\]/u)),
]
const labelKeys = new Set(
  [...(clientSrc.match(/LABEL_OF\s*=\s*\{([\s\S]*?)\n {4}\}/u)?.[1] ?? '').matchAll(/:\s*'([A-Za-z]\w*)'/gu)].map((m) => m[1]),
)
const usedKeys = new Set([
  ...[...clientSrc.matchAll(/\bt\(\s*'([A-Za-z]\w*)'\s*\)/gu)].map((m) => m[1]),
  ...[...clientSrc.matchAll(/key:\s*'(chk[A-Za-z]\w*)'/gu)].map((m) => m[1]),
])
for (const field of valueFields) {
  const cap = `${field.charAt(0).toUpperCase()}${field.slice(1)}`
  assert.ok(labelKeys.has(`label${cap}`), `字段 ${field} 在 LABEL_OF 里没有 label 键`)
  usedKeys.add(`label${cap}`)
  usedKeys.add(`hint${cap}`)
}
for (const key of usedKeys) {
  assert.ok(zhKeys.has(key), `client.js 用到词典键 "${key}"，但 zh 词典里没有`)
  assert.ok(enKeys.has(key), `client.js 用到词典键 "${key}"，但 en 词典里没有`)
}
ok(`client.js 引用的 ${usedKeys.size} 个词典键在 zh / en 中都存在`)

console.log(`\n全部 ${checked.length} 项清单校验通过。`)
