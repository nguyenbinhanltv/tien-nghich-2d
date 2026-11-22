import { GUIDES, guideIds } from '../guides.mjs';
import { ToolError } from '../registry.mjs';
import { jsonResult } from './_shared.mjs';

export default {
  name: 'studio_guide',
  title: 'The shortest correct tool sequence for a task',
  description:
    'Task-oriented guidance: for "make a static asset", "make an animated character", "make a VFX", "make an audio cue", "check someone else\'s work" or "answer a review comment" it returns the shortest correct tool sequence (tool, the parameters to use, a note), the gotchas earlier agent runs hit, and this project\'s pixel-art rules from the pack. ' +
    'Call it with no task to list the guides. Read-only; it changes nothing and cannot approve anything.',
  scope: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      task: { type: 'string', enum: guideIds, description: `Which task: ${guideIds.join(', ')}. Omit to list them.` },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, idempotentHint: true },
  async handler({ task }, ctx) {
    const rules = ctx.project.agentGuidance?.()?.rules ?? [];
    if (!task) return jsonResult({ guides: GUIDES.map((g) => ({ task: g.id, title: g.title, when: g.when })), rules, next: 'Call studio_guide with a task.' });
    const guide = GUIDES.find((g) => g.id === task);
    if (!guide) throw new ToolError(`No guide "${task}". Guides: ${guideIds.join(', ')}.`);
    return jsonResult({ task: guide.id, title: guide.title, when: guide.when, steps: guide.steps.map((s, i) => ({ n: i + 1, ...s })), gotchas: guide.gotchas, rules });
  },
};
