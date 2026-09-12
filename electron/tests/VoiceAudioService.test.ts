import test from "node:test"
import assert from "node:assert/strict"
import { VoiceAudioService } from "../VoiceAudioService"
import type { Config } from "../ConfigHelper"
import { DEFAULT_VOICE_AUDIO_SETTINGS } from "../../src/types/voiceSettings"
import { MAX_VOICE_AUDIO_BYTES } from "../../src/types/voiceAdapter"

const config = (): Config => ({ ...DEFAULT_VOICE_AUDIO_SETTINGS, apiKey: "private-key", apiProvider: "openai",
  voiceAudioService: "whisper", voiceAssistantEnabled: true, voiceRecognitionLanguage: "en-IN",
  voiceTranscriptionModel: "gpt-4o-mini-transcribe", voiceTriggerConfidenceThreshold: 0.3,
  voiceResponseStyle: "concise", extractionModel: "gpt-4o", solutionModel: "gpt-4o", debuggingModel: "gpt-4o", language: "sql", opacity: 1 })
const file = (recordingId: string) => ({ recordingId, sequence: 0, mimeType: "audio/webm", audioBase64: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2]).toString("base64") })
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }

function harness() {
  const settings = config()
  const submissions: string[] = []
  const uploads: Array<{ config: Readonly<Config>; signal: AbortSignal }> = []
  const hangups: string[] = []
  let expirations = 0
  let transcribe = async () => "SQL query"
  let create = async () => ({ session: { id: "opaque_live_id" }, transport: { type: "webrtc" as const, sdp: "v=0\r\n" } })
  const service = new VoiceAudioService({ getConfig: () => settings,
    transcribe: async (_payload, config, signal) => { uploads.push({ config, signal }); return transcribe() },
    createLive: () => ({ create: () => create(), hangup: async id => { hangups.push(id) } }),
    submit: text => { submissions.push(text) },
    expired: () => { expirations++ }
  })
  return { service, settings, submissions, uploads, hangups,
    expirations: () => expirations,
    setTranscribe: (fn: typeof transcribe) => { transcribe = fn }, setCreate: (fn: typeof create) => { create = fn } }
}

test("expired upload aborts and rejects late text; a new recording remains usable", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const h = harness()
  try {
    const { recordingId } = h.service.begin(1)
    h.service.authorizeFile(1, recordingId)
    h.service.claim(1, { recordingId, reason: "shortcut" })
    const pending = deferred<string>()
    h.setTranscribe(() => pending.promise)
    const upload = h.service.upload(1, file(recordingId))
    context.mock.timers.tick(240000)
    assert.equal(h.expirations(), 1)
    assert.equal(h.uploads[0].signal.aborted, true)
    assert.throws(() => h.service.complete(1, { recordingId, text: "late" }), /no longer active/)
    const next = h.service.begin(1)
    pending.resolve("late provider response")
    await assert.rejects(upload, /cancelled/)
    h.service.authorizeFile(1, next.recordingId)
    assert.deepEqual(h.submissions, [])
  } finally { await h.service.dispose() }
})

test("Live survives the file expiry and hangs up once when stopped", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const h = harness()
  try {
    h.settings.voiceAudioService = "gpt-live"
    const live = h.service.begin(1)
    await h.service.createLive(1, { recordingId: live.recordingId, sequence: 0, sdp: "v=0" })
    context.mock.timers.tick(240000)
    assert.deepEqual(h.hangups, [])
    assert.equal(h.service.claim(1, { recordingId: live.recordingId, reason: "shortcut" }), false)
    assert.equal(h.service.claim(1, { recordingId: live.recordingId, reason: "silence" }), false)
    await h.service.dispose()
    assert.deepEqual(h.hangups, ["opaque_live_id"])
    assert.equal(h.expirations(), 0)
    assert.throws(() => h.service.claim(1, { recordingId: live.recordingId, reason: "shortcut" }), /no longer active/)
    h.settings.voiceAudioService = "legacy"
    const next = h.service.begin(1)
    h.service.claim(1, { recordingId: next.recordingId, reason: "shortcut" })
    h.service.complete(1, { recordingId: next.recordingId, text: "SQL indexes" })
    context.mock.timers.tick(240000)
    assert.equal(h.expirations(), 0)
    assert.deepEqual(h.submissions, ["SQL indexes"])
  } finally { await h.service.dispose() }
})

