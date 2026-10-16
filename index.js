/**
 * dsh-custom-search — replace the built-in DeepSeek web search with a search
 * engine you choose.
 *
 * The plugin registers one search provider into the `ctx.web` seam
 * (`WebRuntime.registerSearchProvider`). The seam owns provider selection,
 * cancellation, error routing, and the final `maxResults` cap; this plugin only
 * has to answer two questions:
 *
 *   available()               a cheap, offline check — is a usable credential configured?
 *   search(request, signal)   run the query and return { sources, truncated }
 *
 * The model-facing `web_search` tool keeps its name and schema, so nothing about
 * the agent's prompt or tool list changes when this provider takes over.
 *
 * The second export is optional: a Remote probe the settings page calls to run
 * one real search through the very provider the agent uses, so "did my key
 * work?" has an answer that does not require asking the model. See
 * `installProbe` — a deployment without the Typert packages simply loses the
 * probe and keeps the provider.
 */

import z from '@deepseek-ai/schemastery'
import { ENGINE_IDS, ENGINES, engineLabel, runEngine } from './engines.js'

/** Loader diagnostic name, matched by the row id in `cordis.patch.yml`. */
export const name = 'custom-search'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Stable id this provider registers under; `dsh-web` pins it via `searchProvider`. */
export const PROVIDER_ID = 'custom-search'

/**
 * Cordis service key — and wire namespace — of the connectivity probe.
 * `client.js` spells the same name; the two halves are separate modules, so
 * neither can read the other's constants.
 */
export const PROBE_NAMESPACE = 'customSearchProbe'

/**
 * Prototype key `@deepseek-ai/dsh-typert-protocol` stores Remote method markers
 * under. That package exports the decorators and the reader but not this
 * constant, and the Gateway's source-mode discovery reads the marker straight
 * off the prototype, so it has to be spelled out here.
 */
export const PROBE_MARKER_KEY = '@deepseek-ai/dsh-typert-protocol/remote-methods'

/** Marker descriptor version the Gateway's reader accepts; it refuses any other. */
const PROBE_MARKER_VERSION = 1

/**
 * Remote method markers the Gateway's source-mode discovery reads off the probe
 * prototype. Exported so the offline validator can hold them against the
 * browser-side descriptor without a Typert installation present.
 *
 * `method` must name a prototype method — the Gateway derives the wire
 * parameter names from that function's own source — which is why the probe
 * spells it `async test(query)`: an identifier list, with no defaults,
 * destructuring or rest parameter.
 */
export const PROBE_METHODS = Object.freeze([
  Object.freeze({ method: 'test', invocation: Object.freeze({ kind: 'direct' }) }),
])

/** How many sources a probe reports; enough to prove the pipeline, cheap on quota. */
const PROBE_RESULT_LIMIT = 3

/** Hard ceiling on how many sources one search may hand back to the seam. */
const MAX_RESULTS_LIMIT = 20

/** Schema-drift fallback, used only if `@deepseek-ai/dsh-web` cannot be imported. */
class LocalWebError extends Error {
  constructor(message, code, options) {
    super(message, options)
    this.name = 'WebError'
    this.code = code
  }
}

let WebErrorCtor
/** Build a `WebError` when the seam's class resolves, so failures stay machine-routable. */
async function webError(message, code, cause) {
  if (WebErrorCtor === undefined) {
    try {
      const mod = await import('@deepseek-ai/dsh-web')
      WebErrorCtor = mod?.WebError ?? null
    } catch {
      WebErrorCtor = null
    }
  }
  const Ctor = WebErrorCtor ?? LocalWebError
  return new Ctor(message, code, cause === undefined ? undefined : { cause })
}

export const Config = z.object({
  engine: z.union(ENGINE_IDS.map((id) => z.const(id))).default('searxng').volatile(),
  /** Comma-separated engine ids tried in order when the primary returns nothing or fails. */
  fallback: z.string().volatile(),
  apiKey: z.string().role('secret').volatile(),
  apiKeyEnv: z.string().role('credential-ref').volatile(),
  /** Base URL override for the primary engine; a path prefix is preserved. */
  endpoint: z.string().volatile(),
  /** Per-engine base URL overrides as a JSON object, e.g. {"tavily":"https://gw.internal"}.
   *  Takes precedence over `endpoint` for the engines it names. */
  endpoints: z.string().volatile(),
  /** Google Programmable Search requires the engine id (`cx`) alongside the API key. */
  googleCx: z.string().volatile(),
  searchDepth: z.union([z.const('basic'), z.const('advanced')]).default('basic').volatile(),
  maxResults: z.number().step(1).min(1).default(8).volatile(),
  timeoutMs: z.number().step(1).min(1000).default(20000).volatile(),
  language: z.string().default('zh-CN').volatile(),
  safeSearch: z
    .union([z.const('off'), z.const('moderate'), z.const('strict')])
    .default('moderate')
    .volatile(),
})

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function clampResults(value) {
  if (!Number.isInteger(value) || value < 1) return 8
  return Math.min(value, MAX_RESULTS_LIMIT)
}

