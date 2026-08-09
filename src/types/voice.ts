export type VoiceIntent = "solve" | "explain" | "complexity" | "debug"

export type VoiceModeStatus =
  | "idle"
  | "listening"
  | "capturing"
  | "answering"
  | "complete"
  | "error"

export type VoiceErrorCode =
  | "speech_unavailable"
  | "microphone_denied"
  | "api_key_missing"
  | "screen_capture_failed"
  | "generation_failed"
  | "cancelled"
  | "unknown"

export interface VoiceTranscriptSegment {
  text: string
  isFinal: boolean
  confidence?: number
  submittedPrompt?: boolean
  receivedAt: number
}

export interface VoiceAudioChunkPayload {
  audioBase64: string
  mimeType: string
  language?: string
  submittedPrompt?: boolean
  recordedAt: number
}

export interface VoiceModeStatusPayload {
  status: VoiceModeStatus
  requestId?: string | null
  activeIntent?: VoiceIntent | null
  message?: string
}

export interface VoiceTriggerDetectedPayload {
  requestId: string
  intent: VoiceIntent
  transcript: string
}

export interface VoiceAnswerStartPayload {
  requestId: string
  intent: VoiceIntent
}

export interface VoiceAnswerChunkPayload {
  requestId: string
  text: string
}

export interface VoiceAnswerCompletePayload {
  requestId: string
  text?: string
}

export interface VoiceErrorPayload {
  code: VoiceErrorCode
  message: string
  recoverable: boolean
  requestId?: string | null
}

export interface VoiceRecognitionErrorPayload extends VoiceErrorPayload {
  code: "speech_unavailable" | "microphone_denied" | "unknown"
}

export type VoiceIpcResult = {
  success: boolean
  error?: string
}
