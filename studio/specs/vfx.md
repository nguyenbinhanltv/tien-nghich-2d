# VFX tab behaviours

- **VFX-001** The tab's API is read-only apart from build; unknown routes and ids are refused.
- **VFX-002** The recorder cuts an effect's exported sheet: first frame, last frame, frame skip and sheet columns are validated against the frames the effect renders, the kept frames keep the clip's total time, and the cut is recorded in provenance with the hash of the recorded sheet.
- **VFX-003** The recorder is offered both as `studio_vfx_build`'s `record` option and in the VFX tab's build, and both cut the same way.
