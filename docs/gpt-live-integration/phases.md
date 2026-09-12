# GPT-Live integration phases

These new phases continue after the original voice feature's Phase 10. Original completion markers remain historical. Phase 11 local implementation is available; its live exit gate remains pending. See [plan](plan.md), [implementation specification](implementation.md), and [Phase 11 results](phase-11-results.md).

## Phase 11 — API feasibility and contracts

- [ ] Verify account access to `gpt-live-1` and `whisper-1` using the configured OpenAI key.
- [x] Prototype a Live connection, input transcript deltas, microphone shutdown, and session closure. Implemented with mocked lifecycle tests and an Electron UI/preload smoke test; real API verification remains pending.
- [x] Establish a tested transcript-drain policy at manual and automatic submission boundaries; document late-fragment behavior. Session close drains pending fragments; text always requires review because closure does not certify transcript completeness.
- [x] Confirm silent client playback and application-controlled answer submission independently of Live conversation activity. Code/test verified; live microphone verification remains pending.
- [x] Select a documented Live transport and dependency version; check compatibility with the installed OpenAI SDK range `^4.28.4`.
- [x] Define shared service, submission, session, and turn types.

Access probe result: the configured OpenAI key returned HTTP 401 for both requested model lookups. Phase 11 is not complete until authentication and live protocol/transcript checks pass. Checked items above describe implemented local artifacts, not a live acceptance result.

Exit: captured protocol evidence proves both Live submission modes can deliver complete questions. Do not represent a timed guess as an API completion acknowledgment.

## Phase 12 — Settings and migration

- [x] Add and sanitize service, submission mode, and automatic-pause settings on load and update.
- [x] Preserve legacy recognition and existing transcription-model defaults.
- [x] Update preload/config types, settings initialization, save payload, and config-update notifications.
- [x] Explain live audio transmission in manual mode and validate provider/key requirements.
- [x] Apply changed settings on the next recording; active recording uses an immutable configuration snapshot.

Exit: old, new, and invalid settings have migration tests; selections survive save/reopen/restart.

Implementation and automated results: [Phase 12 results](phase-12-results.md). Persistence is tested through disk reload and fresh config instances; packaged UI restart and microphone QA remain pending. Audio adapters and automatic submission are implemented locally; see the regression audit below.

## Phase 13 — Audio adapters

- [x] Isolate the existing recognition route behind a compatibility adapter.
- [x] Add explicit Whisper upload routing using `whisper-1` and complete supported audio files.
- [x] Add a dedicated Live session adapter and narrow IPC bridge.
- [x] Handle permissions, transport failures, timeouts, cancellation, and resource disposal.
- [x] Keep provider secrets in main-process operations for the new integration.

Exit: adapters are tested with mocked success, rejection, late events, and disconnects; service selection never falls through to another service silently.

## Phase 14 — Manual and automatic submission

- [x] Implement microphone-based speech detection and trailing-silence timing independent of transcript arrival.
- [x] Add shared exactly-once submission arbitration for silence and shortcut triggers.
- [x] Drain the selected adapter, normalize one submitted transcript, and reuse screenshot/answer generation.
- [x] Implement one-question automatic recording behavior, cancellation, duration limits, and empty-recording handling.
- [x] Display active mode, submitting state, and recording-limit guidance.

Exit: a long pause in manual mode never submits; silence-only automatic recording never submits; racing triggers produce one answer.

Implementation and automated results: [Phase 14 results](phase-14-results.md). Real microphone tuning and packaged QA remain pending; Live always requires transcript review.

## Phase 15 — Regression, packaged QA, and release documentation

- [x] Run `npm test`, `npm run lint`, `npx tsc --noEmit`, and `npx tsc -p tsconfig.electron.json --noEmit`.
- [x] Add meaningful adapter, config-migration, submission-race, and cancellation tests to the test command.
- [ ] Verify all service/mode combinations with real microphone input and configured credentials.
- [ ] Verify denied permissions, empty audio, long questions, background noise, pauses, expired sessions, and unavailable models.
- [ ] Verify screen context, SQL/technical normalization, typed prompts, and streaming answers.
- [ ] Verify start/submit shortcuts and resource cleanup in packaged Windows; test other supported platforms before claiming support there.
- [ ] Record measured speech-end-to-first-answer latency and transcript completeness for both services.
- [ ] Add release usage instructions and measured QA results in this folder; preserve original documentation. Usage instructions and automated/API evidence are available, but measured microphone QA is still pending.
- [x] Add [release usage](release-usage.md), a [Phase 15 evidence record](phase-15-results.md), and a repeatable [manual QA protocol](manual-qa.md). Microphone latency/completeness remain explicitly unmeasured.

Exit: results distinguish automated checks, live API checks, and manual checks. No unchecked item is described as delivered.

Phase 15 local implementation: 70 regression tests pass, Settings usage text is current, and a repeatable Windows QA packaging command is available. Live and manual release gates remain open; see [Phase 15 results](phase-15-results.md).

## Cross-phase regression audit

See [the 2026-09-12 audit](regression-audit.md) for current evidence and fixes. Checked implementation items do not certify live acceptance: Phase 11 authentication, Phase 14 Live completeness, and Phase 15 microphone/packaged QA remain pending.
