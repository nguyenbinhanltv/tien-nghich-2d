# Audio sized by the gameplay window (studio_audio_render: window)

- **AUDIOWINDOW-001** A patch's `window` is validated (exactly one source, positive numbers, a patch only, within the length limit) and stretches the patch's length, layer times and envelopes from its own `durationMs` to the window plus its tail.
- **AUDIOWINDOW-002** The configuration that sized a patch is hashed over canonical JSON and the source document, so the same window gives the same hash and a changed patch, window or clip timing gives another.
- **AUDIOWINDOW-003** A clip window reads the clip contract (declared frameMs and events) of the asset it names: the time between two events, or the whole clip; a missing clip, event or timing is refused with what to declare.
- **AUDIOWINDOW-004** `studio_audio_render` sizes by the window before it renders, returns the resolved window and its hash, records both in a kept candidate's provenance, and the rendered length equals the window; dryRun writes nothing.
