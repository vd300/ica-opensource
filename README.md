# Interview Coder (ICA)

Interview Coder is an open-source Electron desktop assistant for practicing coding and software-engineering interviews. It turns screenshots into structured solutions, analyzes follow-up screenshots, and answers spoken technical questions through a compact desktop overlay.

ICA is a bring-your-own-key application. It has no hosted ICA account or subscription service; requests go directly from the desktop app to the AI provider selected in Settings.

> Use ICA for practice, accessibility, or sessions where external assistance is explicitly permitted. It does not bypass interview rules, operating-system permissions, screen-sharing controls, or proctoring software.

## Features

### Screenshot workflow

- Capture up to five problem screenshots with a global shortcut.
- Extract problem statements, constraints, examples, and design context.
- Generate code, explanations, complexity analysis, edge cases, and architecture guidance.
- Select separate models for extraction, solution generation, and debugging.
- Submit follow-up screenshots of code, errors, or test output for debugging.
- Render Mermaid diagrams returned with design answers.
- Generate answers in Python, JavaScript, Java, Go, C++, Swift, Kotlin, Ruby, SQL, R, or C#.

### Voice workflow

Voice Assistant supports three audio services:

| Service | Behavior | Submission |
| --- | --- | --- |
| Current recognition | Uses runtime/browser recognition first, with an OpenAI file-transcription fallback when available | Manual shortcut or automatic pause |
| Whisper API | Records an in-memory audio file and sends the completed recording to OpenAI `whisper-1` | Manual shortcut or automatic pause |
| GPT-Live | Streams microphone audio over WebRTC and displays user and assistant captions in a continuous conversation | Shortcut toggles microphone mute |

Current recognition and Whisper can capture a temporary screenshot for context and stream a written answer through the configured provider. GPT-Live does not use the screenshot or file-answer pipeline. It can delegate technical reasoning and code requests to a fixed reasoning model and show the result in a separate Written answers panel. Provider audio output is intentionally not connected to playback.

Voice settings include recognition language, manual or automatic submission, a 500–5,000 ms automatic pause, two OpenAI transcription models, and concise, code-first, or detailed answer styles.

Whisper API and GPT-Live require OpenAI to be selected with a valid OpenAI API key. GPT-Live currently uses `gpt-live-1` and delegates reasoning to `gpt-5.6-luna`, so the account must have access to both.

## Requirements

- Node.js 22 or newer and npm.
- Windows, macOS, or Linux with an Electron-compatible desktop session.
- An API key for OpenAI, Google Gemini, or Anthropic.
- Internet access for provider requests.
- Screen-capture permission for screenshot features.
- Microphone permission for voice features.

Windows is the primary target of the current voice QA workflow. Automated tests exercise platform-independent logic, but physical microphone behavior and current macOS/Linux shortcut behavior still require manual acceptance testing.

## Install and run

```bash
git clone https://github.com/vd300/ica-opensource.git
cd ica-opensource
npm ci
npm run dev
```

The development renderer uses port `54321`, and development mode opens Electron DevTools automatically.

To run a production build locally:

```bash
npm run build
npm run run-prod
```

## First-time setup

1. Open Settings in the application.
2. Select OpenAI, Gemini, or Anthropic.
3. Enter the matching provider API key.
4. Choose the extraction, solution, and debugging models.
5. Select the output programming language.
6. Configure Voice Assistant and its audio service if needed.
7. Save the settings.

The app stores one active provider/key configuration. Switching providers may reset the three task models to that provider's defaults.

## Using screenshots

1. Display a practice problem and press `Ctrl/Cmd+H` to capture it.
2. Repeat for additional context. The queue retains up to five screenshots.
3. Press `Ctrl/Cmd+Enter` to extract and solve the problem.
4. In the solution view, capture code, errors, or failed output and submit them for debugging.
5. Press `Ctrl/Cmd+R` to clear the problem and begin again.

## Using Voice Assistant

Enable Voice Assistant in Settings before starting.

### Current recognition or Whisper API

1. Press `Ctrl/Cmd+I` to begin recording.
2. Ask a software-engineering question.
3. In Manual mode, press `Ctrl/Cmd+7` to submit. In Automatic mode, sustained speech followed by the configured pause submits once.
4. Read the transcript and streamed answer in the overlay.
5. Start another recording for another question, or use Stop to end the session.

