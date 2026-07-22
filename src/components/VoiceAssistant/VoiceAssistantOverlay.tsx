import { Loader2, Mic, Send, Square, Wand2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Button } from "../ui/button"
import { useSpeechRecognition } from "./useSpeechRecognition"
import type {
  VoiceAnswerChunkPayload,
  VoiceAnswerCompletePayload,
  VoiceAnswerStartPayload,
  VoiceErrorPayload,
  VoiceIntent,
  VoiceModeStatus,
  VoiceModeStatusPayload,
  VoiceTranscriptSegment,
  VoiceTriggerDetectedPayload
} from "../../types/voice"

type OverlayState = {
  isOpen: boolean
  status: VoiceModeStatus
  requestId: string | null
  activeIntent: VoiceIntent | null
  interimTranscript: string
  finalTranscript: string
  answer: string
  error: string | null
}

const initialState: OverlayState = {
  isOpen: false,
  status: "idle",
  requestId: null,
  activeIntent: null,
  interimTranscript: "",
  finalTranscript: "",
  answer: "",
  error: null
}

const statusLabels: Record<VoiceModeStatus, string> = {
  idle: "Idle",
  listening: "Listening",
  capturing: "Capturing",
  answering: "Answering",
  complete: "Complete",
  error: "Error"
}

const intentLabels: Record<VoiceIntent, string> = {
  solve: "Solve",
  explain: "Explain",
  complexity: "Complexity",
  debug: "Debug"
}

const busyStatuses = new Set<VoiceModeStatus>(["capturing", "answering"])

