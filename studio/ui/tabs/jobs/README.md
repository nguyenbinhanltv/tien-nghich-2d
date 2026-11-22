# Jobs tab

Read-only: the MCP server's tool-call feed, its jobs, and the quota view (generations and wall time per agent and per kind of work).

## Pack block `ui.tabs.jobs.quota` (optional; absent means no ceiling)

```json
{"window": "day", "ceilings": {"generations": 40, "wallMs": 1800000}, "perAgent": {"generations": 20}, "perRun": {"generations": 8}, "defaultWallMs": 5000}
```

`window` is `day` (the last 24 hours) or `all` (default). A toolchain run (`studio_generator_run`, `studio_vfx_build`, `studio_pack`) counts as one generation; if it would pass a ceiling it is refused before it starts. An image tool runs outside the studio, so the studio only records the generations an agent declares (`studio_frames_submit` `generations`) and answers "may I?" through `studio_job_status` with `plan`. The studio knows no prices: numbers that are not whole and non-negative are ignored.
