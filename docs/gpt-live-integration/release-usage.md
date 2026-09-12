# Voice audio usage

This describes the local implementation. Live API and physical microphone acceptance remain pending; see [Phase 15 results](phase-15-results.md). The continuous GPT-Live update supersedes the earlier review-based behavior recorded in Phase 15. Physical microphone acceptance remains pending.

## Setup

1. Open Settings and enable Voice Assistant.
2. For Whisper API or GPT-Live, select the OpenAI provider and enter a valid key in Settings. These choices use the existing provider/key configuration; they do not have separate audio credentials.
3. Choose Audio Service. For Whisper or Current recognition, also choose Audio Submission and, for Automatic, Automatic Pause. Save settings. Changes apply to the next recording; disabling voice cancels immediately.

| Audio service | During recording | On submission |
| --- | --- | --- |
| Current recognition | Browser recognition first; file recording if unavailable | Browser text or the existing GPT-4o transcription model goes to the answer route |
| Whisper API | Records locally | Uploads one complete file using `whisper-1`, then answers |
| GPT-Live | Continuously streams microphone audio and displays both user and assistant captions | Answers directly in the Live session; Ctrl+7 toggles the microphone |

Existing installations retain Current recognition, their existing transcription model, and Manual mode. The compatibility transcription-model selector does not change explicit Whisper or Live routing. Current recognition's file fallback also needs OpenAI credentials. Browser recognition is browser-managed; do not assume it processes audio offline.

## Record and submit

- On Windows, press **Ctrl+I** to start voice mode. **Ctrl+7** toggles the microphone for GPT-Live and submits for Whisper or Current recognition. These shortcuts are registered as `CommandOrControl`; physical macOS/Linux behavior has not been accepted in this phase.
- For Whisper and Current recognition in **Manual**, pauses never submit. Press the submit shortcut when the question is finished.
- For Whisper and Current recognition in **Automatic**, sustained speech followed by the configured pause submits once. The default pause is 1,500 ms, adjustable from 500 to 5,000 ms. The submit shortcut also works. Silence alone does not submit. Start another recording for the next question.
- For **GPT-Live**, speak naturally and read the user/assistant conversation. **Ctrl+7** (**Cmd+7** on Mac) or the microphone button toggles microphone mute. Mute before repeating an answer aloud; press again to resume listening. Outgoing audio becomes silence immediately, while the answer and session continue. Words sent before muting can still arrive as late captions. Follow-up questions stay in the same session. Output audio is never connected to playback. There is no review step, file upload, screen capture, or request through the file-answer pipeline. Live can delegate reasoning within its own session. Manual/Automatic and pause settings do not apply.
- The square Stop button ends capture and the Live connection. Starting voice mode again creates a fresh conversation. The two-minute recording limit and four-minute file expiry apply only to file/browser recording services.

Whisper and Current recognition retain transcript normalization, screen context and streamed text answers. Their error input accepts typed prompts through that answer route. Live errors retain the conversation and ask you to start a new session; they do not fall back to Whisper or the typed-answer route.

## Recovery and limits

| Situation | Action |
| --- | --- |
| Missing key or incompatible provider | Correct the provider/key in Settings and start again. The service does not switch automatically. |
| Authentication/model access failure | Check the configured credentials and account access; retry after fixing them. |
| Microphone permission denied | Enable microphone and desktop-app access in Windows privacy settings, then retry. |
| Empty transcript | Start another recording and speak clearly, or use the typed prompt input. |
| Automatic submits too early | Increase the pause or select Manual. Microphone/noise thresholds still need device QA. |
| Live disconnect or incomplete transcript | Start a new session. Received captions remain visible until you stop or restart; there is no service fallback. |
| Duration/file-size/timeout error | Record a shorter question and retry. File/browser capture is capped at two minutes and complete file audio at 20 MiB. |

File transcription has a 45-second main-process deadline. A four-minute file/browser recording expiry is an additional cleanup guard, not extra capture time. Timings and RMS thresholds are implementation settings, not measured response-latency guarantees.

## Local Windows QA build

Run `npm run qa:voice:package` from the repository root. It builds an unsigned Windows x64 directory at `release/voice-qa/win-unpacked`, with executable `Interview Coder.exe`. The QA configuration omits `.env` resources and publishing, and uses the installed Electron runtime on Windows x64. Enter credentials through Settings after launching. It uses the application's normal settings profile; record your settings before changing them for QA.

This directory build does not certify NSIS installation, signing, shortcuts, microphone access, or other platforms. Follow the [manual QA protocol](manual-qa.md) and attach measured results before release acceptance.

## Continuous Live verification

