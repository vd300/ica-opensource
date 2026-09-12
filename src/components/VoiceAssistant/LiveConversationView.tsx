import { useLayoutEffect, useRef, useState } from "react"
import type { LiveWrittenAnswer } from "./LiveWrittenAnswers"
import { WrittenAnswerView } from "./WrittenAnswerView"
import type { LiveCaption } from "./LiveConversation"

export function LiveConversationView({ captions, answers, listening, muted, error }: {
  answers: LiveWrittenAnswer[]; captions: LiveCaption[]; listening: boolean; muted: boolean; error: string | null
}) {
  const [view, setView] = useState<"conversation" | "written">("conversation")
  const conversationScroll = useRef<HTMLDivElement>(null)
  const writtenScroll = useRef<HTMLDivElement>(null)
  const latestCaption = useRef<HTMLDivElement>(null)
  const writtenPositions = useRef(new Map<string, number>())
  const [selectedAnswerId, setSelectedAnswerId] = useState<string | null>(null)
  const followConversation = useRef(true)
  const [readingHistory, setReadingHistory] = useState(false)
  const [seenAnswerCount, setSeenAnswerCount] = useState(0)
  const [openedWritten, setOpenedWritten] = useState(false)
  const [focusAnswer, setFocusAnswer] = useState(0)
  const lastCaptionId = captions[captions.length - 1]?.id
  const generating = answers.some(answer => answer.status === "streaming")
  const generatingAnswer = [...answers].reverse().find(answer => answer.status === "streaming")
  const newestAnswer = answers[answers.length - 1]
  const selectedAnswer = answers.find(answer => answer.id === selectedAnswerId)
  const newAnswers = Math.max(0, answers.length - seenAnswerCount)

  const alignStart = (container: HTMLDivElement | null, row: HTMLDivElement | null) => {
    if (container && row) container.scrollTop += row.getBoundingClientRect().top - container.getBoundingClientRect().top - 12
  }
  // Focus a new reply once; growing text must not push the reader to its end.
  useLayoutEffect(() => {
    if (view === "conversation" && followConversation.current) alignStart(conversationScroll.current, latestCaption.current)
  }, [lastCaptionId, view])
  // Each answer has its own saved position. Growth in a different answer cannot
  // shift this viewport, and streaming/completion never triggers navigation.
  useLayoutEffect(() => {
    if (view === "written" && writtenScroll.current && selectedAnswerId) {
      writtenScroll.current.scrollTop = focusAnswer > 0 ? 0 : writtenPositions.current.get(selectedAnswerId) || 0
      if (focusAnswer > 0) writtenPositions.current.set(selectedAnswerId, 0)
      setFocusAnswer(0)
    }
  }, [view, focusAnswer, selectedAnswerId])
  const pauseFollowing = () => { followConversation.current = false; setReadingHistory(true) }
  const openWritten = () => {
    setView("written")
    if (!openedWritten || !selectedAnswerId) {
      setOpenedWritten(true)
      setSelectedAnswerId((generatingAnswer || newestAnswer)?.id || null)
      setSeenAnswerCount(answers.length)
      setFocusAnswer(1)
    }
  }
  const showAnswer = () => {
    setOpenedWritten(true)
    setView("written")
    setSelectedAnswerId((generatingAnswer || newestAnswer)?.id || null)
    setSeenAnswerCount(answers.length)
    setFocusAnswer(value => value + 1)
  }
  const jumpLatest = () => {
    if (view === "written") showAnswer()
    else {
      followConversation.current = true
      setReadingHistory(false)
      alignStart(conversationScroll.current, latestCaption.current)
    }
  }

  return <>
    <div className="mt-2 flex gap-1 border-y border-white/10 px-3 py-2" aria-label="Response views">
      <button type="button" aria-pressed={view === "conversation"} onClick={() => setView("conversation")}
        className={`rounded px-2 py-1 text-xs ${view === "conversation" ? "bg-white/15 text-white" : "text-white/55 hover:bg-white/10"}`}>Conversation</button>
      <button type="button" aria-pressed={view === "written"} onClick={openWritten}
        className={`rounded px-2 py-1 text-xs ${view === "written" ? "bg-cyan-400/15 text-cyan-200" : "text-white/55 hover:bg-white/10"}`}>
        Written answers ({answers.length}){newAnswers > 0 ? ` / ${newAnswers} new` : ""}
      </button>
    </div>
    <div role="status" className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-white/55">
      <span>{generating ? "Written answer generating..." : answers.length ? "Written answer ready" : listening ? muted ? "Microphone muted" : "Listening for your question" : "Session inactive"}</span>
      {answers.length > 0 && <button type="button" className="shrink-0 text-cyan-300" onClick={showAnswer}>{generating ? "Show generating answer" : "Show latest answer"}</button>}
    </div>
    <div ref={conversationScroll} hidden={view !== "conversation"} aria-label="Conversation" tabIndex={0}
      className="max-h-72 min-h-28 overflow-y-auto px-3 py-3"
      onWheel={pauseFollowing} onTouchMove={pauseFollowing} onPointerDown={pauseFollowing}
      onKeyDown={event => { if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) pauseFollowing() }}>
      {!captions.length && <p className="text-sm text-white/55">{listening ? muted ? "Microphone muted. Unmute when you are ready to speak." : "Listening. Ask a question to begin." : "Connecting to GPT-Live..."}</p>}
      <div className="space-y-4">
        {captions.map((caption, index) => <div key={caption.id} ref={index === captions.length - 1 ? latestCaption : undefined}>
          <div className="mb-1 text-xs text-white/45">{caption.speaker === "user" ? "You" : "gpt-live-1"}</div>
          <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-white/90">{caption.text}</div>
        </div>)}
      </div>
    </div>
    {view === "written" && answers.length > 0 && <div className="flex items-center gap-2 px-3 pb-2 text-xs text-white/60">
      <label htmlFor="live-written-answer">Reading</label>
      <select id="live-written-answer" value={selectedAnswerId || ""}
        className="min-w-0 flex-1 rounded border border-white/15 bg-zinc-900 px-2 py-1 text-white"
        onChange={event => { setSelectedAnswerId(event.target.value); setSeenAnswerCount(answers.length) }}>
        {!selectedAnswerId && <option value="">Choose an answer</option>}
        {answers.map((answer, index) => <option key={answer.id} value={answer.id}>
          Answer {index + 1}{answer.status === "streaming" ? " - Generating" : answer.status === "incomplete" ? " - Incomplete" : " - Ready"}
        </option>)}
      </select>
      <button type="button" disabled={!selectedAnswerId} className="shrink-0 text-cyan-300 disabled:opacity-40"
        onClick={() => setFocusAnswer(value => value + 1)}>Back to start</button>
    </div>}
    <div ref={writtenScroll} hidden={view !== "written"} aria-label="Written answers" tabIndex={0}
      className="max-h-72 min-h-28 overflow-y-auto px-3 py-3" style={{ overflowAnchor: "none" }}
      onScroll={event => { if (selectedAnswerId) writtenPositions.current.set(selectedAnswerId, event.currentTarget.scrollTop) }}>
      {!answers.length && <p className="text-sm text-white/55">Ask for code or a written example. It will appear here without moving your conversation.</p>}
      {selectedAnswer && <WrittenAnswerView key={selectedAnswer.id} answer={selectedAnswer} />}
    </div>
    {error && <p role="alert" className="mx-3 my-2 rounded-md border border-red-400/25 bg-red-500/10 px-3 py-2 text-sm text-red-100">{error}</p>}
    {!listening && (captions.length > 0 || answers.length > 0) && !error && <p className="px-3 py-2 text-xs text-white/50">Session ended. Start voice mode again to continue.</p>}
    {(view === "written" && answers.length > 0 || view === "conversation" && captions.length > 0) && <div className="flex items-center justify-between gap-2 border-t border-white/10 px-3 py-2 text-xs text-white/45">
      <span>{view === "written" || readingHistory ? "Reading position held" : "Following new replies"}</span>
      <button type="button" className="text-cyan-300" onClick={jumpLatest}>{view === "written" ? generating ? "Generating answer (start)" : "Latest answer (start)" : "Latest reply (start)"}</button>
    </div>}
  </>
}
