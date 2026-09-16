import assert from "node:assert/strict"
import test from "node:test"
import { setTimeout as delay } from "node:timers/promises"
import {
  detectVoiceIntent,
  normalizeVoiceTranscript,
  VoiceAssistantController
} from "../VoiceAssistantController"
import { VOICE_IPC_CHANNELS } from "../voiceIpc"
import type { VoiceAnswerChunkPayload } from "../../src/types/voice"
import { VoiceAudioService } from "../VoiceAudioService"
import type { Config } from "../ConfigHelper"
import { DEFAULT_VOICE_AUDIO_SETTINGS } from "../../src/types/voiceSettings"

type SentEvent = {
  channel: string
  payload?: unknown
}

const createMainWindow = (events: SentEvent[]) =>
  ({
    isDestroyed: () => false,
    webContents: {
      send: (channel: string, payload?: unknown) => {
        events.push({ channel, payload })
      }
    }
  }) as any

const createFinalSegment = (text: string, confidence = 0.9) => ({
  text,
  confidence,
  isFinal: true,
  receivedAt: Date.now()
})

const flushAsyncWork = async () => {
  await delay(0)
  await delay(0)
}

for (const service of ["legacy", "whisper"] as const) {
  for (const mode of ["manual", "automatic"] as const) {
    test(`${service}/${mode}: submission preserves normalized screen context and one streamed answer`, async () => {
      const events: SentEvent[] = []
      let captures = 0
      let cleanups = 0
      let answers = 0
      let uploads = 0
      const text = "write a sequel query for the users table"
      const controller = new VoiceAssistantController({
        getMainWindow: () => createMainWindow(events),
        getVoiceSettings: () => ({ enabled: true, minConfidence: 0.3 }),
        hasApiKey: () => true,
        captureScreenContext: async () => {
          captures++
          return { screenshotBase64: "screen-context", cleanup: async () => { cleanups++ } }
        },
        streamVoiceAnswer: async ({ transcript, screenshotBase64, onChunk, onComplete }) => {
          answers++
          assert.equal(transcript, "write a SQL query for the users table")
          assert.equal(screenshotBase64, "screen-context")
          onChunk("SELECT ")
          onChunk("* FROM users;")
          onComplete("SELECT * FROM users;")
        }
      })
      const audio = new VoiceAudioService({
        getConfig: () => ({ ...DEFAULT_VOICE_AUDIO_SETTINGS, voiceAssistantEnabled: true,
          voiceAudioService: service, voiceSubmissionMode: mode, apiProvider: "openai",
          apiKey: "test-key", voiceRecognitionLanguage: "en-US" }) as Config,
        transcribe: async () => { uploads++; return text },
        createLive: () => { throw new Error("This regression does not call the provider") },
        submit: transcript => {
          assert.equal(controller.handleTranscriptSegment({ ...createFinalSegment(transcript), submittedPrompt: true }).success, true)
        }
      })
      try {
        controller.start()
        const { recordingId } = audio.begin(1)
        const claims = await Promise.all(["silence", "shortcut", "shortcut"].map(reason =>
          Promise.resolve().then(() => audio.claim(1, { recordingId, reason: reason as "silence" | "shortcut" }))))
        assert.equal(claims.filter(Boolean).length, 1)
        if (service === "whisper") {
          audio.authorizeFile(1, recordingId)
          await audio.upload(1, { recordingId, sequence: 0, mimeType: "audio/webm",
            audioBase64: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2]).toString("base64") })
        }
        audio.complete(1, { recordingId, text })
        assert.throws(() => audio.complete(1, { recordingId, text }))
        await flushAsyncWork()
        assert.equal(uploads, service === "whisper" ? 1 : 0)
        assert.equal(captures, 1)
        assert.equal(answers, 1)
        assert.equal(cleanups, 1)
        assert.equal(controller.getState().status, "complete")
        assert.equal(events.filter(event => event.channel === VOICE_IPC_CHANNELS.ANSWER_START).length, 1)
        assert.equal(events.filter(event => event.channel === VOICE_IPC_CHANNELS.ANSWER_COMPLETE).length, 1)
        assert.equal(events.filter(event => event.channel === VOICE_IPC_CHANNELS.ANSWER_CHUNK)
          .map(event => (event.payload as VoiceAnswerChunkPayload).text).join(""), "SELECT * FROM users;")
      } finally { controller.stop(); await audio.dispose() }
    })
  }
}

