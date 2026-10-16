/**
 * dsh-custom-search — browser half.
 *
 * DSH does not derive a plugin's settings page from its `Config` schema. The
 * Plugins page renders a config page only for plugins whose own browser half
 * registers one, through `ctx.slots.inject()`. Without this module the row has
 * nothing but a toggle and the plugin cannot be configured from the GUI at all.
 *
 * The page offers three entry points, and all three are registered here, because
 * each one is gated by its own registration and an unregistered slot renders as
 * nothing rather than as an error:
 *
 * - `plugins.bundle.config` — the form on this package's own page, the one its
 *   card in the installed list opens. Keyed by package name, and the page
 *   renders its whole section only when a registration for that name exists
 *   (`configured: ledger.bundles.has(pkg.name)`), so without this the package
 *   page is a title and a blank below it. This is the primary entry point.
 * - `plugins.item` — a card of this plugin's own on the Plugins page, opening a
 *   page with the same form. This is the shape the official settings pages use,
 *   and the only one reachable without opening the bundle first.
 * - `plugins.row.config` — the same form behind the 配置 control on this
 *   plugin's own row, which the page offers when (and only when) a registration
 *   exists for `<package name>#<row id>`.
 *
 * Shape expected by `@deepseek-ai/dsh-client-modules`: executing this file only
 * REGISTERS a factory; the module body runs when it is first materialized. `id`
 * must equal the package name, because a package's browser half is a single
 * module attached to the Loader row whose specifier is exactly that name.
 *
 * `react`, `react/jsx-runtime` and `@deepseek-ai/dsh-client-ui-primitives` are
 * platform modules in the frozen shell table, so they need no `dsh.client.external`
 * entry. Plain CJS with `React.createElement` — no build step, no JSX.
 */
