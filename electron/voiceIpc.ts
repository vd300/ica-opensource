export const VOICE_IPC_CHANNELS = {
  TRANSCRIPT_SEGMENT: "voice:transcript-segment",
  AUDIO_CHUNK: "voice:audio-chunk",
  STOP: "voice:stop",
  RENDERER_READY: "voice:renderer-ready",
  RECOGNITION_ERROR: "voice:recognition-error",
  MODE_STARTED: "voice:mode-started",
  MODE_STOPPED: "voice:mode-stopped",
  STATUS: "voice:status",
  INTERIM_TRANSCRIPT: "voice:interim-transcript",
  FINAL_TRANSCRIPT: "voice:final-transcript",
  TRIGGER_DETECTED: "voice:trigger-detected",
  ANSWER_START: "voice:answer-start",
  ANSWER_CHUNK: "voice:answer-chunk",
  ANSWER_COMPLETE: "voice:answer-complete",
  ERROR: "voice:error"
} as const

export type VoiceIpcChannel =
  (typeof VOICE_IPC_CHANNELS)[keyof typeof VOICE_IPC_CHANNELS]
