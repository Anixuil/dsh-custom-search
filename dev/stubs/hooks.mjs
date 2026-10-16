/**
 * Dev-only module hook: redirect one specifier to its local stand-in.
 *
 * `node --import`-registered hooks are the only way to stand in for a bare
 * package without planting a fake copy in `node_modules/`, where it could
 * shadow the real one once the Harness installs this plugin. Only the single
 * specifier `installProbe` imports lazily is rerouted; everything else resolves
 * normally, so the tests still exercise the real `@deepseek-ai/schemastery`.
 */
const REDIRECT = new Map([
  ['@deepseek-ai/dsh-typert-protocol', new URL('./typert-protocol.js', import.meta.url).href],
])

/** Standard ESM resolve hook. */
export async function resolve(specifier, context, nextResolve) {
  const target = REDIRECT.get(specifier)
  if (target !== undefined) return { url: target, shortCircuit: true }
  return nextResolve(specifier, context)
}