test("Whisper cannot submit renderer text before transcription; legacy browser text remains supported", async () => {
  const h = harness()
  try {
    const { recordingId } = h.service.begin(1)
    assert.throws(() => h.service.complete(1, { recordingId, text: "bypass" }), /cannot be submitted/)
    assert.deepEqual(h.submissions, [])
    h.service.authorizeFile(1, recordingId)
    assert.throws(() => h.service.complete(1, { recordingId, text: "bypass" }), /cannot be submitted/)
    h.service.claim(1, { recordingId, reason: "shortcut" })
    await h.service.upload(1, file(recordingId))
    h.service.complete(1, { recordingId, text: "renderer replacement" })
    assert.deepEqual(h.submissions, ["SQL query"])
    h.settings.voiceAudioService = "legacy"
    const legacy = h.service.begin(1)
    h.service.claim(1, { recordingId: legacy.recordingId, reason: "shortcut" })
    h.service.complete(1, { recordingId: legacy.recordingId, text: "browser question" })
    assert.deepEqual(h.submissions, ["SQL query", "browser question"])
  } finally { await h.service.dispose() }
})

test("credential-free descriptor and frozen upload configuration; no answer until completion", async () => {
  const h = harness()
  try {
    const descriptor = h.service.begin(1)
    assert.equal(JSON.stringify(descriptor).includes("private-key"), false)
    h.settings.voiceAudioService = "legacy"; h.settings.apiKey = "changed"
    h.service.authorizeFile(1, descriptor.recordingId)
    h.service.claim(1, { recordingId: descriptor.recordingId, reason: "shortcut" })
    assert.equal(await h.service.upload(1, file(descriptor.recordingId)), "SQL query")
    assert.equal(h.uploads[0].config.voiceAudioService, "whisper")
    assert.equal(h.uploads[0].config.apiKey, "private-key")
    assert.equal(Object.isFrozen(h.uploads[0].config), true)
    assert.deepEqual(h.submissions, [])
    h.service.complete(1, { recordingId: descriptor.recordingId, text: "renderer replacement" })
    assert.deepEqual(h.submissions, ["SQL query"])
    assert.throws(() => h.service.complete(1, { recordingId: descriptor.recordingId, text: "again" }))
  } finally { await h.service.dispose() }
})

test("rejects stale owners, IDs, duplicate uploads, sequence errors, formats, malformed base64 and oversized files", async () => {
  const h = harness()
  try {
    const { recordingId } = h.service.begin(1)
    assert.throws(() => h.service.authorizeFile(2, recordingId))
    assert.throws(() => h.service.authorizeFile(1, "old"))
    h.service.authorizeFile(1, recordingId)
    for (const changes of [{ sequence: 1 }, { mimeType: "text/html" }, { audioBase64: "%%%=" },
      { audioBase64: "YWJjZA==" }, { audioBase64: "A".repeat(Math.ceil(MAX_VOICE_AUDIO_BYTES / 3) * 4 + 4) }]) {
      await assert.rejects(h.service.upload(1, { ...file(recordingId), ...changes }))
    }
    assert.equal(h.uploads.length, 0)
    const pending = deferred<string>()
    h.setTranscribe(() => pending.promise)
    const upload = h.service.upload(1, file(recordingId))
    await assert.rejects(h.service.upload(1, file(recordingId)), /Duplicate/)
    pending.resolve("question")
    await upload
    assert.equal(h.uploads.length, 1)
  } finally { await h.service.dispose() }
})

test("stop/new recording aborts uploads and suppresses late results without cancelling the new recording", async () => {
  const h = harness()
  try {
    const first = h.service.begin(1)
    h.service.authorizeFile(1, first.recordingId)
    const pending = deferred<string>()
    h.setTranscribe(() => pending.promise)
    const upload = h.service.upload(1, file(first.recordingId))
    const second = h.service.begin(1)
    assert.equal(h.uploads[0].signal.aborted, true)
    h.service.cancel(1, first.recordingId)
    pending.resolve("stale")
    await assert.rejects(upload)
    h.service.authorizeFile(1, second.recordingId)
    assert.deepEqual(h.submissions, [])
  } finally { await h.service.dispose() }
})

