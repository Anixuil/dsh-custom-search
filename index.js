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
 */

import z from '@deepseek-ai/schemastery'
import { ENGINE_IDS, ENGINES, engineLabel, runEngine } from './engines.js'

/** Loader diagnostic name, matched by the row id in `cordis.patch.yml`. */
export const name = 'custom-search'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Stable id this provider registers under; `dsh-web` pins it via `searchProvider`. */
export const PROVIDER_ID = 'custom-search'

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
 * Resolve the credential one search needs.
 *
 * Order: the literal `apiKey`, then the credentials service (what the web Models
 * page and the plugin settings form write), then the launching environment, then
 * the process environment. Resolving per call means a rotated key reaches the
 * next search without a restart.
 *
 * @param literal - a key typed straight into the settings form; wins over a reference.
 * @param refName - the credential reference to resolve when no literal was given.
 */
async function resolveApiKey(ctx, engine, { literal, refName }) {
  if (nonEmpty(literal)) return literal.trim()

  const reference = nonEmpty(refName) ? refName.trim() : engine.apiKeyEnv
  if (reference === null || reference === undefined) return undefined

  try {
    const { credentialRef } = await import('@deepseek-ai/dsh-credentials')
    const credentials = ctx.get('credentials')
    if (credentialRef !== undefined && credentials !== undefined) {
      const resolved = await credentials.resolve(credentialRef(reference))
      if (nonEmpty(resolved?.value)) return resolved.value
    }
  } catch {
    /* the composition may not mount the credentials service */
  }

  try {
    const { launchEnvironmentOf } = await import('@deepseek-ai/dsh-launch-environment')
    const ambient = launchEnvironmentOf(ctx)?.get(reference)
    if (nonEmpty(ambient?.value)) return ambient.value
  } catch {
    /* the composition may not mount the launch environment */
  }

  const fromProcess = process.env?.[reference]
  return nonEmpty(fromProcess) ? fromProcess : undefined
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

  async search(request, signal) {
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
      try {
        const apiKey = engine.keyless === true
          ? undefined
          : await resolveApiKey(this.ctx, engine, {
            // A literal key and a credential reference both describe the
            // selected primary engine; a fallback engine resolves its own.
            literal: isPrimary ? options.apiKey : undefined,
            refName: isPrimary ? options.apiKeyEnv : undefined,
          })

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
          },
          apiKey,
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

  // Registered with the calling fiber, so the provider unregisters on dispose.
  return ctx.web.registerSearchProvider(new CustomSearchProvider(ctx, snapshot))
}