test("detectVoiceIntent matches specific and general assistance prompts", () => {
  assert.equal(detectVoiceIntent("solve this"), "solve")
  assert.equal(detectVoiceIntent("can you answer this question"), "solve")
  assert.equal(detectVoiceIntent("how would you approach this prompt"), "solve")
  assert.equal(detectVoiceIntent("please work through the problem"), "solve")
  assert.equal(detectVoiceIntent("walk me through the approach"), "explain")
  assert.equal(detectVoiceIntent("explain rate limiting"), "explain")
  assert.equal(detectVoiceIntent("what is the time complexity"), "complexity")
  assert.equal(detectVoiceIntent("why is this failing"), "debug")
  assert.equal(detectVoiceIntent("what should I do here"), "solve")
  assert.equal(detectVoiceIntent("can you give me the solution"), "solve")
  assert.equal(detectVoiceIntent("write a SQL query for the orders table"), "solve")
  assert.equal(detectVoiceIntent("write a sequel query for the users table"), "solve")
  assert.equal(detectVoiceIntent("orders table and customers table in SQL"), "explain")
  assert.equal(detectVoiceIntent("what is JIL in python"), "explain")
  assert.equal(detectVoiceIntent("class method and static method in python"), "explain")
  assert.equal(detectVoiceIntent("how does Kafka work"), "solve")
  assert.equal(
    detectVoiceIntent("have you... ever.. offloaded data to... to another server"),
    "solve"
  )
  assert.equal(
    detectVoiceIntent("have you ever uploaded data to another server"),
    "solve"
  )
  assert.equal(detectVoiceIntent("what is the capital of France?"), "solve")
  assert.equal(detectVoiceIntent("explain pizza toppings"), "explain")
  assert.equal(detectVoiceIntent(". ."), null)
  assert.equal(detectVoiceIntent("hello hello mic check 1 2 3"), null)
  assert.equal(detectVoiceIntent("nice weather today"), null)
})

test("normalizeVoiceTranscript corrects common software engineering speech terms", () => {
  assert.equal(normalizeVoiceTranscript("what is JIL in python"), "what is GIL in python")
  assert.equal(normalizeVoiceTranscript("explain GIM in python"), "explain GIL in python")
  assert.equal(normalizeVoiceTranscript("write a sequel query"), "write a SQL query")
  assert.equal(normalizeVoiceTranscript("debug this s q l join"), "debug this SQL join")
  assert.equal(normalizeVoiceTranscript("design a rest api in fast api"), "design a REST API in FastAPI")
  assert.equal(
    normalizeVoiceTranscript("have you... ever.. offloaded data to... to another server"),
    "have you ever offloaded data to another server"
  )
  assert.equal(
    normalizeVoiceTranscript("how do you scale a service to handel lets sayy 1 million request"),
    "how do you scale a service to handle lets say 1 million request"
  )
})

test("controller ignores punctuation-only final transcripts", async () => {
  const events: SentEvent[] = []
  let captures = 0

  const controller = new VoiceAssistantController({
    getMainWindow: () => createMainWindow(events),
    getVoiceSettings: () => ({ enabled: true, minConfidence: 0.3 }),
    hasApiKey: () => true,
    captureScreenContext: async () => {
      captures += 1
      return { screenshotBase64: "screen" }
    },
    streamVoiceAnswer: async ({ onComplete }) => {
      onComplete("done")
    }
  })

  controller.start()
  controller.handleTranscriptSegment(createFinalSegment(". ."))
  await flushAsyncWork()

  assert.equal(captures, 0)
  assert.equal(
    events.some((event) => event.channel === VOICE_IPC_CHANNELS.FINAL_TRANSCRIPT),
    false
  )
})

test("controller debounces duplicate final transcripts", async () => {
  const events: SentEvent[] = []
  let now = 10_000
  let captures = 0

  const controller = new VoiceAssistantController({
    getMainWindow: () => createMainWindow(events),
    getVoiceSettings: () => ({ enabled: true, minConfidence: 0.3 }),
    hasApiKey: () => true,
    now: () => now,
    debounceMs: 5_000,
    captureScreenContext: async () => {
      captures += 1
      return { screenshotBase64: "screen" }
    },
    streamVoiceAnswer: async ({ onComplete }) => {
      onComplete("done")
    }
  })

  controller.start()
  controller.handleTranscriptSegment(createFinalSegment("answer this question"))
  await flushAsyncWork()

  controller.handleTranscriptSegment(createFinalSegment("answer this question"))
  await flushAsyncWork()

  assert.equal(captures, 1)
  assert.equal(
    events.filter((event) => event.channel === VOICE_IPC_CHANNELS.TRIGGER_DETECTED)
      .length,
    1
  )

  now += 5_001
  controller.handleTranscriptSegment(createFinalSegment("answer this question"))
  await flushAsyncWork()

  assert.equal(captures, 2)
})

