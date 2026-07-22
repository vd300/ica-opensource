# Phase 10 QA Notes

## Automated Checks
- `npm test`: passed. Covers intent matching, debounce behavior, and cancellation during active generation.
- `npm run lint`: passed.
- `npx tsc --noEmit`: passed.
- `npx tsc -p tsconfig.electron.json --noEmit`: passed.

## Trigger Behavior
Voice triggering is no longer limited to the exact phrase "solve this". The solve intent now also recognizes clear assistance requests such as:
- "answer this question"
- "work through the problem"
- "how would you approach this prompt"
- "can you help with this"

Unrelated speech still remains transcript-only.

## MVP Completion Criteria Review
- `Ctrl + I` toggles voice mode: code-verified through `CommandOrControl+I` shortcut registration and controller toggle wiring. Live OS shortcut verification remains manual.
- Voice overlay opens and displays live transcript: code-verified through `voice:mode-started`, Web Speech transcript handling, and overlay event subscriptions. Live microphone verification remains manual.
- A clear assistance request triggers current-screen analysis: automated unit coverage verifies broader trigger matching and exactly one debounced request; code path captures temporary screen context before generation.
- OpenAI responses stream partial text to the overlay: code-verified through `stream: true`, chunk forwarding, and overlay chunk rendering. Live OpenAI streaming remains manual.
- Stop/cancel reliably shuts down recognition and generation: automated unit coverage verifies abort and suppression of late chunks; renderer stop button and shortcut both call the stop path.
- Errors are visible and recoverable: code-verified through inline overlay errors and toast handling for missing API key, unavailable speech recognition, and microphone denial.

## Manual QA Remaining
Run the packaged or dev app with a configured API key and microphone access to verify the OS/browser-dependent items:
- `Ctrl + I` starts and stops voice mode.
- Denying microphone permission shows a recoverable error.
- A spoken assistance request triggers one answer.
- OpenAI chunks appear before completion.
- Stopping during generation prevents further visible chunks.
