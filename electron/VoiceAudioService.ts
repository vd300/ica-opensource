import { randomUUID } from "node:crypto"
import type { Config } from "./ConfigHelper"
import { snapshotVoiceConfig, voiceAudioRequirementError } from "../src/types/voiceSettings"
import { MAX_VOICE_AUDIO_BYTES, VOICE_AUDIO_MIME_TYPES, type VoiceFileUpload, type VoiceRecordingDescriptor } from "../src/types/voiceAdapter"
import type { LiveSessionAnswer } from "../src/types/voiceAudio"

interface LiveTransport {
  create(sdp: string): Promise<LiveSessionAnswer>
  hangup(sessionId: string): Promise<void>
}
interface Recording {
  id: string
  owner: number
  config: Readonly<Config>
  abort: AbortController
  state: "ready" | "file" | "uploading" | "transcribed" | "live" | "completed"
  turnId?: string
  text?: string
  live?: LiveTransport
  sessionId?: string
  expiry?: ReturnType<typeof setTimeout>
}
export interface VoiceAudioServiceDeps {
  getConfig(): Config
  transcribe(payload: VoiceFileUpload, config: Readonly<Config>, signal: AbortSignal): Promise<string>
  createLive(apiKey: string): LiveTransport
  submit(text: string): void
  submissionClaimed?(config: Readonly<Config>): void
  expired?(): void
}

/** Owns a single recording and its secrets in main. All methods receive a checked renderer owner. */
export class VoiceAudioService {
  private active?: Recording
  private cleanup = new Set<Promise<unknown>>()
  constructor(private readonly deps: VoiceAudioServiceDeps) {}

  begin(owner: number): VoiceRecordingDescriptor {
    this.cancelAll()
    const config = snapshotVoiceConfig(this.deps.getConfig())
    if (!config.voiceAssistantEnabled) throw new Error("Voice mode is disabled in settings")
    const error = voiceAudioRequirementError(config.voiceAudioService, config.apiProvider, config.apiKey)
    if (error) throw new Error(error)
    const id = randomUUID()
    this.active = { id, owner, config, abort: new AbortController(), state: "ready",
      expiry: config.voiceAudioService === "gpt-live" ? undefined : setTimeout(() => { this.cancelAll(); this.deps.expired?.() }, 240000) }
    return { recordingId: id, settings: {
      voiceAudioService: config.voiceAudioService, voiceSubmissionMode: config.voiceSubmissionMode,
      voiceAutoSubmitSilenceMs: config.voiceAutoSubmitSilenceMs
    }, language: config.voiceRecognitionLanguage }
  }

  private require(owner: number, id: unknown): Recording {
    const record = this.active
    if (typeof id !== "string" || !record || record.id !== id || record.owner !== owner || record.abort.signal.aborted) {
      throw new Error("Recording is no longer active")
    }
    return record
  }

  claim(owner: number, payload: { recordingId: string; reason: "shortcut" | "silence" }): boolean {
    const record = this.require(owner, payload?.recordingId)
    if (!["shortcut", "silence"].includes(payload.reason)) throw new Error("Invalid submission reason")
    if (record.config.voiceAudioService === "gpt-live") return false
    if (payload.reason === "silence" && record.config.voiceSubmissionMode !== "automatic") return false
    if (record.turnId || !["ready", "file", "live"].includes(record.state)) return false
    record.turnId = randomUUID()
    if (record.config.voiceAudioService === "whisper") this.deps.submissionClaimed?.(record.config)
    return true
  }

  authorizeFile(owner: number, id: unknown): void {
    const record = this.require(owner, id)
    if (record.state !== "ready" || record.config.voiceAudioService === "gpt-live") throw new Error("Invalid file recording state")
    if (record.config.apiProvider !== "openai" || !record.config.apiKey.trim()) throw new Error("Microphone file transcription requires the OpenAI provider and API key")
    record.state = "file"
  }

