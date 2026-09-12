# Phase 15 results

Date: 2026-09-12. Base revision: `79ba6ef7181c738eaf10a1e90f2da3a51897685e`, with the existing Phase 11–14 working-tree implementation plus Phase 15 changes. Environment: Windows `10.0.26220`, Node `v25.2.1`, npm `11.7.0`, installed Electron `29.4.6`.

Status: automated regression and release documentation implemented. Live API, physical microphone, latency and packaged interaction acceptance are still pending. Phase 15 is not release-complete.

## Changes

- Added six main-service/controller regression cases: all service/mode combinations retain SQL normalization, screen context, one streamed answer and screenshot cleanup. Live cases assert the review gate and then exercise explicit reviewed text; they do not simulate successful Live transcription.
- Added main-process expiry tests covering aborted uploads, late results, retry, Live hangup and cancellation of expiry after completion.
- Corrected outdated Settings text that said automatic submission was still a future phase. It now explains one-question automatic submission and Live review in both modes.
- Added `npm run qa:voice:package` and a local Windows x64 directory-build configuration. The QA build excludes `.env` resources, disables signing/editing and publishing, and reuses the installed runtime on Windows x64.
- Added [usage instructions](release-usage.md) and a [manual QA protocol](manual-qa.md), including all six combinations, failure/recovery cases and a per-trial latency/completeness worksheet.

## Automated checks

| Check | Measured result |
| --- | --- |
| `npm test` | 70 passed, 0 failed, 0 skipped |
| `npm run lint` | Passed |
| `npx tsc --noEmit` | Passed |
| `npx tsc -p tsconfig.electron.json --noEmit` | Passed |
| `npm run build` | Passed: renderer, main and preload |
| `npm run qa:voice:package` | Passed: unsigned Windows x64 directory package |
| Packaged archive inspection | Passed: executable, main/preload entry points, renderer assets, updated Settings copy, no `.env` in archive or resources |
| Local Markdown links | Passed: 31 references resolve |
| `git diff --check` | Passed; Git reports line-ending conversion notices |

Existing tests already participate in the wildcard test command and cover adapter selection, completed recorder bytes, permissions, cancellation, drain timeouts, speech detection, races and disk migration. The new cases extend that evidence; physical screen capture and provider answer quality remain unverified. Build warnings identify stale Browserslist data and a renderer chunk larger than 500 kB.

## Provider checks

The sandbox access attempt failed without an HTTP result. A network-enabled retry of the compiled access probe reached OpenAI:

| Model | HTTP status | Meaning |
| --- | --- | --- |
| `gpt-live-1` | 401 | Configured credentials were not accepted |
| `whisper-1` | 401 | Configured credentials were not accepted |

No keys were printed or changed. No successful transcription or Live session was measured. Fix authentication before evaluating model/session capability; this result does not establish model availability.

## Windows package

The initial directory-packaging attempt could not download Electron through the sandbox network. The QA configuration was updated to reuse the installed Windows x64 Electron runtime, and the full build/package command then exited successfully.

Artifact: `release/voice-qa/win-unpacked/Interview Coder.exe`. The packaged `resources/app.asar` SHA-256 is `C9A59D52BA03E9C0DCF180C87ACD62A913EA06735D166327105836D1CB8DCB1E`. Archive inspection confirmed the configured main and preload, referenced renderer assets, current automatic-mode Settings text, and absence of `.env` in both archive and resources. The executable was not launched for interactive acceptance. Electron-builder also printed unresolved-dependency diagnostic lines; successful archive creation does not establish runtime dependency completeness.

No installer, physical shortcut, microphone permission UI, screen hide/show or interactive packaged acceptance is claimed by a directory build.

## Manual and measured acceptance

| Area | Result |
| --- | --- |
| Six real-microphone service/mode combinations | Not run; explicit API services blocked by authentication |
| Permission denial, noise, pauses, long questions, network loss, unavailable model | Mocked coverage where listed above; physical/provider trials not run |
| Screen context, SQL normalization, typed/review prompts, streaming | Local regression passed; desktop/provider validation not run |
| Packaged Windows shortcuts, restart and resource release | Not run |
| Whisper speech-end-to-first-answer latency / transcript completeness | Unmeasured; zero live trials |
| Live speech-end-to-first-answer latency / transcript completeness | Unmeasured; zero live trials; explicit review still required |
| Other platforms | Not tested in this phase |

The [manual protocol](manual-qa.md) specifies the remaining steps and evidence fields. Valid credentials, a physical microphone/operator and packaged interaction trials are required to close the remaining checklist items. Original voice-feature documentation and historical results remain unchanged.
