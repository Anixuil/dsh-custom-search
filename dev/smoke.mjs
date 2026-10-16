/**
 * Smoke test for dsh-custom-search.
 *
 * Stands up a fake search endpoint that can answer as SearXNG and as Tavily,
 * drives the real plugin module through a stub `ctx.web`, and asserts the
 * provider contract the seam relies on.
 *
 * The probe cases at the end reach the settings page's connectivity report. They
 * need `installProbe` to succeed, so this process registers a resolve hook that
 * stands in for `@deepseek-ai/dsh-typert-protocol` (see `dev/stubs/`). The truly
 * degraded path — no Typert package at all — runs in a child process without
 * that hook, so both branches are covered by the real code.
 *
 * Imports the plugin by its real path, so there is no copy to keep in sync.
 */
import http from 'node:http'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { register } from 'node:module'

register('./stubs/hooks.mjs', import.meta.url)

const plugin = await import('../index.js')
const stub = await import('./stubs/typert-protocol.js')

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
      searchLang: url.searchParams.get('search_lang'),
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
    if (url.pathname.endsWith('/res/v1/web/search')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        web: {
          results: [
            { url: 'https://brave.example/1', title: 'Brave 1', description: 'first', page_age: '2026-02-03' },
            { url: 'https://brave.example/2', title: 'Brave 2', description: 'second' },
          ],
        },
      }))
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

/**
 * Mount with a context the probe can register on, and wait for its lazy import
 * to settle — `apply` fires `installProbe` without awaiting it.
 * @param values - config overrides layered over {@link BASE}.
 * @returns the provider, the contexts, and the probe the last mount installed.
 */
/**
 * Poll until `check` holds.
 *
 * The probe is installed through a real dynamic `import()`, whose resolution
 * takes a variable number of turns of the loop — a fixed delay makes the test
 * flaky rather than correct.
 * @param check - the condition to wait for.
 */
async function settled(check) {
  for (let attempt = 0; attempt < 500; attempt++) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  assert.fail('探针安装没有在预期时间内完成')
}

/**
 * Mount with a context the probe can register on, and wait for its lazy import
 * to settle — `apply` fires `installProbe` without awaiting it.
 * @param values - config overrides layered over {@link BASE}.
 * @returns the provider, the context, and the probe this mount installed.
 */
