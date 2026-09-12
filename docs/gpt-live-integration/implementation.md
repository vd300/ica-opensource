# GPT-Live implementation specification

Status: production integration design; the isolated Phase 11 prototype is now implemented. See [plan](plan.md), [phases](phases.md), and [Phase 11 results](phase-11-results.md) for verified scope and remaining live checks.

## Configuration contract

Proposed additions:

```ts
type VoiceAudioService = "legacy" | "whisper" | "gpt-live";
type VoiceSubmissionMode = "manual" | "automatic";

interface VoiceAudioSettings {
  voiceAudioService: VoiceAudioService; // default: legacy
  voiceSubmissionMode: VoiceSubmissionMode; // default: manual
  voiceAutoSubmitSilenceMs: number; // default: 1500
}
```

Sanitize unknown enum values to compatibility defaults. Require a finite pause value, clamp to 500–5,000 ms, and use 1,500 ms for invalid input. Enforce this on both load and update. Preserve `voiceTranscriptionModel` and all unrelated settings. Explicit Whisper uses `whisper-1` regardless of the retained legacy transcription setting. Explicit Live uses `gpt-live-1` in its own session configuration.

Capture settings at recording start. Saving settings during recording affects the next recording. Disabling voice mode still cancels immediately.

## File map

| File | Planned change |
| --- | --- |
| `electron/ConfigHelper.ts` | Defaults, validation, update notifications |
| `src/components/Settings/SettingsDialog.tsx` | Service/submission/pause controls and persisted values |
| `src/types/electron.d.ts` | Config and preload contracts |
| `src/types/voice.ts` | Service, recording identity, submission reason and adapter events |
| `src/components/VoiceAssistant/useSpeechRecognition.ts` | Route explicit services; retain legacy route; coordinate capture cleanup |
| New renderer audio adapter and speech detector modules | Capture, transport boundary, speech/silence observation |
| New `electron/LiveVoiceService.ts` | Trusted Live session creation, lifecycle and protocol validation |
| `electron/ProcessingHelper.ts` | Explicit Whisper transcription route; retain existing answer generation |
| `electron/voiceIpc.ts`, `electron/preload.ts`, `electron/ipcHandlers.ts` | Narrow Live lifecycle operations and validated recording identities |
| `electron/VoiceAssistantController.ts` | Exactly-once submission and stale-event rejection |
| `src/components/VoiceAssistant/VoiceAssistantOverlay.tsx` | Service/mode indication and submitting status |
| `electron/main.ts` | Adapter ownership and shutdown cleanup |
| `electron/tests/`, `package.json` | New regression coverage and test discovery |

## Adapter boundary

Define application methods `start`, `submit`, and `cancel`, with callbacks for transcript updates, capture state, and errors. These are application interfaces, not assumed OpenAI API method names. Every callback includes an application-generated recording ID. Allocate a turn ID when submission is claimed.

Main owns credentials and accepts only the intended renderer's narrow operations. Validate active recording identity, payload shape, allowed MIME types, decoded byte limits, sequence numbers, and lifecycle state before processing. Never expose arbitrary provider URLs or general authenticated request forwarding.

## Whisper path