  async upload(owner: number, payload: VoiceFileUpload): Promise<string> {
    const record = this.require(owner, payload?.recordingId)
    if (record.state !== "file" || payload.sequence !== 0) throw new Error("Duplicate or out-of-order audio upload")
    if (!(VOICE_AUDIO_MIME_TYPES as readonly string[]).includes(payload.mimeType) ||
        typeof payload.audioBase64 !== "string" || !payload.audioBase64.length ||
        payload.audioBase64.length > Math.ceil(MAX_VOICE_AUDIO_BYTES / 3) * 4 ||
        (payload.audioBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload.audioBase64))) {
      throw new Error("Invalid audio file or recording exceeds 20 MB. Record a shorter question.")
    }
    const bytes = Buffer.from(payload.audioBase64, "base64")
    if (!bytes.length || bytes.length > MAX_VOICE_AUDIO_BYTES) throw new Error("Audio file exceeds the recording limit")
    // Reject obvious slices/mislabeled containers before asking the provider to decode the complete file.
    const containerValid = payload.mimeType.startsWith("audio/webm")
      ? bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
      : bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp"
    if (!containerValid) throw new Error("Audio file has an invalid container header")
    record.state = "uploading"
    const timeout = setTimeout(() => record.abort.abort(), 45000)
    try {
      const text = await this.deps.transcribe(payload, record.config, record.abort.signal)
      this.require(owner, record.id)
      record.text = text
      record.state = "transcribed"
      return text
    } catch {
      if (this.active === record) this.cancelAll()
      throw new Error("Audio transcription failed or was cancelled. Check OpenAI access and retry.")
    } finally { clearTimeout(timeout) }
  }

  async createLive(owner: number, payload: { recordingId: string; sequence: number; sdp: string }): Promise<LiveSessionAnswer> {
    const record = this.require(owner, payload?.recordingId)
    if (record.config.voiceAudioService !== "gpt-live" || record.state !== "ready" || payload.sequence !== 0) throw new Error("Invalid Live session state")
    if (typeof payload.sdp !== "string" || !payload.sdp.startsWith("v=0") || Buffer.byteLength(payload.sdp) > 65536) throw new Error("Invalid SDP offer")
    record.state = "live"
    const live = this.deps.createLive(record.config.apiKey)
    record.live = live
    // Let bounded creation return the session ID, so cancellation can hang up late-created sessions.
    const pending = live.create(payload.sdp)
    this.track(pending.catch(() => {}))
    try {
      const answer = await pending
      record.sessionId = answer.session.id
      if (this.active !== record || record.abort.signal.aborted) {
        this.track(live.hangup(answer.session.id))
        throw new Error("Recording was cancelled during Live setup")
      }
      return answer
    } catch (error) {
      if (this.active === record) this.cancelAll()
      throw error
    }
  }

  complete(owner: number, payload: { recordingId: string; text: string }): void {
    const record = this.require(owner, payload?.recordingId)
    if (record.config.voiceAudioService === "gpt-live") throw new Error("Live conversations do not use file transcript submission")
    if (!record.turnId) throw new Error("Recording cannot be submitted before claiming submission")
    const browserTranscript = record.config.voiceAudioService === "legacy" && record.state === "ready"
    if (!browserTranscript && record.state !== "transcribed") throw new Error("Recording cannot be submitted in this state")
    const text = record.state === "transcribed" ? record.text : payload.text
    if (typeof text !== "string" || text.length > 100000 || !/[\p{L}\p{N}]/u.test(text)) throw new Error("No speech was captured. Record or type a question.")
    record.state = "completed"
    clearTimeout(record.expiry)
    this.deps.submit(text)
  }

  cancel(owner: number, id: unknown): void {
    // Late renderer cleanup must never cancel a newer recording.
    if (this.active?.owner === owner && this.active.id === id) this.cancelAll()
  }

  cancelAll(): void {
    const record = this.active
    this.active = undefined // Invalidate first, before any asynchronous cleanup.
    if (!record) return
    clearTimeout(record.expiry)
    record.abort.abort()
    if (record.live && record.sessionId) this.track(record.live.hangup(record.sessionId))
  }

  private track(work: Promise<unknown>): void {
    const safe = work.catch(() => { console.warn("Voice remote cleanup unconfirmed") })
    this.cleanup.add(safe)
    void safe.finally(() => this.cleanup.delete(safe))
  }

  async dispose(): Promise<void> {
    this.cancelAll()
    while (this.cleanup.size) await Promise.all([...this.cleanup])
  }
}
