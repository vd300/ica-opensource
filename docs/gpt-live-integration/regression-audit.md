# Cross-phase regression audit

Date: 2026-09-12. Scope: original voice phases 0-10 and integration phases 11-15, reviewed against the current working tree. Historical verification records describe their original checkpoints.

## Findings fixed

- Browser recognition no-speech events during recording no longer fail the recording. The existing onend restart preserves long manual pauses.
- A renderer claim-in-flight guard prevents repeated shortcut/silence requests from producing late claim errors after disposal. Main remains authoritative for exactly-once acceptance.
- Sending a typed prompt cancels capture and invalidates late transcription before invoking the existing answer route.
- Main expiry increased from three to four minutes to accommodate setup, the two-minute capture cap and bounded finalization/transcription. The capture cap still cancels without submission.
- Removed the duplicate overlay start listener and corrected damaged mode/pause separators.
- Removed the obsolete automatic-mode rejection from the settings hook test double and added actual automatic-mode hook coverage.

## Phase assessment

| Phase | Evidence and remaining work |
| --- | --- |
| 0-4: framing, contracts, controller, lifecycle, IPC | Requirements retained. Controller and sender/recording validation tests pass. Reset, navigation, renderer loss and shutdown cancellation wiring inspected. Physical shortcut QA remains pending. |
| 5: recognition | Legacy and explicit service routing tested, including finalization, restart, denial, cancellation and no-speech handling. |
| 6: screen context | Temporary screenshot lifecycle inspected. New test proves cancellation during capture cleans late context without answering. Actual screen capture/hide/show requires desktop QA. |
| 7/7A: answers and SQL | Normalization, submitted prompts, SQL intent, answer completion and streaming cancellation tests pass. Existing answer and screenshot prompt paths retained; provider answer quality is unverified. |
| 8-9: overlay/settings | Type checks and production bundle pass. Migration and all six service/mode persistence combinations pass. Typed input releases capture. Visual and packaged restart QA remain pending. |
| 10: baseline regression | Existing controller suite passes; original manual checkboxes remain pending. |
| 11: Live feasibility | Mocked transport/drain and silent playback tests pass. Fresh network-enabled probe returned HTTP 401 for both models. Authentication and actual protocol/transcript acceptance remain blocked. |
| 12: settings migration | Disk reload, sanitization, legacy defaults, immutable audio settings, disable cancellation and notifications tested. |
| 13: adapters | Success/rejection, complete bytes, duplicate uploads, ownership, cancellation, late fragments, disconnects, limits and disposal tested. Real provider/microphone acceptance remains pending. |
| 14: submission | Acoustic timing, silence-only/manual behavior, resumed speech, arbitration, automatic hook cleanup and empty results tested. Live still requires transcript review; fully automatic Live answer acceptance remains pending. |
| 15: release QA | Automated checks and production bundles verified. Six real-microphone combinations, packaged shortcuts, permission UI, noise and latency measurement remain pending. |

## Commands and results

- npm test: 62 passing tests, including new no-speech, automatic hook race, cancellation-during-claim and cancellation-during-screenshot regressions.
- npm run lint: passed.
- npx tsc --noEmit: passed.
- npx tsc -p tsconfig.electron.json --noEmit: passed.
- npx vite build: renderer, Electron main and preload bundles passed. Warnings report stale Browserslist data and a renderer chunk over 500 kB; neither blocks the build.
- git diff --check: passed; Git reports the existing package.json line-ending conversion warning.
- npm run probe:live:access: sandbox attempt could not complete; network-enabled retry reached OpenAI and returned 401 for both models. No credentials were printed or changed.

This establishes local regression evidence, not a guarantee of real-device/provider behavior. Valid OpenAI credentials and microphone/packaged QA are required before release acceptance.
