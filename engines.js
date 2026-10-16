/**
 * Search-engine adapters for dsh-custom-search.
 *
 * Every adapter turns one provider HTTP response into the `ctx.web` search-result
 * vocabulary: `{ sources, truncated }`, where a source is
 * `{ url, title?, snippet?, publishedAt? }`.
 *
 * An adapter declares how to build the request and how to read the response; the
 * shared plumbing (timeout, abort, redirect policy, normalization, dedupe) lives
 * here too, so adding an engine means adding one table entry.
 */

const USER_AGENT = 'dsh-custom-search/0.1.0'

/** Per-engine safe-search wire values. Engines absent from this map ignore the setting. */
const SAFE_SEARCH = {
  searxng: { off: '0', moderate: '1', strict: '2' },
  bing: { off: 'Off', moderate: 'Moderate', strict: 'Strict' },
  google: { off: 'off', moderate: 'active', strict: 'active' },
  brave: { off: 'off', moderate: 'moderate', strict: 'strict' },
  serper: { off: 'off', moderate: 'active', strict: 'active' },
}

/**
 * The tags Brave accepts for `search_lang`.
 *
 * Brave validates this against a closed enum and answers a value that is not on
 * the list with `HTTP 422 · Unable to validate request parameter(s)`, which kills
 * the entire search. It is not a locale field, so the shapes a user naturally
 * writes do not fit it:
 *
 *   - it takes a region subtag only in `en-gb`, `pt-br` and `pt-pt` — `en-US`,
 *     `fr-FR` and `de-DE` have no such tags;
 *   - two languages are spelled against the ISO-639-1 convention: Japanese is
 *     `jp`, not `ja`, and Norwegian is `nb`, not `no`;
 *   - Chinese has no bare form at all — it must name the script, `zh-hans` or
 *     `zh-hant`.
 *
 * Sending `zh` for the default `zh-CN` setting is what produced the 422. This is
 * why the table is transcribed rather than derived: a plausible-looking
 * normalization (drop the subtag) is exactly the wrong move here.
 */
export const BRAVE_SEARCH_LANGS = new Set([
  'ar', 'eu', 'bn', 'bg', 'ca', 'zh-hans', 'zh-hant', 'hr', 'cs', 'da', 'nl', 'en', 'en-gb',
  'et', 'fi', 'fr', 'gl', 'de', 'gu', 'he', 'hi', 'hu', 'is', 'it', 'jp', 'kn', 'ko', 'lv',
  'lt', 'ms', 'ml', 'mr', 'nb', 'pl', 'pt-br', 'pt-pt', 'pa', 'ro', 'ru', 'sr', 'sk', 'sl',
  'es', 'sv', 'ta', 'te', 'th', 'tr', 'uk', 'vi',
])

/** Languages whose Brave tag is not the one the locale string suggests. */
const BRAVE_LANG_ALIASES = { ja: 'jp', no: 'nb' }

/** Which script a Chinese region implies, for the bare `zh` tags Brave refuses. */
const BRAVE_CHINESE_SCRIPTS = {
  cn: 'zh-hans', sg: 'zh-hans', my: 'zh-hans',
  tw: 'zh-hant', hk: 'zh-hant', mo: 'zh-hant',
}

/**
 * Translate the plugin's `language` setting into a Brave `search_lang` tag.
 *
 * Returns `undefined` when the language has no Brave tag at all. Omitting the
 * parameter costs a language hint; sending a guessed one costs the whole search,
 * so an unmappable value is dropped and reported rather than approximated.
 *
 * @param language - the configured language, in any BCP-47-ish spelling.
 * @returns a tag from {@link BRAVE_SEARCH_LANGS}, or `undefined`.
 */