test("controller stays complete after a submitted answer", async () => {
  const events: SentEvent[] = []

  const controller = new VoiceAssistantController({
    getMainWindow: () => createMainWindow(events),
    getVoiceSettings: () => ({ enabled: true, minConfidence: 0.3 }),
    hasApiKey: () => true,
    captureScreenContext: async () => ({ screenshotBase64: "screen" }),
    streamVoiceAnswer: async ({ onComplete }) => {
      onComplete("done")
    }
  })

  controller.start()
  controller.handleTranscriptSegment(createFinalSegment("what is JIL in python"))
  await flushAsyncWork()

  assert.equal(controller.getState().enabled, true)
  assert.equal(controller.getState().status, "complete")
  assert.ok(
    events.some(
      (event) =>
        event.channel === VOICE_IPC_CHANNELS.STATUS &&
        (event.payload as { status?: string }).status === "complete"
    )
  )
})

test("controller can restart recording while voice session is open", () => {
  const events: SentEvent[] = []

  const controller = new VoiceAssistantController({
    getMainWindow: () => createMainWindow(events),
    getVoiceSettings: () => ({ enabled: true, minConfidence: 0.3 })
  })

  controller.start()
  controller.start()

  assert.equal(controller.getState().enabled, true)
  assert.equal(controller.getState().status, "listening")
  assert.equal(
    events.filter((event) => event.channel === VOICE_IPC_CHANNELS.MODE_STARTED)
      .length,
    2
  )
})

test("controller requests renderer transcript submission", () => {
  const events: SentEvent[] = []

  const controller = new VoiceAssistantController({
    getMainWindow: () => createMainWindow(events),
    getVoiceSettings: () => ({ enabled: true, minConfidence: 0.3 })
  })

  assert.equal(controller.submitRecording().success, false)

  controller.start()
  assert.equal(controller.submitRecording().success, true)
  assert.ok(
    events.some((event) => event.channel === VOICE_IPC_CHANNELS.SUBMIT_RECORDING)
  )
})

test("controller treats submitted transcript as a prompt without trigger words", async () => {
  const events: SentEvent[] = []
  let captures = 0

  const controller = new VoiceAssistantController({
    getMainWindow: () => createMainWindow(events),
    getVoiceSettings: () => ({ enabled: true, minConfidence: 0.3 }),
    hasApiKey: () => true,
    captureScreenContext: async () => {
      captures += 1
      return { screenshotBase64: "screen" }
    },
    streamVoiceAnswer: async ({ intent, transcript, onComplete }) => {
      assert.equal(intent, "solve")
      assert.equal(transcript, "reverse linked list")
      onComplete("done")
    }
  })

  controller.start()
  controller.handleTranscriptSegment({
    ...createFinalSegment("reverse linked list", 0.1),
    submittedPrompt: true
  })
  await flushAsyncWork()

  assert.equal(captures, 1)
  assert.equal(controller.getState().status, "complete")
  assert.ok(
    events.some((event) => event.channel === VOICE_IPC_CHANNELS.TRIGGER_DETECTED)
  )
})

test("controller explains submitted technical topic fragments", async () => {
  const events: SentEvent[] = []
  let captures = 0

  const controller = new VoiceAssistantController({
    getMainWindow: () => createMainWindow(events),
    getVoiceSettings: () => ({ enabled: true, minConfidence: 0.3 }),
    hasApiKey: () => true,
    captureScreenContext: async () => {
      captures += 1
      return { screenshotBase64: "screen" }
    },
    streamVoiceAnswer: async ({ intent, transcript, onComplete }) => {
      assert.equal(intent, "explain")
      assert.equal(transcript, "class method and static method in python")
      onComplete("done")
    }
  })

  controller.start()
  controller.handleTranscriptSegment({
    ...createFinalSegment("class method and static method in python", 0.1),
    submittedPrompt: true
  })
  await flushAsyncWork()

  assert.equal(captures, 1)
  assert.equal(controller.getState().status, "complete")
})

