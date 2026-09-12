import {
  MAX_VOICE_AUDIO_BYTES, VOICE_AUDIO_MIME_TYPES, VOICE_RECORDING_LIMIT_MS,
  type VoiceAudioAdapter, type VoiceAudioBridge, type VoiceAdapterEvent,
  type VoiceAdapterResult, type VoiceRecordingDescriptor
} from "../../types/voiceAdapter"
import { LiveConversation } from "./LiveConversation"
import { LiveWrittenAnswers } from "./LiveWrittenAnswers"

export interface AudioAdapterDependencies {
  observeSpeech?(stream: MediaStream, silenceMs: number, submit: () => void): () => void
  onSilence?(): void
  bridge: VoiceAudioBridge
  emit(event: VoiceAdapterEvent): void
  getMicrophone(): Promise<MediaStream>
  prepareMicrophone?(stream: MediaStream): { stream: MediaStream; dispose(): void }
  createRecorder(stream: MediaStream, mimeType: string): MediaRecorder
  supportsMime(mimeType: string): boolean
  createPeer(): RTCPeerConnection
  createRecognition?: () => BrowserRecognition
}
export interface BrowserRecognition {
  continuous: boolean
  interimResults: boolean
  lang: string
  onstart: (() => void) | null
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

abstract class AudioAdapter implements VoiceAudioAdapter {
  protected abort = new AbortController()
  protected stream?: MediaStream
  protected state: "new" | "starting" | "recording" | "submitting" | "stopped" = "new"
  private stopDetection?: () => void
  private disposeMicrophone?: () => void
  protected duration?: ReturnType<typeof setTimeout>
  constructor(protected recording: VoiceRecordingDescriptor, protected deps: AudioAdapterDependencies) {}
  abstract start(): Promise<void>
  abstract submit(): Promise<VoiceAdapterResult | null>

  protected emit(event: Omit<Extract<VoiceAdapterEvent, { type: "live-written-answers" }>, "recordingId"> | Omit<Extract<VoiceAdapterEvent, { type: "microphone-muted" }>, "recordingId"> | Omit<Extract<VoiceAdapterEvent, { type: "live-captions" }>, "recordingId"> | Omit<Extract<VoiceAdapterEvent, { type: "transcript" }>, "recordingId"> | Omit<Extract<VoiceAdapterEvent, { type: "error" }>, "recordingId">): void {
    if (!this.abort.signal.aborted) this.deps.emit({ ...event, recordingId: this.recording.recordingId })
  }
  protected transition(state: "starting" | "recording" | "submitting" | "stopped"): void {
    this.state = state
    this.deps.emit({ recordingId: this.recording.recordingId, type: "state", state })
  }
  protected ready(): void {
    this.check()
    this.transition("recording")
    if (this.recording.settings.voiceSubmissionMode === "automatic") {
      if (!this.stream || !this.deps.observeSpeech) throw new Error("Microphone speech detection is unavailable")
      this.stopDetection = this.deps.observeSpeech(this.stream, this.recording.settings.voiceAutoSubmitSilenceMs, () => this.deps.onSilence?.())
    }
    this.duration = setTimeout(() => this.fail("Recording limit reached (two minutes). Record a shorter question or type it."), VOICE_RECORDING_LIMIT_MS)
  }
  protected check(): void {
    if (this.abort.signal.aborted) throw new Error("Recording cancelled")
  }
  protected async bounded<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    this.check()
    return new Promise<T>((resolve, reject) => {
      const stop = () => { clearTimeout(timer); this.abort.signal.removeEventListener("abort", cancel) }
      const cancel = () => { stop(); reject(new Error("Recording cancelled")) }
      const timer = setTimeout(() => { stop(); reject(new Error(message)) }, ms)
      this.abort.signal.addEventListener("abort", cancel, { once: true })
      promise.then(value => { stop(); resolve(value) }, error => { stop(); reject(error) })
    })
  }
  protected async microphone(): Promise<MediaStream> {
    const pending = this.deps.getMicrophone().then(stream => {
      if (this.abort.signal.aborted) stream.getTracks().forEach(track => track.stop())
      else {
        this.stream = stream
        const prepared = this.deps.prepareMicrophone?.(stream)
        if (prepared) {
          this.disposeMicrophone = prepared.dispose
          this.stream = prepared.stream
        }
      }
      return this.stream || stream
    })
    const stream = await this.bounded(pending, 30000, "Microphone permission timed out. Please retry.")
    this.check()
    return stream
  }
  protected stopTracks(): void {
    this.stopDetection?.()
    this.stopDetection = undefined
    this.stream?.getTracks().forEach(track => track.stop())
    this.stream = undefined
    this.disposeMicrophone?.()
    this.disposeMicrophone = undefined
    clearTimeout(this.duration)
  }
  protected fail(message: string): void {
    if (this.abort.signal.aborted) return
    this.emit({ type: "error", message })
    this.cancel()
  }
  cancel(): void {
    if (this.abort.signal.aborted) return
    this.abort.abort()
    this.stopTracks()
    this.transition("stopped")
    void this.deps.bridge.cancel(this.recording.recordingId).catch(() => {})
  }
  protected result(text: string, requiresReview = false): VoiceAdapterResult {
    return { recordingId: this.recording.recordingId, text, requiresReview }
  }
}