async function mountWithProbe(values) {
  let provider
  const ctx = {
    web: { registerSearchProvider: (p) => { provider = p; return () => {} } },
    get: () => undefined,
    services: [],
  }
  const dispose = plugin.apply(ctx, refs({ ...BASE, ...values }))
  await settled(() => ctx.services.length > 0)
  assert.equal(ctx.services.length, 1, 'apply 应构造恰好一个探针服务')
  return { provider, ctx, dispose, probe: ctx.services[0] }
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

// 14. Brave validates `search_lang` against a closed enum and answers a value
// that is not on the list with 422 — which kills the whole search, not just the
// hint. A bare `zh` is not on that list, and `zh-CN` is this plugin's DEFAULT
// language, so the obvious normalization (drop the region subtag) is exactly the
// move that breaks the default configuration.
const brave = mount({ engine: 'brave', apiKey: 'bk-test', language: 'zh-CN' })
const braveResult = await brave.search({ query: 'brave query', maxResults: 5 }, undefined)
const braveCall = calls.at(-1)
assert.equal(braveCall.path, '/res/v1/web/search')
assert.equal(braveCall.headers['x-subscription-token'], 'bk-test')
assert.equal(braveCall.searchLang, 'zh-hans', 'zh-CN 必须映射为 zh-hans，不能截成裸 zh')
assert.deepEqual(braveResult.sources.map((s) => s.url), ['https://brave.example/1', 'https://brave.example/2'])
ok('brave：search_lang 由 zh-CN 映射为 zh-hans，不再发出会被 422 拒绝的裸 zh')

// 15. A language Brave has no tag for is dropped rather than guessed — a wrong
// value costs the whole search, a missing one only costs the language hint. The
// omission is reported, so it cannot pass silently.
const unmappable = await mountWithProbe({ engine: 'brave', apiKey: 'bk-test', language: 'id-ID' })
const unmappableReport = await unmappable.probe.test('brave query')
assert.equal(unmappableReport.ok, true)
assert.equal(unmappableReport.attempts[0].endpoint, `${origin}/res/v1/web/search`)
assert.equal(calls.at(-1).searchLang, null, '无法映射的语言必须省略 search_lang')
assert.equal(unmappableReport.attempts[0].notes.length, 1, '省略参数时必须留下一条说明')
assert.match(unmappableReport.attempts[0].notes[0], /id-ID/)
ok('brave：无法映射的语言省略 search_lang 并在报告里说明，而不是发出去等 422')

// 16. The settings page's connectivity report is the plugin's only user-facing
// proof that a key works, so it must show the real exchange: which host was
// called, what status came back, how long it took, and where the key came from.
const probed = await mountWithProbe({})
const probeReport = await probed.probe.test('hello')
assert.equal(probeReport.ok, true)
assert.equal(probeReport.count, 2)
assert.equal(probeReport.attempts.length, 1, '每个引擎都应留下一条尝试记录')
const [successAttempt] = probeReport.attempts
assert.equal(successAttempt.engine, 'searxng')
assert.equal(successAttempt.method, 'GET')
assert.equal(successAttempt.status, 200)
assert.equal(successAttempt.ok, true)
assert.equal(successAttempt.count, 2)
assert.equal(successAttempt.credential, 'not-needed', '免密钥引擎的来源应是 not-needed')
assert.equal(successAttempt.endpoint, `${origin}/search`, '端点必须去掉查询串')
assert.ok(Number.isFinite(successAttempt.ms))
assert.deepEqual(probeReport.sources.map((source) => source.url), ['https://searx.example/1', 'https://searx.example/2'])
ok('探针报告带状态码、端点、耗时与结果（查询串已剔除）')

// 17. A failure reports the same facts, so "bad key" and "wrong host" differ.
const broken = await mountWithProbe({})
const brokenReport = await broken.probe.test('boom-now')
assert.equal(brokenReport.ok, false)
assert.match(String(brokenReport.error), /HTTP 500/)
assert.equal(brokenReport.attempts[0].status, 500)
assert.equal(brokenReport.attempts[0].ok, false)
assert.match(String(brokenReport.attempts[0].error), /HTTP 500/)
assert.equal(brokenReport.attempts[0].endpoint, `${origin}/search`)
ok('探针失败时仍报告状态码与端点，而不是只说失败')

// 18. The report must never carry key material or the query text: it is rendered
// in a settings page and quoted in bug reports.
const keyed2 = await mountWithProbe({ engine: 'tavily', apiKey: 'tv-secret-value', endpoints: JSON.stringify({ tavily: origin }) })
const keyed2Report = await keyed2.probe.test('keyed')
assert.equal(keyed2Report.attempts[0].credential, 'literal', '字面密钥的来源应是 literal')
assert.equal(keyed2Report.attempts[0].endpoint, `${origin}/search`)
assert.ok(!JSON.stringify(keyed2Report).includes('tv-secret-value'), '报告不得泄漏密钥')
assert.ok(!JSON.stringify(probeReport).includes('q=hello'), '报告不得泄漏查询串')
ok('探针报告不泄漏密钥与查询串')

// 19. Fallback shows up as several attempts, so a green result cannot hide a
// broken primary engine. The literal key belongs to the primary engine only, so
// the fallback resolves its own — and the report names where it found it.
process.env.TAVILY_API_KEY = 'tk-from-env'
const fallbackProbe = await mountWithProbe({
  engine: 'searxng',
  fallback: 'tavily',
  endpoints: JSON.stringify({ tavily: origin }),
})
const fallbackReport = await fallbackProbe.probe.test('empty-results-trigger')
delete process.env.TAVILY_API_KEY
assert.equal(fallbackReport.attempts.length, 2, '主引擎与回退引擎各一条尝试记录')
assert.equal(fallbackReport.attempts[0].count, 0)
assert.equal(fallbackReport.attempts[1].engine, 'tavily')
assert.equal(fallbackReport.attempts[1].ok, true)
assert.equal(fallbackReport.attempts[1].credential, 'process-env')
assert.equal(fallbackReport.attempts[1].ref, 'TAVILY_API_KEY')
ok('兜底链的每一跳都留在报告里，并各自标注密钥来源')

// 20. Truly degraded: with no Typert package installed, `installProbe` must bow
// out, say why and leave the provider intact. This runs in a child process
// without the resolve hook, so the stand-in cannot mask the real import failure.
const degraded = spawnSync(process.execPath, [fileURLToPath(new URL('./degraded-probe.mjs', import.meta.url))], {
  encoding: 'utf8',
})
assert.equal(degraded.status, 0, `降级路径子进程应成功退出：\n${degraded.stdout}\n${degraded.stderr}`)
assert.match(degraded.stdout, /ok: 探针缺席时 provider 与 disposer 都在/)
ok('Typert 包缺失时 apply 仍注册 provider，并说明探针缺席的原因')

server.close()

console.log('\n通过项：')
for (const line of pass) console.log('  ✓', line)
console.log(`\n全部 ${pass.length} 项烟测通过。`)