function clampTimeout(value) {
  if (!Number.isInteger(value) || value < 1000) return 20000
  return Math.min(value, 120000)
}

/**
 * Resolve the credential one search needs, and say where it came from.
 *
 * Order: the literal `apiKey`, then the credentials service (what the web Models
 * page and the plugin settings form write), then the launching environment, then
 * the process environment. Resolving per call means a rotated key reaches the
 * next search without a restart.
 *
 * The origin is returned alongside the value because the connectivity probe
 * reports it: "no key configured" and "a key exists but this deployment never
 * resolved it" look identical from the outside and need different fixes.
 *
 * @param literal - a key typed straight into the settings form; wins over a reference.
 * @param refName - the credential reference to resolve when no literal was given.
 * @returns the value (possibly undefined) and the step that produced it.
 */
async function resolveApiKey(ctx, engine, { literal, refName }) {
  if (nonEmpty(literal)) return { value: literal.trim(), source: 'literal', ref: undefined }

  const reference = nonEmpty(refName) ? refName.trim() : engine.apiKeyEnv
  if (reference === null || reference === undefined) return { value: undefined, source: 'none', ref: undefined }

  try {
    const { credentialRef } = await import('@deepseek-ai/dsh-credentials')
    const credentials = ctx.get('credentials')
    if (credentialRef !== undefined && credentials !== undefined) {
      const resolved = await credentials.resolve(credentialRef(reference))
      if (nonEmpty(resolved?.value)) return { value: resolved.value, source: 'credential', ref: reference }
    }
  } catch {
    /* the composition may not mount the credentials service */
  }

  try {
    const { launchEnvironmentOf } = await import('@deepseek-ai/dsh-launch-environment')
    const ambient = launchEnvironmentOf(ctx)?.get(reference)
    if (nonEmpty(ambient?.value)) return { value: ambient.value, source: 'launch-environment', ref: reference }
  } catch {
    /* the composition may not mount the launch environment */
  }

  const fromProcess = process.env?.[reference]
  if (nonEmpty(fromProcess)) return { value: fromProcess, source: 'process-env', ref: reference }
  return { value: undefined, source: 'none', ref: reference }
}

/** Ordered, de-duplicated engine chain: the primary first, then configured fallbacks. */
function buildChain(options) {
  const declared = [options.engine, ...String(options.fallback ?? '').split(',')]
  const seen = new Set()
  const chain = []
  for (const raw of declared) {
    const id = String(raw ?? '').trim()
    if (id.length === 0 || ENGINES[id] === undefined || seen.has(id)) continue
    seen.add(id)
    chain.push(id)
  }
  return chain
}

/** Read the per-engine endpoint map; malformed JSON is ignored rather than fatal. */
function parseEndpoints(raw) {
  const text = String(raw ?? '').trim()
  if (text.length === 0) return {}
  try {
    const parsed = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (ENGINES[key] !== undefined && nonEmpty(value)) out[key] = value.trim()
    }
    return out
  } catch {
    return {}
  }
}

function describe(error) {
  if (error === undefined || error === null) return 'unknown error'
  const message = error instanceof Error ? error.message : String(error)
  return error?.code === undefined ? message : `${error.code}: ${message}`
}

function isAbort(error, signal) {
  if (signal?.aborted === true) return true
  return error instanceof DOMException && error.name === 'AbortError'
}

/**
 * The provider handed to `ctx.web`. Every search snapshots the live config so a
 * settings change applies to the next call without re-registering — a
 * re-registration would show up to the user as a selection flicker.
 */
class CustomSearchProvider {
  id = PROVIDER_ID

  constructor(ctx, snapshot) {
    this.ctx = ctx
    this.snapshot = snapshot
  }

