/**
 * Degraded-path check for the connectivity probe.
 *
 * Run by `smoke.mjs` in a child process *without* the resolve hook, so the
 * `installProbe` import of `@deepseek-ai/dsh-typert-protocol` fails exactly as
 * it does in a deployment that does not ship the Typert packages. The contract
 * under test: the failure is reported with its reason, and the provider is
 * registered anyway — losing the settings page's button must never cost the
 * agent its search provider.
 */
import assert from 'node:assert/strict'

const plugin = await import('../index.js')

const warnings = []
const original = console.warn
console.warn = (line) => warnings.push(String(line))

const values = { engine: 'searxng', maxResults: 8, timeoutMs: 5000, language: 'zh-CN', safeSearch: 'moderate' }
const config = new Proxy({}, { get: (_target, key) => ({ get: () => values[key] }) })

let provider
const ctx = {
  web: { registerSearchProvider: (p) => { provider = p; return () => {} } },
  get: () => undefined,
}
const dispose = plugin.apply(ctx, config)
await new Promise((resolve) => setTimeout(resolve, 0))
console.warn = original

assert.equal(typeof provider?.search, 'function', 'provider 必须已注册')
assert.equal(typeof provider?.available, 'function')
assert.equal(typeof dispose, 'function', 'apply 必须返回 registerSearchProvider 的 disposer')
assert.equal(warnings.length, 1, '探针缺席应恰好报告一次')
assert.match(warnings[0], /连接探针未安装/)
assert.match(warnings[0], /typert-protocol/, '原因里要点名缺失的包')

console.log('ok: 探针缺席时 provider 与 disposer 都在')
