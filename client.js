/**
 * dsh-custom-search — browser half.
 *
 * DSH does not derive a plugin's settings page from its `Config` schema. The
 * Plugins page renders a config page only for plugins whose own browser half
 * registers one, through `ctx.slots.inject()`. This module registers one for
 * the `custom-search` row under `plugins.row.config`, which is what puts a
 * 配置 control on that row; without it the row has nothing but a toggle and the
 * plugin cannot be configured from the GUI at all.
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

    /** Dictionary namespace owned by this plugin. */
    const NS = 'settings.customSearch'

    /** Form field staging the API key. The key never rides the settings file. */
    const API_KEY_FIELD = 'apiKey'

    /** Credential reference used when neither the section nor the engine names one. */
    const FALLBACK_KEY_REF = 'CUSTOM_SEARCH_API_KEY'

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
        ],
      )
    }

    /** Required services (cordis fiber inject). */
    const inject = ['slots', 'locale', 'configForms', 'remote', 'remote.credentials']

    /**
     * Mount this row's config page while the Host serves its namespace, so a
     * deployment that never composed the provider shows no trace of the page.
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

      ctx.effect(
        () =>
          ctx.configForms.whileServed([ROW_ID], () =>
            ctx.slots.inject('plugins.row.config', () =>
              ctx.slots.register(
                {
                  name: 'plugins.row.config',
                  key: ROW_KEY,
                  locale: NS,
                  inject: () => card.inject(),
                },
                CustomSearchCard,
              ),
            ),
          ),
        'dsh-custom-search: page',
      )
    }

    exports.NS = NS
    exports.ROW_ID = ROW_ID
    exports.ROW_KEY = ROW_KEY
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
