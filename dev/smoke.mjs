/**
 * Smoke test for dsh-custom-search.
 *
 * Stands up a fake search endpoint that can answer as SearXNG and as Tavily,
 * drives the real plugin module through a stub `ctx.web`, and asserts the
 * provider contract the seam relies on.
 *
 * The last case pins the degraded path of the settings page's connectivity
 * probe: with no Typert package installed the probe must bow out without
 * disturbing the provider — which is the state this checkout is in.
 *
 * Imports the plugin by its real path, so there is no copy to keep in sync.
 */
import http from 'node:http'
import assert from 'node:assert/strict'

const plugin = await import('../index.js')

const calls = []
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    calls.push({
      method: req.method,
      path: url.pathname,
      search: url.search,
      query: url.searchParams.get('q'),
      headers: req.headers,
    })

    // The "empty" / "boom" prefixes let a test force a zero-result or a 5xx response.
    const q = url.searchParams.get('q') ?? ''
    if (q.startsWith('empty')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ results: [], web: { results: [] }, organic: [] }))
      return
    }
    if (q.startsWith('boom')) {
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end('upstream exploded')
      return
    }

    if (req.method === 'POST') {
      // Tavily / Exa / Serper shape
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        results: [
          { url: 'https://tavily.example/a', title: 'Tavily A', content: 'snippet a', published_date: '2026-01-02' },
          { url: 'https://tavily.example/a', title: 'duplicate must collapse', content: 'dup' },
          { url: 'not-a-url', title: 'invalid must drop', content: 'x' },
        ],
      }))
      return
    }

    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      results: [
        { url: 'https://searx.example/1', title: 'SearX 1', content: 'first', publishedDate: '2026-03-04' },
        { url: 'https://searx.example/2', title: 'SearX 2', content: 'second' },
      ],
    }))
  })
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`

/** Minimal stand-in for the reactive config refs the loader hands `apply`. */
function refs(values) {
  const out = {}
  for (const [key, value] of Object.entries(values)) out[key] = { get: () => value }
  return new Proxy(out, { get: (t, k) => (k in t ? t[k] : { get: () => undefined }) })
}

const BASE = {
  engine: 'searxng',
  fallback: '',
  apiKey: undefined,
  apiKeyEnv: undefined,
  endpoint: origin,
  endpoints: undefined,
  googleCx: undefined,
  searchDepth: 'basic',
  maxResults: 8,
  timeoutMs: 5000,
  language: 'zh-CN',
  safeSearch: 'moderate',
}

function mount(values) {
  let provider
  const ctx = {
    web: { registerSearchProvider: (p) => { provider = p; return () => {} } },
    get: () => undefined,
  }
  plugin.apply(ctx, refs({ ...BASE, ...values }))
  return provider
}

const pass = []
const ok = (line) => { pass.push(line); console.log('  ✓', line) }

// 1. Contract shape
const provider = mount({})
assert.equal(typeof provider.id, 'string')
assert.equal(typeof provider.available, 'function')
assert.equal(typeof provider.search, 'function')
assert.equal(provider.id, plugin.PROVIDER_ID)
ok(`provider 契约完整（id=${provider.id}）`)

// 2. Keyless engine is available without a credential
assert.equal(provider.available(), true)
ok('searxng 免 key 时 available() = true')

// 3. Keyed engine without a key is unavailable (cheap, offline check)
const keyed = mount({ engine: 'tavily' })
assert.equal(keyed.available(), false)
ok('tavily 未配置 key 时 available() = false（未发网络请求）')

// 4. SearXNG search normalizes, dedupes, drops non-http urls
const searx = await provider.search({ query: 'hello', maxResults: 5 }, undefined)
assert.ok(Array.isArray(searx.sources))
assert.equal(searx.sources.length, 2)
assert.deepEqual(searx.sources[0], {
  url: 'https://searx.example/1',
  title: 'SearX 1',
  snippet: 'first',
  publishedAt: '2026-03-04',
})
assert.equal(searx.sources[1].publishedAt, undefined, '缺少日期时不应带该字段')
ok('searxng 归一化：2 条结果、字段按需出现')

// 5. The request really carried format=json and the safe-search value
const searxCall = calls.at(-1)
assert.equal(searxCall.path, '/search')
assert.equal(searxCall.query, 'hello')
assert.match(searxCall.search, /format=json/)
assert.match(searxCall.search, /safesearch=1/)
assert.match(searxCall.search, /language=zh-CN/)
ok('searxng 请求参数正确（format=json / safesearch / language）')

// 6. maxResults is honoured
const capped = await provider.search({ query: 'hello', maxResults: 1 }, undefined)
assert.equal(capped.sources.length, 1)
assert.equal(capped.truncated, false, '截断由 seam 负责，provider 报告 false')
ok('maxResults 生效，truncated = false')

// 7. Tavily: POST + bearer auth + duplicate/invalid rows collapse
const tavily = mount({ engine: 'tavily', apiKey: 'tk-test' })
assert.equal(tavily.available(), true)
const tv = await tavily.search({ query: 'tavily query', maxResults: 5 }, undefined)
assert.deepEqual(tv.sources.map((s) => s.url), ['https://tavily.example/a'])
const tavilyCall = calls.at(-1)
assert.equal(tavilyCall.method, 'POST')
assert.equal(tavilyCall.headers.authorization, 'Bearer tk-test')
ok('tavily：POST + Bearer、重复与非法 URL 被剔除')

// 8. Endpoint override carries a reverse-proxy path prefix
const prefixed = mount({ engine: 'searxng', endpoint: `${origin}/searxng` })
await prefixed.search({ query: 'prefix', maxResults: 3 }, undefined)
assert.equal(calls.at(-1).path, '/searxng/search')
ok('endpoint 前缀不会被吞掉')

// 9. Fallback chain: primary returns nothing, secondary answers.
// A fallback engine is a different vendor, so it resolves its OWN credential
// (the literal apiKey belongs to the selected primary engine only).
process.env.TAVILY_API_KEY = 'tk-from-env'
const chain = mount({
  engine: 'searxng',
  fallback: ' tavily , unknown-engine',
  endpoints: JSON.stringify({ tavily: origin }),
})
const chained = await chain.search({ query: 'empty-results-trigger', maxResults: 5 }, undefined)
assert.deepEqual(chained.sources.map((s) => s.url), ['https://tavily.example/a'])
assert.equal(calls.at(-1).method, 'POST', '应回退到 tavily')
assert.equal(calls.at(-1).headers.authorization, 'Bearer tk-from-env', '回退引擎应使用自己的凭据')
delete process.env.TAVILY_API_KEY
ok('fallback 链生效：主引擎无结果时用回退引擎自己的凭据')

// 10. All engines failing raises a routable WebError that names the engine
const dead = mount({ engine: 'searxng' })
await assert.rejects(
  () => dead.search({ query: 'boom-now', maxResults: 3 }, undefined),
  (error) => {
    assert.equal(error.code, 'WEB_PROVIDER_ERROR')
    assert.match(error.message, /SearXNG/)
    assert.match(error.message, /HTTP 500/)
    return true
  },
)
ok('全部失败时抛 WebError(WEB_PROVIDER_ERROR)，并带上引擎名与 HTTP 状态')

// 11. An invalid engine id surfaces as a config error, not a crash
const bogus = mount({ engine: 'nope' })
assert.equal(bogus.available(), false)
await assert.rejects(
  () => bogus.search({ query: 'x' }, undefined),
  (error) => error.code === 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE',
)
ok('未知引擎：available()=false 且报配置类错误')

// 12. Caller cancellation maps to WEB_ABORTED
const controller = new AbortController()
controller.abort()
await assert.rejects(
  () => provider.search({ query: 'later', maxResults: 3 }, controller.signal),
  (error) => error.code === 'WEB_ABORTED',
)
ok('取消信号映射为 WEB_ABORTED')

// 13. Google CSE still requires cx
const google = mount({ engine: 'google', apiKey: 'gk' })
await assert.rejects(
  () => google.search({ query: 'x', maxResults: 3 }, undefined),
  (error) => /cx/.test(error.message),
)
ok('Google CSE 缺 cx 时给出明确提示')

// 14. The settings page's connectivity probe is optional. This environment has
// no Typert package, which is exactly the degraded case: installProbe must bow
// out quietly and apply() must still register the provider and hand back its
// disposer, rather than throwing or returning undefined.
let sawProvider = false
const noTypertCtx = {
  web: { registerSearchProvider: () => { sawProvider = true; return () => {} } },
  get: () => undefined,
}
const dispose = plugin.apply(noTypertCtx, refs(BASE))
assert.equal(typeof dispose, 'function', 'apply 必须返回 registerSearchProvider 的 disposer')
assert.equal(sawProvider, true)
// Give the async probe attempt a chance to reject before the process moves on.
await new Promise((resolve) => setTimeout(resolve, 0))
ok('Typert 包缺失时 apply 仍注册 provider 并返回 disposer（探针可选）')

server.close()

console.log('\n通过项：')
for (const line of pass) console.log('  ✓', line)
console.log(`\n全部 ${pass.length} 项烟测通过。`)