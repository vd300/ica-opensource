# Voice Interview Assistant - Implementation Design

## Summary
Implement a voice mode as a small feature slice across Electron main, preload, and React renderer. Recording is started with a global shortcut and submitted with a separate shortcut, then the app detects interview intents in the main process, captures the current screen with the existing screenshot helper, and streams a compact answer back to an overlay.

The implementation should not reuse the current two-step extraction-then-solution path as-is for voice. That path is high quality, but it waits for a complete extraction result before producing a complete solution. Voice mode needs a fast path that starts emitting text as soon as the model returns chunks.

## Phase 0 Constraints
- The feature is for interview practice or live assistance only when the user is permitted to use such assistance.
- Do not store raw interview audio by default.
- Do not bypass microphone, screen capture, operating-system, interview, employer, classroom, or platform permissions.
- Register `CommandOrControl+I` to start recording and `CommandOrControl+7` to submit/stop recording for the MVP. Electron accelerators do not reliably distinguish physical left control, so true `Left Ctrl` support requires a later native keyboard hook.
- Keep voice-triggered screenshots temporary and out of the normal screenshot queue by default.

## Existing Integration Points
- `electron/shortcuts.ts`: owns global shortcut registration through Electron `globalShortcut`.
- `electron/main.ts`: owns singleton helper lifecycle and dependency interfaces.
- `electron/ipcHandlers.ts`: owns `ipcMain.handle` channels for renderer commands.
- `electron/preload.ts`: exposes the renderer-safe Electron API through `contextBridge`.
- `electron/ScreenshotHelper.ts`: captures screenshots and stores queues.
- `electron/ProcessingHelper.ts`: initializes OpenAI, Gemini, and Anthropic clients and contains screenshot processing logic.
- `src/App.tsx`: initializes app state and can mount a global overlay.
- `src/types/electron.d.ts`: describes `window.electronAPI`.

## Proposed Files
Add:
- `electron/VoiceAssistantController.ts`
- `src/components/VoiceAssistant/VoiceAssistantOverlay.tsx`
- `src/components/VoiceAssistant/useSpeechRecognition.ts`
- `src/types/voice.ts`

Modify:
- `electron/main.ts`
- `electron/shortcuts.ts`
- `electron/ipcHandlers.ts`
- `electron/preload.ts`
- `electron/ProcessingHelper.ts`
- `src/App.tsx` or `src/_pages/SubscribedApp.tsx`
- `src/types/electron.d.ts`

## Main Process Design
### VoiceAssistantController
Create a controller that owns the session state:

```ts
type VoiceModeStatus = "idle" | "listening" | "capturing" | "answering" | "error";

interface VoiceSessionState {
  enabled: boolean;
  status: VoiceModeStatus;
  lastTranscript: string;
  activeIntent: VoiceIntent | null;
  requestId: string | null;
  lastTriggeredAt: number;
}
```

Responsibilities:
- Start voice recording.
- Request recording submission.
- Send start/submit/stop events to the renderer.
- Receive transcript segments.
- Detect stable trigger intent.
- Debounce duplicate triggers.
- Request a temporary screenshot.
- Start and cancel streaming answer generation.
- Forward answer chunks, completion, and errors.

### Shortcut Registration
Add `CommandOrControl+I` in `electron/shortcuts.ts` and delegate to `deps.startVoiceMode()`. Add `CommandOrControl+7` and delegate to `deps.submitVoiceRecording()`.

Electron accelerators do not reliably distinguish left vs right control. If physical `Left Ctrl` is a hard requirement, add a native keyboard hook later. For the first implementation, document the fallback and use `CommandOrControl+I` to match the existing shortcut style.

### Dependency Injection
Extend `IShortcutsHelperDeps` in `electron/main.ts`:

```ts
startVoiceMode: () => void
submitVoiceRecording: () => void
```

Add `voiceAssistantController` to application state and initialize it after `ProcessingHelper` and `ScreenshotHelper`.

## IPC Contract
Use namespaced events to avoid collisions.

Renderer invokes:
- `voice:transcript-segment`
- `voice:stop`
- `voice:renderer-ready`
- `voice:recognition-error`