/** A completed MediaRecorder container is uploaded exactly once; slices are never uploaded. */
export class FileAudioAdapter extends AudioAdapter {
  private recorder?: MediaRecorder
  private chunks: Blob[] = []
  private bytes = 0
  private ended?: () => void
  async start(): Promise<void> {
    if (this.state !== "new") throw new Error("Audio adapters are single-use")
    this.transition("starting")
    try {
      await this.bounded(this.deps.bridge.authorizeFile(this.recording.recordingId), 5000, "Audio setup timed out. Please retry.")
      this.check()
      const mime = VOICE_AUDIO_MIME_TYPES.find(type => this.deps.supportsMime(type))
      if (!mime) throw new Error("No supported microphone recording format is available")
      const stream = await this.microphone()
      const recorder = this.deps.createRecorder(stream, mime)
      this.recorder = recorder
      recorder.ondataavailable = event => {
        if (this.abort.signal.aborted || !event.data.size) return
        this.bytes += event.data.size
        if (this.bytes > MAX_VOICE_AUDIO_BYTES) { this.fail("Recording exceeds 20 MB. Record a shorter question."); return }
        this.chunks.push(event.data)
      }
      recorder.onerror = () => this.fail("Microphone recording failed. Please retry.")
      recorder.onstop = () => {
        this.stopTracks()
        if (this.state === "submitting") this.ended?.()
        else if (!this.abort.signal.aborted) this.fail("Microphone recording ended unexpectedly. Please retry.")
      }
      recorder.start(1000)
      this.ready()
    } catch (error) { this.cancel(); throw error }
  }

  async submit(): Promise<VoiceAdapterResult | null> {
    if (this.state !== "recording" || !this.recorder) return null
    this.transition("submitting")
    clearTimeout(this.duration)
    try {
      const stopped = new Promise<void>(resolve => { this.ended = resolve })
      this.recorder.stop() // Final dataavailable precedes stop, per MediaRecorder's contract.
      this.stopTracks()
      await this.bounded(stopped, 5000, "Microphone finalization timed out. Please retry.")
      this.check()
      const blob = new Blob(this.chunks, { type: this.recorder.mimeType })
      this.chunks = []
      if (!blob.size) throw new Error("No audio was captured. Please retry.")
      const bytes = new Uint8Array(await blob.arrayBuffer())
      this.check()
      let binary = ""
      for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192))
      const text = await this.bounded(this.deps.bridge.upload({
        recordingId: this.recording.recordingId, sequence: 0,
        mimeType: blob.type, audioBase64: btoa(binary)
      }), 45000, "Audio transcription timed out. Please retry.")
      this.check()
      this.transition("stopped")
      return this.result(text)
    } catch (error) { this.cancel(); throw error }
  }

  cancel(): void {
    super.cancel()
    if (this.recorder) {
      this.recorder.ondataavailable = null
      this.recorder.onerror = null
      this.recorder.onstop = null
      if (this.recorder.state !== "inactive") { try { this.recorder.stop() } catch { /* Already stopped. */ } }
    }
    this.chunks = []
  }
}

