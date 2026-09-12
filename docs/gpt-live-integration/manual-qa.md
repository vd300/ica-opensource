# Phase 15 manual QA protocol

Record actual observations in [Phase 15 results](phase-15-results.md). A mocked test, successful build, or model lookup is not a microphone result. Use synthetic code/screens and questions for repeatable trials.

## Preconditions and evidence

- Record date, tester, working-tree revision, package hash, Windows version, Electron version, microphone/device, recognition language, pause, answer model and network conditions. Do not record keys.
- Run the four automated checks in [phases](phases.md), then `npm run qa:voice:package`. Launch the executable directly with no development server running. Test the NSIS installation separately before calling installer QA passed.
- Configure a valid OpenAI key in Settings. `npm run probe:live:access` checks model lookup only. Both HTTP 200 results are prerequisites, not proof of transcription/session access. `npm run probe:live` is the separate development protocol harness, not the packaged application.
- Save and reopen each selection; quit and relaunch to verify persistence. Confirm a settings change during recording applies only to the next recording.

## Six recording combinations

Run each row with real microphone input. For Current recognition, record whether browser recognition or the file fallback ran; exercise the fallback separately if browser recognition is available.

| Service | Mode | Required result | Current result |
| --- | --- | --- | --- |
| Current recognition | Manual | A long pause causes no answer; shortcut produces one answer | Not run |
| Current recognition | Automatic | Speech plus configured silence produces one answer | Not run |
| Whisper API | Manual | No upload on pause; shortcut uploads a complete file and produces one answer | Blocked: configured key returned HTTP 401 |
| Whisper API | Automatic | One completed file upload after speech/silence, one answer | Blocked: configured key returned HTTP 401 |
| GPT-Live | Manual | Streaming captions; shortcut stops for review; explicit Send produces one answer | Blocked: configured key returned HTTP 401 |
| GPT-Live | Automatic | Speech/silence stops for review; explicit Send produces one answer | Blocked: configured key returned HTTP 401 |

Live reaching review is current behavior. It does **not** satisfy the planned fully automatic Live answer/completeness exit gate. Keep that gate open until protocol evidence establishes completeness and the behavior can safely change.

Use these repeatable prompts, checking both the first and last words:

1. Short: "Explain the Python GIL."
2. SQL: "Write a SQL query joining users and orders. Include users with no orders and sort by total descending."
3. Screen context: show a synthetic broken loop and ask "Debug the loop on screen and explain its time complexity."
4. Long: speak a 90-second technical question, including identifiers and a final constraint, then submit. In a separate trial exceed two minutes and confirm cancellation without an answer.

## Boundary and recovery cases

For each applicable service/mode, record pass/fail, observed behavior, and evidence location:

| Case | Check |
| --- | --- |
| Denied microphone permission | Recoverable error, no active capture; grant permission and retry successfully |
| Empty/silence-only audio | Automatic never submits; manual empty submit produces no screenshot/answer |
| Background noise | Keyboard/fan noise alone produces no answer; speech still works; record false triggers |
| Short and long pauses | Resume before threshold: no submit. Beyond threshold: automatic submits once; manual continues |
| Shortcut/silence race | Press Ctrl+7 at the silence boundary, then repeatedly; one upload, screenshot and answer only |
| Network loss/session expiry | Disconnect during setup and capture; recoverable state, capture stopped, retained Live text reviewed; reconnect and start anew |
| Invalid credentials/unavailable model | Actionable error, no silent fallback, next corrected recording works |
| Stop/cancel | Stop during permission, setup, capture, upload, screen capture and answer streaming; no late answer/chunks |
| Restart/reset/navigation/quit | Old recording cannot affect the next; no persistent microphone indicator, duplicate listeners or orphan app processes |
| Typed prompt and Live review | Sending cancels capture, uses edited text, normalizes technical/SQL terms, and streams one answer |
| Screenshot lifecycle | Correct screen is captured once, app hide/show recovers, temporary screenshot is removed after completion/cancellation |
| Packaged shortcuts | Start/submit work with another app focused, repeated recordings work, shortcuts are released on quit |
| Persistence | All six combinations survive Settings reopen and packaged quit/relaunch; legacy model remains selected |

Where internal resource counts cannot be observed, mark them unverified and retain the separate automated evidence. Physical microphone release can be observed via the Windows microphone indicator; it does not prove remote session closure. Record server closure evidence separately.

## Latency and transcript measurements

Use at least five successful trials per Whisper/Live mode with the same prompt, microphone, pause, answer model and network. Keep failed trials in the record. Use a local timestamped screen/audio recording or equivalent single-clock observation; disclose its resolution. Test fixtures and unit-test durations are not API latency measurements.

For each trial record speech end, submission trigger, transcript/review ready, explicit review Send (Live), and first visible nonempty answer chunk. Report milliseconds:

- Speech end to first answer: `first_chunk - speech_end` (includes pause and human review).
- Trigger to transcript ready: `transcript_ready - trigger`.
- Live review time: `review_send - transcript_ready`.
- Live post-review answer latency: `first_chunk - review_send`.

Retain per-trial values and report sample count, median and range; do not silently remove review time from end-to-end latency. Compare raw transcript against the spoken reference before correcting it. Record omitted/substituted/added words, whether the final constraint survived, and whether technical normalization preserved meaning. Do not certify lossless Live transcripts from a small successful sample alone.

| Trial | Service/mode | Speech end | Trigger | Transcript ready | Review Send | First chunk | Raw transcript complete? | Errors/evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Pending | — | — | — | — | — | — | Unmeasured | Credentials/microphone QA pending |

Accept a row only after attaching its evidence. Other platforms require their own packaged permission, shortcut and cleanup runs before claiming support.