export function VoiceAssistantOverlay() {
  const recognitionState = useSpeechRecognition()
  const [state, setState] = useState<OverlayState>(initialState)
  const [typedPrompt, setTypedPrompt] = useState("")

  useEffect(() => {
    if (!recognitionState.interimTranscript && !recognitionState.finalTranscript) {
      return
    }

    setState((current) => ({
      ...current,
      interimTranscript:
        recognitionState.interimTranscript || current.interimTranscript,
      finalTranscript:
        recognitionState.finalTranscript || current.finalTranscript
    }))
  }, [recognitionState.finalTranscript, recognitionState.interimTranscript])

  useEffect(() => {
    if (!recognitionState.error) {
      return
    }

    setState((current) => ({
      ...current,
      isOpen: true,
      status: "error",
      error: recognitionState.error
    }))
  }, [recognitionState.error])

  useEffect(() => {
    const cleanupFunctions = [
      window.electronAPI.onVoiceModeStarted(() => {
        setState({
          ...initialState,
          isOpen: true,
          status: "listening"
        })
      }),
      window.electronAPI.onVoiceModeStopped(() => {
        setState(initialState)
      }),
      window.electronAPI.onVoiceStatus((payload: VoiceModeStatusPayload) => {
        setState((current) => ({
          ...current,
          isOpen: payload.status !== "idle" || current.isOpen,
          status: payload.status,
          requestId: payload.requestId ?? current.requestId,
          activeIntent: payload.activeIntent ?? current.activeIntent,
          error: payload.status === "error" ? payload.message ?? current.error : current.error
        }))
      }),
      window.electronAPI.onVoiceInterimTranscript((text: string) => {
        setState((current) => ({
          ...current,
          interimTranscript: text
        }))
      }),
      window.electronAPI.onVoiceFinalTranscript((segment: VoiceTranscriptSegment) => {
        setState((current) => ({
          ...current,
          finalTranscript: segment.text,
          interimTranscript: ""
        }))
      }),
      window.electronAPI.onVoiceTriggerDetected((payload: VoiceTriggerDetectedPayload) => {
        setState((current) => ({
          ...current,
          isOpen: true,
          status: "capturing",
          requestId: payload.requestId,
          activeIntent: payload.intent,
          finalTranscript: payload.transcript,
          answer: "",
          error: null
        }))
      }),
      window.electronAPI.onVoiceAnswerStart((payload: VoiceAnswerStartPayload) => {
        setState((current) => ({
          ...current,
          isOpen: true,
          status: "answering",
          requestId: payload.requestId,
          activeIntent: payload.intent,
          answer: "",
          error: null
        }))
      }),
      window.electronAPI.onVoiceAnswerChunk((payload: VoiceAnswerChunkPayload) => {
        setState((current) => {
          if (current.requestId && current.requestId !== payload.requestId) {
            return current
          }

          return {
            ...current,
            status: "answering",
            requestId: payload.requestId,
            answer: `${current.answer}${payload.text}`
          }
        })
      }),
      window.electronAPI.onVoiceAnswerComplete((payload: VoiceAnswerCompletePayload) => {
        setState((current) => {
          if (current.requestId && current.requestId !== payload.requestId) {
            return current
          }

          return {
            ...current,
            status: "complete",
            requestId: payload.requestId,
            answer: current.answer || payload.text || current.answer
          }
        })
      }),
      window.electronAPI.onVoiceError((payload: VoiceErrorPayload) => {
        setState((current) => ({
          ...current,
          isOpen: true,
          status: "error",
          requestId: payload.requestId ?? current.requestId,
          error: payload.message
        }))
      })
    ]

    return () => {
      cleanupFunctions.forEach((cleanup) => cleanup())
    }
  }, [])

  const latestTranscript = state.interimTranscript || state.finalTranscript
  const displayStatus = useMemo(() => {
    if (state.activeIntent) {
      return `${statusLabels[state.status]} - ${intentLabels[state.activeIntent]}`
    }

    return statusLabels[state.status]
  }, [state.activeIntent, state.status])

  if (!state.isOpen) {
    return null
  }

  const isBusy = busyStatuses.has(state.status)

  const submitTypedPrompt = () => {
    const text = typedPrompt.trim()
    if (!text) {
      return
    }

    setState((current) => ({
      ...current,
      error: null,
      finalTranscript: text,
      interimTranscript: ""
    }))
    setTypedPrompt("")
    window.electronAPI.sendVoiceTranscriptSegment({
      text,
      isFinal: true,
      confidence: 1,
      receivedAt: Date.now()
    })
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[min(28rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-white/10 bg-zinc-950/95 text-white shadow-2xl backdrop-blur-md">
      <div className="flex h-11 items-center justify-between border-b border-white/10 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/10">
            {isBusy ? (
              <Loader2 className="h-4 w-4 animate-spin text-cyan-300" />
            ) : state.status === "listening" ? (
              <Mic className="h-4 w-4 text-emerald-300" />
            ) : (
              <Wand2 className="h-4 w-4 text-violet-300" />
            )}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium leading-tight">
              {displayStatus}
            </div>
            {latestTranscript ? (
              <div className="truncate text-xs text-white/55">{latestTranscript}</div>
            ) : null}
          </div>
        </div>

        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0 text-white/70 hover:bg-white/10 hover:text-white"
          title="Stop voice assistant"
          onClick={() => window.electronAPI.stopVoiceMode()}
        >
          <Square className="h-4 w-4" />
        </Button>
      </div>

      <div className="max-h-72 min-h-28 overflow-y-auto px-3 py-3">
        {state.error ? (
          <div className="space-y-3">
            <div className="rounded-md border border-red-400/25 bg-red-500/10 px-3 py-2 text-sm text-red-100">
              {state.error}
            </div>
            <div className="flex gap-2">
              <input
                value={typedPrompt}
                onChange={(event) => setTypedPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    submitTypedPrompt()
                  }
                }}
                placeholder="Type a prompt..."
                className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-white/35 focus:border-white/25"
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-9 w-9 shrink-0 text-white/70 hover:bg-white/10 hover:text-white"
                title="Send typed prompt"
                onClick={submitTypedPrompt}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : state.answer ? (
          <div className="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-white/90">
            {state.answer}
          </div>
        ) : latestTranscript ? (
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-wide text-white/40">
              Transcript
            </div>
            <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-white/80">
              {latestTranscript}
            </div>
          </div>
        ) : (
          <div className="flex min-h-20 items-center text-sm text-white/55">
            {recognitionState.isSupported
              ? "Listening..."
              : "Speech recognition is unavailable."}
          </div>
        )}
      </div>
    </div>
  )
}