window.__ModuleLoader__.load({
  id: 'dsh-custom-search',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const UI = require('@deepseek-ai/dsh-client-ui-primitives')

    /**
     * Row id this page configures. It is also the settings namespace the Host
     * serves for that row, which is the key `configForms.get()` takes.
     */
    const ROW_ID = 'custom-search'

    /**
     * Slot key. The Plugins page keys `plugins.row.config` by
     * `<bundle package name>#<row id>` — spelled out here rather than derived,
     * because this package must not import its own manifest at runtime.
     */
    const ROW_KEY = 'dsh-custom-search#custom-search'

    /** The card of this plugin's own on the Plugins page. */
    const ITEM_SLOT = 'plugins.item'

    /** The 配置 control on this plugin's own row. */
    const ROW_SLOT = 'plugins.row.config'

    /**
     * Registration id of the card above. The page also keys card artwork by
     * this id: unknown ids fall back to the default artwork, while `shell`,
     * `agent-loop`, `subagent` and `web-search` are taken by the official
     * cards, so this must stay distinct from all four.
     */
    const ITEM_ID = 'custom-search'

    /** Where the card sorts among the other cards of the page. */
    const ITEM_ORDER = 45

    /**
     * The form on this package's own page. The page keys this slot by package
     * name and renders the section only while a registration for that name is
     * on its ledger, so this registration is what makes the page configurable.
     */
    const BUNDLE_SLOT = 'plugins.bundle.config'

    /** This package's name. The bundle-level slot is keyed by it, not by the row. */
    const PKG_NAME = 'dsh-custom-search'

    /** Dictionary namespace owned by this plugin. */
    const NS = 'settings.customSearch'

    /** Form field staging the API key. The key never rides the settings file. */
    const API_KEY_FIELD = 'apiKey'

    /** Credential reference used when neither the section nor the engine names one. */
    const FALLBACK_KEY_REF = 'CUSTOM_SEARCH_API_KEY'

    /**
     * Namespace — and Host service key — of the connectivity probe. Equals
     * `PROBE_NAMESPACE` in `index.js`; spelled out on both sides because neither
     * module can reach the other's constants.
     */
    const PROBE_NAMESPACE = 'customSearchProbe'

    /** The one method that namespace exposes. */
    const PROBE_METHOD = 'test'

    /**
     * The boundary schema a strict codec must be able to produce.
     *
     * This endpoint's boundary is JSON and nothing more: the Host synthesizes an
     * SRC parameter as `{ mode: 'src-json' }`, and its `decode()` only consults a
     * codec at all for strict ones. So the honest factory is a JSON passthrough.
     */
    const SRC_BOUNDARY_SCHEMA = { parse: (value) => value }

    /**
     * A strict codec, complete enough for every validator on the way in.
     *
     * Three separate validators read a descriptor, and they do NOT agree on how
     * much of a codec has to be there:
     *
     *   - the Gateway's `requireStrictInputs` looks only at `mode`;
     *   - the Client registry's `validateInvocation`/`validateCodec` — reached by
     *     the same `$mount`, right after the Gateway's check — additionally
     *     demands a non-empty `typeSymbol` and a `create` function;
     *   - `dsh-typert-loader`'s `requireStrictCodec` demands the same, plus that
     *     `decode`/`encode`, if present at all, are functions.
     *
     * Falling short of the second one cost us the probe for two releases, and it
     * reported itself as `Cannot read properties of undefined (reading 'length')`
     * — `validateNonempty` reading `.length` off the absent `typeSymbol`. Hence
     * one factory here rather than two hand-written literals.
     *
     * @param typeSymbol - the `<package>#<endpoint>:<slot>` name the schema carries.
     * @returns a codec that satisfies all three validators.
     */
    const strictCodec = (typeSymbol) => ({
      mode: 'strict',
      typeSymbol,
      create: () => SRC_BOUNDARY_SCHEMA,
    })

    /**
     * The Host-for-Client contribution the probe is mounted from.
     *
     * This deployment selects Remote capabilities at build time, so a plugin
     * that ships no generated `/remote` artifact cannot be added to that set.
     * The Gateway's source-mode fallback covers exactly that case: the Host half
     * declares a Remote marker on its service prototype, and this side hands the
     * Gateway the descriptor describing the same endpoint.
     *
     * The call itself sends positional JSON values keyed by `wire`; the codecs
     * exist to satisfy validation, not to transform anything. A refused mount is
     * not fatal — the page falls back to its local checks and says which
     * validator refused it.
     */
    const PROBE_CONTRIBUTION = {
      package: PKG_NAME,
      descriptors: [
        {
          id: `${PKG_NAME}#${PROBE_NAMESPACE}/${PROBE_METHOD}`,
          service: PROBE_NAMESPACE,
          namespace: PROBE_NAMESPACE,
          method: PROBE_METHOD,
          invocation: { kind: 'direct' },
          parameters: [
            {
              name: 'query',
              wire: 'query',
              source: 'json',
              codec: strictCodec(`${PKG_NAME}#${PROBE_NAMESPACE}/${PROBE_METHOD}:parameter:query`),
            },
          ],
          result: strictCodec(`${PKG_NAME}#${PROBE_NAMESPACE}/${PROBE_METHOD}:result`),
        },
      ],
    }

    /** Numeric bounds the Host half clamps to; the checks report rather than clamp. */
    const MAX_RESULTS_CEILING = 20

    /** Lowest timeout the Host half accepts. */
    const MIN_TIMEOUT_MS = 1000

    /**
     * Engine ids, their display labels, and the credential reference each one
     * reads when `apiKeyEnv` is left empty. Mirrors `engines.js` on the host
     * half; duplicated rather than imported because a client module cannot
     * reach the host half's source.
     */
    const ENGINES = [
      { id: 'searxng', label: 'SearXNG', apiKeyEnv: null },
      { id: 'tavily', label: 'Tavily', apiKeyEnv: 'TAVILY_API_KEY' },
      { id: 'exa', label: 'Exa', apiKeyEnv: 'EXA_API_KEY' },
      { id: 'brave', label: 'Brave Search', apiKeyEnv: 'BRAVE_API_KEY' },
      { id: 'serper', label: 'Serper', apiKeyEnv: 'SERPER_API_KEY' },
      { id: 'bing', label: 'Bing', apiKeyEnv: 'BING_API_KEY' },
      { id: 'google', label: 'Google CSE', apiKeyEnv: 'GOOGLE_API_KEY' },
    ]

    /**
     * Fields staged as text, in display order. `engine` is here as well as in
     * the pill row, so the value stays visible and typable.
     */
    const TEXT_FIELDS = [
      'engine',
      'fallback',
      'endpoint',
      'endpoints',
      'apiKeyEnv',
      'googleCx',
      'searchDepth',
      'language',
      'safeSearch',
    ]

    /** Fields edited as whole numbers. */
    const NUMBER_FIELDS = ['maxResults', 'timeoutMs']

    /** Every non-secret field this page shows. */
    const VALUE_FIELDS = [...TEXT_FIELDS, ...NUMBER_FIELDS]

    /** Conversion specs the form model stages edits through. */
    const SPECS = [
      ...TEXT_FIELDS.map((field) => UI.settingsTextField(field)),
      ...NUMBER_FIELDS.map((field) => UI.settingsNumberField(field)),
    ]

    /** Simplified Chinese copy. */
    const zh = {
      title: '自定义搜索引擎',
      summary: '用你自己的搜索源替换官方 DeepSeek 搜索。',
      engineQuick: '一键切换（也可直接改下面的文本）',
      labelEngine: '搜索引擎',
      labelFallback: '备用引擎',
      labelEndpoint: '接口地址',
      labelEndpoints: '按引擎的接口地址',
      labelApiKey: 'API Key',
      labelApiKeyEnv: '凭证引用名',
      labelGoogleCx: 'Google 搜索引擎 ID',
      labelSearchDepth: '检索深度',
      labelMaxResults: '最多返回条数',
      labelTimeoutMs: '超时（毫秒）',
      labelLanguage: '语言 / 地区',
      labelSafeSearch: '安全搜索',
      hintEngine: 'searxng / tavily / exa / brave / serper / bing / google',
      hintFallback: '逗号分隔，主引擎报错或返回空结果时按顺序兜底。留空表示不兜底。',
      hintEndpoint: '主引擎的接口基址。留空用官方地址；自建 SearXNG 填 http://127.0.0.1:8080。',
      hintEndpoints: 'JSON，按引擎分别指定基址，例如 {"tavily":"https://gw.internal/tavily"}。优先级高于接口地址。',
      hintApiKey: '不写入设置文件，存在凭证服务里，由下面的凭证引用名寻址。留空表示保持当前密钥。',
      hintApiKeyEnv: '留空则用该引擎约定的环境变量（如 Brave 是 BRAVE_API_KEY）。',
      hintGoogleCx: '只有 Google CSE 需要：Programmable Search 的搜索引擎 ID。',
      hintSearchDepth: '只有 Tavily 用：basic 或 advanced（advanced 更耗额度）。',
      hintMaxResults: '单次搜索最多返回多少条来源，上限 20。',
      hintTimeoutMs: '单次搜索超时毫秒数。',
      hintLanguage: '语言 / 地区提示，各引擎会映射成自己的参数。',
      hintSafeSearch: 'off / moderate / strict，引擎不支持时忽略。',
      apiKeySet: '已配置密钥。',
      apiKeyUnset: '未配置密钥；需要 key 的引擎会直接报错。',
      overridden: '已覆盖',
      reset: '恢复默认',
      invalidNumber: '请填数字；留空表示使用默认值。',
      unavailable: '该插件当前未加载，暂时无法配置。',
      readOnly: '本部署的设置为只读。',
      save: '保存',
      saving: '保存中…',
      saveFailed: '本部署没有接受这些值，已保留供你修改。',
      test: '测试连接',
      testing: '测试中…',
      testHint: '按当前配置发一次真实搜索，验证密钥和接口是否可用（消耗 1 次配额）。',
      probeDirty: '有未保存的修改：上面的检查看的是当前输入，真实请求用的是已保存的配置。',
      probeUnavailable: '宿主没有提供探针，只能做本地检查。',
      probeNoMount: '这个 Harness 构建的 remote 上没有 $mount，页面无法挂载探针。',
      probeRefused: '挂载探针被拒绝：{v}',
      probeNotReadable: '探针已挂载，但读不到命名空间 {v}。',
      probeMissingMethod: '探针已挂载，但没有 {v} 方法。',
      probeOk: '{v} 返回 {n} 条结果，用时 {ms} ms。',
      probeFail: '请求失败：{msg}',
      probeRequest: '{m} {url}',
      probeStatus: 'HTTP {s} · {ms} ms',
      probeNoStatus: '未拿到响应 · {ms} ms',
      probeNote: '· {v}',
      probeCredential: '密钥来源：{v}',
      keySourceLiteral: '配置里的字面密钥',
      keySourceCredential: '凭据服务（{v}）',
      keySourceLaunch: '启动环境（{v}）',
      keySourceProcess: '进程环境变量（{v}）',
      keySourceMissing: '未找到（{v}）',
      keySourceFree: '不需要（该引擎免密钥）',
      chkEngineOk: '引擎：{v}',
      chkEngineBad: '引擎无效：{v}',
      chkKeyOk: '密钥：已配置（{v}）',
      chkKeyMissing: '密钥：未配置（{v}），该引擎会直接报错',
      chkKeyFree: '密钥：不需要，SearXNG 只要求接口地址可达',
      chkEndpointOk: '接口地址：{v}',
      chkEndpointBad: '接口地址不是合法的 http(s) 地址：{v}',
      chkEndpointsBad: '按引擎的接口地址不是 JSON 对象，会被整个忽略',
      chkFallbackOk: '兜底链：{v}',
      chkFallbackBad: '兜底里有无法识别的引擎：{v}',
      chkNumbersBad: '数值超出范围：{v}',
      chkGoogleCxBad: 'Google CSE 还缺搜索引擎 ID（googleCx）',
    }

    /** English copy. */
    const en = {
      title: 'Custom search',
      summary: 'Replace the built-in DeepSeek search with an engine you choose.',
      engineQuick: 'One-click switch (the field below stays editable)',
      labelEngine: 'Search engine',
      labelFallback: 'Fallback engines',
      labelEndpoint: 'Endpoint',
      labelEndpoints: 'Per-engine endpoints',
      labelApiKey: 'API key',
      labelApiKeyEnv: 'Credential reference',
      labelGoogleCx: 'Google engine ID',
      labelSearchDepth: 'Search depth',
      labelMaxResults: 'Max sources',
      labelTimeoutMs: 'Timeout (ms)',
      labelLanguage: 'Language / region',
      labelSafeSearch: 'Safe search',
      hintEngine: 'searxng / tavily / exa / brave / serper / bing / google',
      hintFallback: 'Comma-separated; tried in order when the primary fails or returns nothing. Blank disables it.',
      hintEndpoint: 'Base URL of the primary engine. Blank uses the vendor default; self-hosted SearXNG is http://127.0.0.1:8080.',
      hintEndpoints: 'JSON mapping engine ids to base URLs, e.g. {"tavily":"https://gw.internal/tavily"}. Wins over the endpoint field.',
      hintApiKey: 'Stored outside the settings file, in the credentials service, addressed by the reference below. Leave blank to keep the current key.',
      hintApiKeyEnv: 'Blank uses the engine\'s conventional variable (BRAVE_API_KEY for Brave).',
      hintGoogleCx: 'Google CSE only: the Programmable Search engine id.',
      hintSearchDepth: 'Tavily only: basic or advanced (advanced spends more quota).',
      hintMaxResults: 'How many sources one search may return, at most 20.',
      hintTimeoutMs: 'Per-search timeout in milliseconds.',
      hintLanguage: 'Language / region hint; each engine maps it to its own parameter.',
      hintSafeSearch: 'off / moderate / strict; ignored by engines without it.',
      apiKeySet: 'A key is configured.',
      apiKeyUnset: 'No key configured; engines that need one will fail outright.',
      overridden: 'Overridden',
      reset: 'Reset to default',
      invalidNumber: 'Enter a number, or leave blank to use the default.',
      unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
      readOnly: 'This deployment stores settings read-only.',
      save: 'Save',
      saving: 'Saving…',
      saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
      test: 'Test connection',
      testing: 'Testing…',
      testHint: 'Runs one real search with the current settings to prove the key and endpoint work (spends one quota unit).',
      probeDirty: 'Unsaved edits: the checks above read your input, but the real request uses the saved settings.',
      probeUnavailable: 'The Host exposed no probe, so only the local checks are available.',
      probeNoMount: 'this Harness build has no $mount on remote, so the page cannot mount the probe.',
      probeRefused: 'mounting the probe was refused: {v}',
      probeNotReadable: 'the probe mounted, but namespace {v} is not readable.',
      probeMissingMethod: 'the probe mounted, but it has no {v} method.',
      probeOk: '{v} returned {n} source(s) in {ms} ms.',
      probeFail: 'Request failed: {msg}',
      probeRequest: '{m} {url}',
      probeStatus: 'HTTP {s} · {ms} ms',
      probeNoStatus: 'no response · {ms} ms',
      probeNote: '· {v}',
      probeCredential: 'Credential from: {v}',
      keySourceLiteral: 'the literal key in the settings',
      keySourceCredential: 'the credentials service ({v})',
      keySourceLaunch: 'the launching environment ({v})',
      keySourceProcess: 'the process environment ({v})',
      keySourceMissing: 'nowhere ({v})',
      keySourceFree: 'not needed (this engine is keyless)',
      chkEngineOk: 'Engine: {v}',
      chkEngineBad: 'Unknown engine: {v}',
      chkKeyOk: 'Credential: configured ({v})',
      chkKeyMissing: 'Credential: not configured ({v}); this engine will fail outright',
      chkKeyFree: 'Credential: not needed; SearXNG only needs a reachable endpoint',
      chkEndpointOk: 'Endpoint: {v}',
      chkEndpointBad: 'Endpoint is not a valid http(s) URL: {v}',
      chkEndpointsBad: 'Per-engine endpoints are not a JSON object and would be ignored entirely',
      chkFallbackOk: 'Fallback chain: {v}',
      chkFallbackBad: 'Fallback names unknown engines: {v}',
      chkNumbersBad: 'Value out of range: {v}',
      chkGoogleCxBad: 'Google CSE also needs its search engine id (googleCx)',
    }

    /** Field name -> dictionary key suffix. */
    const LABEL_OF = {
      engine: 'labelEngine',
      fallback: 'labelFallback',
      endpoint: 'labelEndpoint',
      endpoints: 'labelEndpoints',
      apiKeyEnv: 'labelApiKeyEnv',
      googleCx: 'labelGoogleCx',
      searchDepth: 'labelSearchDepth',
      maxResults: 'labelMaxResults',
      timeoutMs: 'labelTimeoutMs',
      language: 'labelLanguage',
      safeSearch: 'labelSafeSearch',
    }

    /**
     * The copy the shared settings form frame renders.
     * @param t - the page's locale reader.
     * @returns the frame's labels.
     */
    function formLabels(t) {
      return {
        unavailable: t('unavailable'),
        readOnly: t('readOnly'),
        saveFailed: t('saveFailed'),
        save: t('save'),
        saving: t('saving'),
      }
    }

    /**
     * The engine entry with this id.
     * @param id - engine id, possibly undefined or stale.
     * @returns the entry, or undefined.
     */
    function engineById(id) {
      return ENGINES.find((engine) => engine.id === id)
    }

    /**
     * The credential reference this page reads and writes.
     *
     * An explicit `apiKeyEnv` wins; otherwise the selected engine's conventional
     * variable. The host half resolves the same name, so a key written here is
     * the key the provider picks up.
     * @param snapshot - the current settings scope snapshot.
     * @returns the reference to address.
     */
    function refOf(snapshot) {
      const declared = snapshot?.value?.apiKeyEnv
      if (typeof declared === 'string' && declared.trim().length > 0) return declared.trim()
      const engine = engineById(snapshot?.value?.engine)
      return (engine && engine.apiKeyEnv) || FALLBACK_KEY_REF
    }

    /**
     * Whether the value parses as an absolute http(s) URL — what the Host half
     * needs from an endpoint override.
     * @param text - the candidate base URL.
     * @returns whether the value would be usable.
     */
    function isHttpUrl(text) {
      try {
        const url = new URL(text)
        return url.protocol === 'http:' || url.protocol === 'https:'
      } catch {
        return false
      }
    }

    /**
     * Parse the per-engine endpoint map the way the Host half does: malformed
     * JSON is ignored rather than fatal, so the check only flags a string that
     * would silently contribute nothing.
     * @param text - the raw JSON text.
     * @returns the parsed object, or undefined when it is not a JSON object.
     */
    function parseEndpointMap(text) {
      let parsed
      try {
        parsed = JSON.parse(text)
      } catch {
        return undefined
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
      return parsed
    }

    /**
     * Fill `{name}` placeholders from a plain object.
     * @param template - the dictionary string.
     * @param vars - replacements; missing names are left as written.
     * @returns the final text.
     */
    function format(template, vars) {
      return String(template).replace(/\{(\w+)\}/gu, (match, name) => (vars != null && name in vars ? String(vars[name]) : match))
    }

    /**
     * Inspect the staged values the way the Host half reads them, with no
     * network at all. The point is to name the mistakes a real request would
     * otherwise only surface as an opaque vendor error — a stale engine id, a
     * key that was never saved, a fallback that silently does nothing.
     * @param value - the settings snapshot to inspect.
     * @param credential - what the credentials domain last reported for this scope.
     * @returns one entry per check, in display order.
     */
    function localChecks(value, credential) {
      const rows = []
      const settings = value ?? {}
      const engine = engineById(settings.engine)
      const engineText = String(settings.engine ?? '').trim()

      rows.push(
        engine === undefined
          ? { level: 'bad', key: 'chkEngineBad', vars: { v: engineText.length > 0 ? engineText : '—' } }
          : { level: 'ok', key: 'chkEngineOk', vars: { v: engine.label } },
      )

      if (engine !== undefined) {
        if (engine.apiKeyEnv === null) {
          // SearXNG is the one keyless engine: it needs a reachable endpoint, not a key.
          rows.push({ level: 'info', key: 'chkKeyFree', vars: {} })
        } else {
          const ref = refOf({ value: settings })
          rows.push(
            credential?.configured === true
              ? { level: 'ok', key: 'chkKeyOk', vars: { v: ref } }
              : { level: 'bad', key: 'chkKeyMissing', vars: { v: ref } },
          )
        }
      }

      const endpoint = String(settings.endpoint ?? '').trim()
      if (endpoint.length > 0) {
        rows.push(
          isHttpUrl(endpoint)
            ? { level: 'ok', key: 'chkEndpointOk', vars: { v: endpoint } }
            : { level: 'bad', key: 'chkEndpointBad', vars: { v: endpoint } },
        )
      }

      const endpoints = String(settings.endpoints ?? '').trim()
      if (endpoints.length > 0 && parseEndpointMap(endpoints) === undefined) {
        rows.push({ level: 'bad', key: 'chkEndpointsBad', vars: {} })
      }

      const chain = String(settings.fallback ?? '')
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
      if (chain.length > 0) {
        const known = chain.filter((id) => engineById(id) !== undefined)
        const unknown = chain.filter((id) => engineById(id) === undefined)
        rows.push(
          unknown.length === 0
            ? { level: 'ok', key: 'chkFallbackOk', vars: { v: known.map((id) => engineById(id).label).join(' → ') } }
            : { level: 'bad', key: 'chkFallbackBad', vars: { v: unknown.join(', ') } },
        )
      }

      const outOfRange = []
      if (typeof settings.maxResults === 'number' && (settings.maxResults < 1 || settings.maxResults > MAX_RESULTS_CEILING)) {
        outOfRange.push(`maxResults=${settings.maxResults}`)
      }
      if (typeof settings.timeoutMs === 'number' && settings.timeoutMs < MIN_TIMEOUT_MS) {
        outOfRange.push(`timeoutMs=${settings.timeoutMs}`)
      }
      if (outOfRange.length > 0) rows.push({ level: 'bad', key: 'chkNumbersBad', vars: { v: outOfRange.join(' / ') } })

      if (engine?.id === 'google' && String(settings.googleCx ?? '').trim().length === 0) {
        rows.push({ level: 'bad', key: 'chkGoogleCxBad', vars: {} })
      }

      return rows
    }

    /**
     * The mounted probe namespace, or undefined when the Host did not accept the
     * contribution. A Remote namespace is a child service of `remote`, reachable
     * either as a property or by its dotted key — reading an unmounted one can
     * throw instead of answering undefined, so both paths are guarded.
     * @param ctx - the page plugin's context.
     * @returns the namespace service, or undefined.
     */
    function probeOf(ctx) {
      try {
        const direct = ctx.remote?.[PROBE_NAMESPACE]
        if (direct !== undefined && direct !== null) return direct
      } catch {
        /* not mounted as a reachable property */
      }
      try {
        return ctx.get(`remote.${PROBE_NAMESPACE}`)
      } catch {
        return undefined
      }
    }

    /**
     * The text of a caught value, which is not always an `Error`: a rejected
     * `$mount` carries a `RemoteError` or a plain object on some carriers.
     * @param error - whatever was thrown or rejected.
     * @returns a one-line description safe to put on the page.
     */
    function describeFailure(error) {
      if (error instanceof Error) return String(error.message)
      if (error !== null && typeof error === 'object') {
        const code = error.code
        const message = error.message
        if (typeof message === 'string' && message.length > 0) {
          return typeof code === 'string' ? `${code}: ${message}` : message
        }
        try {
          return JSON.stringify(error).slice(0, 300)
        } catch {
          return Object.prototype.toString.call(error)
        }
      }
      return String(error)
    }

    /**
     * What `ctx.remote` does expose, for the one failure where that list is the
     * answer: a namespace that mounted somewhere the page does not look.
     * @param ctx - the page plugin's context.
     * @returns a comma-separated list, or a note about why there is none.
     */
    function remoteNamespaceHint(ctx) {
      try {
        const names = Object.keys(ctx.remote ?? {}).filter((name) => !name.startsWith('$'))
        return names.length === 0 ? '（ctx.remote 上没有可枚举的命名空间）' : names.join(', ')
      } catch {
        return '（ctx.remote 不可枚举）'
      }
    }

    /**
     * Name which of the page-visible probe failures happened.
     * @param state - the recorded mount outcome.
     * @param probe - what `probeOf` found, if anything.
     * @param ctx - the page plugin's context.
     * @returns the `remote` field's `unavailable` branch, with its cause.
     */
    function describeProbeAbsence(state, probe, ctx) {
      if (state.status === 'unsupported') return { status: 'unavailable', cause: 'unsupported' }
      if (state.status === 'refused') {
        return { status: 'unavailable', cause: 'refused', message: state.reason }
      }
      if (state.status === 'mounted') {
        if (probe === undefined || probe === null) {
          return {
            status: 'unavailable',
            cause: 'unreadable',
            message: `${PROBE_NAMESPACE}（ctx.remote 上是：${remoteNamespaceHint(ctx)}）`,
          }
        }
        return { status: 'unavailable', cause: 'missing-method', message: PROBE_METHOD }
      }
      return { status: 'unavailable', cause: 'pending' }
    }

    /**
     * Why the probe is not callable, as far as the page can tell.
     *
     * Five different failures used to render as one sentence that blamed the
     * Host, which is the one thing the page cannot see: it can see whether
     * `remote.$mount` exists, and — because `$mount` rejects with the Gateway's
     * own error — *why* a mount was refused. Recording that here is what turns
     * "宿主没有提供探针" from a guess into a diagnosis.
     *
     * Statuses: `pending` (mount in flight), `unsupported` (no `$mount` on this
     * build), `refused` (the Gateway rejected the contribution), `mounted`.
     */
    const probeState = { status: 'pending', reason: null }

    /**
     * Mount the probe namespace, keeping the page working when the Host refuses
     * it. The mount is asynchronous — descriptors are validated before any
     * method becomes callable — so the panel treats a missing namespace as
     * "local checks only" rather than an error. The refusal is kept, not
     * swallowed: the panel reports which of the two happened.
     * @param ctx - the page plugin's context.
     */
    function mountProbe(ctx) {
      let dispose
      let disposed = false

      if (typeof ctx.remote?.$mount !== 'function') {
        probeState.status = 'unsupported'
        return
      }

      Promise.resolve()
        .then(() => ctx.remote.$mount(PROBE_CONTRIBUTION))
        .then((unmount) => {
          if (disposed) {
            try {
              unmount?.()
            } catch {
              /* the namespace was already gone */
            }
            return
          }
          dispose = unmount
          probeState.status = 'mounted'
          probeState.reason = null
        })
        .catch((error) => {
          probeState.status = 'refused'
          probeState.reason = describeFailure(error)
          // The Host's own error code is the whole diagnosis, so it is kept
          // verbatim; `describeFailure` only guards against a non-Error throw.
        })

      ctx.effect(
        () => () => {
          disposed = true
          try {
            dispose?.()
          } catch {
            /* already unmounted with its fiber */
          }
        },
        'dsh-custom-search: probe unmount',
      )
    }

    /**
     * Stages one row's edits over the `custom-search` settings scope and writes
     * them on save, plus the one control that lives outside the scope: the API
     * key, which is written through the credentials domain.
     */
    class CardController {
      /**
       * @param scope - the bound settings scope for the `custom-search` namespace.
       * @param ctx - the page plugin's context, whose `remote.credentials` faces the key.
       */
      constructor(scope, ctx) {
        this.scope = scope
        this.ctx = ctx
        this.form = new UI.SettingsFormModel(scope, SPECS, [
          { field: API_KEY_FIELD, write: (text) => this.writeKey(text) },
        ])
        this.credential = { ref: '', configured: false, writable: true }
        this.store = this.form.bind(() => this.projection())
        this.unsubscribe = scope.subscribe(() => {
          this.readCredential()
        })
        this.readCredential()
      }

      /** Everything the card reads, rebuilt from the scope and the drafts together. */
      projection() {
        const state = this.form.shell()
        for (const field of VALUE_FIELDS) state[field] = this.form.field(field)
        const key = this.form.field(API_KEY_FIELD)
        state.apiKey = key
        state.apiKeyText = key.text
        state.apiKeyConfigured = this.credential.configured
        state.apiKeyWritable = this.credential.writable
        return state
      }

      /**
       * Ask the credentials domain about the reference the scope currently names.
       *
       * The answer is stored with the reference it describes: `apiKeyEnv` can
       * change between the request and its response, and two reads can settle
       * out of order, so a response is published only while it still answers for
       * the reference in force.
       */
      async readCredential() {
        const ref = refOf(this.scope.getSnapshot())
        if (ref !== this.credential.ref) {
          this.credential = { ref, configured: false, writable: true }
          this.store.set(this.projection())
        }
        let response
        try {
          response = await this.ctx.remote.credentials.describe([ref])
        } catch {
          return
        }
        if (!response?.ok || ref !== refOf(this.scope.getSnapshot())) return
        const view = response.value?.[ref]
        const next = {
          ref,
          configured: view?.configured ?? false,
          writable: view?.writable ?? true,
        }
        if (next.configured === this.credential.configured && next.writable === this.credential.writable) return
        this.credential = next
        this.store.set(this.projection())
      }

      /** Build the face the page's slot registration injects. */
      inject() {
        return {
          hooks: { customSearchCard: this.store },
          testConnection: (query) => this.testConnection(query),
          ...this.form.actions(),
        }
      }

      /**
       * Write the staged key, then re-read whether the Host now holds one.
       * @param value - the staged credential literal.
       * @returns whether the Host reports a configured credential afterwards.
       */
      async writeKey(value) {
        try {
          await this.ctx.remote.credentials.set(refOf(this.scope.getSnapshot()), value)
        } catch {
          return false
        }
        await this.readCredential()
        return this.credential.configured
      }

      /**
       * Answer "is what I configured actually usable?" in two passes: the local
       * one reads the staged settings and the credentials domain synchronously
       * and always succeeds; the Host one runs a real search through the
       * provider the agent uses.
       *
       * The saved snapshot is what the Host will read, but the local pass also
       * covers a pending draft, so an unsaved edit is reported rather than
       * silently ignored.
       * @param query - optional text to search for; blank uses the probe's own.
       * @returns the report the card renders; never rejects.
       */
      async testConnection(query) {
        const snapshot = this.scope.getSnapshot()
        const staged = { ...(snapshot?.value ?? {}) }
        for (const field of VALUE_FIELDS) {
          const entry = this.form.field(field)
          if (entry === undefined || typeof entry.text !== 'string') continue
          const text = entry.text.trim()
          if (NUMBER_FIELDS.includes(field)) {
            // A blank or non-numeric box means "use the default", not NaN.
            const parsed = Number(text)
            staged[field] = text.length === 0 || Number.isNaN(parsed) ? undefined : parsed
          } else {
            staged[field] = text
          }
        }

        const report = {
          local: localChecks(staged, this.credential),
          dirty: this.form.shell().dirty === true,
          remote: { status: 'unavailable' },
        }
        const probe = probeOf(this.ctx)
        if (probe === undefined || typeof probe[PROBE_METHOD] !== 'function') {
          // Not "the Host did not provide a probe": the page knows which of the
          // mount outcomes it saw, and says so.
          report.remote = describeProbeAbsence(probeState, probe, this.ctx)
          return report
        }

        report.remote = { status: 'running' }
        let answer
        try {
          answer = await probe[PROBE_METHOD](String(query ?? ''))
        } catch (error) {
          report.remote = { status: 'failed', message: error instanceof Error ? error.message : String(error) }
          return report
        }

        // A Remote call resolves to { ok, value } / { ok, error } and never
        // rejects for a carrier problem, so both branches are ordinary outcomes.
        if (answer?.ok !== true) {
          report.remote = { status: 'failed', message: String(answer?.error?.message ?? 'unreachable') }
          return report
        }

        const value = answer.value ?? {}
        report.remote = {
          status: value.ok === true ? 'ok' : 'failed',
          count: value.count ?? 0,
          elapsedMs: value.elapsedMs ?? 0,
          engineLabel: value.engineLabel,
          chain: Array.isArray(value.chain) ? value.chain : [],
          attempts: Array.isArray(value.attempts) ? value.attempts : [],
          sources: Array.isArray(value.sources) ? value.sources : [],
          message: value.error,
        }
        return report
      }

      /** Release the form's subscriptions. */
      dispose() {
        this.unsubscribe()
        this.form.dispose()
      }
    }

    /**
     * The engine picker: one pill per engine, so switching is a single click.
     * It stages through the same `edit` action the text field uses, so the two
     * controls never disagree.
     * @param props - the page's form actions.
     * @param state - the current projection.
     * @param t - the page's locale reader.
     * @returns the caption and the pill row.
     */
    function enginePicker(props, state, t) {
      const current = String(state.engine?.text ?? '').trim()
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(
          'p',
          { key: 'caption', style: { margin: '0 0 6px', opacity: 0.7 } },
          t('engineQuick'),
        ),
        React.createElement(
          'div',
          { key: 'pills', style: { display: 'flex', flexWrap: 'wrap', gap: '6px', margin: '0 0 14px' } },
          ENGINES.map((engine) =>
            React.createElement(
              UI.Pill,
              {
                key: engine.id,
                active: engine.id === current,
                onClick: () => props.edit('engine', engine.id),
              },
              engine.label,
            ),
          ),
        ),
      )
    }

    /**
     * One staged value row.
     * @param props - the page's form actions and locale reader.
     * @param state - the current projection.
     * @param field - the field to render.
     * @param numeric - render the numeric keypad hint.
     * @returns the field element.
     */
    function valueField(props, state, field, numeric) {
      return React.createElement(UI.SettingsValueField, {
        key: field,
        id: `plugin-config-custom-search-${field}`,
        label: props.t(LABEL_OF[field] ?? field),
        hint: props.t(`hint${field.charAt(0).toUpperCase()}${field.slice(1)}`),
        overriddenLabel: props.t('overridden'),
        resetLabel: props.t('reset'),
        invalidLabel: props.t('invalidNumber'),
        numeric: numeric === true,
        disabled: !state.writable,
        ...(state[field] ?? { text: '' }),
        onEdit: (text) => props.edit(field, text),
        onReset: () => props.resetField(field),
      })
    }

    /**
     * Leading glyph per check level. Text rather than colour so the panel reads
     * the same in either theme, and rather than an icon component so it cannot
     * break on a primitive this deployment does not ship.
     */
    const MARK = { ok: '✓', bad: '✗', warn: '!', info: '·' }

    /**
     * One local check line.
     * @param row - the check entry.
     * @param t - the page's locale reader.
     * @returns the list item.
     */
    function checkLine(row, t) {
      return React.createElement(
        'li',
        {
          key: `check-${row.key}`,
          style: { margin: '3px 0', opacity: row.level === 'ok' || row.level === 'info' ? 0.75 : 1 },
        },
        `${MARK[row.level] ?? '·'} ${format(t(row.key), row.vars)}`,
      )
    }

    /** Dictionary key per credential origin the Host reports. */
    const KEY_SOURCE_OF = {
      literal: 'keySourceLiteral',
      credential: 'keySourceCredential',
      'launch-environment': 'keySourceLaunch',
      'process-env': 'keySourceProcess',
      free: 'keySourceFree',
      'not-needed': 'keySourceFree',
      none: 'keySourceMissing',
    }

    /** The indented line style every detail row shares. */
    const DETAIL_STYLE = { margin: '4px 0 0 14px', opacity: 0.7 }

    /**
     * Dictionary key per cause of an unavailable probe. `pending` is absent on
     * purpose: an unmounted-in-flight probe has no cause to name yet.
     */
    const ABSENCE_KEY_OF = {
      unsupported: 'probeNoMount',
      refused: 'probeRefused',
      unreadable: 'probeNotReadable',
      'missing-method': 'probeMissingMethod',
    }

    /**
     * How one attempt reads: where the key came from, then the request itself.
     *
     * These are the facts that separate the failures a user cannot tell apart —
     * a wrong key, a wrong host, and a deployment that never resolved the key at
     * all — so the panel states them instead of collapsing them into "failed".
     * @param attempt - one `remote.attempts` entry from the Host.
     * @param t - the page's locale reader.
     * @returns the detail rows, possibly empty.
     */
    function attemptLines(attempt, t) {
      const rows = []
      const source = KEY_SOURCE_OF[String(attempt?.credential ?? '')]
      if (source !== undefined) {
        rows.push(format(t('probeCredential'), {
          v: attempt?.ref ? format(t(source), { v: String(attempt.ref) }) : t(source),
        }))
      }
      if (typeof attempt?.endpoint === 'string') {
        rows.push(format(t('probeRequest'), { m: String(attempt.method ?? 'GET'), url: attempt.endpoint }))
      }
      const ms = Number.isFinite(attempt?.ms) ? attempt.ms : 0
      if (Number.isFinite(attempt?.status)) rows.push(format(t('probeStatus'), { s: attempt.status, ms }))
      else if (attempt?.endpoint !== undefined && attempt?.endpoint !== null) rows.push(format(t('probeNoStatus'), { ms }))
      for (const note of (Array.isArray(attempt?.notes) ? attempt.notes : [])) {
        rows.push(format(t('probeNote'), { v: String(note) }))
      }
      return rows
    }

    /**
     * The line describing the real request, in any of its four states.
     * @param remote - the report's `remote` field.
     * @param t - the page's locale reader.
     * @returns the list item.
     */
    /**
     * The sentence for an unavailable probe, naming the cause when the page has
     * one. An unidentified cause keeps the generic wording rather than
     * inventing a reason.
     * @param remote - the report's `remote` field.
     * @param t - the page's locale reader.
     * @returns the sentence to render.
     */
    function unavailableLine(remote, t) {
      const key = ABSENCE_KEY_OF[String(remote?.cause ?? '')]
      if (key === undefined) return t('probeUnavailable')
      const detail = remote?.message
      return detail === undefined || detail === null ? t(key) : format(t(key), { v: String(detail) })
    }

    function remoteLine(remote, t) {
      const style = { margin: '8px 0 0' }

      if (remote === undefined || remote.status === 'running' || remote.status === 'unavailable') {
        return React.createElement('li', { key: 'probe', style: { ...style, opacity: 0.6 } }, `· ${unavailableLine(remote, t)}`)
      }

      const children = [
        React.createElement(
          'span',
          { key: 'head' },
          remote.status === 'failed'
            ? `✗ ${format(t('probeFail'), { msg: String(remote.message ?? '') })}`
            : `✓ ${format(t('probeOk'), { n: remote.count ?? 0, ms: remote.elapsedMs ?? 0, v: String(remote.engineLabel ?? '') })}`,
        ),
      ]

      // Every attempt is reported, including the ones a fallback chain abandoned,
      // so a working fallback does not hide a broken primary.
      for (const [index, attempt] of (remote.attempts ?? []).entries()) {
        for (const [row, line] of attemptLines(attempt, t).entries()) {
          children.push(
            React.createElement('div', { key: `attempt-${index}-${row}`, style: DETAIL_STYLE }, line),
          )
        }
      }

      for (const [index, source] of (remote.sources ?? []).entries()) {
        children.push(
          React.createElement(
            'div',
            { key: `source-${index}`, style: DETAIL_STYLE },
            `${index + 1}. ${String(source?.title || source?.url || '')}`,
          ),
        )
      }
      return React.createElement('li', { key: 'probe', style }, children)
    }

    /**
     * The connectivity panel: one button, and whatever the last run reported.
     *
     * A component of its own rather than a call inlined into the page, so its
     * two `useState` hooks live on their own fiber. Called inline they would
     * join the page component's hook chain — and conditionally, since the page
     * only builds this panel when the registration injected `testConnection` —
     * so the count could differ between renders, which React rejects.
     *
     * It owns its own state rather than staging through the settings scope: a
     * probe result is not a setting, and keeping it out of the scope means
     * pressing the button never marks the form dirty.
     * @param props - the form's state, the probe action, and the locale reader.
     * @returns the panel.
     */
    function connectionPanel(props) {
      const { state, t, testConnection } = props
      const [report, setReport] = React.useState(null)
      const [busy, setBusy] = React.useState(false)

      const run = () => {
        if (busy) return
        setBusy(true)
        setReport(null)
        Promise.resolve()
          .then(() => testConnection(''))
          .then((next) => setReport(next))
          .catch((error) => setReport({ local: [], remote: { status: 'failed', message: error?.message ?? String(error) } }))
          .then(() => setBusy(false))
      }

      const items = []
      if (report !== null) {
        for (const row of report.local ?? []) items.push(checkLine(row, t))
        if (report.dirty === true) {
          items.push(
            React.createElement('li', { key: 'dirty', style: { margin: '3px 0', opacity: 0.75 } }, `! ${t('probeDirty')}`),
          )
        }
        items.push(remoteLine(report.remote, t))
      }

      return React.createElement('div', { key: 'probe', style: { margin: '6px 0 18px' } }, [
        React.createElement('p', { key: 'caption', style: { margin: '0 0 6px', opacity: 0.7 } }, t('testHint')),
        React.createElement(
          UI.Button,
          { key: 'run', onClick: run, disabled: busy === true || !state?.writable },
          busy ? t('testing') : t('test'),
        ),
        items.length > 0
          ? React.createElement('ul', { key: 'items', style: { margin: '10px 0 0', padding: 0, listStyle: 'none', fontSize: '0.92em' } }, items)
          : null,
      ])
    }

    /**
     * Render this row's config page, as the Plugins page asks.
     * @param props - the view asked for, this page's copy, the form snapshot, and its actions.
     * @returns the one-liner, or the form.
     */
    function CustomSearchCard(props) {
      const state = props.useCustomSearchCard((snapshot) => snapshot)
      if (props.view === 'summary') return props.t('summary')
      return React.createElement(
        UI.SettingsForm,
        {
          labels: formLabels(props.t),
          state,
          onSave: props.save,
          onDiscard: props.discard,
        },
        [
          enginePicker(props, state, props.t),
          valueField(props, state, 'engine', false),
          React.createElement(UI.SettingsSecretField, {
            key: API_KEY_FIELD,
            id: 'plugin-config-custom-search-api-key',
            label: props.t('labelApiKey'),
            hint: props.t('hintApiKey'),
            disabled: !state.apiKeyWritable,
            text: state.apiKeyText ?? '',
            configured: state.apiKeyConfigured,
            stateLabel: state.apiKeyConfigured ? props.t('apiKeySet') : props.t('apiKeyUnset'),
            onEdit: (text) => props.edit(API_KEY_FIELD, text),
          }),
          valueField(props, state, 'fallback', false),
          valueField(props, state, 'endpoint', false),
          valueField(props, state, 'endpoints', false),
          valueField(props, state, 'apiKeyEnv', false),
          valueField(props, state, 'googleCx', false),
          valueField(props, state, 'searchDepth', false),
          valueField(props, state, 'maxResults', true),
          valueField(props, state, 'timeoutMs', true),
          valueField(props, state, 'language', false),
          valueField(props, state, 'safeSearch', false),
          // Guarded because the injected face is what carries the probe: a card
          // rendered from a registration without it stays a plain form. Mounted
          // as an element, not called, so its hooks stay off this component's
          // chain — this branch is the only thing that decides whether they run.
          typeof props.testConnection === 'function'
            ? React.createElement(connectionPanel, {
                key: 'probe',
                state,
                t: props.t,
                testConnection: props.testConnection,
              })
            : null,
        ],
      )
    }

    /** Required services (cordis fiber inject). */
    const inject = ['slots', 'locale', 'configForms', 'remote', 'remote.credentials']

    /**
     * Mount the page on one slot of the Plugins page, and take it down again
     * when the Host stops serving the row's settings namespace, so a
     * deployment that never composed the provider shows no trace of it.
     * @param ctx - the browser plugin context.
     * @param card - the form the registration injects.
     * @param slot - the slot to register into.
     * @param options - the addressing options that slot requires.
     * @param effect - the label this registration is reported under.
     */
    function mount(ctx, card, slot, options, effect) {
      ctx.effect(
        () =>
          ctx.configForms.whileServed([ROW_ID], () =>
            ctx.slots.inject(slot, () =>
              ctx.slots.register(
                { name: slot, locale: NS, inject: () => card.inject(), ...options },
                CustomSearchCard,
              ),
            ),
          ),
        effect,
      )
    }

    /**
     * Mount this plugin's page on all three of the Plugins page's entry points.
     * They share one form controller, so a draft staged from any of them is the
     * same draft, and each is gated by its own registration — which is why all
     * three have to be registered rather than just the one this build happens
     * to navigate through.
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-custom-search: dictionaries')

      const card = new CardController(ctx.configForms.get(ROW_ID), ctx)
      ctx.effect(
        () => () => {
          card.dispose()
        },
        'dsh-custom-search: form subscription',
      )

      // Best effort: a deployment whose Gateway refuses the contribution still
      // renders the form, and the panel says only local checks are available.
      mountProbe(ctx)

      // The package's own page is the primary entry point — it is where the
      // card in the installed list lands — and the page renders its config
      // section only while a registration for the package name exists.
      mount(ctx, card, BUNDLE_SLOT, { key: PKG_NAME }, 'dsh-custom-search: bundle config')
      mount(
        ctx,
        card,
        ITEM_SLOT,
        { id: ITEM_ID, order: ITEM_ORDER, label: () => t('title') },
        'dsh-custom-search: card',
      )
      mount(ctx, card, ROW_SLOT, { key: ROW_KEY }, 'dsh-custom-search: row config')
    }

    exports.NS = NS
    exports.ROW_ID = ROW_ID
    exports.ROW_KEY = ROW_KEY
    exports.PKG_NAME = PKG_NAME
    exports.ITEM_SLOT = ITEM_SLOT
    exports.BUNDLE_SLOT = BUNDLE_SLOT
    exports.ROW_SLOT = ROW_SLOT
    exports.ITEM_ID = ITEM_ID
    exports.PROBE_NAMESPACE = PROBE_NAMESPACE
    exports.PROBE_METHOD = PROBE_METHOD
    exports.PROBE_CONTRIBUTION = PROBE_CONTRIBUTION
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
