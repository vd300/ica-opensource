# Voice Interview Assistant - Product Plan

## Purpose
Add an opt-in voice interview assistant mode that can be started with `Left Ctrl + I` during an interview practice session or a permitted live-assistance session. Once active, the app listens to interviewer speech, detects action-oriented prompts such as "solve this", captures the current screen context, and starts showing a generated answer as quickly as possible.

The primary product requirement is low time-to-first-answer. The UI should display useful partial output as soon as the model starts responding instead of waiting for the complete solution payload.

## User Problem
Today the app is screenshot-first:
- the user captures problem screenshots manually,
- then starts processing with a separate shortcut,
- then waits for the full extraction and solution flow.

For voice-led interviews, the user may hear prompts like "solve this", "explain your approach", or "what is the complexity". The app needs a faster interactive mode that combines live speech recognition, current screen analysis, and streaming answer display.

## Goals
- Register `Left Ctrl + I` as the voice mode toggle on Windows/Linux, with the closest reliable Electron accelerator fallback when physical left/right modifier detection is unavailable.
- Start and stop a voice assistant session from a global shortcut.
- Capture interviewer speech with interim and final transcript updates.
- Normalize common software-engineering speech-recognition errors before intent detection, including language, backend, distributed-systems, and data-system vocabulary such as `GIL`, `Kafka`, and `REST API`.
- Detect trigger phrases such as "solve this" and infer related intents like explanation, debugging, or complexity discussion.
- Restrict freeform voice answers to software engineering interview topics without narrowing the feature to one language or backend-only development. Behavioral experience questions are in scope when they are about engineering work.
- Do not maintain an exhaustive software-engineering vocabulary allowlist for triggering. Explicit questions and assistance requests should reach the answer layer, where the model performs the semantic scope check and briefly declines clearly non-engineering topics.
- Capture fresh screen context automatically when a trigger fires.
- Generate an answer from the transcript plus screen image.
- Stream answer chunks to the renderer so the first useful text appears quickly.
- Keep the feature compatible with the existing Electron, React, TypeScript, screenshot, and AI-provider architecture.

## Non-Goals
- Do not build a full meeting bot or calendar-integrated assistant.
- Do not store interview audio by default.
- Do not implement offline transcription in the first release.
- Do not add complex conversation memory beyond the active voice session.
- Do not bypass microphone or operating-system permissions.
- Do not position the feature as a way to violate interview rules; users should only use it for practice or with permission.

## Phase 0 Decisions
- Safety framing: the feature is documented as an opt-in practice or permitted-assistance workflow and must follow the repository ethical-use guidance in `README.md`.
- Shortcut: use `CommandOrControl+I` for the MVP because Electron global accelerators do not reliably distinguish physical left control from right control.
- Screen context: keep voice-triggered screenshots temporary by default and delete them after the voice request completes, is cancelled, or errors.

## Primary Flow
1. User presses `Left Ctrl + I`.
2. Main process toggles voice mode and sends `voice:mode-started` to the renderer.
3. Renderer opens a compact voice overlay and requests microphone access.
4. Speech recognition begins and streams interim transcript text.
5. Final transcript fragments are buffered briefly so pause-heavy speech is merged before being sent to the main process.
6. Main process detects intent, for example "solve this".
7. Main process takes a fresh screenshot using the existing screenshot helper path.
8. Voice answer generation starts with a compact prompt containing:
   - detected user intent,
   - latest transcript segment,
   - preferred programming language,
   - current screen image.
9. First model chunks are sent to the renderer immediately.
10. Renderer updates the same answer panel progressively until `voice:answer-complete`.
11. User stops voice mode with `Left Ctrl + I`, a stop button, or reset.

## UX Requirements
- The overlay must be compact and readable at the app's current opacity and size.
- The first visible state should make it clear whether the app is listening, thinking, answering, or blocked by a permission/API error.
- Interim transcript text should be visible but visually secondary.
- Final transcript handling should tolerate natural pauses and filler words without truncating the question before the user finishes.
- Streaming answer text should not cause layout jumps that resize the Electron window aggressively.
- The stop action should be available in the overlay and through the same shortcut.
- The overlay should not hide existing solution content; it can sit above the current page with a constrained max height.