Main sends:
- `voice:mode-started`
- `voice:mode-stopped`
- `voice:submit-recording`
- `voice:status`
- `voice:interim-transcript`
- `voice:final-transcript`
- `voice:trigger-detected`
- `voice:answer-start`
- `voice:answer-chunk`
- `voice:answer-complete`
- `voice:error`

Payload examples:

```ts
interface VoiceTranscriptSegment {
  text: string;
  isFinal: boolean;
  confidence?: number;
  receivedAt: number;
}

interface VoiceAnswerChunk {
  requestId: string;
  text: string;
}

interface VoiceError {
  code:
    | "speech_unavailable"
    | "microphone_denied"
    | "api_key_missing"
    | "screen_capture_failed"
    | "generation_failed"
    | "cancelled";
  message: string;
  recoverable: boolean;
}
```

## Renderer Speech Recognition
Implement `useSpeechRecognition` around `window.SpeechRecognition || window.webkitSpeechRecognition`.

Behavior:
- Start recognition when `voice:mode-started` arrives.
- Stop recognition when `voice:mode-stopped` arrives or the overlay stop button is clicked.
- Use continuous recognition and interim results when supported.
- Buffer final segments locally during recording.
- Send interim text to overlay state directly for immediate visual feedback.
- When `voice:submit-recording` arrives, submit the accumulated final transcript plus the latest interim transcript to main, then stop microphone capture.
- In provider transcription fallback mode, record audio continuously until `voice:submit-recording`; do not auto-stop or transcribe on fixed time slices.
- Surface permission and availability errors through `voice:recognition-error`.

If Web Speech API is unavailable, show a clear overlay error and leave the feature in a stopped state. A provider transcription fallback can be implemented in a later phase.

## Intent Detection
Keep the first version deterministic and fast. Add a small phrase matcher in the controller:

```ts
const INTENT_PATTERNS = [
  { intent: "solve", patterns: [/solve this/i, /write (the )?solution/i] },
  { intent: "explain", patterns: [/explain this/i, /walk me through/i] },
  { intent: "complexity", patterns: [/time complexity/i, /space complexity/i] },
  { intent: "debug", patterns: [/what('s| is) wrong/i, /fix this/i, /why .* failing/i] }
];
```

Trigger rules:
- Only trigger on the explicit submitted final transcript.
- Ignore low-confidence segments when confidence is available.
- Debounce for 4-6 seconds after a trigger.
- Do not start a second request while one is already active unless the user explicitly cancels.
- Normalize common software-engineering terms before matching, for example `JIL`, `GIM`, and `gill` should become `GIL` for Python questions, and pause artifacts such as `to... to` should collapse to one word.
- Trigger explicit questions and assistance requests without requiring an exhaustive software-engineering vocabulary match. Screen-referential commands such as "solve this" can still trigger because the screen image supplies the coding context.
- Let the model perform the semantic software-engineering scope check and briefly decline clearly unrelated questions instead of silently ignoring them in the controller.
- Treat behavioral or experience-style prompts as in scope when they include engineering work, for example data migration, offloading/uploading data, production systems, servers, services, reliability, or scaling.
- Leave clearly unrelated questions transcript-only and do not send them to the model.

### Interview Domain Tuning
The main-process transcript normalization should run before the transcript is stored, emitted as final text, matched for intent, debounced, or sent to `ProcessingHelper`.

The initial vocabulary should focus on interview-heavy software engineering terms:
- languages and frameworks: `GIL`, `Global Interpreter Lock`, `asyncio`, `Django`, `Flask`, `FastAPI`, `JavaScript`, `TypeScript`, `React`, `Node.js`
- APIs and data: `REST API`, `SQL`, `Postgres`, `Redis`
- distributed systems and platforms: `Kafka`, message queues, event streaming, `Docker`, `Kubernetes`
- interview concepts: data structures, algorithms, complexity, debugging, system design, scalability, services, data migration, production systems

Keep correction hints deterministic and easy to extend. Do not use this list as a hard allowlist for all possible software-engineering topics.

## Screen Context Capture
Use the existing `takeScreenshot()` dependency from `main.ts`. For voice mode, prefer a temporary screenshot path that is not pushed into the normal screenshot queue.

