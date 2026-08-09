import { useCallback, useEffect, useRef, useState } from "react"
import type { VoiceErrorCode } from "../../types/voice"

type SpeechRecognitionAlternative = {
  transcript: string
  confidence: number
}

type SpeechRecognitionResult = {
  isFinal: boolean
  length: number
  [index: number]: SpeechRecognitionAlternative
}

type SpeechRecognitionResultList = {
  length: number
  [index: number]: SpeechRecognitionResult
}

type SpeechRecognitionEventLike = {
  resultIndex: number
  results: SpeechRecognitionResultList
}

type SpeechRecognitionErrorEventLike = {
  error?: string
  message?: string
}

type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor
  webkitSpeechRecognition?: SpeechRecognitionConstructor
}

export type UseSpeechRecognitionState = {
  isListening: boolean
  isSupported: boolean
  interimTranscript: string
  finalTranscript: string
  error: string | null
}

const getSpeechRecognitionConstructor = (): SpeechRecognitionConstructor | null => {
  const speechWindow = window as SpeechRecognitionWindow
  return (
    speechWindow.SpeechRecognition ??
    speechWindow.webkitSpeechRecognition ??
    null
  )
}

const getSupportedAudioMimeType = (): string => {
  const options = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4"
  ]

  return (
    options.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ||
    ""
  )
}

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result
      if (typeof result !== "string") {
        reject(new Error("Failed to read audio chunk."))
        return
      }

      resolve(result.split(",")[1] || "")
    }
    reader.onerror = () => reject(reader.error || new Error("Failed to read audio chunk."))
    reader.readAsDataURL(blob)
  })

const getRecognitionErrorCode = (error?: string): VoiceErrorCode => {
  if (error === "not-allowed" || error === "service-not-allowed") {
    return "microphone_denied"
  }

  if (error === "audio-capture") {
    return "microphone_denied"
  }

  if (error === "network" || error === "language-not-supported") {
    return "speech_unavailable"
  }

  return "unknown"
}

const getRecognitionErrorMessage = (
  code: VoiceErrorCode,
  fallback?: string
): string => {
  if (fallback) {
    return fallback
  }

  if (code === "microphone_denied") {
    return "Microphone access was denied or unavailable."
  }

  if (code === "speech_unavailable") {
    return "Speech recognition service is unavailable in this Electron runtime. You can type a prompt instead."
  }

  return "Speech recognition failed. You can type a prompt instead."
}