The production adapter consumes both `session.input_transcript.delta` and `session.output_transcript.delta`, following the [Live session guide](https://developers.openai.com/api/docs/guides/live-conversations). Caption timing is used only for display grouping, never to trigger the file-answer pipeline. The session uses the Gleam voice to match the reference playground, with playback disconnected locally. Live uses managed Responses delegation with `gpt-5.6-luna` for reasoning. No external tools are configured; this backend belongs to the Live session and does not use Whisper or the file-answer pipeline.

Automated regression covers both saved submission modes, continuous operation beyond file recording limits, both speakers, late/duplicate captions, stopping and disconnect cleanup, and unchanged file-provider routing. Real microphone quality, provider latency, and interactive desktop acceptance are not established by these tests. Restart the app using the new build before testing; previously packaged executables are not updated by `npm run build`.

### Live response pacing

The Live prompt requests a brisk, clear pace and answers without introductory acknowledgments or repeating the question. This follows the [prompting guide's pace controls](https://developers.openai.com/api/docs/guides/live-prompting). Captions still display immediately on arrival, without a typing animation or a batching delay. This is a prompt adjustment, not a measured server-throughput increase; provider/network latency and real microphone shortcut behavior still require device testing. Spoken output remains muted.

### Technical vocabulary and stalled answers

The Live and reasoning prompts now include software-engineering vocabulary such as FastAPI and Flask, and request a short clarification when a key name is ambiguous. Provider captions remain unmodified: the UI does not substitute guessed words to make recognition appear correct.

The previous client-delegation handler returned only a "no backend" message when Live requested help. It has been replaced with [managed Responses delegation](https://developers.openai.com/api/docs/guides/live-delegation), which returns actual reasoning results to Live. Backend failures are surfaced in the UI rather than silently ignored. This requires access to `gpt-5.6-luna` as well as `gpt-live-1` and uses additional model tokens when Live delegates.

Regression uses synthetic events to check managed delegation, caption preservation, failures, mute, and isolation from file transcription. It does not establish acoustic recognition or model answer quality. Retest "What is the difference between FastAPI and Flask?" in a fresh session; verify an actual comparison or a relevant clarification, then try a different framework pair and confirm Ctrl+7 still mutes speech without stopping the answer.

### Written code examples

Ask for a programming example, code, an implementation, or say "write it down" while discussing a topic. Live is instructed to delegate that request to its reasoning model. The model's `response.output_text.delta` events now stream directly into a separate **Written answer** area, with fenced code blocks preserving indentation and a Copy button. Live's spoken summary remains in the conversation captions and output audio remains muted. Ctrl+7 can mute your microphone while the code continues streaming.

Backend text is keyed by delegation, output item and content part; duplicate events are ignored, sequence order is retained, final text is reconciled, and an empty `response.completed` output snapshot does not erase streamed code. Cancellation preserves partial text marked Incomplete. Only output text is displayed; reasoning events and tool arguments are excluded. Code is displayed as inert text, not executed.

Automated checks cover streaming code while muted, late events after disposal, preserved whitespace, multiple answers, incomplete output and final-text reconciliation. Live generation and interactive clipboard behavior require a real session test. Suggested acceptance: discuss shallow versus deep copy, then say "Write a Python example of that" and check that the panel shows actual code rather than only a verbal analogy.

### Reading streamed responses

Conversation and Written answers now have independent scroll areas. Arriving code never switches views or scrolls the spoken conversation. A visible status shows whether written output is generating or ready; the Written answers button shows new output. Show answer and Latest answer (start) jump to the beginning of the newest answer once. Subsequent text and completion events preserve the reading position.

Conversation follows the beginning of new replies, not the bottom on each fragment. Scrolling, selecting text, or keyboard navigation pauses following; Latest reply (start) resumes it. Both views stay mounted to retain scroll positions when switching. The generation status and navigation controls remain outside the scroll area.

Interactive browser verification of this update was unavailable because the browser tool rejected its connection metadata. Manually verify a long reply while code arrives, switch to Written answers, read midway while more code streams, and use Show answer / Latest answer to find new output without being pushed to its end.

### Reading a response while other output streams

Written answers now displays one selected answer at a time. Choose an answer using the Reading selector; its scroll position is retained when switching answers or views. Incoming answers never replace the selection. Browser scroll anchoring is disabled in this viewport so appending code does not pull the reader to the end.

Show generating answer targets the newest still-streaming answer (which may not be the last answer in the list) and opens its beginning once. When none is streaming, Show latest answer opens the newest answer. Back to start returns to the beginning of the currently selected answer. These controls and the generating/ready status remain outside the scrollable text.

Type checking and lint passed. Interactive verification was attempted again but the browser connection failed before opening a tab (missing sandboxPolicy metadata). Manual checks: open a long answer, scroll midway, stream additional code and a second answer, verify the selection/position stay fixed, switch answers and return, then use Show generating answer and Back to start.
