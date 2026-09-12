import type { LiveDrainResult, LiveTranscriptFragment, VoiceSubmittedTurn, VoiceSubmissionMode } from "../../types/voiceAudio"

/** No timers infer speech or completeness. Caller supplies acoustic boundaries. */
export class LiveTranscriptDrain {
  private fragments: LiveTranscriptFragment[] = []
  private seen = new Set<string>()
  private turn: VoiceSubmittedTurn | null = null
  private ended = false

  constructor(readonly recordingId: string, readonly mode: VoiceSubmissionMode) {}

  append(recordingId: string, event: unknown): boolean {
    if (this.ended || recordingId !== this.recordingId || !event || typeof event !== "object") return false
    const e = event as Record<string, unknown>
    if (e.type !== "session.input_transcript.delta" || typeof e.event_id !== "string" ||
        typeof e.delta !== "string" || typeof e.start_ms !== "number" || typeof e.end_ms !== "number" ||
        !Number.isFinite(e.start_ms) || !Number.isFinite(e.end_ms) || e.start_ms < 0 || e.end_ms < e.start_ms ||
        this.seen.has(e.event_id)) return false
    this.seen.add(e.event_id)
    this.fragments.push({ eventId: e.event_id, delta: e.delta, startMs: e.start_ms, endMs: e.end_ms })
    return true
  }

  claim(turn: VoiceSubmittedTurn): boolean {
    if (this.ended || this.turn || turn.recordingId !== this.recordingId || !turn.turnId ||
        !["shortcut", "silence"].includes(turn.reason) || (this.mode === "manual" && turn.reason !== "shortcut")) return false
    this.turn = { ...turn }
    return true
  }

  get text(): string {
    return [...this.fragments].sort((a, b) => a.startMs - b.startMs).map(f => f.delta).join("")
  }

  finish(finalization: "confirmed" | "unconfirmed", closeReason?: string): LiveDrainResult | null {
    if (this.ended || !this.turn) return null
    this.ended = true
    return { ...this.turn, text: this.text, fragments: this.fragments.map(f => ({ ...f })),
      finalization, completeness: "requires-review", closeReason }
  }

  cancel(): void { this.ended = true }
}
