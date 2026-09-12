import type { VoiceAudioSettings, LiveSessionAnswer } from "./voiceAudio"

export const MAX_VOICE_AUDIO_BYTES = 20 * 1024 * 1024
export const VOICE_RECORDING_LIMIT_MS = 120000
export const VOICE_AUDIO_MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"] as const

/** This is the only configuration passed to audio adapters. Never contains credentials. */
export interface VoiceRecordingDescriptor {
  recordingId: string
  settings: Readonly<VoiceAudioSettings>
  language: string
}
export interface VoiceFileUpload {
  recordingId: string
  sequence: number
  audioBase64: string
  mimeType: string
}
export interface VoiceAdapterResult {
  recordingId: string
  text: string
  requiresReview: boolean
  finalization?: "confirmed" | "unconfirmed"
}
export type VoiceAdapterEvent =
  | { recordingId: string; type: "live-written-answers"; answers: import("../components/VoiceAssistant/LiveWrittenAnswers").LiveWrittenAnswer[] }
  | { recordingId: string; type: "microphone-muted"; muted: boolean }
  | { recordingId: string; type: "live-captions"; captions: import("../components/VoiceAssistant/LiveConversation").LiveCaption[] }
  | { recordingId: string; type: "transcript"; text: string }
  | { recordingId: string; type: "state"; state: "starting" | "recording" | "submitting" | "stopped" }
  | { recordingId: string; type: "error"; message: string }

export interface VoiceAudioAdapter {
  start(): Promise<void>
  toggleMicrophone?(): void
  submit(): Promise<VoiceAdapterResult | null>
  cancel(): void
}
export interface VoiceAudioBridge {
  claim(payload: { recordingId: string; reason: "shortcut" | "silence" }): Promise<boolean>
  begin(): Promise<VoiceRecordingDescriptor>
  authorizeFile(recordingId: string): Promise<void>
  upload(payload: VoiceFileUpload): Promise<string>
  createLive(payload: { recordingId: string; sequence: number; sdp: string }): Promise<LiveSessionAnswer>
  cancel(recordingId: string): Promise<void>
  complete(payload: { recordingId: string; text: string }): Promise<void>
}