export function useSpeechRecognition(
  language = "en-US"
): UseSpeechRecognitionState {
  const RecognitionConstructor = getSpeechRecognitionConstructor()
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const providerSubmitRequestedRef = useRef(false)
  const finalSegmentBufferRef = useRef("")
  const finalSegmentConfidenceRef = useRef<number | undefined>(undefined)
  const interimTranscriptRef = useRef("")
  const shouldListenRef = useRef(false)
  const isListeningRef = useRef(false)
  const [state, setState] = useState<UseSpeechRecognitionState>({
    isListening: false,
    isSupported: Boolean(RecognitionConstructor),
    interimTranscript: "",
    finalTranscript: "",
    error: null
  })

  const reportError = useCallback(
    (code: VoiceErrorCode, message: string) => {
      setState((current) => ({
        ...current,
        isListening: false,
        error: message
      }))

      window.electronAPI.reportVoiceRecognitionError({
        code: code === "speech_unavailable" ? "speech_unavailable" : code === "microphone_denied" ? "microphone_denied" : "unknown",
        message,
        recoverable: true
      })
    },
    []
  )

  const flushBufferedFinalTranscript = useCallback((submittedPrompt = false) => {
    const text = `${finalSegmentBufferRef.current} ${interimTranscriptRef.current}`
      .replace(/\s+/g, " ")
      .trim()
    if (!text) {
      return
    }

    const confidence = finalSegmentConfidenceRef.current
    finalSegmentBufferRef.current = ""
    finalSegmentConfidenceRef.current = undefined
    interimTranscriptRef.current = ""

    setState((current) => ({
      ...current,
      finalTranscript: text,
      interimTranscript: ""
    }))

    window.electronAPI.sendVoiceTranscriptSegment({
      text,
      isFinal: true,
      confidence,
      submittedPrompt,
      receivedAt: Date.now()
    })
  }, [])

  const bufferFinalTranscript = useCallback(
    (text: string, confidence?: number) => {
      finalSegmentBufferRef.current = `${finalSegmentBufferRef.current} ${text}`
        .replace(/\s+/g, " ")
        .trim()
      finalSegmentConfidenceRef.current = confidence

      setState((current) => ({
        ...current,
        finalTranscript: finalSegmentBufferRef.current,
        interimTranscript: ""
      }))
    },
    []
  )

  const cleanupRecognition = useCallback(() => {
    const recognition = recognitionRef.current
    if (!recognition) {
      return
    }

    recognition.onresult = null
    recognition.onerror = null
    recognition.onend = null
    recognitionRef.current = null
  }, [])

  const cleanupProviderTranscription = useCallback(() => {
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== "inactive") {
      try {
        providerSubmitRequestedRef.current = false
        recorder.stop()
      } catch (error) {
        console.error("Failed to stop provider transcription recorder:", error)
      }
    }

    mediaRecorderRef.current = null
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
    mediaStreamRef.current = null
  }, [])

  const submitProviderTranscription = useCallback(() => {
    const recorder = mediaRecorderRef.current
    if (!recorder) {
      return false
    }

    providerSubmitRequestedRef.current = true
    shouldListenRef.current = false

    try {
      if (recorder.state === "recording") {
        recorder.requestData?.()
        recorder.stop()
      }
    } catch (error) {
      providerSubmitRequestedRef.current = false
      reportError(
        "microphone_denied",
        error instanceof Error
          ? error.message
          : "Microphone recording failed to stop."
      )
    }

    return true
  }, [reportError])

  const startProviderTranscription = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      reportError(
        "microphone_denied",
        "Microphone recording is unavailable. You can type a prompt instead."
      )
      return
    }

    cleanupProviderTranscription()

    try {
      const config = await window.electronAPI.getConfig().catch(() => null)
      if (config?.apiProvider !== "openai") {
        reportError(
          "speech_unavailable",
          "Speech recognition service is unavailable. Switch provider to OpenAI for microphone transcription, or type a prompt."
        )
        return
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!shouldListenRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }

      const mimeType = getSupportedAudioMimeType()
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined
      )

      mediaStreamRef.current = stream
      mediaRecorderRef.current = recorder
      let audioChunks: Blob[] = []

      recorder.ondataavailable = async (event) => {
        if (event.data.size === 0) {
          return
        }

        audioChunks.push(event.data)
      }

      recorder.onerror = () => {
        reportError(
          "microphone_denied",
          "Microphone recording failed. You can type a prompt instead."
        )
      }

      recorder.onstop = async () => {
        const shouldSubmit = providerSubmitRequestedRef.current
        providerSubmitRequestedRef.current = false
        const segmentChunks = audioChunks
        audioChunks = []

        if (segmentChunks.length > 0 && shouldSubmit) {
          const audioBlob = new Blob(segmentChunks, {
            type: recorder.mimeType || mimeType || "audio/webm"
          })

          try {
            const audioBase64 = await blobToBase64(audioBlob)
            const result = await window.electronAPI.sendVoiceAudioChunk({
              audioBase64,
              mimeType: audioBlob.type || mimeType || "audio/webm",
              language: config?.voiceRecognitionLanguage || language,
              submittedPrompt: true,
              recordedAt: Date.now()
            })

            if (!result.success && result.error) {
              reportError("speech_unavailable", result.error)
              return
            }
          } catch (error) {
            reportError(
              "speech_unavailable",
              error instanceof Error
                ? error.message
                : "Failed to transcribe microphone audio."
            )
            return
          }
        }

        mediaRecorderRef.current = null
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
        mediaStreamRef.current = null
        isListeningRef.current = false
        setState((current) => ({
          ...current,
          isListening: false
        }))
      }

      recorder.start()
      isListeningRef.current = true
      setState((current) => ({
        ...current,
        isListening: true,
        error: null
      }))
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Microphone access failed. You can type a prompt instead."
      reportError("microphone_denied", message)
    }
  }, [cleanupProviderTranscription, language, reportError])

  const stopRecognition = useCallback((resetBufferedTranscript = true) => {
    shouldListenRef.current = false
    if (resetBufferedTranscript) {
      finalSegmentBufferRef.current = ""
      finalSegmentConfidenceRef.current = undefined
      interimTranscriptRef.current = ""
    }
    const recognition = recognitionRef.current

    if (recognition) {
      try {
        recognition.stop()
      } catch (error) {
        console.error("Failed to stop speech recognition:", error)
      }
    }

    cleanupRecognition()
    cleanupProviderTranscription()
    isListeningRef.current = false
    setState((current) => ({
      ...current,
      isListening: false,
      interimTranscript: ""
    }))
  }, [cleanupProviderTranscription, cleanupRecognition])

  const startRecognition = useCallback((preserveBufferedTranscript = false) => {
    const startRecognitionAsync = async () => {
    const CurrentRecognitionConstructor = getSpeechRecognitionConstructor()

    if (!CurrentRecognitionConstructor) {
      shouldListenRef.current = true
      void startProviderTranscription()
      return
    }

    stopRecognition(!preserveBufferedTranscript)
    shouldListenRef.current = true
    const config = await window.electronAPI.getConfig().catch(() => null)
    const recognitionLanguage = config?.voiceRecognitionLanguage || language
    if (!shouldListenRef.current) {
      return
    }

    const recognition = new CurrentRecognitionConstructor()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = recognitionLanguage

    recognition.onresult = (event) => {
      let interimTranscript = ""

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        const bestAlternative = result[0]
        const transcript = bestAlternative?.transcript?.trim()

        if (!transcript) {
          continue
        }

        if (result.isFinal) {
          interimTranscriptRef.current = ""
          bufferFinalTranscript(transcript, bestAlternative.confidence)
        } else {
          interimTranscript = `${interimTranscript} ${transcript}`.trim()
        }
      }

      if (interimTranscript) {
        interimTranscriptRef.current = interimTranscript
        setState((current) => ({
          ...current,
          interimTranscript
        }))

        window.electronAPI.sendVoiceTranscriptSegment({
          text: interimTranscript,
          isFinal: false,
          receivedAt: Date.now()
        })
      }
    }

    recognition.onerror = (event) => {
      const code = getRecognitionErrorCode(event.error)
      const message = getRecognitionErrorMessage(
        code,
        event.message ||
          (event.error
            ? `Speech recognition failed (${event.error}). You can type a prompt instead.`
            : undefined)
      )
      shouldListenRef.current = false
      isListeningRef.current = false
      cleanupRecognition()
      if (code === "speech_unavailable") {
        shouldListenRef.current = true
        void startProviderTranscription()
        return
      }
      reportError(code, message)
    }

    recognition.onend = () => {
      isListeningRef.current = false
      setState((current) => ({
        ...current,
        isListening: false
      }))

      if (shouldListenRef.current) {
        startRecognition(true)
      }
    }

    recognitionRef.current = recognition

    try {
      recognition.start()
      isListeningRef.current = true
      setState((current) => ({
        ...current,
        isListening: true,
        isSupported: true,
        interimTranscript: "",
        error: null
      }))
    } catch (error) {
      shouldListenRef.current = false
      isListeningRef.current = false
      cleanupRecognition()
      reportError(
        "unknown",
        error instanceof Error ? error.message : "Speech recognition failed to start."
      )
    }
    }

    void startRecognitionAsync()
  }, [bufferFinalTranscript, cleanupRecognition, language, reportError, startProviderTranscription, stopRecognition])

  useEffect(() => {
    setState((current) => ({
      ...current,
      isSupported: Boolean(getSpeechRecognitionConstructor())
    }))

    const cleanupFunctions = [
      window.electronAPI.onVoiceModeStarted(() => {
        startRecognition()
      }),
      window.electronAPI.onVoiceModeStopped(() => {
        stopRecognition()
      }),
      window.electronAPI.onVoiceSubmitRecording(() => {
        if (submitProviderTranscription()) {
          return
        }

        flushBufferedFinalTranscript(true)
        stopRecognition()
      })
    ]

    window.electronAPI.voiceRendererReady()

    return () => {
      cleanupFunctions.forEach((cleanup) => cleanup())
      stopRecognition()
    }
  }, [flushBufferedFinalTranscript, startRecognition, stopRecognition, submitProviderTranscription])

  return state
}