/** Browser-first compatibility route, with the retained GPT-4o file fallback. */
export class LegacyAudioAdapter extends AudioAdapter {
  private recognition?: BrowserRecognition
  private fallback?: FileAudioAdapter
  private final = ""
  private interim = ""
  private ended?: () => void
  async start(): Promise<void> {
    if (this.state !== "new") throw new Error("Audio adapters are single-use")
    this.transition("starting")
    try {
      if (!this.deps.createRecognition) { await this.startFallback(); return }
      if (this.recording.settings.voiceSubmissionMode === "automatic") await this.microphone()
      const recognition = this.deps.createRecognition()
      this.recognition = recognition
      recognition.lang = this.recording.language
      recognition.continuous = true
      recognition.interimResults = true
      let started!: () => void
      const startup = new Promise<void>(resolve => { started = resolve })
      recognition.onstart = () => { if (!this.abort.signal.aborted) started() }
      recognition.onresult = event => {
        if (this.abort.signal.aborted) return
        let interim = ""
        for (let index = event.resultIndex; index < event.results.length; index++) {
          const result = event.results[index]
          const text = result[0]?.transcript?.trim()
          if (!text) continue
          if (result.isFinal) { this.final = `${this.final} ${text}`.trim(); this.interim = "" }
          else interim = `${interim} ${text}`.trim()
        }
        this.interim = interim
        this.emit({ type: "transcript", text: this.text })
      }
      recognition.onerror = event => {
        if (this.abort.signal.aborted) return
        // Silence is normal in manual mode; onend restarts browser recognition.
        if (event.error === "no-speech" && this.state === "recording") return
        if (["starting", "recording"].includes(this.state) && ["network", "language-not-supported"].includes(event.error || "")) {
          this.detach()
          clearTimeout(this.duration)
          void this.startFallback().then(started).catch(() => this.fail("Browser recognition and OpenAI fallback are unavailable. Check your provider and microphone."))
        } else this.fail(event.error === "not-allowed" || event.error === "audio-capture"
          ? "Microphone access was denied or unavailable." : "Speech recognition failed. Please retry.")
      }
      recognition.onend = () => {
        if (this.state === "submitting") { this.ended?.(); return }
        if (this.state === "recording" && !this.abort.signal.aborted) {
          try { recognition.start() } catch { this.fail("Speech recognition could not restart. Please retry.") }
        }
      }
      recognition.start()
      await this.bounded(startup, 30000, "Speech recognition startup timed out. Check microphone permission and retry.")
      this.check()
      if (!this.fallback) this.ready()
    } catch (error) { this.cancel(); throw error }
  }
  private get text(): string { return `${this.final} ${this.interim}`.replace(/\s+/g, " ").trim() }
  private async startFallback(): Promise<void> {
    this.check()
    this.stopTracks()
    this.transition("starting")
    this.fallback = new FileAudioAdapter(this.recording, this.deps)
    await this.fallback.start()
    this.check()
    this.state = "recording"
  }
  async submit(): Promise<VoiceAdapterResult | null> {
    if (this.state !== "recording") return null
    this.transition("submitting")
    clearTimeout(this.duration)
    try {
      if (this.fallback) {
        const result = await this.fallback.submit()
        this.check()
        return result
      }
      const stopped = new Promise<void>(resolve => { this.ended = resolve })
      this.stopTracks()
      this.recognition?.stop()
      await this.bounded(stopped, 3000, "Speech recognition did not finish. Please retry.")
      this.check()
      this.detach()
      this.transition("stopped")
      return this.result(this.text)
    } catch (error) { this.cancel(); throw error }
  }
  private detach(): void {
    if (!this.recognition) return
    this.recognition.onstart = null
    this.recognition.onresult = null
    this.recognition.onerror = null
    this.recognition.onend = null
    try { this.recognition.abort() } catch { /* Already ended. */ }
    this.recognition = undefined
  }
  cancel(): void { super.cancel(); this.detach(); this.fallback?.cancel() }
}