  available() {
    const options = this.snapshot()
    const engine = ENGINES[options.engine]
    if (engine === undefined) return false
    if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1000) return false
    if (engine.keyless === true) return true
    if (nonEmpty(options.apiKey) || nonEmpty(options.apiKeyEnv)) return true
    // A declared reference proves a resolver exists; a live environment variable
    // proves a value does. Both checks stay synchronous and offline — the seam
    // calls `available()` during provider selection and forbids network I/O there.
    const reference = engine.apiKeyEnv
    return reference !== null && nonEmpty(process.env?.[reference])
  }

  /**
   * Run the query down the configured engine chain.
   *
   * `trace` is not part of the seam's contract — the seam calls this with two
   * arguments — but the connectivity probe passes one so the settings page can
   * report what actually happened on the wire. Routing it through here rather
   * than through a parallel implementation is the point: the probe then
   * exercises exactly the path the agent uses, fallbacks and all.
   *
   * @param request - the seam's request; only `query` is read.
   * @param signal - the seam's cancellation signal.
   * @param trace - optional per-attempt observer; see `runEngine`.
   */
  async search(request, signal, trace) {
    const options = this.snapshot()
    const chain = buildChain(options)
    if (chain.length === 0) {
      throw await webError(
        `没有可用的搜索引擎：请在「插件配置 → custom-search」里把 engine 设为本插件支持的值（${ENGINE_IDS.join('、')}）。`,
        'WEB_PROVIDER_CONFIGURED_UNAVAILABLE',
      )
    }

    const maxResults = clampResults(Math.min(options.maxResults, request?.maxResults ?? options.maxResults))
    const perEngine = parseEndpoints(options.endpoints)
    const failures = []

    for (const [index, engineId] of chain.entries()) {
      const engine = ENGINES[engineId]
      const isPrimary = index === 0
      let credential = {
        value: undefined,
        source: engine.keyless === true ? 'not-needed' : 'none',
        ref: engine.apiKeyEnv,
      }
      const forward = typeof trace === 'function'
        ? (record) => trace({ ...record, credential: { source: credential.source, ref: credential.ref } })
        : undefined

      try {
        if (engine.keyless !== true) {
          credential = await resolveApiKey(this.ctx, engine, {
            // A literal key and a credential reference both describe the
            // selected primary engine; a fallback engine resolves its own.
            literal: isPrimary ? options.apiKey : undefined,
            refName: isPrimary ? options.apiKeyEnv : undefined,
          })
        }

        const sources = await runEngine(
          engineId,
          String(request?.query ?? ''),
          {
            maxResults,
            timeoutMs: clampTimeout(options.timeoutMs),
            language: nonEmpty(options.language) ? options.language.trim() : undefined,
            safeSearch: options.safeSearch,
            searchDepth: options.searchDepth,
            googleCx: options.googleCx,
            // A bare `endpoint` describes the primary engine only; a fallback
            // engine must not be pointed at another vendor's host. Naming an
            // engine in `endpoints` overrides it for that engine specifically.
            endpointOverride: perEngine[engineId] ?? (isPrimary ? options.endpoint : undefined),
            trace: forward,
          },
          credential.value,
          signal,
        )

        if (sources.length > 0) return { sources, truncated: false }
        failures.push(`${engineLabel(engineId)}：没有返回结果`)
      } catch (error) {
        if (isAbort(error, signal)) {
          throw await webError('自定义搜索已取消', 'WEB_ABORTED', error)
        }
        failures.push(`${engineLabel(engineId)}：${describe(error)}`)
      }
    }

    throw await webError(
      `自定义搜索引擎全部失败。${failures.join('；')}。请在「插件配置 → custom-search」中检查引擎、API key 与 endpoint 设置。`,
      'WEB_PROVIDER_ERROR',
    )
  }
}

/**
 * Build and register the Host-for-Client probe the settings page calls.
 *
 * A settings page reaches a Host capability through a Remote call, and this
 * deployment selects Remote capabilities at build time — a plugin shipping no
 * generated `/remote` artifact cannot be one of them. The Gateway's source-mode
 * fallback closes that gap: it discovers a service whose prototype carries a
 * Remote method marker. A package with no build step has no generator to emit
 * those two declarations, so they are written by hand here, and `client.js`
 * carries the matching browser-side descriptor.
 *
 * The Typert packages are imported lazily, so a deployment without them keeps
 * the provider; the caller is told why the probe is missing instead of it
 * failing silently, because "the button does nothing" and "the button is not
 * there" have the same appearance from the settings page.
 *
 * @param ctx - the plugin context; the service unregisters with its fiber.
 * @param provider - the live provider, so a probe exercises the agent's own path.
 * @returns whether the probe was installed, and the reason when it was not.
 */
