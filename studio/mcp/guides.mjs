// Task guides for studio_guide: the shortest correct tool sequence for a task, with the gotchas the Codex sample runs hit.
// Every step names a tool and the parameters it uses; guides.test.mjs fails if any named tool or parameter does not exist
// (including tools and parameters mentioned in the gotcha text). Project-specific wording lives in the pack, not here.
export const GUIDES = [
  {
    id: 'static-asset', title: 'Make a static asset (an icon, a prop, a shot, a tile)',
    when: 'One frame or a few, code-drawn: icons, props, projectiles, tiles. Not characters.',
    steps: [
      { tool: 'studio_asset_plan', params: ['op', 'id', 'custom', 'brief'], note: 'op=create with custom {category, size, pivot, clips} when no profile fits; read the returned etag.' },
      { tool: 'studio_generator_run', params: ['assetId', 'generator', 'params', 'seed'], note: 'Run a registered generator with submit omitted first; an unknown generator or parameter lists what is allowed.' },
      { tool: 'studio_generator_run', params: ['assetId', 'generator', 'params', 'seed', 'submit'], note: 'Same call with submit=true commits the frames with generator, parameters and seed as provenance.' },
      { tool: 'studio_metadata_set', params: ['assetId', 'pivot', 'hitbox', 'etag'], note: 'Pivot and hitbox; the etag comes from studio_asset_get.' },
      { tool: 'studio_preview_render', params: ['assetId'], note: 'Look at the picture.' },
      { tool: 'studio_scene_snapshot', params: ['assetId', 'background'], note: 'See it in place; this needs frames that are already submitted.' },
      { tool: 'studio_qa_run', params: ['assetId'], note: 'The verdict. Then stop: a DIFFERENT session makes the independent check and asks for review.' },
    ],
    gotchas: ['A pixel patch (studio_frame_patch target "create") draws a small asset from stored operations when no generator fits.', 'Do not ask for review in the session that authored the frames: studio_review_request refuses without an independent check.'],
  },
  {
    id: 'animated-character', title: 'Make an animated character (mob, player, NPC, pet, boss)',
    when: 'A character with clips: locomotion from drawn key poses, idle and small motions from a rig, marks from patches.',
    steps: [
      { tool: 'studio_catalog_search', params: ['query', 'source', 'status'], note: 'Find the planned asset; or plan one with studio_asset_plan.' },
      { tool: 'studio_asset_get', params: ['assetId'], note: 'Clips, directions, size, profile.' },
      { tool: 'studio_template_get', params: ['assetId', 'kind', 'clip', 'write'], note: 'kind "turnaround" for rig clips, then kind "pose-sheet" with the locomotion clip. Each returns an image, a layout and a prompt skeleton (prompt.text) with the proportions and, for a locked entity, its reference image and description.' },
      { tool: 'studio_sheet_import', params: ['assetId', 'sheet', 'layout', 'prompt', 'tool', 'scaleOptions'], note: 'Import each sheet you drew (prompt VERBATIM). The two kinds keep separate slots. A sheet with no printed labels needs layout.labelBand.fraction 0. Pose sheets use scaleOptions mode "sheet".' },
      { tool: 'studio_process', params: ['assetId', 'marks', 'accents'], note: 'Pixelise. Name asymmetric marks in marks and accent colours in accents; read the figure warnings.' },
      { tool: 'studio_rig_bake', params: ['assetId', 'rig', 'poseClips', 'qa'], note: 'ONE call with both rig and poseClips; read verdicts.animationGates, verdicts.pixelGates and the gates listed as notRun. Do not turn gates off to pass.' },
      { tool: 'studio_frame_patch', params: ['assetId', 'edits', 'target'], note: 'target "bake" keeps a one-sided mark through every re-bake; its pixels are checked at the next bake.' },
      { tool: 'studio_rig_bake', params: ['assetId', 'submit'], note: 'submit=true only when both verdicts pass; raw is immutable afterwards.' },
      { tool: 'studio_metadata_set', params: ['assetId', 'pivot', 'hitbox', 'clips', 'etag'], note: 'Pivot, hitbox, frame durations.' },
      { tool: 'studio_scene_snapshot', params: ['assetId', 'clip', 'mode', 'background'], note: 'A walk strip on a floor tile, after the submit.' },
      { tool: 'studio_qa_run', params: ['assetId'], note: 'Then stop for the independent check.' },
    ],
    gotchas: ['Drawn locomotion has no foot-slide check unless planted contacts are annotated in poseClips; flicker is off for drawn clips unless qa.pose.flicker is set. verdicts.animationGates.notRun says so; not run is not a pass.', 'Fix by editing (patches, a better rig), not by regenerating the sheet. The stop policy (pack policy.stop) ends the work after too many fix rounds or two without progress: studio_qa_run then reports stopPolicy.decision "stop", the writing tools refuse, and studio_review_request becomes the escalation that asks the human.', 'Sheets drawn separately can differ in colours; the stability gate reports colours one clip has and another lacks.'],
  },
  {
    id: 'vfx', title: 'Make a VFX',
    when: 'A pixel effect from a SpriteFX spec.',
    steps: [
      { tool: 'studio_asset_plan', params: ['op', 'id', 'custom', 'brief'], note: 'custom {category "vfx", size, pivot, clips {play: {frames, frameMs}}}; frames must equal the sum of the spec\'s phase ticks.' },
      { tool: 'studio_project_info', params: ['sections'], note: 'Palette ids and hex values for the spec ramps.' },
      { tool: 'studio_vfx_build', params: ['assetId', 'spec'], note: 'Dry run: SpriteFX audits (faults) and the gates; change the spec, not the gates, until there are 0 faults.' },
      { tool: 'studio_vfx_build', params: ['assetId', 'spec', 'submit'], note: 'submit=true commits; provenance keeps the spec and its hash.' },
      { tool: 'studio_scene_snapshot', params: ['assetId', 'mode', 'background'], note: 'See it at its anchor, after the submit.' },
      { tool: 'studio_metadata_set', params: ['assetId', 'pivot', 'clips', 'etag'], note: 'Pivot and frame durations.' },
      { tool: 'studio_qa_run', params: ['assetId'], note: 'Then stop for the independent check.' },
    ],
    gotchas: ['A spec names no files: no "/", "\\", "~" or ".." in any value or key.', 'A dry run stores nothing, so studio_scene_snapshot cannot show it.'],
  },
  {
    id: 'audio-cue', title: 'Make an audio cue',
    when: 'A sound effect (patch) or a music loop (score) from data. Nobody listens: you measure and look.',
    steps: [
      { tool: 'studio_catalog_search', params: ['query', 'source'], note: 'source "audio": find the cue.' },
      { tool: 'studio_audio_render', params: ['cueId', 'document'], note: 'Render a studio.audio.patch or score into scratch: numbers plus a waveform and a spectrogram. Change the document on what the numbers show.' },
      { tool: 'studio_audio_analyze', params: ['document'], note: 'Exactly one of file, cueId or document; a document names its own cue, so no cueId with it.' },
      { tool: 'studio_audio_render', params: ['cueId', 'document', 'keep', 'note'], note: 'keep=true stores the next immutable candidate and starts its review history.' },
      { tool: 'studio_qa_run', params: ['assetId'], note: 'Measurements only. Then stop for the independent check.' },
    ],
    gotchas: ['Never claim a cue sounds good: a human signs listening in the Review tab.', 'A patch must start and end at digital zero and must not clip.'],
  },
  {
    id: 'check-others-work', title: 'Check someone else\'s work (the independent check)',
    when: 'Another session authored the asset; you did not.',
    steps: [
      { tool: 'studio_asset_get', params: ['assetId', 'promptDetail'], note: 'Provenance (every submission, parameters, seed, prompts with promptDetail "full"), milestones, existing checks.' },
      { tool: 'studio_preview_render', params: ['assetId'], note: 'Look at the sheet.' },
      { tool: 'studio_scene_snapshot', params: ['assetId', 'mode'], note: 'Look at it in place.' },
      { tool: 'studio_qa_run', params: ['assetId', 'independent'], note: 'independent=true records the check; refused from the authoring session. If it fails, report the defects with coordinates and fix nothing.' },
      { tool: 'studio_review_request', params: ['assetId', 'note', 'questions'], note: 'Only after a passing independent check on exactly the current frames.' },
      { tool: 'studio_review_list', params: ['assetId'], note: 'See that every status is pending: only a human decides.' },
    ],
    gotchas: ['Changing a frame after the check makes the check stale; the request is refused until it is run again.'],
  },
  {
    id: 'answer-review-comment', title: 'Answer a review comment',
    when: 'A human left a comment on a frame you made.',
    steps: [
      { tool: 'studio_review_list', params: ['assetId', 'detail'], note: 'Open comments come with the key, revision and comment index to reply to.' },
      { tool: 'studio_frame_patch', params: ['assetId', 'edits', 'target'], note: 'If the comment asks for a pixel change: target "revision" saves it as a NEW revision, pending.' },
      { tool: 'studio_review_reply', params: ['key', 'revision', 'replyTo', 'text', 'resolves'], note: 'Answer; resolves marks the comment handled. It is a comment, never a status.' },
    ],
    gotchas: ['You cannot approve, reject or reopen anything: only a human changes a status.'],
  },
];

export const guideIds = GUIDES.map((g) => g.id);
