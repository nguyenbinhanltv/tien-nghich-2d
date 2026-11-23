export default {
  name: 'studio_project_info',
  title: 'Studio project info',
  description:
    'Read-only orientation for the project this Pixel Kiln connection serves: the project palette (ids and hex), ' +
    'sprite size classes and clip layouts, outline and alpha rules, frame-key templates, and asset counts ' +
    'by category from the manifests, which project this connection serves (serving), the fixed review rubric (rubric) and the motion lint thresholds (motion). Call this first in any session.',
  scope: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      sections: {
        type: 'array',
        description: 'Limit the response to these sections. Omit for everything.',
        items: { type: 'string', enum: ['palette', 'sizeClasses', 'rules', 'frameKeys', 'assetCounts', 'manifests', 'rubric', 'motion'] },
      },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, idempotentHint: true },
  handler({ sections }, ctx) {
    const p = ctx.project.snapshot(); // one consistent load for the whole response
    const all = {
      palette: () => p.palette(),
      sizeClasses: () => p.sizeClasses(),
      rules: () => p.rules(),
      frameKeys: () => p.frameKeys(),
      assetCounts: () => p.assetCounts(),
      manifests: () => p.manifests(),
      rubric: () => p.rubric(),
      motion: () => p.motion(),
    };
    const wanted = sections?.length ? sections : Object.keys(all);
    return {
      project: { root: p.root, source: p.source, pack: p.pack() },
      // Which project this connection serves. One connection is bound to one project (--project); opening another project in the browser does not move it.
      serving: { id: p.pack().id, name: p.pack().name, root: p.root, boundTo: 'this connection, for its whole life' },
      connection: { agent: ctx.caller.agent, scope: ctx.scope, protocolEra: ctx.era, protocolVersion: ctx.protocolVersion },
      ...Object.fromEntries(wanted.map((k) => [k, all[k]()])),
    };
  },
};
