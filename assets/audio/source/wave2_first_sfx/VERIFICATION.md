# Wave 2 first SFX sub-batch

The initial render and two fresh scratch rebuilds produced byte-identical masters and provenance. Independent WAV reads verified both PCM and file hashes, format, endpoints, nonzero bounds and peaks. All eight mono masters begin and end at digital zero.

| Cue | Frames at 44.1 kHz | Onset | Tail end (exclusive) | Sample peak (dBFS) |
|---|---:|---:|---:|---:|
| sfx_step | 5204 | 1 | 5112 | -12.141 |
| sfx_evade | 8467 | 1 | 8287 | -9.165 |
| sfx_cast | 13627 | 2 | 13488 | -6.495 |
| sfx_bolt | 6350 | 1 | 6085 | -3.484 |
| sfx_tell_light | 10319 | 1 | 10004 | -5.717 |
| sfx_focus | 2470 | 1 | 2196 | -12.728 |
| sfx_cancel | 7850 | 1 | 7627 | -11.414 |
| sfx_deny | 9129 | 1 | 8907 | -9.428 |

Each preset records its intended perceptual role and the approved pilot cue used for comparison. The ledger includes patch hashes, per-cue seeds, PCM and WAV hashes, RMS, and the exact rebuild command. No uniform loudness normalization was applied. Human listening acceptance is pending.
