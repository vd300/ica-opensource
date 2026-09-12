# GPT-Live integration plan

Status: Phase 11 prototype implemented locally; live verification is pending authentication. Phase 12 settings and migration are implemented; see [Phase 12 results](phase-12-results.md). Phases 13 and 14 are implemented locally; Phase 15 automated checks pass, while live and packaged acceptance remain pending. See [regression audit](regression-audit.md). Baseline verified against repository commit `79ba6ef7181c738eaf10a1e90f2da3a51897685e` on 2026-09-12. See [Phase 11 results](phase-11-results.md).

This is an additive extension to the [original voice plan](../voice-interview-feature/plan.md). Read the [phase checklist](phases.md), [implementation specification](implementation.md), and [verification record](verification.md) together. Existing plans, completed tasks, and QA records remain unchanged.

Phase 15 now includes expanded automated regression, Windows QA packaging tooling, [release usage](release-usage.md), and a [manual QA protocol](manual-qa.md). See [Phase 15 results](phase-15-results.md) for current evidence and remaining acceptance gates.

## Requirements

1. Settings offers Whisper API and GPT-Live (`gpt-live-1`) as explicit audio choices.
2. A separate setting selects manual submission or automatic submission after speech ends.
3. Existing installations retain their current recognition route, transcription model, and manual behavior until the user chooses otherwise.
4. Preserve transcript normalization, software-engineering scope, SQL guidance, screenshot context, answer streaming, typed prompts, and stop/reset behavior.

## Verified baseline

The current hook prefers browser SpeechRecognition. If unavailable, it records with MediaRecorder and sends a completed recording to the main process. API transcription currently selects `gpt-4o-transcribe` or `gpt-4o-mini-transcribe`, not `whisper-1`. It requires the OpenAI provider. `CommandOrControl+I` starts recording; `CommandOrControl+7` submits it.

## Settings and compatibility

| Setting | Choices | Migration/default |
| --- | --- | --- |
| Audio service | Current recognition, Whisper API, GPT-Live | Current recognition preserves browser-first routing and existing API fallback |
| Audio submission | Manual, Automatic | Manual |
| Automatic pause | Proposed 1,500 ms; adjustable 500–5,000 ms | Only active for Automatic |

The compatibility choice prevents silently replacing existing GPT-4o transcription selections with Whisper. Explicit Whisper and GPT-Live choices bypass browser recognition. Keep the existing transcription-model selector for the compatibility route.

For the first implementation, explicit OpenAI audio services require the existing OpenAI provider and key. Show an explanatory settings error for incompatible providers without changing the answer provider or erasing saved choices. Independent audio credentials can be a later extension.

## Submission behavior

| Service | Manual | Automatic |
| --- | --- | --- |
| Whisper API | Record locally; upload once on submit | Detect speech and trailing silence locally; upload one complete recording |
| GPT-Live | Stream microphone audio; submit accumulated transcript to the answer pipeline on shortcut | Stream microphone audio; local speech detection determines when to submit accumulated transcript |
| Current recognition | Preserve current shortcut workflow | Apply the same local speech-boundary policy to browser recognition or the API fallback |

Automatic mode handles one question per recording: submit once, stop microphone capture, and show the answer. The user starts another recording with the existing shortcut. Manual submit remains usable in automatic mode. Stop cancels rather than submits. Silence without speech produces no request. A short pause does not submit. Show the selected service and submission mode in the overlay.

“Submission” means sending the question into screen capture and answer generation. GPT-Live sends audio during recording even in manual mode; make this distinction visible in settings. The proposed integration keeps answer output in the existing text panel and does not play Live output audio.

## API constraints

`gpt-live-1` is a Live conversation model, not a file-transcription replacement. Use a separate adapter. [OpenAI model documentation](https://developers.openai.com/api/docs/models/gpt-live-1).

Live streams continuously and does not use Realtime manual commits to start spoken turns. The application must enforce its own answer-submission gate. [Migration guide](https://developers.openai.com/api/docs/guides/live-migration).

Input transcript deltas are not authoritative completed turns. Verify transcript draining around submission before shipping either Live mode. [Session guide](https://developers.openai.com/api/docs/guides/live-conversations).

## Acceptance criteria

- Both requested services and both submission modes persist across restart.
- Existing settings load without changing their previous behavior.
- Each service/mode combination produces one screenshot and one answer per submitted question.
- Manual mode never starts the answer pipeline on a pause or provider event alone.
- Automatic mode requires detected speech followed by the configured pause.
- Simultaneous shortcut and silence events cannot submit twice.
- Stop, restart, reset, renderer teardown, and disconnect invalidate stale events and release resources.
- Missing keys, unavailable models, permission denial, and network failures produce recoverable errors without silent service switching.
- Live transcript completeness and packaged microphone behavior are verified before declaring implementation complete.