/** Independent Live conversation: caption both speakers, never enter the file/answer pipeline. */
export class LiveAudioAdapter extends AudioAdapter {
  private microphoneMuted = false
  private peer?: RTCPeerConnection
  private channel?: RTCDataChannel
  private conversation = new LiveConversation()
  private writtenAnswers = new LiveWrittenAnswers()
  private readyResolve?: () => void
  private iceCleanup?: () => void
  async start(): Promise<void> {
    if (this.state !== "new") throw new Error("Audio adapters are single-use")
    this.transition("starting")
    try {
      const started = new Promise<void>(resolve => { this.readyResolve = resolve })
      const setup = async () => {
        this.peer = this.deps.createPeer()
        const microphone = await this.microphone()
        for (const track of microphone.getAudioTracks()) {
          track.enabled = false
          this.peer.addTrack(track, microphone)
        }
        // Do not connect remote tracks to an audio element or audio destination.
        this.channel = this.peer.createDataChannel("oai-events")
        this.channel.onmessage = ({ data }) => {
          if (this.abort.signal.aborted) return
          try {
            if (typeof data !== "string" || data.length > 65536) throw new Error()
            this.receive(JSON.parse(data))
          } catch { this.fail("Invalid Live event. Please retry.") }
        }
        this.channel.onclose = () => this.disconnected()
        this.channel.onerror = () => this.disconnected()
        this.peer.onconnectionstatechange = () => {
          if (["failed", "closed", "disconnected"].includes(this.peer?.connectionState || "")) this.disconnected()
        }
        await this.peer.setLocalDescription(await this.peer.createOffer())
        this.check()
        await this.waitForIce()
        this.check()
        const sdp = this.peer.localDescription?.sdp
        if (!sdp) throw new Error("Missing SDP offer")
        const answer = await this.deps.bridge.createLive({ recordingId: this.recording.recordingId, sequence: 0, sdp })
        this.check()
        await this.peer.setRemoteDescription({ type: "answer", sdp: answer.transport.sdp })
        await started
      }
      await this.bounded(setup(), 30000, "Live connection timed out. Check model access and retry.")
      this.check()
      this.stream?.getAudioTracks().forEach(track => { track.enabled = true })
      this.transition("recording")
    } catch (error) { this.cancel(); throw error }
  }
  private async waitForIce(): Promise<void> {
    const peer = this.peer!
    if (peer.iceGatheringState === "complete") return
    const gathering = new Promise<void>(resolve => {
      const changed = () => { if (peer.iceGatheringState === "complete") resolve() }
      peer.addEventListener("icegatheringstatechange", changed)
      this.iceCleanup = () => peer.removeEventListener("icegatheringstatechange", changed)
      changed()
    })
    try { await this.bounded(gathering, 10000, "ICE gathering timed out") }
    finally { this.iceCleanup?.(); this.iceCleanup = undefined }
  }
  private receive(event: unknown): void {
    if (!event || typeof event !== "object") throw new Error("Invalid event")
    const value = event as Record<string, unknown>
    if (value.type === "session.started" && this.state === "starting") this.readyResolve?.()
    else if (value.type === "session.closed") {
      this.cancel()
    } else if (value.type === "error") {
      this.fail("Live reported a session error. Start a new session or check OpenAI access.")
    } else if (["starting", "recording"].includes(this.state) && this.conversation.append(value)) {
      this.emit({ type: "live-captions", captions: this.conversation.captions })
    } else if (value.type === "response.event") {
      // Show exact backend text/code separately from the spoken summary.
      if (this.writtenAnswers.append(value)) {
        this.emit({ type: "live-written-answers", answers: this.writtenAnswers.answers })
      }
      const backend = value.event as { type?: unknown } | undefined
      if (backend?.type === "response.failed" || backend?.type === "error") {
        this.fail("Live's reasoning model could not answer. Check OpenAI model access and start a new session.")
      } else if (backend?.type === "response.incomplete") {
        this.fail("Live's reasoning response was incomplete. Start a new session and retry the question.")
      }
    }
  }
  private disconnected(): void {
    if (!this.abort.signal.aborted) this.fail("Live connection lost. Start a new session.")
  }
  // Live responds continuously. A file-submission shortcut must not close or reroute it.
  async submit(): Promise<VoiceAdapterResult | null> { return null }
  toggleMicrophone(): void {
    if (this.abort.signal.aborted || this.state !== "recording" || !this.stream) return
    this.microphoneMuted = !this.microphoneMuted
    // Disabled WebRTC tracks send silence: no new speech leaves the device, while
    // the session clock and incoming answer continue without a network round trip.
    this.stream.getAudioTracks().forEach(track => { track.enabled = !this.microphoneMuted })
    this.emit({ type: "microphone-muted", muted: this.microphoneMuted })
  }
  cancel(): void {
    if (this.writtenAnswers.finish("incomplete")) {
      this.emit({ type: "live-written-answers", answers: this.writtenAnswers.answers })
    }
    super.cancel()
    this.iceCleanup?.()
    this.iceCleanup = undefined
    if (this.channel) {
      this.channel.onmessage = null; this.channel.onclose = null; this.channel.onerror = null
      this.channel.close()
    }
    if (this.peer) { this.peer.onconnectionstatechange = null; this.peer.close() }
  }
}

export function createAudioAdapter(recording: VoiceRecordingDescriptor, deps: AudioAdapterDependencies): VoiceAudioAdapter {
  switch (recording.settings.voiceAudioService) {
    case "legacy": return new LegacyAudioAdapter(recording, deps)
    case "whisper": return new FileAudioAdapter(recording, deps)
    case "gpt-live": return new LiveAudioAdapter(recording, deps)
    default: throw new Error("Unsupported audio service")
  }
}