Silence alone does not submit. File/browser capture is limited to two minutes, uploaded audio to 20 MiB, and file transcription to a 45-second main-process deadline.

### GPT-Live

1. Select GPT-Live with the OpenAI provider and start it with `Ctrl/Cmd+I`.
2. Speak naturally and follow the user/assistant captions.
3. Press `Ctrl/Cmd+7` to mute or unmute the microphone without ending the conversation.
4. Ask for code or say “write it down” to place formatted output in Written answers.
5. Use Stop to close the session. Starting again creates a new conversation.

Manual/Automatic submission and pause duration do not apply to GPT-Live. A disconnect does not fall back to Whisper; start a new session after correcting the reported error.

## Keyboard shortcuts

Electron registers these as global `CommandOrControl` shortcuts while ICA runs:

| Action | Shortcut |
| --- | --- |
| Capture screenshot | `Ctrl/Cmd+H` |
| Process screenshot queue | `Ctrl/Cmd+Enter` |
| Delete latest screenshot | `Ctrl/Cmd+L` |
| Reset current problem | `Ctrl/Cmd+R` |
| Show or hide overlay | `Ctrl/Cmd+B` |
| Start Voice Assistant | `Ctrl/Cmd+I` |
| Submit recording or toggle GPT-Live microphone | `Ctrl/Cmd+7` |
| Move overlay | `Ctrl/Cmd+Arrow keys` |
| Decrease/increase opacity | `Ctrl/Cmd+[` / `Ctrl/Cmd+]` |
| Zoom out/in | `Ctrl/Cmd+-` / `Ctrl/Cmd+=` |
| Reset zoom | `Ctrl/Cmd+0` |
| Quit | `Ctrl/Cmd+Q` |

Other applications or operating-system shortcuts can prevent registration. Electron does not reliably distinguish the physical left and right Control keys.

## Providers and models

These are the model IDs currently accepted by the application. Availability and billing depend on the provider and account.

| Provider | Screenshot, solution, and debugging models | Voice notes |
| --- | --- | --- |
| OpenAI | `gpt-5-nano`, `gpt-4o`, `gpt-4o-mini` | Supports file-transcription fallback, Whisper API, and GPT-Live |
| Google Gemini | `gemini-1.5-pro`, `gemini-2.0-flash` | Supports the file-answer route, not OpenAI transcription services |
| Anthropic | `claude-3-7-sonnet-20250219`, `claude-3-5-sonnet-20241022`, `claude-3-opus-20240229` | Supports the file-answer route, not OpenAI transcription services |

The configuration layer also accepts `gpt-5-nano-2025-08-07`, although Settings exposes `gpt-5-nano`. Current recognition's OpenAI fallback supports `gpt-4o-transcribe` and `gpt-4o-mini-transcribe`.

OpenAI key testing performs an API request. Gemini and Anthropic checks currently validate only the key's shape; successful validation does not prove model access.

## Privacy and data flow

ICA is locally operated, but it is not an offline AI application.

- Settings and the API key are stored as plain JSON in Electron's user-data directory, not an operating-system credential vault.
- Queue screenshots are stored locally and sent to the selected provider when processed.
- Voice screen context uses a separate temporary screenshot and cleans it after the request.
- File-mode microphone audio is held in memory and sent for transcription; ICA does not intentionally save raw recordings to disk.
- GPT-Live streams microphone audio to OpenAI over WebRTC.
- Prompts, transcripts, images, context, and responses are subject to the selected provider's terms and data policies.
- Mermaid rendering loads browser code from jsDelivr when a diagram is displayed.

The launch log prints `Config path:` with the effective settings location. Never commit that file, API keys, captured content, or unredacted logs.

## Overlay and screen capture

The Electron window is frameless, transparent, always on top, hidden from the taskbar where supported, and created with Electron content protection enabled. These settings depend on the operating system and capture method.

Content protection does not promise that the overlay will be absent from every screenshot, recording, browser share, full-display share, remote-desktop session, or conferencing product. ICA does not detect which platform is recording it and provides no compatibility or “invisibility” guarantee.

For legitimate compatibility testing, use non-sensitive sample content and test each mode independently:

