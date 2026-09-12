export interface LiveWrittenAnswer {
  id: string
  delegationId: string
  text: string
  status: "streaming" | "complete" | "incomplete"
}

/** Keep verbatim backend text separate from Live's spoken captions. */
export class LiveWrittenAnswers {
  private parts = new Map<string, LiveWrittenAnswer & { deltas: Map<number, string> }>()
  private size = 0

  append(envelope: Record<string, unknown>): boolean {
    if (envelope.type !== "response.event" || typeof envelope.delegation_id !== "string") return false
    const event = envelope.event as Record<string, unknown> | undefined
    if (!event || typeof event !== "object") return false
    if (event.type === "response.completed") {
      return this.finish("complete", envelope.delegation_id)
    }
    if (event.type !== "response.output_text.delta" && event.type !== "response.output_text.done") return false
    if (typeof event.item_id !== "string" || !Number.isSafeInteger(event.content_index) ||
        (event.content_index as number) < 0 || !Number.isSafeInteger(event.sequence_number)) return false
    const text = event.type === "response.output_text.delta" ? event.delta : event.text
    if (typeof text !== "string") return false
    const id = JSON.stringify([envelope.delegation_id, event.item_id, event.content_index])
    const previous = this.parts.get(id)
    if (previous?.status === "complete") return false
    if (previous?.deltas.has(event.sequence_number as number)) return false
    if (this.size + text.length > 1000000 || (!previous && this.parts.size >= 1000)) {
      throw new Error("Live written answer limit reached")
    }
    const part = previous || { id, delegationId: envelope.delegation_id, text: "", status: "streaming" as const, deltas: new Map<number, string>() }
    this.size += text.length
    if (event.type === "response.output_text.done") {
      part.text = text
      part.status = "complete"
      part.deltas.clear()
    } else {
      part.deltas.set(event.sequence_number as number, text)
      part.text = [...part.deltas].sort(([a], [b]) => a - b).map(([, delta]) => delta).join("")
    }
    this.parts.set(id, part)
    return true
  }

  finish(status: "complete" | "incomplete", delegationId?: string): boolean {
    let changed = false
    for (const part of this.parts.values()) {
      if (part.status === "streaming" && (!delegationId || part.delegationId === delegationId)) {
        part.status = status
        changed = true
      }
    }
    return changed
  }

  get answers(): LiveWrittenAnswer[] {
    return [...this.parts.values()].map(({ id, delegationId, text, status }) => ({ id, delegationId, text, status }))
  }
}