## Intent Coverage
The first release should support these intents:
- `solve`: "solve this", "can you solve this", "write the solution"
- `explain`: "explain this", "walk me through it", "what is the approach"
- `complexity`: "what is the time complexity", "space complexity"
- `debug`: "what is wrong", "fix this", "why is it failing"

Unknown non-question speech should remain transcript-only and should not trigger an AI request. Explicit questions and assistance requests should trigger even when they use an unseen technical term. For example, "what is GIL in Python" should trigger even if speech recognition returns "JIL" or "GIM", "how does Kafka work" and "explain rate limiting" should trigger as distributed-systems/API reliability questions, and "have you ever uploaded data to another server" should trigger as a behavioral engineering interview question. Clearly unrelated questions may still trigger the answer layer so the model can provide a short software-engineering-scope decline instead of silently ignoring the user.

## Software Engineering Tuning
Apply deterministic transcript normalization in the main process before confidence checks, intent detection, debounce comparison, and answer generation.

Initial correction examples:
- `JIL`, `GIM`, `gill`, or spoken letter forms near Python context -> `GIL`
- pause punctuation and immediate repeated words such as `to... to` -> `to`
- `sequel` -> `SQL`
- `rest api` -> `REST API`
- `fast api` -> `FastAPI`
- `node js` -> `Node.js`
- `type script` -> `TypeScript`

The model prompt should reinforce the same scope: answer software engineering interview topics across coding, backend, frontend, infrastructure, distributed systems, data systems, debugging, complexity, and system design, answer ambiguous prompts when they could plausibly be technical interview questions, and briefly decline clearly unrelated requests.

Behavioral or experience-style prompts should not be declined when they involve engineering work such as data migration, offloading/uploading data, deployment, production systems, servers, services, reliability, or scaling.

## Latency Strategy
The feature should optimize for time-to-first-token:
- Start screen capture as soon as a trigger is stable.
- Use a single vision call where possible instead of a separate extraction call followed by a solution call.
- Ask the model to answer first, then provide reasoning.
- Stream provider responses where SDK support exists.
- Use shorter max tokens for the voice path than the full screenshot workflow.
- Cancel stale voice requests when the user stops mode or a newer trigger replaces the previous one.

## Architecture Fit
Use the existing project boundaries:
- `electron/shortcuts.ts`: register the voice hotkey and delegate to a voice controller.
- `electron/main.ts`: own voice controller lifecycle and dependency injection.
- `electron/ipcHandlers.ts`: add renderer-to-main handlers for transcript, stop, and permission/error state.
- `electron/preload.ts`: expose a safe `voice` API to the renderer.
- `electron/ScreenshotHelper.ts`: reuse current screenshot capture behavior.
- `electron/ProcessingHelper.ts`: add a voice-specific streaming generation method.
- `src/App.tsx` or `src/_pages/SubscribedApp.tsx`: mount the voice overlay once the app is initialized.
- `src/types/electron.d.ts`: add voice API and event types.

## Dependencies
Preferred MVP path:
- Browser Web Speech API for speech recognition when available in Electron's Chromium runtime.
- Existing OpenAI/Gemini/Anthropic client configuration for AI calls.

Fallback path:
- Add a provider-backed transcription service, such as Whisper-compatible API integration, if the Web Speech API is unavailable or unreliable in packaged Electron.

## Configuration
Add settings only when the MVP path is stable:
- Enable voice assistant mode.
- Recognition language.
- Trigger confidence threshold.
- Auto-capture on trigger.
- Preferred response style: concise, detailed, or code-first.

## Acceptance Criteria
- Pressing `Left Ctrl + I` toggles voice mode without breaking existing shortcuts.
- The overlay shows listening state and transcript updates.
- A phrase like "solve this" triggers one request, not repeated duplicate requests.
- A phrase like "what is JIL in Python" is normalized and answered as "what is GIL in Python".
- A clearly unrelated freeform question does not trigger an answer request.
- The feature captures a fresh screen image automatically.
- The first answer chunk appears before the full answer is complete for providers that support streaming.
- Stop/cancel ends microphone listening and aborts in-flight model requests.
- Permission denial, missing API key, unavailable speech recognition, and model errors produce visible recoverable states.

## Open Questions
- Does packaged Electron in this project support Web Speech API consistently on all target platforms?
- Should voice-generated answers reuse the current `solutions` view data shape, or render in a separate transient overlay only?
