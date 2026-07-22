# Voice Interview Assistant - Phase 0 Decisions

## Product and Safety Framing

The voice interview assistant is scoped as an opt-in practice and permitted-assistance feature. It must follow the repository ethical-use guidance in `README.md`: users should use the tool to learn, understand solution approaches, and comply with any interview, classroom, employer, or platform rules that apply to them.

The feature must not be positioned as a way to bypass rules or hide unauthorized assistance. Product copy, prompts, settings, and errors should describe it as practice support or assistance that is appropriate only when allowed.

## Shortcut Decision

Use `CommandOrControl+I` for the MVP voice-mode toggle.

The product goal names `Left Ctrl + I`, but Electron global accelerators do not reliably distinguish physical left and right control keys. A native keyboard hook can be evaluated later if physical-side detection becomes a hard requirement. For the MVP, `CommandOrControl+I` matches the project's existing cross-platform shortcut style and is acceptable.

## Screenshot Handling Decision

Voice-triggered screenshots should be temporary by default and should not appear in the existing screenshot queue.

The voice path needs fresh screen context for generation, but queue pollution would make the normal screenshot workflow harder to reason about. The implementation should capture a temporary screenshot, read it for the AI request, and delete it after completion, cancellation, or error. If a first pass must reuse `takeScreenshot()`, it should immediately remove any voice capture from the normal queue after reading the image.