export function braveSearchLang(language) {
  const raw = text(language)
  if (raw === undefined) return undefined
  const tag = raw.toLowerCase().replace(/_/g, '-')
  if (BRAVE_SEARCH_LANGS.has(tag)) return tag

  const [primary, ...rest] = tag.split('-')
  if (primary === 'zh') {
    if (rest[0] === 'hans' || rest[0] === 'hant') return `zh-${rest[0]}`
    return BRAVE_CHINESE_SCRIPTS[rest[0]] ?? 'zh-hans'
  }
  const aliased = BRAVE_LANG_ALIASES[primary]
  if (aliased !== undefined) return aliased
  return BRAVE_SEARCH_LANGS.has(primary) ? primary : undefined
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function list(value) {
  return Array.isArray(value) ? value : []
}

/** Accept only absolute http(s) URLs; anything else is dropped rather than shown to the model. */
function httpUrl(raw) {
  const value = text(raw)
  if (value === undefined) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

/** Resolve the base URL for one engine: the user's override first, the engine default second. */
function baseUrl(override, fallback) {
  const raw = text(override) ?? fallback
  try {
    return new URL(raw)
  } catch {
    /* fall through: the user may have written host:port without a scheme */
  }
  return new URL(`http://${raw}`)
}

/** Append a path without discarding a reverse-proxy prefix already present on the base. */
function endpointFor(base, path) {
  const url = new URL(base.toString())
  url.pathname = `${url.pathname.replace(/\/+$/u, '')}${path}`
  url.hash = ''
  return url
}

/**
 * Strip a request URL down to what is safe to show a user: scheme, host, path.
 *
 * The query string is what carries a credential for the engines that put one in
 * the URL (Google CSE sends `key=`), and it also carries the user's query text;
 * a connectivity report is read in a settings page and logged, so neither
 * belongs in it.
 * @param raw - the full request URL, string or URL.
 * @returns `https://host/path`, or the input if it does not parse.
 */
export function publicEndpoint(raw) {
  try {
    const url = new URL(String(raw))
    return `${url.protocol}//${url.host}${url.pathname}`
  } catch {
    return String(raw)
  }
}

/**
 * Remove credentials that a URL smuggled into free text.
 *
 * Failure messages quote the request URL (a timeout says which request timed
 * out), so redacting the report's own fields is not enough — any absolute URL
 * inside an error string is rewritten to its public form too.
 * @param text - the text to sanitize.
 * @returns the same text with every absolute http(s) URL reduced to host + path.
 */
export function redactUrls(text) {
  return String(text).replace(/https?:\/\/[^\s"'<>\\]+/gu, (match) => publicEndpoint(match))
}

/**
 * Race the caller's abort signal against one operation's timeout budget and
 * report which one fired, so a timeout never reads as a user cancellation.
 */
function createGate(signal, timeoutMs) {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort(new Error(`search timed out after ${timeoutMs}ms`))
  }, timeoutMs)
  const forward = () => controller.abort(signal?.reason)
  if (signal !== undefined) {
    if (signal.aborted === true) forward()
    else signal.addEventListener('abort', forward, { once: true })
  }
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    done() {
      clearTimeout(timer)
      if (signal !== undefined) signal.removeEventListener('abort', forward)
    },
  }
}

/**
 * Perform one engine request and parse its JSON body.
 * @param keepRedirects - keyless engines follow redirects (self-hosted SearXNG
 *   commonly redirects http to https); an engine that carries an API key rejects
 *   them so the credential can never be replayed to an unvetted host.
 * @returns the parsed body plus the exchange facts a caller may want to show.
 */
async function requestJson({ url, init, timeoutMs, signal, keepRedirects }) {
  const gate = createGate(signal, timeoutMs)
  const startedAt = Date.now()
  try {
    const response = await fetch(url, {
      ...init,
      redirect: keepRedirects === true ? 'follow' : 'error',
      headers: { 'user-agent': USER_AGENT, accept: 'application/json', ...(init?.headers ?? {}) },
      signal: gate.signal,
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      const detail = body.slice(0, 300).replace(/\s+/gu, ' ').trim()
      const error = new Error(`HTTP ${response.status}${detail.length > 0 ? `: ${detail}` : ''}`)
      error.code = `HTTP_${response.status}`
      // Recorded on the error so a failure report can still name the status and
      // how long the round trip took — the two facts that separate "bad key"
      // from "wrong host" from "network is down".
      error.status = response.status
      error.elapsedMs = Date.now() - startedAt
      throw error
    }
    return { json: await response.json(), status: response.status, elapsedMs: Date.now() - startedAt }
  } catch (error) {
    if (gate.timedOut() === true) {
      const timeout = new Error(`request to ${url} did not complete within ${timeoutMs}ms`)
      timeout.code = 'TIMEOUT'
      timeout.elapsedMs = Date.now() - startedAt
      throw timeout
    }
    throw error
  } finally {
    gate.done()
  }
}

/** Build one normalized source, omitting fields the engine did not supply. */
function source({ url, title, snippet, publishedAt }) {
  const href = httpUrl(url)
  if (href === undefined) return undefined
  return {
    url: href,
    ...(text(title) !== undefined ? { title: text(title) } : {}),
    ...(text(snippet) !== undefined ? { snippet: text(snippet) } : {}),
    ...(text(publishedAt) !== undefined ? { publishedAt: text(publishedAt) } : {}),
  }
}

function normalize(rows, maxResults) {
  const seen = new Set()
  const sources = []
  for (const row of rows) {
    const entry = source(row)
    if (entry === undefined || seen.has(entry.url)) continue
    seen.add(entry.url)
    sources.push(entry)
    if (sources.length >= maxResults) break
  }
  return sources
}

/**
 * The engine table. Each entry declares its credential needs, default endpoint,
 * request builder, and response reader.
 */
export const ENGINES = {
  searxng: {
    label: 'SearXNG',
    keyless: true,
    defaultEndpoint: 'http://127.0.0.1:8080',
    apiKeyEnv: null,
    hint: '自建或公共 SearXNG 实例；需要在实例的 settings.yml 中开启 json 输出格式。',
    build(request, options, base) {
      const url = endpointFor(base, '/search')
      const params = url.searchParams
      params.set('q', request.query)
      params.set('format', 'json')
      params.set('pageno', '1')
      params.set('safesearch', SAFE_SEARCH.searxng[options.safeSearch] ?? '1')
      if (options.language !== undefined) params.set('language', options.language)
      return { url: url.toString(), init: { method: 'GET' } }
    },
    parse(json) {
      return list(json?.results).map((row) => ({
        url: row?.url,
        title: row?.title,
        snippet: row?.content,
        publishedAt: row?.publishedDate ?? row?.pubdate,
      }))
    },
  },

  tavily: {
    label: 'Tavily',
    keyless: false,
    defaultEndpoint: 'https://api.tavily.com',
    apiKeyEnv: 'TAVILY_API_KEY',
    hint: '为 AI 检索设计的搜索 API，按次计费，支持 basic / advanced 深度。',
    build(request, options, base, apiKey) {
      const url = endpointFor(base, '/search')
      return {
        url: url.toString(),
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            query: request.query,
            max_results: options.maxResults,
            search_depth: options.searchDepth === 'advanced' ? 'advanced' : 'basic',
            include_answer: false,
            include_raw_content: false,
          }),
        },
      }
    },
    parse(json) {
      return list(json?.results).map((row) => ({
        url: row?.url,
        title: row?.title,
        snippet: row?.content,
        publishedAt: row?.published_date,
      }))
    },
  },

  exa: {
    label: 'Exa',
    keyless: false,
    defaultEndpoint: 'https://api.exa.ai',
    apiKeyEnv: 'EXA_API_KEY',
    hint: '神经网络检索，返回正文片段，适合语义型查询。',
    build(request, options, base, apiKey) {
      const url = endpointFor(base, '/search')
      return {
        url: url.toString(),
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify({
            query: request.query,
            numResults: options.maxResults,
            type: 'auto',
            contents: { text: { maxCharacters: 600 } },
          }),
        },
      }
    },
    parse(json) {
      return list(json?.results).map((row) => ({
        url: row?.url,
        title: row?.title,
        snippet: row?.text ?? (list(row?.highlights)[0]),
        publishedAt: row?.publishedDate,
      }))
    },
  },

  brave: {
    label: 'Brave Search',
    keyless: false,
    defaultEndpoint: 'https://api.search.brave.com',
    apiKeyEnv: 'BRAVE_API_KEY',
    hint: '独立的 Web 索引，免费额度较宽裕，响应快。',
    build(request, options, base, apiKey) {
      const url = endpointFor(base, '/res/v1/web/search')
      const params = url.searchParams
      params.set('q', request.query)
      params.set('count', String(Math.min(options.maxResults, 20)))
      params.set('safesearch', SAFE_SEARCH.brave[options.safeSearch] ?? 'moderate')
      const notes = []
      if (options.language !== undefined) {
        const lang = braveSearchLang(options.language)
        if (lang === undefined) {
          notes.push(`Brave 没有「${options.language}」对应的 search_lang，已省略该参数（Brave 只认 50 个固定标签，中文须写 zh-hans / zh-hant）`)
        } else {
          params.set('search_lang', lang)
        }
      }
      return {
        url: url.toString(),
        init: { method: 'GET', headers: { 'x-subscription-token': apiKey } },
        notes,
      }
    },
    parse(json) {
      return list(json?.web?.results).map((row) => ({
        url: row?.url,
        title: row?.title,
        snippet: row?.description,
        publishedAt: row?.page_age ?? row?.age,
      }))
    },
  },

  serper: {
    label: 'Serper (Google)',
    keyless: false,
    defaultEndpoint: 'https://google.serper.dev',
    apiKeyEnv: 'SERPER_API_KEY',
    hint: 'Google 结果的低延迟代理，按次计费。',
    build(request, options, base, apiKey) {
      const url = endpointFor(base, '/search')
      const locale = (options.language ?? 'zh-CN').split('-')
      return {
        url: url.toString(),
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify({
            q: request.query,
            num: Math.min(options.maxResults, 20),
            hl: locale[0],
            gl: (locale[1] ?? locale[0]).toLowerCase(),
            safe: SAFE_SEARCH.serper[options.safeSearch] ?? 'active',
          }),
        },
      }
    },
    parse(json) {
      return [...list(json?.organic), ...list(json?.news)].map((row) => ({
        url: row?.link,
        title: row?.title,
        snippet: row?.snippet,
        publishedAt: row?.date,
      }))
    },
  },

  bing: {
    label: 'Bing (Azure)',
    keyless: false,
    defaultEndpoint: 'https://api.bing.microsoft.com',
    apiKeyEnv: 'BING_API_KEY',
    hint: 'Azure 认知服务 Web Search，key 形如 32 位十六进制串。',
    build(request, options, base, apiKey) {
      const url = endpointFor(base, '/v7.0/search')
      const params = url.searchParams
      params.set('q', request.query)
      params.set('count', String(Math.min(options.maxResults, 50)))
      params.set('safeSearch', SAFE_SEARCH.bing[options.safeSearch] ?? 'Moderate')
      if (options.language !== undefined) params.set('mkt', options.language)
      return {
        url: url.toString(),
        init: { method: 'GET', headers: { 'ocp-apim-subscription-key': apiKey } },
      }
    },
    parse(json) {
      return list(json?.webPages?.value).map((row) => ({
        url: row?.url,
        title: row?.name,
        snippet: row?.snippet,
      }))
    },
  },

  google: {
    label: 'Google CSE',
    keyless: false,
    defaultEndpoint: 'https://www.googleapis.com',
    apiKeyEnv: 'GOOGLE_API_KEY',
    hint: '需要单独填写搜索引擎 ID（cx），每天免费额度有限。',
    requiresExtra: 'googleCx',
    build(request, options, base, apiKey) {
      const url = endpointFor(base, '/customsearch/v1')
      const params = url.searchParams
      params.set('key', apiKey)
      params.set('cx', options.googleCx)
      params.set('q', request.query)
      params.set('num', String(Math.min(options.maxResults, 10)))
      params.set('safe', SAFE_SEARCH.google[options.safeSearch] ?? 'active')
      if (options.language !== undefined) params.set('hl', options.language)
      return { url: url.toString(), init: { method: 'GET' } }
    },
    parse(json) {
      return list(json?.items).map((row) => ({
        url: row?.link,
        title: row?.title,
        snippet: row?.snippet,
      }))
    },
  },
}

