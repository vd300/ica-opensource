import test from "node:test"
import assert from "node:assert/strict"
import Module from "node:module"
import axios from "axios"
import { LiveVoiceService } from "../LiveVoiceService"
import { DEFAULT_VOICE_AUDIO_SETTINGS } from "../../src/types/voiceSettings"

const requests: any[] = []
const clients: any[] = []
const handlers = new Map<string, (...args: any[]) => any>()
const nodeModule = Module as unknown as { _load: (...args: any[]) => any }
const originalLoad = nodeModule._load
nodeModule._load = function (id: string, ...args: any[]) {
  if (id === "electron") return { ipcMain: { handle: (channel: string, fn: (...args: any[]) => any) => handlers.set(channel, fn) } }
  if (id === "./ScreenshotHelper") return {}
  if (id === "./ConfigHelper") return { configHelper: { loadConfig: () => ({ apiProvider: "openai", solutionModel: "gpt-4o", voiceResponseStyle: "concise" }) } }
  if (id === "openai") return {
    OpenAI: class {
      constructor(options: unknown) { clients.push(options) }
      audio = { transcriptions: { create: async (body: unknown, options: unknown) => { requests.push({ body, options }); return { text: " question " } } } }
    },
    toFile: async (bytes: Buffer, name: string, options: unknown) => ({ bytes, name, options })
  }
  return originalLoad.call(this, id, ...args)
}
const { ProcessingHelper } = require("../ProcessingHelper") as typeof import("../ProcessingHelper")
const { initializeVoiceAudioIpc, assertVoiceAudioSender } = require("../voiceAudioIpc") as typeof import("../voiceAudioIpc")
nodeModule._load = originalLoad

test("voice output-limit cutoff is reported instead of completing a partial answer", async () => {
  const helper = Object.create(ProcessingHelper.prototype) as any
  helper.getLanguage = async () => "typescript"
  helper.openaiClient = { chat: { completions: { create: async function* () {
    yield { choices: [{ delta: { content: "An agentic workflow uses" }, finish_reason: null }] }
    yield { choices: [{ delta: {}, finish_reason: "length" }] }
  } } } }
  const chunks: string[] = []
  let completed = false
  await assert.rejects(helper.streamVoiceAnswer({ intent: "explain", transcript: "Agentic work flow",
    signal: new AbortController().signal, onChunk: (text: string) => chunks.push(text),
    onComplete: () => { completed = true }
  }), /output limit/)
  assert.deepEqual(chunks, ["An agentic workflow uses"])
  assert.equal(completed, false)
})

test("Whisper model is explicit; compatibility models, language hints and AbortSignal are retained", async () => {
  const helper = Object.create(ProcessingHelper.prototype) as InstanceType<typeof ProcessingHelper>
  const controller = new AbortController()
  for (const service of ["whisper", "legacy"] as const) {
    for (const legacyModel of ["gpt-4o-transcribe", "gpt-4o-mini-transcribe"] as const) {
      const config = { ...DEFAULT_VOICE_AUDIO_SETTINGS, voiceAudioService: service, voiceTranscriptionModel: legacyModel,
        apiProvider: "openai", apiKey: "test-secret", voiceRecognitionLanguage: "en-IN" } as any
      assert.equal(await helper.transcribeRecordingAudio({ audioBase64: "YWJj", mimeType: "audio/webm" }, config, controller.signal), "question")
      const request = requests.at(-1)
      assert.equal(request.body.model, service === "whisper" ? "whisper-1" : legacyModel)
      assert.equal(request.body.language, "en")
      assert.match(request.body.prompt, /SQL/)
      assert.match(request.body.prompt, /Kafka/)
      assert.equal(request.options.signal, controller.signal)
      assert.equal(request.options.timeout, 45000)
      assert.equal(clients.at(-1).maxRetries, 0)
    }
  }
  controller.abort()
  await assert.rejects(helper.transcribeRecordingAudio({ audioBase64: "YWJj", mimeType: "audio/webm" }, {} as any, controller.signal), /cancelled/)
})

test("Live uses the fixed HTTP contract and opaque session IDs; authorization never crosses the response", async context => {
  const calls: any[][] = []
  context.mock.method(axios, "post", async (...args: any[]) => {
    calls.push(args)
    return { status: args[0].endsWith("hangup") ? 200 : 201,
      data: { session: { id: "live/opaque-prefix" }, transport: { type: "webrtc", sdp: "v=0\r\n" }, secret: "must-not-return" } }
  })
  const service = new LiveVoiceService("test-secret")
  const result = await service.create("v=0\r\n")
  assert.equal(calls[0][0], "https://api.openai.com/v1/live/sessions")
  assert.equal(calls[0][1].session.model, "gpt-live-1")
  assert.equal(calls[0][1].session.delegation.type, "responses")
  assert.equal(calls[0][1].session.delegation.responses.model, "gpt-5.6-luna")
  assert.equal(typeof calls[0][1].session.delegation.responses.instructions, "string")
  assert.equal(calls[0][1].session.delegation.responses.tools, undefined)
  assert.equal(calls[0][2].maxRedirects, 0)
  assert.equal(JSON.stringify(result).includes("secret"), false)
  await service.hangup(result.session.id)
  assert.equal(calls[1][0], "https://api.openai.com/v1/live/sessions/live%2Fopaque-prefix/hangup")
})

test("Live rejects bad SDP and sanitizes network errors", async context => {
  let requests = 0
  context.mock.method(axios, "post", async () => {
    requests++
    throw Object.assign(new Error("Authorization: test-secret"), { isAxiosError: true })
  })
  const service = new LiveVoiceService("test-secret")
  await assert.rejects(service.create("garbage"), /Invalid/)
  assert.equal(requests, 0)
  await assert.rejects(service.create("v=0"), error => !String(error).includes("test-secret"))
  await assert.rejects(service.hangup("id"), /cleanup unconfirmed/)
})

test("Live authentication rejection gives recovery instructions without forwarding provider secrets", async context => {
  context.mock.method(axios, "post", async () => ({
    status: 401,
    data: { error: { message: "Incorrect API key provided: test-secret" } }
  }))
  await assert.rejects(new LiveVoiceService("test-secret").create("v=0"), error => {
    assert.ok(error instanceof Error)
    assert.match(error.message, /HTTP 401/)
    assert.match(error.message, /Open Settings/)
    assert.match(error.message, /save, then start a new recording/)
    assert.equal(error.message.includes("test-secret"), false)
    return true
  })
})

test("audio IPC rejects foreign windows and subframes and checks recording state before begin", () => {
  const frame = {}
  const contents = { id: 7, mainFrame: frame }
  const window = { isDestroyed: () => false, webContents: contents } as any
  const event = { sender: contents, senderFrame: frame } as any
  assert.equal(assertVoiceAudioSender(event, window), 7)
  assert.throws(() => assertVoiceAudioSender({ ...event, senderFrame: {} }, window), /Unauthorized/)
  assert.throws(() => assertVoiceAudioSender({ ...event, sender: { id: 8 } }, window), /Unauthorized/)
  assert.throws(() => assertVoiceAudioSender(event, null), /Unauthorized/)
  let canRecord = false
  const owners: number[] = []
  initializeVoiceAudioIpc({ begin: (owner: number) => owners.push(owner) } as any, () => window, () => canRecord)
  const begin = handlers.get("voice-audio:begin")!
  assert.throws(() => begin(event), /Start voice mode/)
  canRecord = true
  begin(event)
  assert.deepEqual(owners, [7])
})
