# Interview Coder - Unlocked Edition

An open-source desktop copilot for technical-interview practice. Capture a problem from your screen, turn it into a structured prompt, generate an implementation in your preferred language, and ask for debugging help without leaving the workflow.

Interview Coder is built for people who want a transparent, self-hosted alternative to subscription interview assistants: there is no account, subscription, or application paywall. You bring your own provider API key and choose the models you want to use, so the source, configuration, and usage costs remain under your control. Provider API charges may still apply.

> Use Interview Coder responsibly. Only use screen capture, microphone, or AI assistance where the interviewer, employer, classroom, platform, and local rules allow it. The privacy features described below are interface conveniences, not a promise that the app is undetectable.

## Features

### Screenshot-to-solution workflow

- Capture up to five problem screenshots with a global shortcut or the app controls.
- Preview, queue, and remove screenshots before sending them for analysis.
- Extract the problem statement, constraints, examples, and other relevant details from images.
- Generate an optimized solution with reasoning plus time- and space-complexity analysis.
- Add screenshots of code, failures, or test results after a solution to receive focused debugging and improvement advice.
- First-class guidance for algorithms, SQL/database questions, backend and frontend topics, infrastructure, distributed systems, and system design.
- System-design answers can include compact HLD, LLD, and data-flow diagrams in portable ASCII text.

### Multiple AI providers and models

- Connect directly to OpenAI, Google Gemini, or Anthropic with your own API key.
- Select separate models for problem extraction, solution generation, and debugging.
- Keep provider, model, language, opacity, and voice preferences in local application settings.
- Switch the output language among Python, JavaScript, Java, Go, C++, Swift, Kotlin, Ruby, SQL, R, and C#.

This provider flexibility is a quiet advantage over many hosted paid tools: you are not locked into one model, one pricing tier, or a recurring app subscription.

### Voice interview assistant

- Start voice mode globally with `Ctrl+I` on Windows/Linux or `Cmd+I` on macOS.
- Choose browser/current recognition, Whisper transcription, or a continuous GPT-Live conversation.
- Use manual submission or automatic submission after a configurable pause where supported.
- Tune recognition language, trigger confidence, pause duration, and answer style (`Concise`, `Code First`, or `Detailed`).
- Read streaming transcripts and written answers while GPT-Live audio output remains muted.
- Toggle the GPT-Live microphone, or submit a recorded question in other modes, with `Ctrl+7` / `Cmd+7`.
- Supply optional resume context from PDF, DOCX, TXT, or Markdown and add factual clarifications for experience questions.
- Import a local snapshot of public GitHub profile and repository metadata to ground project discussions without inventing contributions.

Voice capabilities depend on the selected provider and platform. Resume files are parsed through OpenAI; the original remote file is deleted after parsing, while the returned reference is stored locally.

### A deliberately low-profile desktop experience

The app is designed to stay out of the way while you work:

- A frameless, transparent, always-on-top panel avoids a conventional desktop window footprint.
- It is omitted from the taskbar and can appear across workspaces, including full-screen spaces where the operating system supports it.
- One shortcut instantly makes the panel transparent and click-through; the same shortcut restores it without taking focus.
- Opacity can be adjusted from nearly invisible to fully readable.
- Global arrow shortcuts move the panel without dragging it.
- Content protection is requested from Electron to exclude the panel from many screen-capture paths.
- The app briefly hides its own panel during its screenshot flow so it does not obscure the problem being captured.
- Dedicated Windows and macOS stealth launch scripts build and start the application in the background.

These measures make the interface discreet and reduce interruption, but behavior varies by OS, desktop environment, conferencing software, and capture method. No desktop application can guarantee invisibility in every environment.

### Desktop quality-of-life features

- Keyboard-first controls available even when the panel is not focused.
- Adjustable zoom and opacity.
- Persisted window and application preferences.
- Reset/cancel control for clearing queues and returning to a clean state.
- Update notifications and packaged targets for Windows, macOS, and Linux.
- Local-first configuration with no required app login or hosted subscription service.

## Keyboard shortcuts

Use `Ctrl` on Windows/Linux and `Cmd` on macOS.

| Shortcut | Action |
| --- | --- |
| `Ctrl/Cmd + B` | Toggle panel visibility |
| `Ctrl/Cmd + H` | Capture a screenshot |
| `Ctrl/Cmd + Enter` | Process queued screenshots |
| `Ctrl/Cmd + L` | Delete the most recent screenshot |
| `Ctrl/Cmd + I` | Start voice mode |
| `Ctrl/Cmd + 7` | Submit voice recording or toggle the GPT-Live microphone |
| `Ctrl/Cmd + Arrow keys` | Move the panel |
| `Ctrl/Cmd + [` / `]` | Decrease / increase opacity |
| `Ctrl/Cmd + -` / `0` / `=` | Zoom out / reset / zoom in |
| `Ctrl/Cmd + R` | Cancel active work, clear queues, and reset the view |
| `Ctrl/Cmd + Q` | Quit |

## Getting started

### Prerequisites

- Node.js and npm
- An API key for the provider you plan to use
- Screen-recording and microphone permission when using the corresponding features

### Run in development

```bash
git clone <your-fork-or-repository-url>
cd interview-coder-withoupaywall-opensource
npm install
npm run dev
```

Open **Settings**, select a provider, enter its API key, choose models for each stage, and select your preferred programming language. Then capture a problem with `Ctrl/Cmd + H` and process it with `Ctrl/Cmd + Enter`.

### Build and run locally

```bash
npm run build
npm run run-prod
```

Or use the platform helper:

```powershell
.\stealth-run.bat
```

```bash
chmod +x stealth-run.sh
./stealth-run.sh
```

To create distributable packages, use `npm run package`, `npm run package-win`, or `npm run package-mac` as appropriate.

## Why this edition

Interview Coder focuses on ownership rather than a service tier. Comparable commercial tools often bundle the interface, model choice, and usage into a recurring plan. This edition keeps the application free and auditable, lets you select among supported providers, stores configuration locally, and leaves AI spend with the provider account you control. That can be simpler and more economical for occasional practice, while still offering screenshot analysis, debugging, voice interaction, and contextual interview support in one desktop app.

The trade-off is equally clear: you set up and maintain the app yourself, supply API access, and pay any provider usage charges directly.

## Privacy and data notes

- API keys and preferences are stored locally through the Electron application configuration.
- Screenshots, audio, prompts, resume content, and related context are sent to the selected service when a feature requires processing.
- Public GitHub metadata can be imported and retained as a local snapshot for GPT-Live context.
- Review your provider's retention policy and your organization's rules before sending confidential material.

## Credits

This edition is built upon the open-source work in [j4wg/interview-coder-withoupaywall-opensource](https://github.com/j4wg/interview-coder-withoupaywall-opensource). Many thanks to that project's author and contributors for the foundation this repository extends.

## Contributing

Bug fixes, documentation improvements, platform testing, and focused features are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow.

## License

Licensed under the [GNU Affero General Public License v3.0 or later](LICENSE). See [LICENSE-SHORT](LICENSE-SHORT) for the repository's summary and additional terms.
