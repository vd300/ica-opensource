/** Local acoustic policy; transcript/provider timing never enters this detector. */
export class SpeechActivity {
  private speechStart?: number
  private lastSpeech?: number
  private heardSpeech = false
  private submitted = false
  constructor(private mode: "manual" | "automatic", private silenceMs: number) {}
  sample(rms: number, now: number): boolean {
    if (this.submitted || this.mode === "manual") return false
    if (!Number.isFinite(rms) || rms < 0) return false
    // Quiet speech should count without requiring a raised voice; retain the
    // sustained-speech gate so brief clicks cannot trigger submission.
    if (rms >= 0.006) {
      this.speechStart ??= now
      this.lastSpeech = now
      if (now - this.speechStart >= 250) this.heardSpeech = true
    } else {
      this.speechStart = undefined
      if (this.heardSpeech && this.lastSpeech !== undefined && now - this.lastSpeech >= this.silenceMs) {
        this.submitted = true
        return true
      }
    }
    return false
  }
}

export function observeSpeech(stream: MediaStream, silenceMs: number, submit: () => void): () => void {
  const context = new AudioContext()
  const source = context.createMediaStreamSource(stream)
  const analyser = context.createAnalyser()
  analyser.fftSize = 2048
  source.connect(analyser)
  // No destination connection: microphone audio is never played back.
  const samples = new Float32Array(analyser.fftSize)
  const detector = new SpeechActivity("automatic", silenceMs)
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(samples)
    const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length)
    if (detector.sample(rms, performance.now())) submit()
  }, 50)
  void context.resume().catch(() => {})
  return () => { clearInterval(timer); source.disconnect(); analyser.disconnect(); void context.close().catch(() => {}) }
}
