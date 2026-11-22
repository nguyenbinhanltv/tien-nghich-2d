import test from 'node:test';
import assert from 'node:assert/strict';

test('the legacy buildPreviewIndex() still works with no argument', async () => {
  const { buildPreviewIndex } = await import('../../preview-app/serve.mjs');
  const index = await buildPreviewIndex();
  assert.ok(Array.isArray(index.atlases) && Array.isArray(index.processedPngs));
});
