# Phase 14 results

Implemented manual and one-question automatic submission on the existing Phase 13 adapters.

- Local microphone RMS is sampled every 50 ms. Speech requires at least 250 ms at RMS 0.02, followed by the configured continuous pause. Resumed speech resets the pause. Manual mode does not start detection; silence-only automatic capture never submits.
- File and Live adapters observe their capture stream. Browser recognition obtains a microphone stream for automatic detection, independently of recognition results. All detector timers, nodes and contexts are released with capture.
- Both shortcut and silence invoke a narrow main-process claim operation. Main validates owner, recording identity, mode and reason, and allocates one turn ID synchronously. Duplicate claims cannot drain or submit again. Submission waits for recording readiness.
- The selected adapter drains final audio/transcript events. Main rejects empty or punctuation-only text and forwards one accepted transcript through the existing submittedPrompt path, preserving normalization, screenshot context and answer streaming.
- Live still requires explicit text review, even after confirmed session closure. Phase 11 did not establish transcript completeness; automatic detection does not bypass this restriction.
- Recordings stop after one question and never restart automatically. The two-minute capture limit cancels without sending. Adapter finalization/transcription retain bounded timeouts and cancellation/stale-result protection.
- The overlay shows the recording service/mode snapshot, submitting status and duration-limit guidance.

Validation: npm test (58 tests), npm run lint, renderer TypeScript check and Electron compilation passed. Tests cover acoustic pauses, silence-only input, short noise, resumed speech, duplicate/racing claims, empty results, detector disposal, completed file bytes, delayed Live fragments, cancellation and recording limits.

No real microphone, authenticated provider or packaged UI acceptance was performed. RMS and timing are application tuning values requiring microphone/background-noise QA. Live completeness and the six service/mode microphone combinations remain release gates in Phase 15.
