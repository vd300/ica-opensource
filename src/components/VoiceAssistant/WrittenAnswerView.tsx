import { useState } from "react"
import type { LiveWrittenAnswer } from "./LiveWrittenAnswers"

/** Render fenced code as inert text, preserving whitespace even during streaming. */
export function WrittenAnswerView({ answer }: { answer: LiveWrittenAnswer }) {
  const [copyState, setCopyState] = useState("Copy")
  const blocks = answer.text.split(/^[ \t]*```[^\r\n]*\r?\n?/m)
  return <section className="rounded-md border border-cyan-300/20 bg-cyan-950/10 p-3">
    <div className="mb-2 flex items-center justify-between gap-2 text-xs text-cyan-200">
      <span>Written answer{answer.status === "streaming" ? " / Generating" : answer.status === "incomplete" ? " / Incomplete" : ""}</span>
      <button type="button" disabled={!answer.text} className="rounded px-2 py-1 hover:bg-white/10" onClick={async () => {
        try { await navigator.clipboard.writeText(answer.text); setCopyState("Copied") }
        catch { setCopyState("Copy failed") }
      }}>{copyState}</button>
    </div>
    <div className="space-y-2">
      {blocks.map((block, index) => index % 2
        ? <pre key={index} className="overflow-x-auto rounded bg-black/50 p-3 font-mono text-xs leading-relaxed text-white/90"><code>{block}</code></pre>
        : block && <div key={index} className="whitespace-pre-wrap break-words text-sm leading-relaxed text-white/90">{block}</div>)}
    </div>
  </section>
}
