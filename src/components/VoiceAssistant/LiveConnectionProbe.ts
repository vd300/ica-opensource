import type { LiveDrainResult, LiveSessionAnswer, VoiceSubmissionMode, VoiceSubmissionReason } from "../../types/voiceAudio"
import { LiveTranscriptDrain } from "./LiveTranscriptDrain"

export interface LiveProbeDependencies {
  createSession(sdp: string): Promise<LiveSessionAnswer>
  abandonSession(sessionId: string): Promise<void>
  getMicrophone(): Promise<MediaStream>
  createPeer(): RTCPeerConnection
  report(message: string): void
}

/** Isolated feasibility harness. Has no answer-generation or playback capability. */
export class LiveConnectionProbe {
  private peer?: RTCPeerConnection
  private channel?: RTCDataChannel
  private microphone?: MediaStream
  private closed = false
  private ready = false
  private closing = false
  private timeout?: ReturnType<typeof setTimeout>
  private resolveDrain?: (result: LiveDrainResult | null) => void
  readonly drain: LiveTranscriptDrain

  constructor(readonly recordingId: string, mode: VoiceSubmissionMode,
    private deps: LiveProbeDependencies, private closeTimeoutMs = 15000) {
    this.drain = new LiveTranscriptDrain(recordingId, mode)
  }

  async start(): Promise<void> {
    if (this.peer || this.closed) throw new Error("Probe instances are single-use")
    this.peer = this.deps.createPeer()
    this.timeout = setTimeout(() => this.fail("Session startup timed out"), 30000)
    try {
      const microphone = await this.deps.getMicrophone()
      if (this.closed) { microphone.getTracks().forEach(t => t.stop()); return }
      this.microphone = microphone
      for (const track of microphone.getAudioTracks()) {
        track.enabled = false // Do not transmit speech before session.started.
        this.peer.addTrack(track, microphone)
      }
      // Intentionally no ontrack playback, Audio element, or audio destination.
      this.channel = this.peer.createDataChannel("oai-events")
      this.channel.onmessage = ({ data }) => {
        try { this.receive(JSON.parse(data)) } catch { this.fail("Invalid Live event") }
      }
      this.channel.onclose = () => { if (!this.closed) this.fail("Disconnected before session.closed") }
      this.channel.onerror = () => this.fail("Live data channel failed")
      this.peer.onconnectionstatechange = () => {
        if (this.peer?.connectionState === "failed") this.fail("WebRTC connection failed")
      }
      await this.peer.setLocalDescription(await this.peer.createOffer())
      await this.waitForIce()
      if (this.closed) return
      const sdp = this.peer.localDescription?.sdp
      if (!sdp) throw new Error("Missing SDP offer")
      const answer = await this.deps.createSession(sdp)
      if (this.closed) {
        try { await this.deps.abandonSession(answer.session.id) }
        catch { this.deps.report("Late session cleanup unconfirmed") }
        return
      }
      await this.peer.setRemoteDescription({ type: "answer", sdp: answer.transport.sdp })
    } catch { this.fail("Live startup failed; check model access, microphone permission and network") }
  }

  private waitForIce(): Promise<void> {
    const peer = this.peer!
    if (peer.iceGatheringState === "complete") return Promise.resolve()
    return new Promise((resolve, reject) => {
      const onState = () => {
        if (peer.iceGatheringState !== "complete") return
        clearTimeout(timer)
        peer.removeEventListener("icegatheringstatechange", onState)
        resolve()
      }
      const timer = setTimeout(() => {
        peer.removeEventListener("icegatheringstatechange", onState)
        reject(new Error("ICE timeout"))
      }, 10000)
      peer.addEventListener("icegatheringstatechange", onState)
      onState()
    })
  }

  private receive(event: Record<string, unknown>): void {
    if (this.closed) return
    if (event.type === "session.started" && !this.ready && !this.closing) {
      clearTimeout(this.timeout)
      this.ready = true
      this.microphone?.getTracks().forEach(t => { t.enabled = true })
      this.timeout = setTimeout(() => this.cancel(), 120000)
      this.deps.report("Ready. Microphone streaming; playback disabled.")
    } else if (event.type === "session.closed") {
      const result = this.drain.finish("confirmed", typeof event.reason === "string" ? event.reason : undefined)
      this.dispose()
      this.resolveDrain?.(result)
      this.deps.report("Session finalized. Transcript completeness still requires review.")
    } else if (event.type === "error") {
      this.fail("Live provider returned an error")
    } else if (this.ready && this.drain.append(this.recordingId, event)) {
      this.deps.report(this.drain.text)
    }
    // Delegation and output events cannot submit a question or execute a backend.
  }

  submit(reason: VoiceSubmissionReason): Promise<LiveDrainResult | null> {
    if (!this.ready || this.closed || !this.drain.claim({ recordingId: this.recordingId,
      turnId: `${this.recordingId}:1`, reason })) return Promise.resolve(null)
    return new Promise(resolve => { this.resolveDrain = resolve; this.closeSession() })
  }

  cancel(): void {
    this.drain.cancel()
    this.resolveDrain?.(null)
    this.resolveDrain = undefined
    this.closeSession()
  }

  private closeSession(): void {
    if (this.closed || this.closing) return
    this.closing = true
    this.microphone?.getTracks().forEach(t => t.stop())
    clearTimeout(this.timeout)
    if (this.channel?.readyState !== "open" || !this.ready) { this.fail("Stopped before session ready"); return }
    // Keep receiving late input deltas until finalization, not a quiet-period guess.
    this.timeout = setTimeout(() => this.fail("Incomplete finalization: close deadline exceeded"), this.closeTimeoutMs)
    try { this.channel.send(JSON.stringify({ type: "session.close" })) }
    catch { this.fail("Failed to close Live session") }
  }

  private fail(message: string): void {
    if (this.closed) return
    const result = this.drain.finish("unconfirmed")
    this.dispose()
    this.resolveDrain?.(result)
    this.deps.report(message)
  }

  private dispose(): void {
    this.closed = true
    clearTimeout(this.timeout)
    this.microphone?.getTracks().forEach(t => t.stop())
    this.channel?.close()
    this.peer?.close()
  }
}
