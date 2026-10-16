/**
 * Dev-only stand-in for `@deepseek-ai/dsh-typert-protocol`.
 *
 * It exists so `dev/smoke.mjs` can reach the body of the connectivity probe:
 * `installProbe` imports the real package lazily, and no checkout of this
 * plugin has it installed, so without a stand-in every assertion about the
 * probe's report would be unreachable.
 *
 * It is NOT shipped and NOT installed anywhere the Harness resolves: `dev/` is
 * excluded from `files`, and `dev/stubs/hooks.mjs` maps the specifier to this
 * file for the duration of one test process only. At runtime the manifest's
 * `peerDependencies` entry routes the import to the installation's own copy.
 *
 * What it must reproduce is only the part `installProbe` touches: a base class
 * that registers the instance on the context it is given. The protocol's real
 * contract — the marker key, its version, the method list, and the parameter
 * names the Gateway derives from the method's own source — is pinned separately
 * by `dev/validate.mjs`, which reads both halves' constants.
 */

/** Instances constructed through this stand-in, in construction order. */
export const instances = []

export class TypertRemoteService {
  /**
   * @param ctx - the context that owns the registration.
   * @param serviceKey - the Cordis service key.
   */
  constructor(ctx, serviceKey) {
    this.ctx = ctx
    this.name = serviceKey
    this.typertRemote = Object.freeze({ service: this, serviceKey, namespace: serviceKey })
    instances.push(this)
    if (ctx?.services !== undefined) ctx.services.push(this)
  }
}

/** The marker reader the Gateway uses; present so a wrong call shape fails loudly. */
export function remoteMethods(service) {
  const value = service?.typertRemote
  return value === undefined ? [] : [{ method: 'test', invocation: { kind: 'direct' } }]
}
