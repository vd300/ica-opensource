import type { BrowserWindow } from "electron"
import { randomUUID } from "crypto"
import { VOICE_IPC_CHANNELS } from "./voiceIpc"
import type {
  VoiceAnswerChunkPayload,
  VoiceAnswerCompletePayload,
  VoiceAnswerStartPayload,
  VoiceErrorPayload,
  VoiceIntent,
  VoiceIpcResult,
  VoiceModeStatus,
  VoiceModeStatusPayload,
  VoiceRecognitionErrorPayload,
  VoiceTranscriptSegment,
  VoiceTriggerDetectedPayload
} from "../src/types/voice"

type VoiceAnswerParams = {
  requestId: string
  intent: VoiceIntent
  transcript: string
  screenshotBase64?: string
  signal: AbortSignal
  onChunk: (text: string) => void
  onComplete: (text?: string) => void
}

type VoiceScreenContext = {
  screenshotBase64: string
  cleanup?: () => void | Promise<void>
}

export interface VoiceAssistantControllerDeps {
  getMainWindow: () => BrowserWindow | null
  getVoiceSettings?: () => {
    enabled: boolean
    minConfidence: number
  }
  hasApiKey?: () => boolean
  captureScreenContext?: (signal: AbortSignal) => Promise<VoiceScreenContext>
  streamVoiceAnswer?: (params: VoiceAnswerParams) => Promise<void>
  now?: () => number
  debounceMs?: number
}

export interface VoiceSessionState {
  enabled: boolean
  status: VoiceModeStatus
  lastTranscript: string
  activeIntent: VoiceIntent | null
  requestId: string | null
  activeAbortController: AbortController | null
  lastTriggeredAt: number
  lastTriggeredText: string | null
}

type IntentPattern = {
  intent: VoiceIntent
  patterns: RegExp[]
}

