# Baseline and documentation verification

Date: 2026-09-12. Baseline commit: `79ba6ef7181c738eaf10a1e90f2da3a51897685e`.

## Repository findings

- Initial working tree was clean.
- `electron/ConfigHelper.ts` defaults voice transcription to `gpt-4o-transcribe` and also allows `gpt-4o-mini-transcribe`.
- `src/components/VoiceAssistant/useSpeechRecognition.ts` prefers browser recognition, then uses MediaRecorder API transcription fallback. It submits through the existing recording-submit event.
- `electron/ProcessingHelper.ts` uses `audio.transcriptions.create` and requires OpenAI for that fallback.
- `electron/ipcHandlers.ts` converts returned transcription into a final transcript with `submittedPrompt` passed through.
- Original tasks cover Phases 0–10 and retain unchecked manual QA items.
- Original Phase 10 QA text includes older toggle wording, while the newer plan and tasks describe separate start and submit shortcuts. This historical inconsistency is recorded here rather than rewritten.

## API verification

Official sources confirm the requested [GPT-Live model](https://developers.openai.com/api/docs/models/gpt-live-1) and [Whisper model](https://developers.openai.com/api/docs/models/whisper-1). The [Live migration guide](https://developers.openai.com/api/docs/guides/live-migration) and [session guide](https://developers.openai.com/api/docs/guides/live-conversations) require application-owned submission boundaries instead of assuming Realtime commit/completed-turn semantics.

The OpenAI documentation MCP was registered during research but its tools were not available in this running session; official web documentation was used. No authenticated API or microphone test was performed.

## Change scope

Only new Markdown files in `docs/gpt-live-integration/` are added. Existing documentation, source, dependency manifests, and completed phase records are preserved. New implementation checkboxes remain unchecked. The deliverable is a plan, phased checklist, and implementation specification; it does not claim the settings or API integration are shipped.

Verification commands: `git diff --exit-code HEAD -- .` to confirm tracked files remain unchanged, a local Markdown-link existence check for this folder, and `git status --short --untracked-files=all` to confirm the added-file scope. Runtime tests are unnecessary for documentation-only additions; required future implementation checks are listed in [phases](phases.md).