Recommended refactor:
- Add `captureTemporaryScreenshot()` to `ScreenshotHelper`.
- Reuse the existing hide-window, capture, show-window flow.
- Store temporary screenshots in the existing temp screenshot directory.
- Delete temporary screenshots after the request completes or is cancelled.

If that refactor is too large for MVP, use `takeScreenshot()` and immediately remove the path from the queue after loading the base64 image.

## AI Generation
Add a voice-specific public method to `ProcessingHelper`:

```ts
public async streamVoiceAnswer(params: {
  requestId: string;
  intent: VoiceIntent;
  transcript: string;
  screenshotBase64: string;
  onChunk: (text: string) => void;
  onComplete: () => void;
  signal: AbortSignal;
}): Promise<void>
```

Prompt strategy:
- One call, not extraction plus solution.
- Include the image and transcript.
- Ask for answer-first formatting.
- Ask for concise output unless the intent requires detail.
- Use the configured language from `getLanguage()`.
- Tell the model to answer software-engineering interview topics broadly, answer ambiguous prompts when they could plausibly be technical interview questions, and briefly decline clearly unrelated questions.
- Tell the model to interpret near-match speech recognition terms as technical vocabulary when the surrounding context supports it, such as `JIL` or `GIM` in Python meaning `GIL`.

Prompt sketch:

```text
You are helping with an interview practice prompt. Use the screen image and the interviewer transcript.
Intent: solve
Preferred language: python
Transcript: "solve this"

Scope: answer software-engineering interview topics across coding, backend, frontend, infrastructure, distributed systems, data systems, debugging, complexity, and system design.

Behavioral engineering prompts such as "have you ever uploaded data to another server" are in scope.

Respond immediately with the most useful answer first. For coding problems:
1. Give the approach in 1-2 lines.
2. Provide code.
3. Add time and space complexity.
Keep the response concise and stream-friendly.
```

### Provider Streaming
OpenAI:
- Use `chat.completions.create({ stream: true })` and iterate chunks.

Anthropic:
- Use the SDK streaming API if available in the installed version, otherwise fall back to non-streaming with a visible "generating" state.

Gemini:
- Use `streamGenerateContent` if the project switches to the Google SDK.
- With the current axios REST implementation, MVP can fall back to non-streaming and still use the voice overlay.

The UI should treat streaming as best effort. Providers without streaming still return `voice:answer-start` and `voice:answer-complete`, but no chunk events until the final text is available.

## Renderer Overlay
Mount a global overlay after app initialization. It should subscribe to voice events from `window.electronAPI`.

State:
- `isOpen`
- `status`
- `interimTranscript`
- `finalTranscript`
- `answer`
- `error`

UI:
- Listening indicator.
- Latest transcript.
- Answer panel with streaming text.
- Stop button.
- Error message area.

Do not add a large landing-style explanation. This is an operational overlay, so keep it compact.

## Cancellation
Use one `AbortController` per voice answer request in `VoiceAssistantController`.

Cancel when:
- user stops voice mode,
- user clicks stop,
- app reset is triggered,
- renderer reports microphone failure,
- a new request supersedes the old request.

On cancellation:
- abort generation,
- stop recognition,
- delete temporary screenshot,
- send `voice:mode-stopped` and a recoverable cancellation status.

## Testing Strategy
Unit-level:
- Intent matcher detects supported phrases.
- Intent matcher ignores unrelated transcripts.
- Debounce prevents duplicate requests.
- Controller cancels active request on stop.

Integration-level:
- Shortcuts send start and submit events.
- Preload exposes voice methods and listeners.
- Overlay renders each status and cleans listeners on unmount.

Manual QA:
- Start app and press `Ctrl + I`.
- Speak a pause-heavy question, press `Ctrl + 7`, and verify the full accumulated transcript is submitted.
- Deny microphone permission and verify visible error.
- Say "solve this" over a visible coding problem and verify exactly one request starts.
- Confirm answer text appears progressively for OpenAI streaming.
- Stop mode while generation is active and verify no further chunks render.

## Rollout Plan
1. Land the controller, IPC contract, preload types, and overlay with mocked transcript events.
2. Add real speech recognition in the renderer.
3. Add temporary screenshot capture.
4. Add OpenAI streaming answer path.
5. Add provider fallbacks for Gemini and Anthropic.
6. Add settings and polish after the core flow is stable.