export const ENGINE_IDS = Object.keys(ENGINES)

/**
 * Run one engine for one query.
 *
 * `options.trace`, when it is a function, receives exactly one record per call —
 * the exchange's outcome whether it succeeded or not. That is what lets the
 * settings page answer "is my key actually working?" with the status code, the
 * host it talked to, and the round-trip time instead of a bare yes/no.
 * @param engineId - a key of {@link ENGINES}.
 * @param query - the caller's query string.
 * @param options - the resolved plugin options for this search.
 * @param apiKey - the credential resolved for this engine, when it needs one.
 * @param signal - the caller's abort signal.
 * @returns normalized sources, ready for the seam's own `maxResults` cap.
 */
export async function runEngine(engineId, query, options, apiKey, signal) {
  const engine = ENGINES[engineId]
  if (engine === undefined) throw new Error(`unknown search engine "${engineId}"`)

  const trace = typeof options.trace === 'function' ? options.trace : undefined
  const startedAt = Date.now()
  let notes = []
  const report = (record) => {
    if (trace === undefined) return
    trace({
      engine: engineId,
      engineLabel: engine.label,
      ms: Date.now() - startedAt,
      ...(notes.length > 0 ? { notes: [...notes] } : {}),
      ...record,
    })
  }

  const wantsKey = engine.keyless !== true
  if (wantsKey && text(apiKey) === undefined) {
    report({ ok: false, error: `${engine.label} 需要 API key，但未配置（apiKey 或 ${engine.apiKeyEnv}）` })
    throw new Error(`${engine.label} 需要 API key，但未配置（apiKey 或 ${engine.apiKeyEnv}）`)
  }
  if (engine.requiresExtra === 'googleCx' && text(options.googleCx) === undefined) {
    report({ ok: false, error: 'Google CSE 还需要填写「搜索引擎 ID (cx)」' })
    throw new Error('Google CSE 还需要填写「搜索引擎 ID (cx)」')
  }

  const base = baseUrl(options.endpointOverride, engine.defaultEndpoint)
  const { url, init, notes: builtNotes } = engine.build({ query }, options, base, text(apiKey))
  if (Array.isArray(builtNotes)) notes = builtNotes.map((note) => text(note)).filter((note) => note !== undefined)
  const endpoint = publicEndpoint(url)
  const method = init?.method ?? 'GET'

  let exchange
  try {
    exchange = await requestJson({
      url,
      init,
      timeoutMs: options.timeoutMs,
      signal,
      keepRedirects: engine.keyless === true,
    })
  } catch (error) {
    report({ ok: false, method, endpoint, status: error?.status, error: redactUrls(describeForTrace(error)) })
    throw error
  }

  const sources = normalize(engine.parse(exchange.json), options.maxResults)
  report({ ok: true, method, endpoint, status: exchange.status, ms: exchange.elapsedMs, count: sources.length })
  return sources
}

/** A failure's one-line description, with its error code when it has one. */
function describeForTrace(error) {
  const message = error instanceof Error ? error.message : String(error)
  return error?.code === undefined ? message : `${error.code}: ${message}`
}

export function engineLabel(engineId) {
  return ENGINES[engineId]?.label ?? engineId
}