test("controller accepts a different software engineering question after completion", async () => {
  const events: SentEvent[] = []
  let captures = 0

  const controller = new VoiceAssistantController({
    getMainWindow: () => createMainWindow(events),
    getVoiceSettings: () => ({ enabled: true, minConfidence: 0.3 }),
    hasApiKey: () => true,
    captureScreenContext: async () => {
      captures += 1
      return { screenshotBase64: "screen" }
    },
    streamVoiceAnswer: async ({ onComplete }) => {
      onComplete("done")
    }
  })

  controller.start()
  controller.handleTranscriptSegment(createFinalSegment("what is GIL in python"))
  await flushAsyncWork()
  controller.handleTranscriptSegment(createFinalSegment("what is time complexity in python"))
  await flushAsyncWork()

  assert.equal(captures, 2)
})

test("controller stop aborts active generation and suppresses later chunks", async () => {
  const events: SentEvent[] = []
  let signalWasAborted = false
  let releaseStream: ((value?: unknown) => void) | null = null
  let streamStarted: Promise<void>
  let resolveStreamStarted: () => void

  streamStarted = new Promise((resolve) => {
    resolveStreamStarted = resolve
  })

  const controller = new VoiceAssistantController({
    getMainWindow: () => createMainWindow(events),
    getVoiceSettings: () => ({ enabled: true, minConfidence: 0.3 }),
    hasApiKey: () => true,
    captureScreenContext: async () => ({ screenshotBase64: "screen" }),
    streamVoiceAnswer: async ({ signal, onChunk, onComplete }) => {
      resolveStreamStarted()
      signal.addEventListener("abort", () => {
        signalWasAborted = true
      })
      await new Promise((resolve) => {
        releaseStream = resolve
      })
      onChunk("late")
      onComplete("late")
    }
  })

  controller.start()
  controller.handleTranscriptSegment(createFinalSegment("solve this"))
  await streamStarted

  const activeRequestId = controller.getState().requestId
  controller.stop()
  releaseStream?.()
  await flushAsyncWork()

  assert.equal(signalWasAborted, true)
  assert.equal(controller.getState().enabled, false)
  assert.equal(controller.getState().status, "idle")
  assert.ok(
    events.some(
      (event) =>
        event.channel === VOICE_IPC_CHANNELS.ERROR &&
        (event.payload as { code?: string }).code === "cancelled"
    )
  )
  assert.equal(
    events
      .filter((event) => event.channel === VOICE_IPC_CHANNELS.ANSWER_CHUNK)
      .some(
        (event) =>
          (event.payload as VoiceAnswerChunkPayload).requestId === activeRequestId
      ),
    false
  )
})

test("stop during screenshot capture cleans late screen context and never starts an answer", async () => {
  const events: SentEvent[] = []
  let release!: (value: { screenshotBase64: string; cleanup: () => Promise<void> }) => void
  let cleanups = 0
  let answers = 0
  const pending = new Promise<{ screenshotBase64: string; cleanup: () => Promise<void> }>(resolve => { release = resolve })
  const controller = new VoiceAssistantController({
    getMainWindow: () => createMainWindow(events),
    getVoiceSettings: () => ({ enabled: true, minConfidence: 0.3 }),
    hasApiKey: () => true,
    captureScreenContext: () => pending,
    streamVoiceAnswer: async () => { answers++ }
  })
  controller.start()
  controller.handleTranscriptSegment({ ...createFinalSegment("SQL indexes"), submittedPrompt: true })
  controller.stop()
  release({ screenshotBase64: "late", cleanup: async () => { cleanups++ } })
  await flushAsyncWork()
  assert.equal(answers, 0)
  assert.equal(cleanups, 1)
  assert.equal(controller.getState().status, "idle")
  assert.equal(events.some(event => event.channel === VOICE_IPC_CHANNELS.ANSWER_START), false)
})

test("Whisper submission can prepare screen context before transcription completes", async () => {
  const events: SentEvent[] = []
  let captures = 0
  let answers = 0
  const controller = new VoiceAssistantController({
    getMainWindow: () => createMainWindow(events),
    getVoiceSettings: () => ({ enabled: true, minConfidence: 0.3 }),
    hasApiKey: () => true,
    captureScreenContext: async () => {
      captures++
      return { screenshotBase64: "prepared-screen" }
    },
    streamVoiceAnswer: async ({ screenshotBase64, onComplete }) => {
      answers++
      assert.equal(screenshotBase64, "prepared-screen")
      onComplete("answer")
    }
  })
  controller.start()
  controller.prepareSubmissionContext()
  await flushAsyncWork()
  assert.equal(captures, 1)

  controller.handleTranscriptSegment({ ...createFinalSegment("explain database indexes"), submittedPrompt: true })
  await flushAsyncWork()
  assert.equal(captures, 1)
  assert.equal(answers, 1)
})