Use the existing MediaRecorder capture and main-process `/audio/transcriptions` architecture with the explicit `whisper-1` model. Whisper supports file transcription. [Model reference](https://developers.openai.com/api/docs/models/whisper-1).

On submit, stop the recorder, await its final data event, assemble one complete file, and upload once. Do not treat arbitrary recorder slices as independently decodable files. Retain language conversion and technical vocabulary hints. Add an AbortSignal and stale-result checks around transcription. Choose a conservative application byte limit below the verified provider upload limit and stop with an actionable error if exceeded; never upload truncated bytes as a complete recording.

## Live path

Prefer WebRTC microphone transport for the renderer, with trusted session setup in main. Session readiness is explicit; begin the active recording only when the session is ready. OpenAI documents WebRTC media tracks and a JSON event channel, plus separately controlled backend work. [Getting started](https://developers.openai.com/api/docs/guides/live).

Use `session.input_transcript.delta` for input captions. Preserve raw fragments, spaces, and timeline intervals; normalize only the assembled submitted question. The API provides no authoritative completed-input-turn event. Missing transcript events cannot establish silence. [Session documentation](https://developers.openai.com/api/docs/guides/live-conversations).

Do not send Realtime `input_audio_buffer.commit` or use `response.create` as a Live speech trigger. Live conversation behavior runs independently of the app's submission setting. [Migration documentation](https://developers.openai.com/api/docs/guides/live-migration).

The adapter must not invoke the screenshot/answer pipeline from a provider delegation or transcript event alone. Keep the application's submission coordinator authoritative. Do not attach remote output audio to playback. Validate any required delegation setup in Phase 11; retain the existing answer provider through application-owned execution.

At submission, stop new microphone capture and keep the connection available long enough to process already transmitted audio. Phase 11 must establish a bounded, tested drain strategy, including delayed final fragments. If completeness cannot be established, show a recoverable incomplete-transcript state with text review/retry; do not claim lossless submission or silently substitute another model. Closing the transport immediately after the shortcut is insufficient.

## Submission coordinator

Use `idle -> starting -> recording -> submitting -> answering -> complete`, with error/cancel exits. Main is authoritative for accepting a submission. An atomic state transition from recording to submitting prevents shortcut/silence races. Subsequent requests for that recording return an already-submitting result.

Manual mode accepts only explicit submit. Automatic mode uses local microphone activity detection, a minimum sustained speech interval (proposed 250 ms), and the configured continuous silence interval. Treat thresholds as application tuning values requiring microphone QA. Reset the silence timer when speech resumes. Do not derive acoustic silence from Web Speech final results, empty text, network inactivity, or Live deltas.

After the first accepted submission, stop detection and capture, await adapter finalization, reject an empty or punctuation-only result, and send exactly one assembled question through the existing `submittedPrompt` route. This preserves short prompts without trigger words. Capture the screen once when the accepted transcript is ready, then stream the existing answer. Automatic mode does not restart capture after the answer.

Set a proposed two-minute recording cap and bounded submission timeout. On cap, stop capture and show a review/retry message; manual mode must never auto-submit because a duration limit elapsed. Tune and publish final limits during QA.

## Cancellation and recovery

Stop, reset, new recording, renderer reload, and app shutdown invalidate the recording ID before releasing resources. Abort transcription and answer requests, clear timers, stop media tracks, disconnect audio nodes, close AudioContext/RTC/data channels and provider sessions, and delete temporary screenshots. Ignore all late results with stale recording or request IDs.

Live connection loss ends the recording with a visible retry action. Do not replay buffered audio or switch services automatically. Preserve display text for review without submitting it. Missing OpenAI credentials or incompatible providers fail before opening the microphone for the new API routes.

## Required tests

- Config migration retains existing browser-first behavior and both existing GPT-4o transcription models.
- Service selection invokes exactly the requested adapter.
- Manual long silence produces no submission; automatic silence without speech produces none.
- Speech resumes before the pause threshold and cancels pending automatic submission.
- Simultaneous shortcut/timer, duplicate events, and repeated submit produce one upload/screenshot/answer.
- Final recorder bytes and delayed Live transcript fragments are included before accepted submission.
- Stop during permission request, connection setup, transcription, screenshot, and answer streaming rejects late work.
- API errors, invalid payloads, duration/size limits, and disconnects release all resources.
- All six service/mode combinations pass microphone QA; existing typed prompts and screenshot workflows regress cleanly.

The baseline `npm test` command explicitly ran one controller test file. Phase 11 expands it to include the new probe tests. The production audio path and OpenAI SDK dependency remain unchanged.
