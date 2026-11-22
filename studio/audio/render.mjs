import { renderPatch } from './patch.mjs';
import { renderScore } from './score.mjs';
import { documentKind, validateDocument } from './validate.mjs';

/** Render a patch or a score, whichever `doc.schema` says. Throws a coded Error with `.issues` when invalid. */
export function renderDocument(doc, options) {
  const kind = documentKind(doc);
  if (!kind) throw Object.assign(new Error('Not an audio document: $.schema must be "studio.audio.patch" or "studio.audio.score"'), {code: 'invalid_document', issues: validateDocument(doc)});
  return kind === 'patch' ? renderPatch(doc, options) : renderScore(doc, options);
}
export { renderPatch, renderScore };
