export interface LiveCaption {
  id: string
  speaker: "user" | "assistant"
  text: string
  startMs: number
  endMs: number
}

/** Timeline fragments are captions, never submission or answer triggers. */
export class LiveConversation {
  private fragments: LiveCaption[] = []
  private seen = new Set<string>()
  private size = 0

  append(event: Record<string, unknown>): boolean {
    const speaker = event.type === "session.input_transcript.delta" ? "user"
      : event.type === "session.output_transcript.delta" ? "assistant" : null
    if (!speaker) return false
    const { event_id: id, delta, start_ms: startMs, end_ms: endMs } = event
    if (typeof id !== "string" || !id || typeof delta !== "string" ||
        typeof startMs !== "number" || typeof endMs !== "number" ||
        !Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs < startMs) {
      throw new Error("Invalid Live caption")
    }
    if (this.seen.has(id)) return false
    if (this.size + delta.length > 1000000 || this.fragments.length >= 100000) {
      throw new Error("Live conversation limit reached. Start a new session.")
    }
    this.seen.add(id)
    this.size += delta.length
    this.fragments.push({ id, speaker, text: delta, startMs, endMs })
    return true
  }

  get captions(): LiveCaption[] {
    const rows: LiveCaption[] = []
    for (const fragment of [...this.fragments].sort((a, b) => a.startMs - b.startMs)) {
      const last = rows[rows.length - 1]
      // Display grouping only; late fragments rebuild the affected groups.
      if (last?.speaker === fragment.speaker && fragment.startMs - last.endMs <= 1500) {
        last.text += fragment.text
        last.endMs = Math.max(last.endMs, fragment.endMs)
      } else rows.push({ ...fragment })
    }
    return rows
  }
}
