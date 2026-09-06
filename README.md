# CodeInterviewAssist (ICA)

An open-source desktop assistant for coding and software engineering interview practice. Capture a problem from your screen or submit a spoken question, then get AI-generated solutions, explanations, and debugging help using your own API key.

Built with Electron, React, and TypeScript. The application supports OpenAI, Google Gemini, and Anthropic, with no application subscription or sign-in required. Provider API usage may incur charges.

## Features

- **Screenshot workflow:** Capture up to five screenshots per queue, extract problem requirements, generate solutions, and capture follow-up screenshots for debugging.
- **Solution explanations:** View code, reasoning, and time/space complexity analysis, with diagram rendering when a response includes diagrams.
- **Voice assistant:** Record a question, explicitly submit it, and receive an answer using the transcript and a fresh screenshot as context. Questions can cover coding, SQL, debugging, complexity, and broader software engineering topics.
- **Provider and model settings:** Choose OpenAI, Gemini, or Anthropic and select separate models for extraction, solution generation, and debugging.
- **Language selection:** Python, JavaScript, Java, Go, C++, Swift, Kotlin, Ruby, SQL, R, and C#.
- **Window controls:** Always-on-top overlay, global shortcuts, visibility toggle, movement, opacity, and zoom controls.

The app runs on your desktop, but AI processing uses external provider APIs. See [Data and privacy](#data-and-privacy) for what is stored and sent.

## Quick start

### Requirements

- Node.js 22 or newer and npm. The repository's build tooling no longer supports the old Node.js 16 requirement.
- An API key for one of the providers exposed in Settings.
- An internet connection for AI requests and dependency installation.
- Screen capture access; microphone access is needed for voice input.

### Install and run

```bash
git clone https://github.com/vd300/ica-opensource.git
cd ica-opensource
npm ci
npm run dev
```

Run these commands from the repository root. The main application's frontend is in `src/`; you do not need a separate install in `renderer/`.

The development server uses port `54321`. If the window is not visible, press **Ctrl+B** on Windows/Linux or **Cmd+B** on macOS.

### First-time setup

1. Open Settings when prompted, or use the settings control in the app.
2. Select your API provider and enter its matching API key.
3. Choose the extraction, solution, and debugging models, then save.
4. Select the programming language for generated solutions.
5. For voice input, enable voice mode in Settings and configure the recognition language and response style.

API keys are configured in the app; an `.env` file is not required for the normal bring-your-own-key workflow. Settings currently stores one provider/key pair, so update the key when switching providers.

## Using the app

### Screenshots and debugging

1. Put the problem on screen and press **Ctrl/Cmd+H** to capture it. Repeat for additional context; each queue retains up to five screenshots.
2. Remove the latest capture with **Ctrl/Cmd+L** if needed.
3. Press **Ctrl/Cmd+Enter** to extract the problem and generate a solution.
4. Review the solution and explanation. Capture additional code or error screenshots in the solution view and process them for debugging feedback.
5. Press **Ctrl/Cmd+R** to clear the current problem and start again.

### Voice assistant

**Two voice workflows are available on separate branches:**

- [`voice-manual-record-submit`](https://github.com/vd300/ica-opensource/tree/voice-manual-record-submit) (this branch): Start recording with **Ctrl/Cmd+I**, then stop and submit each question with **Ctrl/Cmd+7**.
- [`voice-assistant-fixes`](https://github.com/vd300/ica-opensource/tree/voice-assistant-fixes): Automated voice support. Toggle voice mode with **Ctrl/Cmd+I**; while enabled, it processes speech and triggers answers automatically, without manually starting and submitting each question.

The instructions below describe this branch's manual recording workflow.

1. Enable voice mode in Settings and press **Ctrl/Cmd+I** to start recording.
2. Speak a question, such as "Explain this solution," "What is the time complexity?" or "How would you design a rate limiter?"
3. Press **Ctrl/Cmd+7** to stop recording and submit it. Recording is submitted explicitly; pausing speech does not submit the question.
4. The assistant processes the submitted transcript, captures the screen for context, and displays an answer in the overlay.
5. Use the overlay's stop button to stop the session or cancel an answer.

OpenAI voice answers stream into the overlay. Gemini and Anthropic voice answers are displayed after the provider response completes.

Voice input first uses the runtime's speech recognition service. If that service is unavailable or fails, microphone transcription can fall back to OpenAI when OpenAI is the selected provider. The fallback uses the configured `gpt-4o-transcribe` or `gpt-4o-mini-transcribe` model. Gemini and Anthropic do not currently have an equivalent audio transcription fallback in this app. When a voice error appears, the overlay also offers a typed prompt field.

Voice recording captures microphone input. There is no dedicated system-audio or meeting-audio capture integration. Microphone access and speech recognition availability depend on the operating system and runtime.

## Keyboard shortcuts

Use **Ctrl** on Windows/Linux and **Cmd** on macOS.

| Action | Shortcut |
| --- | --- |
| Show or hide the window | `Ctrl/Cmd+B` |
| Capture a screenshot | `Ctrl/Cmd+H` |
| Delete the latest screenshot | `Ctrl/Cmd+L` |
| Process screenshots | `Ctrl/Cmd+Enter` |
| Start a new problem | `Ctrl/Cmd+R` |
| Start voice recording | `Ctrl/Cmd+I` |
| Stop and submit voice recording | `Ctrl/Cmd+7` |
| Move the window | `Ctrl/Cmd+Arrow keys` |
| Decrease / increase opacity | `Ctrl/Cmd+[` / `Ctrl/Cmd+]` |
| Zoom out / in | `Ctrl/Cmd+-` / `Ctrl/Cmd+=` |
| Reset zoom | `Ctrl/Cmd+0` |
| Quit | `Ctrl/Cmd+Q` |

Shortcuts are registered globally while the app runs. Other applications or OS shortcuts can conflict with them.

## Providers and configuration

The following model IDs are currently exposed by this repository's Settings UI. This is an inventory of the implemented options, not a guarantee of current provider availability or access for your account.

| Provider | Configured model options |
| --- | --- |
| OpenAI | `gpt-5-nano`, `gpt-4o`, `gpt-4o-mini` |
| Google Gemini | `gemini-1.5-pro`, `gemini-2.0-flash` |
| Anthropic | `claude-3-7-sonnet-20250219`, `claude-3-5-sonnet-20241022`, `claude-3-opus-20240229` |

A fresh configuration defaults to Gemini with `gemini-2.0-flash`. Voice answers use the solution model. Voice settings also include recognition language, trigger confidence, and concise, code-first, or detailed response styles.

Model options and validation live in [SettingsDialog.tsx](src/components/Settings/SettingsDialog.tsx) and [ConfigHelper.ts](electron/ConfigHelper.ts). Provider requests live in [ProcessingHelper.ts](electron/ProcessingHelper.ts). Adding a model may require updating all three, including provider-specific request parameters.

## Data and privacy

- **API keys and settings:** Saved in a local `config.json` as plain JSON; keys are not encrypted with an operating-system credential store.
- **Screenshots:** Saved locally for the screenshot queues and sent to the selected AI provider when processed. Voice captures use a separate temporary screenshot path and are cleaned up after the request.
- **Voice input:** Audio is held in memory for the OpenAI transcription fallback and sent to OpenAI on submission. The voice implementation does not write raw recordings to disk. Runtime speech recognition may use its own external service.
- **AI requests:** Problem text, screenshots, transcripts, and relevant context are sent to the selected provider. This is not an offline inference application.
- **Diagram rendering:** The diagram component loads Mermaid from jsDelivr when needed.

The app sets its runtime data directory to `interview-coder-v1` under the operating system's app-data directory. However, the configuration helper is initialized before that override and resolves its `config.json` path at construction time. If locating or resetting settings, use the **`Config path:`** line in the launch logs rather than assuming the configuration is in the runtime data folder.

Avoid including API keys, local configuration, or sensitive captured content in commits and issue reports.

## Screen capture behavior

The app enables Electron content protection and hides its window from the taskbar where supported. These are platform-dependent window settings, not a guarantee that the app is invisible to screenshots, recordings, or screen sharing. The repository does not establish a verified compatibility matrix for recording applications or versions.

Use the app for practice and in settings where assistance is permitted.

## Development and builds

| Command | Purpose |
| --- | --- |
| `npm run dev` | Clean generated output and run the development app with TypeScript watching and Vite |
| `npm start` | Start the development app without the initial clean; Electron TypeScript compilation is not watched |
| `npm run build` | Build the frontend and compile Electron code |
| `npm run run-prod` | Launch an existing production build |
| `npm test` | Compile Electron code and run the voice controller tests |
| `npm run lint` | Run the repository's ESLint configuration |
| `npm run clean` | Remove `dist/` and `dist-electron/` |

To run a production build locally:

```bash
npm run build
npm run run-prod
```

### Package installers

```bash
# Windows: NSIS installer
npm run package-win

# macOS: DMG and ZIP for x64 and arm64
npm run package-mac

# Platform-default packaging; Linux target is AppImage
npm run package
```

Output goes to `release/`. Packaging configuration is in [package.json](package.json), and packaged apps currently use the name **Interview Coder**.

Before distributing a fork, review the inherited application ID, icons, signing/notarization settings, GitHub publish destination, and `.env` extra-resource entry. The current macOS configuration enables signing and notarization, so producing those artifacts requires appropriate credentials or a deliberate local configuration change. The source launch workflow above does not require packaging.

### Project layout

```text
electron/                 Main process, provider requests, screenshots, shortcuts, IPC
  tests/                  Voice assistant controller tests
src/                      Main React application
  components/Settings/    Provider, model, and voice settings
  components/VoiceAssistant/
                          Voice overlay and microphone/speech recognition handling
  _pages/                 Screenshot queue, solutions, and debugging views
docs/voice-interview-feature/
                          Voice design notes, implementation plan, and QA notes
assets/                   Application icons and other assets
build/                    Packaging resources and macOS entitlements
```

Voice design and QA notes are in [docs/voice-interview-feature](docs/voice-interview-feature). Some documents describe earlier milestones; the current recording shortcuts and workflow are documented above.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Window is missing or too faint | Toggle `Ctrl/Cmd+B`, increase opacity with `Ctrl/Cmd+]`, and check whether the process is running. |
| Development server fails to start | Ensure port `54321` is free. Stop the previous development process before starting another. |
| Stale or missing build output | Stop the app, then run `npm run dev` or rebuild with `npm run build`. |
| API request fails | Check the selected provider, matching key, account quota, and access to the selected model. Gemini and Anthropic key tests currently check format rather than making a live authentication request. |
| Screen capture fails on macOS | Grant screen recording access to the app or the terminal/IDE launching it, then restart. |
| Screen capture fails on Linux | Check your desktop session's capture support and permissions; behavior can vary by display server. |
| Voice input is unavailable | Check microphone permissions. If runtime recognition is unavailable, select OpenAI for transcription fallback or use the typed prompt offered in the error overlay. |
| A recorded question is not submitted | Press `Ctrl/Cmd+7`; `Ctrl/Cmd+I` starts recording. |
| A legacy launcher removes local configuration files | `stealth-run.bat` and `stealth-run.sh` delete the repository's `.env` file. Use the npm launch commands above for routine development. |

## Contributing

Bug fixes, documentation improvements, and provider updates are welcome. Open issues and pull requests in [this repository](https://github.com/vd300/ica-opensource). Include reproduction steps and your OS; for AI or voice issues, also include the selected provider/model and a redacted error message.

Run `npm test`, `npm run lint`, and `npm run build` for code changes. Voice controller tests cover application logic; microphone permissions, real provider responses, screen capture, and global shortcuts still need manual testing on the target platform.

## License

Licensed under **AGPL-3.0-or-later**, as declared in [package.json](package.json). See [LICENSE](LICENSE) for the license text. Preserve the original license and attribution when redistributing the project.