1. Record the full display with a local recorder.
2. Record or share only the window containing a sample prompt.
3. Test browser-tab, window, and full-screen sharing in a private meeting with informed participants.
4. Verify every monitor in a multi-display setup.
5. Repeat after Electron, OS, graphics-driver, or conferencing-app updates.
6. Record the OS, versions, capture mode, and result instead of generalizing from one test.

Only perform these checks in environments you control. Do not use capture behavior to conceal unauthorized assistance.

## Development commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Clean output, watch Electron TypeScript, run Vite, and launch Electron |
| `npm start` | Compile Electron once, run Vite, and launch Electron |
| `npm test` | Compile Electron and run the Node test suite |
| `npm run lint` | Run ESLint |
| `npm run build` | Build the renderer and compile Electron for production |
| `npm run run-prod` | Launch the existing production build |
| `npm run clean` | Remove `dist/` and `dist-electron/` |
| `npm run probe:live:access` | Run the command-line GPT-Live access probe |
| `npm run probe:live` | Launch the Electron GPT-Live prototype |
| `npm run qa:voice:package` | Create an unpacked Windows x64 voice-QA build |

Before submitting code:

```bash
npm test
npm run lint
npm run build
```

The automated suite covers voice state, settings migration, speech activity, submission races, provider routing, audio validation, cancellation, Live captions, managed delegation, and written-answer streaming. It does not certify real microphones, provider latency, API entitlements, installer behavior, or capture compatibility.

## Packaging

```bash
npm run package       # platform/default target
npm run package-win   # Windows NSIS
npm run package-mac   # macOS DMG and ZIP, x64 and arm64
```

Artifacts go to `release/`; Linux's configured target is AppImage.

The standard configuration contains inherited app identifiers, GitHub publishing metadata, an `.env` extra-resource entry, and macOS signing/notarization settings. Review them before distributing a fork. The `qa:voice:package` build omits publishing and `.env` resources and produces `release/voice-qa/win-unpacked/Interview Coder.exe`.

## Project structure

```text
electron/                         Electron main process and provider integrations
  ConfigHelper.ts                 Local settings, defaults, and validation
  ProcessingHelper.ts             Screenshot and file-answer provider routes
  ScreenshotHelper.ts             Queues and temporary screen context
  VoiceAssistantController.ts     Voice session and answer orchestration
  VoiceAudioService.ts            Audio lifecycle and validation
  LiveVoiceService.ts             Fixed GPT-Live session boundary
  tests/                           Node regression tests
  prototypes/live/                 GPT-Live probes
src/                              React renderer
  _pages/                          Queue, solution, and debugging screens
  components/Settings/             Provider, model, and voice controls
  components/VoiceAssistant/       Audio adapters, captions, and written answers
docs/gpt-live-integration/         Live implementation and QA records
docs/voice-interview-feature/      Original voice design notes
assets/                           Packaging icons
build/                            Packaging resources and macOS entitlements
```

## Troubleshooting

| Problem | Check |
| --- | --- |
| Overlay is missing | Press `Ctrl/Cmd+B`, increase opacity, and confirm Electron is running |
| Development launch times out | Confirm port `54321` is free and no stale dev process remains |
| Screenshot capture fails | Grant screen-recording permission and restart ICA |
| Global shortcut does nothing | Check for conflicts with the OS or another application |
| Provider request fails | Verify provider, key, quota, network access, and model entitlement |
| Voice cannot start | Enable desktop microphone access and select a compatible provider/service |
| Whisper or GPT-Live is incompatible | Select OpenAI and save a valid OpenAI API key |
| Automatic submission is early | Increase Automatic Pause or switch to Manual |
| GPT-Live disconnects | Start a fresh session; it does not fall back to another service |
| Production behavior is stale | Run `npm run build`; packaged executables are not updated by a source build |

## Contributing

Issues and pull requests are welcome. Include reproducible steps, operating system, application version, selected provider/model, and redacted logs. For microphone or capture issues, also state the device, permissions, display setup, and exact capture mode.

Keep changes focused and do not commit credentials or generated build output.

## License

ICA is licensed under the GNU Affero General Public License v3.0 or later (`AGPL-3.0-or-later`). See [LICENSE](LICENSE) and preserve required notices when modifying or redistributing the project.
