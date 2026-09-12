import test from "node:test"
import assert from "node:assert/strict"
import Module from "node:module"
import { DEFAULT_VOICE_AUDIO_SETTINGS, voiceAudioRequirementError } from "../../src/types/voiceSettings"

let silence: (() => void) | undefined
let detectorDisposals = 0
let effects: Array<() => void | (() => void)> = []
const nodeModule = Module as unknown as { _load: (...args: any[]) => any }
const originalLoad = nodeModule._load
nodeModule._load = function (id: string, ...args: any[]) {
  if (id === "./SpeechActivity") return { observeSpeech: (_stream: unknown, _pause: number, callback: () => void) => {
    silence = callback
    return () => { detectorDisposals++ }
  } }
  if (id === "react") return {
    useCallback: (fn: unknown) => fn,
    useRef: (value: unknown) => ({ current: value }),
    useState: (value: unknown) => [value, () => {}],
    useEffect: (effect: () => void) => effects.push(effect)
  }
  return originalLoad.call(this, id, ...args)
}
const { useSpeechRecognition } = require("../../src/components/VoiceAssistant/useSpeechRecognition") as typeof import("../../src/components/VoiceAssistant/useSpeechRecognition")
nodeModule._load = originalLoad

function harness() {
  effects = []
  silence = undefined
  detectorDisposals = 0
  let claimed = false
  let claims = 0
  const completed: string[] = []
  let tracksStopped = 0
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator")
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() { tracksStopped++ } }] }) } } })
  let config = { ...DEFAULT_VOICE_AUDIO_SETTINGS, apiProvider: "openai", apiKey: "configured", voiceAssistantEnabled: true, voiceRecognitionLanguage: "en-US" }
  const events: Record<string, (...args: any[]) => void> = {}
  const errors: string[] = []
  const recognizers: Recognition[] = []
  class Recognition {
    onresult?: (event: any) => void
    onstart?: () => void
    lang = ""
    onend?: () => void
    stopCount = 0
    constructor() { recognizers.push(this) }
    start() { this.onstart?.() }
    stop() { this.stopCount++; this.onend?.() }
    abort() { this.stopCount++ }
  }
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window")
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    SpeechRecognition: Recognition,
    electronAPI: {
      voiceAudio: {
        claim: async () => { claims++; if (claimed) return false; claimed = true; return true },
        complete: async (payload: { text: string }) => { completed.push(payload.text) },
        begin: async () => {
          claimed = false
          const error = voiceAudioRequirementError(config.voiceAudioService, config.apiProvider, config.apiKey)
          if (error) throw new Error(error)
          return { recordingId: "test", settings: { ...config }, language: config.voiceRecognitionLanguage }
        },
        cancel: async () => {}
      },
      reportVoiceRecognitionError: (error: { message: string }) => errors.push(error.message),
      onConfigUpdated: (fn: (...args: any[]) => void) => { events.config = fn; return () => {} },
      onVoiceModeStarted: (fn: () => void) => { events.start = fn; return () => {} },
      onVoiceModeStopped: (fn: () => void) => { events.stop = fn; return () => {} },
      onVoiceSubmitRecording: (fn: () => void) => { events.submit = fn; return () => {} },
      voiceRendererReady() {},
      sendVoiceTranscriptSegment() {}
    }
  } })
  useSpeechRecognition()
  const cleanups = effects.map(effect => effect())
  return {
    events, errors, recognizers, completed,
    counts: () => ({ claims, tracksStopped, detectorDisposals }),
    silence: () => silence?.(),
    update: (updates: Partial<typeof config>) => { config = { ...config, ...updates }; events.config(config) },
    dispose: () => {
      cleanups.forEach(cleanup => { if (typeof cleanup === "function") cleanup() })
      if (oldNavigator) Object.defineProperty(globalThis, "navigator", oldNavigator)
      else Reflect.deleteProperty(globalThis, "navigator")
      if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow)
      else Reflect.deleteProperty(globalThis, "window")
    }
  }
}
const flush = () => new Promise(resolve => setImmediate(resolve))

test("settings changes preserve active recognition and browser restarts; next recording picks them up", async () => {
  const h = harness()
  try {
    h.events.start(); await flush()
    assert.equal(h.recognizers[0].lang, "en-US")
    h.update({ voiceRecognitionLanguage: "hi-IN" })
    assert.equal(h.recognizers[0].stopCount, 0)
    h.recognizers[0].onend!(); await flush()
    assert.equal(h.recognizers[0].lang, "en-US")
    h.events.start(); await flush()
    assert.equal(h.recognizers[1].lang, "hi-IN")
    h.update({ voiceAssistantEnabled: false })
    assert.equal(h.recognizers[1].stopCount, 1)
  } finally { h.dispose() }
})

test("unsupported choices and missing OpenAI configuration fail before microphone capture", async () => {
  const h = harness()
  try {
    h.update({ voiceAudioService: "gpt-live", apiProvider: "gemini" })
    h.events.start(); await flush()
    assert.match(h.errors.pop()!, /OpenAI provider/)
    h.update({ apiProvider: "openai", apiKey: "" })
    h.events.start(); await flush()
    assert.match(h.errors.pop()!, /API key/)
    assert.equal(h.recognizers.length, 0)
  } finally { h.dispose() }
})

test("stop while settings are loading invalidates the pending recording start", async () => {
  const h = harness()
  try {
    h.events.start()
    h.events.stop()
    await flush()
    assert.equal(h.recognizers.length, 0)
  } finally { h.dispose() }
})


test("automatic hook accepts silence and shortcut race once and stops the microphone", async () => {
  const h = harness()
  try {
    h.update({ voiceSubmissionMode: "automatic" })
    h.events.start(); await flush()
    h.recognizers[0].onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "SQL question" } }] })
    h.silence(); h.events.submit(); h.events.submit()
    await flush()
    assert.deepEqual(h.completed, ["SQL question"])
    assert.equal(h.counts().claims, 1)
    assert.equal(h.counts().tracksStopped, 1)
    assert.equal(h.counts().detectorDisposals, 1)
    assert.equal(h.recognizers.length, 1)
    assert.deepEqual(h.errors, [])
  } finally { h.dispose() }
})

test("stop during a pending submission claim suppresses the completed question", async () => {
  const h = harness()
  try {
    h.events.start(); await flush()
    h.recognizers[0].onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "SQL question" } }] })
    h.events.submit(); h.events.stop()
    await flush()
    assert.deepEqual(h.completed, [])
    assert.deepEqual(h.errors, [])
  } finally { h.dispose() }
})
