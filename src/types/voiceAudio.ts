/** Phase 11 contracts. Separate from the shipped legacy IPC contract. */
export type VoiceAudioService = "legacy" | "whisper" | "gpt-live"
export type VoiceSubmissionMode = "manual" | "automatic"
export type VoiceSubmissionReason = "shortcut" | "silence"
export type VoiceRecordingId = string
export type VoiceTurnId = string
export type LiveSessionId = string // Opaque provider ID; never strip its prefix.

export interface VoiceAudioSettings {
  voiceAudioService: VoiceAudioService
  voiceSubmissionMode: VoiceSubmissionMode
  voiceAutoSubmitSilenceMs: number
}

export interface VoiceRecordingSession {
  recordingId: VoiceRecordingId
  settings: Readonly<VoiceAudioSettings>
  providerSessionId?: LiveSessionId
}

export interface VoiceSubmittedTurn {
  recordingId: VoiceRecordingId
  turnId: VoiceTurnId
  reason: VoiceSubmissionReason
}

export interface LiveTranscriptFragment {
  eventId: string
  delta: string
  startMs: number
  endMs: number
}

export interface LiveDrainResult extends VoiceSubmittedTurn {
  text: string
  fragments: LiveTranscriptFragment[]
  finalization: "confirmed" | "unconfirmed"
  /** Session closure is not an authoritative input transcription completion. */
  completeness: "requires-review"
  closeReason?: string
}

export type VoiceAudioEvent =
  | { recordingId: VoiceRecordingId; type: "ready"; sessionId: LiveSessionId }
  | { recordingId: VoiceRecordingId; type: "transcript"; fragment: LiveTranscriptFragment }
  | { recordingId: VoiceRecordingId; type: "error"; message: string }

export interface LiveSessionAnswer {
  session: { id: LiveSessionId }
  transport: { type: "webrtc"; sdp: string }
}
