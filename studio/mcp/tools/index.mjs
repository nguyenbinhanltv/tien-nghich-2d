// Registers every tool. To add a tool: create tools/<name>.mjs and add one line below.
import { ToolRegistry } from '../registry.mjs';
import projectInfo from './project_info.mjs';
import catalogSearch from './catalog_search.mjs';
import assetGet from './asset_get.mjs';
import assetPlan from './asset_plan.mjs';
import framesSubmit from './frames_submit.mjs';
import metadataSet from './metadata_set.mjs';
import qaRun from './qa_run.mjs';
import diff from './diff.mjs';
import previewRender from './preview_render.mjs';
import reviewRequest from './review_request.mjs';
import reviewList from './review_list.mjs';
import reviewReply from './review_reply.mjs';
import jobStatus from './job_status.mjs';
import jobWait from './job_wait.mjs';
import templateGet from './template_get.mjs';
import sheetImport from './sheet_import.mjs';
import processTool from './process.mjs';
import rigBake from './rig_bake.mjs';
import framePatch from './frame_patch.mjs';
import frameRead from './frame_read.mjs';
import generatorRun from './generator_run.mjs';
import vfxBuild from './vfx_build.mjs';
import pack from './pack.mjs';
import sceneSnapshot from './scene_snapshot.mjs';
import audioRender from './audio_render.mjs';
import audioAnalyze from './audio_analyze.mjs';

export function buildRegistry() {
  const registry = new ToolRegistry();
  for (const tool of [
    projectInfo, catalogSearch, assetGet, assetPlan,                 // context
    framesSubmit, metadataSet, qaRun, diff,                          // authoring and checking
    previewRender, sceneSnapshot, frameRead,                         // seeing: a picture, a scene, a frame as text
    reviewRequest, reviewList, reviewReply,                          // review loop: ask, read, answer. No approve, ever.
    jobStatus, jobWait,                                              // jobs
    templateGet, sheetImport, processTool, rigBake, framePatch,      // forge: template, import, pixelise, bake, pixel operations
    generatorRun, vfxBuild, pack,                                    // toolchain: registered generators, SpriteFX, staging packs
    audioRender, audioAnalyze,                                       // audio: render from data, measure and look. Nobody listens.
  ]) registry.register(tool);
  return registry;
}
