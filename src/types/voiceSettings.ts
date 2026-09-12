import type { VoiceAudioSettings } from "./voiceAudio"

export const DEFAULT_VOICE_AUDIO_SETTINGS: Readonly<VoiceAudioSettings> = Object.freeze({
  voiceAudioService: "legacy",
  voiceSubmissionMode: "manual",
  voiceAutoSubmitSilenceMs: 1500
})

export function sanitizeVoiceAudioSettings(config: {
  voiceAudioService?: unknown
  voiceSubmissionMode?: unknown
  voiceAutoSubmitSilenceMs?: unknown
}): VoiceAudioSettings {
  const pause = config.voiceAutoSubmitSilenceMs
  return {
    voiceAudioService: config.voiceAudioService === "whisper" || config.voiceAudioService === "gpt-live"
      ? config.voiceAudioService : "legacy",
    voiceSubmissionMode: config.voiceSubmissionMode === "automatic" ? "automatic" : "manual",
    voiceAutoSubmitSilenceMs: typeof pause === "number" && Number.isFinite(pause)
      ? Math.min(5000, Math.max(500, pause)) : 1500
  }
}

export function voiceAudioRequirementError(service: VoiceAudioSettings["voiceAudioService"], provider: string, apiKey: string): string | null {
  if (service === "legacy") return null
  if (provider !== "openai") return "Whisper API and GPT-Live require the OpenAI provider. Your audio selection is retained."
  if (!apiKey.trim()) return "Whisper API and GPT-Live require an OpenAI API key."
  return null
}

export function snapshotVoiceConfig<T extends Partial<VoiceAudioSettings>>(config: T): Readonly<T & VoiceAudioSettings> {
  return Object.freeze({ ...config, ...sanitizeVoiceAudioSettings(config) })
}
