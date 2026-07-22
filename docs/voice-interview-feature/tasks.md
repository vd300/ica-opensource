# Voice Interview Assistant - Tasks

## Phase 0 - Product and Safety Framing
- [x] Confirm the feature is documented as practice/permitted assistance and follows the repository ethical-use guidance.
- [x] Decide whether `CommandOrControl+I` is acceptable for MVP, since Electron accelerators do not reliably distinguish physical left control.
- [x] Decide whether voice screenshots should be temporary only or visible in the existing screenshot queue.

## Phase 1 - Types and Contracts
- [x] Add `src/types/voice.ts` with `VoiceIntent`, `VoiceModeStatus`, transcript, chunk, and error payload types.
- [x] Add voice methods and listeners to `src/types/electron.d.ts`.
- [x] Define IPC channel constants for `voice:*` events in a shared location or near the preload/main IPC code.
- [x] Add cleanup-returning listener helpers in `electron/preload.ts`.

## Phase 2 - Main Process Controller
- [x] Create `electron/VoiceAssistantController.ts`.
- [x] Add session state: enabled, status, last transcript, active intent, request id, active abort controller, and debounce timestamp.
- [x] Implement `toggle()`, `start()`, `stop()`, `handleTranscriptSegment()`, and `handleRecognitionError()`.
- [x] Add deterministic intent detection for solve, explain, complexity, and debug phrases.
- [x] Normalize common technical speech-recognition misses and pause artifacts before intent detection and answer generation.
- [x] Route explicit freeform questions to the answer layer instead of relying on an exhaustive software-engineering vocabulary allowlist.
- [x] Add debounce logic to avoid repeated triggers from the same spoken phrase.
- [x] Add cancellation handling that aborts generation and sends stopped/error events.

## Phase 3 - Shortcut and Lifecycle Wiring
- [x] Add `voiceAssistantController` to `electron/main.ts` state.
- [x] Initialize the controller after screenshot and processing helpers.
- [x] Extend `IShortcutsHelperDeps` with `toggleVoiceMode`.
- [x] Register `CommandOrControl+I` in `electron/shortcuts.ts`.
- [x] Stop voice mode during reset and app shutdown.

## Phase 4 - IPC Handlers
- [x] Add `ipcMain.handle("voice:transcript-segment", ...)` in `electron/ipcHandlers.ts`.
- [x] Add `ipcMain.handle("voice:stop", ...)`.
- [x] Add `ipcMain.handle("voice:renderer-ready", ...)` if the controller needs to resync state after renderer reloads.
- [x] Add `ipcMain.handle("voice:recognition-error", ...)`.
- [x] Ensure every handler returns a structured `{ success, error? }` result.

## Phase 5 - Speech Recognition
- [x] Create `src/components/VoiceAssistant/useSpeechRecognition.ts`.
- [x] Detect `window.SpeechRecognition` and `window.webkitSpeechRecognition`.
- [x] Start recognition on `voice:mode-started`.
- [x] Stop recognition on `voice:mode-stopped`.
- [x] Enable continuous recognition and interim results where supported.
- [x] Send final transcript segments to the main process.
- [x] Show interim transcript locally for immediate user feedback.
- [x] Report unavailable speech recognition and microphone permission errors.

## Phase 6 - Screen Context
- [x] Add `captureTemporaryScreenshot()` to `electron/ScreenshotHelper.ts`, or implement a safe MVP wrapper around `takeScreenshot()`.
- [x] Ensure voice screenshots do not permanently pollute the normal queue unless explicitly chosen.
- [x] Read the screenshot as base64 for AI input.
- [x] Delete temporary screenshot files after completion, cancellation, or error.
- [x] Verify the main window hide/show behavior still works during voice capture.

## Phase 7 - Streaming AI Path
- [x] Add `streamVoiceAnswer(...)` to `electron/ProcessingHelper.ts`.
- [x] Reuse existing provider configuration and language lookup.
- [x] Implement OpenAI streaming with chunk callbacks.
- [x] Add non-streaming fallback for providers that are not yet wired for streaming.
- [x] Add concise voice-specific prompts for solve, explain, complexity, and debug intents.
- [x] Tune voice prompts for broad software-engineering interview scope and concise off-topic handling.
- [x] Add provider transcription vocabulary hints for software-engineering interview terms.
- [x] Send `voice:answer-start`, `voice:answer-chunk`, `voice:answer-complete`, and `voice:error` events.
- [x] Support abort through the request `AbortSignal`.

## Phase 8 - Renderer Overlay
- [x] Create `src/components/VoiceAssistant/VoiceAssistantOverlay.tsx`.
- [x] Mount the overlay from `src/App.tsx` or `src/_pages/SubscribedApp.tsx`.
- [x] Subscribe to voice start, stop, status, trigger, answer chunk, complete, and error events.
- [x] Render compact states for listening, capturing, answering, complete, and error.
- [x] Add a stop button that calls `window.electronAPI.stopVoiceMode()`.
- [x] Keep layout stable while answer text streams.
- [x] Clean up all listeners on unmount.

## Phase 9 - Settings and Polish
- [x] Add a settings toggle for enabling voice assistant mode.
- [x] Add recognition language setting.
- [x] Add configurable trigger confidence threshold if Web Speech confidence is reliable enough.
- [x] Add response style option: concise, code-first, or detailed.
- [x] Add toasts or inline errors for missing API key and unavailable microphone.

## Phase 10 - Tests and QA
- [x] Unit test intent matching.
- [x] Unit test transcript normalization for technical terms such as `GIL` and pause artifacts.
- [x] Unit test that unrelated freeform questions do not trigger answers.
- [x] Unit test debounce behavior.
- [x] Unit test controller cancellation.
- [x] Type-check preload and `window.electronAPI` additions.
- [x] Run `npm run lint`.
- [ ] Manually verify `Ctrl + I` starts and stops voice mode.
- [ ] Manually verify microphone denial produces a recoverable error.
- [ ] Manually verify a clear assistance request, such as "answer this question", triggers exactly one answer request.
- [ ] Manually verify answer chunks appear before completion for OpenAI.
- [ ] Manually verify stopping during generation prevents later chunks from rendering.

## MVP Completion Criteria
- `Ctrl + I` toggles voice mode.
- Voice overlay opens and displays live transcript.
- A clear assistance request triggers current-screen analysis.
- At least OpenAI responses stream partial text to the overlay.
- Stop/cancel reliably shuts down recognition and generation.
- Errors are visible and recoverable.
