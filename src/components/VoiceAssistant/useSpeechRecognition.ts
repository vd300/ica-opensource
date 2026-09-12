import { useCallback, useEffect, useRef, useState } from "react"
import type { AppConfig } from "../../types/electron"
import type { VoiceAudioAdapter, VoiceAudioBridge, VoiceAdapterEvent, VoiceRecordingDescriptor } from "../../types/voiceAdapter"
import { observeSpeech } from "./SpeechActivity"
import type { LiveWrittenAnswer } from "./LiveWrittenAnswers"
import type { LiveCaption } from "./LiveConversation"
import { createAudioAdapter, type BrowserRecognition } from "./AudioAdapters"

export type UseSpeechRecognitionState = {
  cancelRecording(): void
  toggleMicrophone(): void
  isMicrophoneMuted: boolean
  isSubmitting: boolean
  modeLabel: string
  isListening: boolean
  isSupported: boolean
  interimTranscript: string
  finalTranscript: string
  error: string | null
  reviewText: string | null
  isLive: boolean
  liveCaptions: LiveCaption[]
  liveWrittenAnswers: LiveWrittenAnswer[]
}

export function useSpeechRecognition(): UseSpeechRecognitionState {
  const active = useRef<{ descriptor: VoiceRecordingDescriptor; adapter: VoiceAudioAdapter; ready: boolean; claiming: boolean } | null>(null)
  const submitRef = useRef<(reason: "shortcut" | "silence") => Promise<void>>(async () => {})
  const generation = useRef(0)
  const [state, setState] = useState<Omit<UseSpeechRecognitionState, "cancelRecording" | "toggleMicrophone">>({
    isSubmitting: false, modeLabel: "", isListening: false, isSupported: true, interimTranscript: "", finalTranscript: "", error: null, reviewText: null, isLive: false, liveCaptions: [], liveWrittenAnswers: [], isMicrophoneMuted: false
  })
  const reportError = useCallback((message: string) => {
    setState(current => ({ ...current, isListening: false, isSubmitting: false, error: message }))
    void window.electronAPI.reportVoiceRecognitionError({ code: "speech_unavailable", message, recoverable: true })
  }, [])
  const stop = useCallback(() => {
    generation.current++
    const previous = active.current
    active.current = null
    previous?.adapter.cancel()
    setState(current => ({ ...current, isListening: false, isSubmitting: false }))
  }, [])
  const start = useCallback(async () => {
    stop()
    const version = generation.current
    const bridge: VoiceAudioBridge = window.electronAPI.voiceAudio
    setState({ isSubmitting: false, modeLabel: "", isListening: false, isSupported: true, interimTranscript: "", finalTranscript: "", error: null, reviewText: null, isLive: false, liveCaptions: [], liveWrittenAnswers: [], isMicrophoneMuted: false })
    try {
      const loaded = await bridge.begin()
      const descriptor = Object.freeze({ ...loaded, settings: Object.freeze({ ...loaded.settings }) })
      if (version !== generation.current) { await bridge.cancel(descriptor.recordingId); return }
      setState(current => ({ ...current, isLive: descriptor.settings.voiceAudioService === "gpt-live", modeLabel: descriptor.settings.voiceAudioService === "gpt-live" ? "GPT-Live / Continuous conversation / Output muted" : `${descriptor.settings.voiceAudioService} / ${descriptor.settings.voiceSubmissionMode}` }))
      const recognitionWindow = window as Window & {
        SpeechRecognition?: new () => BrowserRecognition
        webkitSpeechRecognition?: new () => BrowserRecognition
      }
      const Recognition = recognitionWindow.SpeechRecognition || recognitionWindow.webkitSpeechRecognition
      const emit = (event: VoiceAdapterEvent) => {
        if (version !== generation.current || event.recordingId !== active.current?.descriptor.recordingId) return
        if (event.type === "microphone-muted") setState(current => ({ ...current, isMicrophoneMuted: event.muted }))
        else if (event.type === "live-written-answers") setState(current => ({ ...current, liveWrittenAnswers: event.answers }))
        else if (event.type === "live-captions") setState(current => ({ ...current, liveCaptions: event.captions }))
        else if (event.type === "transcript") setState(current => ({ ...current, interimTranscript: event.text }))
        else if (event.type === "state") {
          if (active.current) active.current.ready = event.state === "recording"
          setState(current => ({ ...current, isListening: event.state === "recording", isSubmitting: event.state === "submitting" }))
        }
        else {
          reportError(event.message)
        }
      }
      const adapter = createAudioAdapter(descriptor, {
        bridge, emit, observeSpeech, onSilence: () => { void submitRef.current("silence") },
        getMicrophone: () => {
          if (!navigator.mediaDevices?.getUserMedia) return Promise.reject(new Error("Microphone capture is unavailable"))
          return navigator.mediaDevices.getUserMedia({ audio: {
            autoGainControl: true, echoCancellation: true, noiseSuppression: true, channelCount: 1
          } })
        },
        supportsMime: mime => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime),
        createRecorder: (stream, mimeType) => new MediaRecorder(stream, { mimeType }),
        createPeer: () => new RTCPeerConnection(),
        createRecognition: Recognition ? () => new Recognition() : undefined
      })
      active.current = { descriptor, adapter, ready: false, claiming: false }
      await adapter.start()
    } catch (error) {
      if (version === generation.current) reportError(error instanceof Error ? error.message : "Voice recording failed. Please retry.")
    }
  }, [reportError, stop])
  const toggleMicrophone = useCallback(() => {
    active.current?.adapter.toggleMicrophone?.()
  }, [])
  const submit = useCallback(async (reason: "shortcut" | "silence" = "shortcut") => {
    const recording = active.current
    if (!recording?.ready || recording.claiming) return
    if (recording.descriptor.settings.voiceAudioService === "gpt-live") {
      if (reason === "shortcut") toggleMicrophone()
      return
    }
    recording.claiming = true
    const version = generation.current
    try {
      const accepted = await window.electronAPI.voiceAudio.claim({ recordingId: recording.descriptor.recordingId, reason })
      if (!accepted || version !== generation.current || active.current !== recording) return
      const result = await recording.adapter.submit()
      if (!result || version !== generation.current || active.current !== recording) return
      if (!/[\p{L}\p{N}]/u.test(result.text)) throw new Error("No speech was captured. Record or type a question.")
      setState(current => ({ ...current, isListening: false, isSubmitting: false, interimTranscript: "", finalTranscript: result.text,
        reviewText: result.requiresReview ? result.text : null }))
      await (window.electronAPI.voiceAudio as VoiceAudioBridge).complete({ recordingId: result.recordingId, text: result.text })
    } catch (error) {
      if (version === generation.current) { recording.adapter.cancel(); reportError(error instanceof Error ? error.message : "Voice submission failed. Please retry.") }
    } finally { recording.claiming = false }
  }, [reportError, toggleMicrophone])
  submitRef.current = submit
  useEffect(() => {
    const cleanups = [
      window.electronAPI.onVoiceModeStarted(() => { void start() }),
      window.electronAPI.onVoiceModeStopped(stop),
      window.electronAPI.onVoiceSubmitRecording(() => { void submit() }),
      window.electronAPI.onConfigUpdated((config: Omit<AppConfig, "apiKey">) => { if (!config.voiceAssistantEnabled) stop() })
    ]
    window.electronAPI.voiceRendererReady()
    return () => { cleanups.forEach(cleanup => cleanup()); stop() }
  }, [start, stop, submit])
  return { ...state, cancelRecording: stop, toggleMicrophone }
}
