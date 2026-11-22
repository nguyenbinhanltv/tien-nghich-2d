# Jobs tab behaviours

- **JOBS-001** (loopback) The tab's API refuses writes and unknown routes, answers only a loopback listener, and reports an unreachable job feed instead of failing.
- **JOBS-002** A job shown in the tab never carries its result, and its text is bounded.
- **JOBS-003** A toolchain run that would pass a ceiling the pack sets is refused before it starts and records nothing; counts are generations and wall time per agent and per kind of work, never money, and a dry run spends nothing.
- **JOBS-004** The real project's pack states that it has no quota ceiling (an explicit empty `ceilings`), so counting and display work but no run is ever refused for quota.
