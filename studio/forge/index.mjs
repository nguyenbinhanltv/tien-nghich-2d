// Forge library entry: image primitives, layout templates, sheet import, pixelisation, rig bake, patches, gates
// and the one-call pipeline.
export * from './image.mjs';
export { validateLayout, assertLayout, cellRect, gridLayout, turnaroundLayout, fromLegacyLayout, normalizeLayout, layoutSchema } from './sheet/layout.mjs';
export { validateAnnotations, nativeAnnotations, applyToPoseClips } from './sheet/annotations.mjs';
export { renderTemplate } from './sheet/template.mjs';
export { importSheet, normalizeScale, normalizeEntries, scalesByFacing, defaultScaleOptions, readSheetFile, writeImport, readImport, assertNoOverwrite, assertCellId, importSchema } from './sheet/import.mjs';
export { settingsFromPack, parsePaletteColors, resolveMarks } from './pixelize/settings.mjs';
export { pixelizeCell, pixelizeImport, writePixelized, readPixelized, pixelizeSchema } from './pixelize/pixelize.mjs';
export { bakeRig, writeBake, qaBake, validateRig, validatePatch, applyPatch, appendOps, emptyPatch, patchKey, frameName, gateFacing, unitOf } from './rig/index.mjs';
export { loadLibrary, getTemplate, listTemplates, coverage, clipTable, checkApplicable, validateLibrary } from './motion/library.mjs';
export { runGates, stability, defaultOptions } from './gates/index.mjs';
export { openForgeProject, rigPalette, manifestProfile, bakeStage, qaStage, summarizeBake, writeBakeDir, readBakeDir, runPipeline, bakeSchema,
  poseClipsSchema, validatePoseClips, poseFacings, bakePoseClip, effectiveLoops } from './pipeline/index.mjs';
export { compareSets, loadFrameSet } from './pipeline/compare.mjs';
export { accentsInBrief, nearestColours, colourDistance } from './figure/accents.mjs';
export { figureFor, figureChoice, guidanceText, guideShapes, drawGuide, measureFigure, figureWarnings } from './figure/figure.mjs';
export { LINEUP_METRICS, outlineWeight, standingMeasure, medianMeasure, referenceMeasure, lineupNumbers, judgeLineup, lineupMessages, trimFigure, ghostFigure, renderLineup } from './figure/lineup.mjs';