async function installProbe(ctx, provider) {
  let Base
  try {
    ({ TypertRemoteService: Base } = await import('@deepseek-ai/dsh-typert-protocol'))
  } catch (error) {
    return { ok: false, reason: `@deepseek-ai/dsh-typert-protocol 无法加载（${describe(error)}）` }
  }
  if (typeof Base !== 'function') return { ok: false, reason: '@deepseek-ai/dsh-typert-protocol 未导出 TypertRemoteService' }

  class CustomSearchProbe extends Base {
    /**
     * @param context - the context whose fiber owns the service registration.
     */
    constructor(context) {
      super(context, PROBE_NAMESPACE)
    }

    /**
     * Run one real search down the configured engine chain and report what
     * happened — including every attempt's failure.
     *
     * Deliberately not a wrapper that rethrows: the page shows `error` verbatim,
     * and the provider's own message already names every engine it tried and why
     * each one failed, which is exactly what a user debugging a key needs.
     *
     * @param query - text to search for; blank falls back to a fixed probe.
     * @returns a plain report; every field is lossless JSON with no key material.
     */
    async test(query) {
      const options = provider.snapshot()
      const text = nonEmpty(query) ? String(query).trim().slice(0, 200) : 'deepseek'
      const attempts = []
      const started = Date.now()
      const report = {
        query: text,
        engine: options.engine ?? null,
        engineLabel: engineLabel(options.engine),
        chain: buildChain(options).map((id) => engineLabel(id)),
        ok: false,
        count: 0,
        sources: [],
        attempts,
        elapsedMs: 0,
      }

      try {
        const { sources } = await provider.search({ query: text, maxResults: PROBE_RESULT_LIMIT }, undefined, (record) => {
          attempts.push({
            engine: record.engine,
            engineLabel: record.engineLabel,
            method: record.method ?? null,
            endpoint: record.endpoint ?? null,
            status: record.status ?? null,
            ms: record.ms ?? null,
            ok: record.ok === true,
            count: record.count ?? null,
            error: record.error ?? null,
            credential: record.credential?.source ?? null,
            ref: record.credential?.ref ?? null,
          })
        })
        report.count = sources.length
        report.ok = sources.length > 0
        report.sources = sources.slice(0, PROBE_RESULT_LIMIT).map((source) => ({
          title: String(source?.title ?? ''),
          url: String(source?.url ?? ''),
        }))
      } catch (error) {
        report.error = describe(error)
      }

      report.elapsedMs = Date.now() - started
      return report
    }
  }

  Object.defineProperty(CustomSearchProbe.prototype, PROBE_MARKER_KEY, {
    configurable: true,
    value: Object.freeze({ version: PROBE_MARKER_VERSION, methods: PROBE_METHODS }),
  })

  // Constructing a Service registers it on the calling fiber, so the probe
  // disappears with the plugin.
  new CustomSearchProbe(ctx)
  return { ok: true }
}

export function apply(ctx, config) {
  const snapshot = () => ({
    engine: config.engine.get(),
    fallback: config.fallback.get(),
    apiKey: config.apiKey.get(),
    apiKeyEnv: config.apiKeyEnv.get(),
    endpoint: config.endpoint.get(),
    endpoints: config.endpoints.get(),
    googleCx: config.googleCx.get(),
    searchDepth: config.searchDepth.get(),
    maxResults: config.maxResults.get(),
    timeoutMs: config.timeoutMs.get(),
    language: config.language.get(),
    safeSearch: config.safeSearch.get(),
  })

  const provider = new CustomSearchProvider(ctx, snapshot)

  // Optional, and never allowed to break the provider: a refused probe costs the
  // settings page its connectivity button and nothing else. A Host half has no
  // channel to a slot, so a maintainer reads the reason here; the page shows its
  // own "no probe" line in place of the button's result.
  void installProbe(ctx, provider).then(
    (result) => {
      if (result.ok !== true) console.warn(`[dsh-custom-search] 连接探针未安装：${result.reason}，配置页只显示本地检查。`)
    },
    (error) => console.warn(`[dsh-custom-search] 连接探针未安装：${describe(error)}，配置页只显示本地检查。`),
  )

  // Registered with the calling fiber, so the provider unregisters on dispose.
  return ctx.web.registerSearchProvider(provider)
}