test("Live rejects wrong service/sequence, cleans late creation, and never submits transcripts directly", async () => {
  const h = harness()
  try {
    let descriptor = h.service.begin(1)
    await assert.rejects(h.service.createLive(1, { recordingId: descriptor.recordingId, sequence: 0, sdp: "v=0" }))
    h.settings.voiceAudioService = "gpt-live"
    descriptor = h.service.begin(1)
    assert.throws(() => h.service.authorizeFile(1, descriptor.recordingId))
    const pending = deferred<{ session: { id: string }; transport: { type: "webrtc"; sdp: string } }>()
    h.setCreate(() => pending.promise)
    const creation = h.service.createLive(1, { recordingId: descriptor.recordingId, sequence: 0, sdp: "v=0" })
    await assert.rejects(h.service.createLive(1, { recordingId: descriptor.recordingId, sequence: 0, sdp: "v=0" }))
    assert.throws(() => h.service.complete(1, { recordingId: descriptor.recordingId, text: "provider transcript" }), /do not use file/)
    h.service.cancelAll()
    pending.resolve({ session: { id: "keep_this_prefix" }, transport: { type: "webrtc", sdp: "v=0" } })
    await assert.rejects(creation, /cancelled/)
    await h.service.dispose()
    assert.deepEqual(h.hangups, ["keep_this_prefix"])
    assert.deepEqual(h.submissions, [])
  } finally { await h.service.dispose() }
})

test("provider/key validation runs before issuing a recording descriptor; errors never return secrets", async () => {
  const h = harness()
  try {
    h.settings.apiProvider = "gemini"
    assert.throws(() => h.service.begin(1), /OpenAI provider/)
    h.settings.apiProvider = "openai"; h.settings.apiKey = ""
    assert.throws(() => h.service.begin(1), /API key/)
    h.settings.apiKey = "secret"
    const { recordingId } = h.service.begin(1)
    h.service.authorizeFile(1, recordingId)
    h.setTranscribe(async () => { throw new Error("authorization: secret") })
    await assert.rejects(h.service.upload(1, file(recordingId)), error => !String(error).includes("secret"))
  } finally { await h.service.dispose() }
})

for (const mode of ["manual", "automatic"] as const) {
  test(`${mode}: racing triggers claim one turn and cancellation rejects stale claims`, async () => {
    const h = harness()
    h.settings.voiceSubmissionMode = mode
    try {
      const { recordingId } = h.service.begin(1)
      h.service.authorizeFile(1, recordingId)
      const claims = await Promise.all(["silence", "shortcut", "shortcut"].map(reason =>
        Promise.resolve().then(() => h.service.claim(1, { recordingId, reason: reason as "silence" | "shortcut" }))))
      assert.equal(claims.filter(Boolean).length, 1)
      assert.equal(claims[0], mode === "automatic")
      await h.service.upload(1, file(recordingId))
      h.service.complete(1, { recordingId, text: "ignored" })
      assert.throws(() => h.service.complete(1, { recordingId, text: "duplicate" }))
      assert.equal(h.uploads.length, 1)
      assert.deepEqual(h.submissions, ["SQL query"])
      h.service.cancelAll()
      assert.throws(() => h.service.claim(1, { recordingId, reason: "shortcut" }))
    } finally { await h.service.dispose() }
  })
}

test("empty or punctuation-only transcription never generates an answer", async () => {
  const h = harness()
  h.setTranscribe(async () => "... !")
  try {
    const { recordingId } = h.service.begin(1)
    h.service.authorizeFile(1, recordingId)
    h.service.claim(1, { recordingId, reason: "shortcut" })
    await h.service.upload(1, file(recordingId))
    assert.throws(() => h.service.complete(1, { recordingId, text: "replacement" }), /No speech/)
    assert.deepEqual(h.submissions, [])
  } finally { await h.service.dispose() }
})