const INTENT_PATTERNS: IntentPattern[] = [
  {
    intent: "solve",
    patterns: [
      /\bsolve this\b/i,
      /\bcan you solve this\b/i,
      /\bwrite (the )?solution\b/i,
      /\bimplement (the )?solution\b/i,
      /\b(answer|handle|work through|walk through|help (me )?with|take a look at) (this|it|the problem|the question|the prompt)\b/i,
      /\bhow (would|do) (you|we) (solve|approach|handle) (this|it|the problem|the question|the prompt)\b/i,
      /\bwhat (should|would) (i|we|you) do (here|next|for this)\b/i,
      /\bcan you (help|answer|do) (this|it)\b/i,
      /\b(can you )?give me the solution\b/i
    ]
  },
  {
    intent: "explain",
    patterns: [
      /\bexplain this\b/i,
      /\bwalk me through\b/i,
      /\bwhat('s| is) the approach\b/i,
      /\bexplain (the )?approach\b/i
    ]
  },
  {
    intent: "complexity",
    patterns: [
      /\btime complexity\b/i,
      /\bspace complexity\b/i,
      /\bcomplexity analysis\b/i,
      /\bbig o\b/i
    ]
  },
  {
    intent: "debug",
    patterns: [
      /\bwhat('s| is) wrong\b/i,
      /\bfix this\b/i,
      /\bwhy .* failing\b/i,
      /\bdebug this\b/i
    ]
  }
]

const DEFAULT_DEBOUNCE_MS = 5000
const DEFAULT_MIN_CONFIDENCE = 0.3
const MIN_FREEFORM_PROMPT_WORDS = 3

const TECHNICAL_TRANSCRIPT_CORRECTIONS: Array<[RegExp, string]> = [
  [/\b(?:jil|gim|gel|gill|g i l|gee eye ell)\b/gi, "GIL"],
  [/\bglobal interpreter lock\b/gi, "Global Interpreter Lock"],
  [/\bcough ka\b/gi, "Kafka"],
  [/\bsequel\b/gi, "SQL"],
  [/\brest api\b/gi, "REST API"],
  [/\bfast api\b/gi, "FastAPI"],
  [/\bnode js\b/gi, "Node.js"],
  [/\btype script\b/gi, "TypeScript"],
  [/\bjava script\b/gi, "JavaScript"],
  [/\bpost gres\b/gi, "Postgres"],
  [/\bkuber net ease\b/gi, "Kubernetes"],
  [/\bhandel\b/gi, "handle"],
  [/\bsayy+\b/gi, "say"]
]

const hasWords = (text: string): boolean => /[a-z0-9]/i.test(text)

const isLikelyMicCheck = (text: string): boolean =>
  /\b(mic|microphone) check\b/i.test(text) ||
  /\b(test(ing)?|hello)\b/i.test(text) && !/[?]/.test(text)

export function normalizeVoiceTranscript(text: string): string {
  const correctedText = TECHNICAL_TRANSCRIPT_CORRECTIONS.reduce(
    (normalized, [pattern, replacement]) =>
      normalized.replace(pattern, replacement),
    text
  )

  return correctedText
    .replace(/[.]{2,}/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b([a-z]+)\s+\1\b/gi, "$1")
    .trim()
}

const isActionableFreeformPrompt = (text: string): boolean => {
  const normalizedText = text.trim()
  if (!hasWords(normalizedText) || isLikelyMicCheck(normalizedText)) {
    return false
  }

  const words = normalizedText.match(/[a-z0-9]+/gi) ?? []
  if (words.length < MIN_FREEFORM_PROMPT_WORDS) {
    return false
  }

  const asksForHelp =
    /[?]/.test(normalizedText) ||
    /\b(can|could|please|tell|give|show|find|write|implement|explain|solve|debug|fix|help|analyze|compare|design)\b/i.test(normalizedText) ||
    /\b(how|what|why|which|where|when)\b/i.test(normalizedText) ||
    /\bhave you\b/i.test(normalizedText)

  return asksForHelp
}

export function detectVoiceIntent(text: string): VoiceIntent | null {
  const normalizedText = normalizeVoiceTranscript(text)
  if (!normalizedText) {
    return null
  }

  const match = INTENT_PATTERNS.find(({ patterns }) =>
    patterns.some((pattern) => pattern.test(normalizedText))
  )

  if (match?.intent) {
    return match.intent
  }

  if (/\bexplain\b/i.test(normalizedText)) {
    return "explain"
  }

  return isActionableFreeformPrompt(normalizedText) ? "solve" : null
}

export class VoiceAssistantController {
  private readonly deps: VoiceAssistantControllerDeps
  private readonly debounceMs: number
  private readonly now: () => number

  private state: VoiceSessionState = {
    enabled: false,
    status: "idle",
    lastTranscript: "",
    activeIntent: null,
    requestId: null,
    activeAbortController: null,
    lastTriggeredAt: 0,
    lastTriggeredText: null
  }

  constructor(deps: VoiceAssistantControllerDeps) {
    this.deps = deps
    this.debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS
    this.now = deps.now ?? (() => Date.now())
  }

  public getState(): VoiceSessionState {
    return { ...this.state }
  }

  public toggle(): VoiceIpcResult {
    return this.state.enabled ? this.stop() : this.start()
  }

  public start(): VoiceIpcResult {
    if (!this.getVoiceSettings().enabled) {
      const error = {
        code: "unknown" as const,
        message: "Voice assistant is disabled in settings.",
        recoverable: true
      }
      this.sendError(error)
      this.sendStatus(error.message)
      return { success: false, error: error.message }
    }

    if (this.state.enabled) {
      this.sendStatus()
      return { success: true }
    }

    this.state = {
      ...this.state,
      enabled: true,
      status: "listening",
      lastTranscript: "",
      activeIntent: null,
      requestId: null
    }

    this.send(VOICE_IPC_CHANNELS.MODE_STARTED)
    this.sendStatus()

    return { success: true }
  }

  public stop(): VoiceIpcResult {
    const hadActiveRequest = Boolean(this.state.activeAbortController)
    const requestId = this.state.requestId

    this.abortActiveRequest()

    this.state = {
      ...this.state,
      enabled: false,
      status: "idle",
      activeIntent: null,
      requestId: null,
      lastTranscript: ""
    }

    if (hadActiveRequest) {
      this.sendError({
        code: "cancelled",
        message: "Voice assistant stopped.",
        recoverable: true,
        requestId
      })
    }

    this.send(VOICE_IPC_CHANNELS.MODE_STOPPED)
    this.sendStatus()

    return { success: true }
  }

  public handleTranscriptSegment(
    segment: VoiceTranscriptSegment
  ): VoiceIpcResult {
    if (!this.state.enabled) {
      return { success: false, error: "Voice mode is not enabled" }
    }

    const text = normalizeVoiceTranscript(segment.text)
    if (!text || !hasWords(text)) {
      return { success: true }
    }

    this.state.lastTranscript = text

    if (!segment.isFinal) {
      this.send(VOICE_IPC_CHANNELS.INTERIM_TRANSCRIPT, text)
      return { success: true }
    }

    this.send(VOICE_IPC_CHANNELS.FINAL_TRANSCRIPT, {
      ...segment,
      text
    } satisfies VoiceTranscriptSegment)

    if (
      typeof segment.confidence === "number" &&
      segment.confidence < this.getVoiceSettings().minConfidence
    ) {
      return { success: true }
    }

    const intent = detectVoiceIntent(text)
    if (!intent || this.shouldDebounce(text)) {
      return { success: true }
    }

    this.triggerIntent(intent, text).catch((error) => {
      this.handleControllerError(error, this.state.requestId)
    })

    return { success: true }
  }

  public handleRecognitionError(
    error: VoiceRecognitionErrorPayload
  ): VoiceIpcResult {
    this.abortActiveRequest()
    this.state = {
      ...this.state,
      status: "error",
      activeIntent: null,
      requestId: null
    }

    this.sendError(error)
    this.sendStatus(error.message)

    return { success: true }
  }

  public syncRenderer(): VoiceIpcResult {
    if (this.state.enabled) {
      this.send(VOICE_IPC_CHANNELS.MODE_STARTED)
    }

    this.sendStatus()

    return { success: true }
  }

  private async triggerIntent(
    intent: VoiceIntent,
    transcript: string
  ): Promise<void> {
    if (this.state.activeAbortController) {
      return
    }

    if (this.deps.hasApiKey && !this.deps.hasApiKey()) {
      this.state = {
        ...this.state,
        status: "error",
        activeIntent: null,
        requestId: null
      }
      this.sendError({
        code: "api_key_missing",
        message: "Add an API key in settings before using voice answers.",
        recoverable: true
      })
      this.sendStatus("Add an API key in settings before using voice answers.")
      return
    }

    const requestId = randomUUID()
    const abortController = new AbortController()

    this.state = {
      ...this.state,
      status: "capturing",
      activeIntent: intent,
      requestId,
      activeAbortController: abortController,
      lastTriggeredAt: this.now(),
      lastTriggeredText: transcript
    }

    this.sendTriggerDetected({ requestId, intent, transcript })
    this.sendStatus()

    let screenContext: VoiceScreenContext | undefined

    try {
      if (this.deps.captureScreenContext) {
        screenContext = await this.deps.captureScreenContext(
          abortController.signal
        )
      }

      this.throwIfAborted(abortController.signal)

      this.state.status = "answering"
      this.sendStatus()
      this.sendAnswerStart({ requestId, intent })

      if (this.deps.streamVoiceAnswer) {
        await this.deps.streamVoiceAnswer({
          requestId,
          intent,
          transcript,
          screenshotBase64: screenContext?.screenshotBase64,
          signal: abortController.signal,
          onChunk: (text) => {
            if (!abortController.signal.aborted) {
              this.sendAnswerChunk({ requestId, text })
            }
          },
          onComplete: (text) => {
            if (!abortController.signal.aborted) {
              this.completeAnswer({ requestId, text })
            }
          }
        })
      } else {
        this.completeAnswer({ requestId })
      }
    } catch (error) {
      if (!abortController.signal.aborted) {
        this.handleControllerError(error, requestId)
      }
    } finally {
      await screenContext?.cleanup?.()
      if (this.state.requestId === requestId) {
        this.state.activeAbortController = null
      }
    }
  }

  private completeAnswer(payload: VoiceAnswerCompletePayload): void {
    if (this.state.requestId !== payload.requestId) {
      return
    }

    this.state = {
      ...this.state,
      status: this.state.enabled ? "listening" : "complete",
      activeIntent: this.state.enabled ? null : this.state.activeIntent,
      requestId: this.state.enabled ? null : payload.requestId,
      activeAbortController: null
    }

    this.send(VOICE_IPC_CHANNELS.ANSWER_COMPLETE, payload)
    this.sendStatus()
  }

  private shouldDebounce(transcript: string): boolean {
    const now = this.now()
    const withinDebounceWindow =
      now - this.state.lastTriggeredAt < this.debounceMs
    const sameTranscript = transcript === this.state.lastTriggeredText

    return withinDebounceWindow && sameTranscript
  }

  private getVoiceSettings(): { enabled: boolean; minConfidence: number } {
    const settings = this.deps.getVoiceSettings?.()
    return {
      enabled: settings?.enabled ?? true,
      minConfidence: settings?.minConfidence ?? DEFAULT_MIN_CONFIDENCE
    }
  }

  private abortActiveRequest(): void {
    if (this.state.activeAbortController) {
      this.state.activeAbortController.abort()
      this.state.activeAbortController = null
    }
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new Error("Voice request cancelled")
    }
  }

  private handleControllerError(error: unknown, requestId: string | null): void {
    const message = error instanceof Error ? error.message : String(error)

    this.abortActiveRequest()
    this.state = {
      ...this.state,
      status: "error",
      activeIntent: null,
      requestId: null
    }

    this.sendError({
      code: "generation_failed",
      message,
      recoverable: true,
      requestId
    })
    this.sendStatus(message)
  }

  private sendStatus(message?: string): void {
    this.send(VOICE_IPC_CHANNELS.STATUS, {
      status: this.state.status,
      requestId: this.state.requestId,
      activeIntent: this.state.activeIntent,
      message
    } satisfies VoiceModeStatusPayload)
  }

  private sendTriggerDetected(payload: VoiceTriggerDetectedPayload): void {
    this.send(VOICE_IPC_CHANNELS.TRIGGER_DETECTED, payload)
  }

  private sendAnswerStart(payload: VoiceAnswerStartPayload): void {
    this.send(VOICE_IPC_CHANNELS.ANSWER_START, payload)
  }

  private sendAnswerChunk(payload: VoiceAnswerChunkPayload): void {
    this.send(VOICE_IPC_CHANNELS.ANSWER_CHUNK, payload)
  }

  private sendError(payload: VoiceErrorPayload): void {
    this.send(VOICE_IPC_CHANNELS.ERROR, payload)
  }

  private send(channel: string, payload?: unknown): void {
    const mainWindow = this.deps.getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) {
      return
    }

    if (payload === undefined) {
      mainWindow.webContents.send(channel)
      return
    }

    mainWindow.webContents.send(channel, payload)
  }
}
