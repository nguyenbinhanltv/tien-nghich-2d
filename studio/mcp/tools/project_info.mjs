export default {
  name: 'studio_project_info',
  title: 'Studio project info',
  description:
    'Read-only orientation for the Tien Nghich 2D asset studio: the 40-colour palette (ids and hex), ' +
    'sprite size classes and clip layouts, outline and alpha rules, frame-key templates, and asset counts ' +
    'by category from the manifests. Call this first in any session.',
  scope: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      sections: {
        type: 'array',
        description: 'Limit the response to these sections. Omit for everything.',
        items: { type: 'string', enum: ['palette', 'sizeClasses', 'rules', 'frameKeys', 'assetCounts', 'manifests'] },
      },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, idempotentHint: true },
  handler({ sections }, ctx) {
    const p = ctx.project;
    const all = {
      palette: () => p.palette(),
      sizeClasses: () => p.sizeClasses(),
      rules: () => p.rules(),
      frameKeys: () => p.frameKeys(),
      assetCounts: () => p.assetCounts(),
      manifests: () => p.manifests(),
    };
    const wanted = sections?.length ? sections : Object.keys(all);
    return {
      project: { root: p.root, source: p.source, pack: p.pack() },
      connection: { agent: ctx.caller.agent, scope: ctx.scope, protocolEra: ctx.era, protocolVersion: ctx.protocolVersion },
      ...Object.fromEntries(wanted.map((k) => [k, all[k]()])),
    };
  },
};
