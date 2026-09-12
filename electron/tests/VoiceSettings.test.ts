import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Module from "node:module"
import { DEFAULT_VOICE_AUDIO_SETTINGS, sanitizeVoiceAudioSettings, snapshotVoiceConfig, voiceAudioRequirementError } from "../../src/types/voiceSettings"
import { VoiceAssistantController } from "../VoiceAssistantController"

// ConfigHelper uses Electron only to locate config.json. Isolate it from real user settings.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ica-voice-config-"))
const nodeModule = Module as unknown as { _load: (...args: any[]) => any }
const originalLoad = nodeModule._load
nodeModule._load = function (id: string, ...args: any[]) {
  if (id === "electron") return { app: { getPath: () => directory } }
  return originalLoad.call(this, id, ...args)
}
const { ConfigHelper } = require("../ConfigHelper") as typeof import("../ConfigHelper")
nodeModule._load = originalLoad
const configPath = path.join(directory, "config.json")
test.after(() => fs.rmSync(directory, { recursive: true, force: true }))

function writeConfig(value: unknown) {
  fs.writeFileSync(configPath, JSON.stringify(value))
  return new ConfigHelper()
}

test("old settings preserve browser-first defaults and both legacy transcription models", () => {
  for (const model of [undefined, "gpt-4o-transcribe", "gpt-4o-mini-transcribe"]) {
    const config = writeConfig({ voiceTranscriptionModel: model, language: "sql", opacity: 0.7 }).loadConfig()
    assert.deepEqual(sanitizeVoiceAudioSettings(config), DEFAULT_VOICE_AUDIO_SETTINGS)
    assert.equal(config.voiceTranscriptionModel, model || "gpt-4o-transcribe")
    assert.equal(config.language, "sql")
    assert.equal(config.opacity, 0.7)
  }
})

test("all six selections survive save, reopen, and a fresh ConfigHelper", () => {
  for (const voiceAudioService of ["legacy", "whisper", "gpt-live"] as const) {
    for (const voiceSubmissionMode of ["manual", "automatic"] as const) {
      const helper = writeConfig({ voiceTranscriptionModel: "gpt-4o-mini-transcribe" })
      const settings = { voiceAudioService, voiceSubmissionMode, voiceAutoSubmitSilenceMs: 2300 }
      helper.updateConfig(settings)
      assert.deepEqual(sanitizeVoiceAudioSettings(helper.loadConfig()), settings)
      assert.deepEqual(sanitizeVoiceAudioSettings(new ConfigHelper().loadConfig()), settings)
      assert.equal(new ConfigHelper().loadConfig().voiceTranscriptionModel, "gpt-4o-mini-transcribe")
    }
  }
})

test("invalid settings sanitize on load and update, including finite pause bounds", () => {
  for (const pause of [undefined, null, "2000", "", {}, NaN, Infinity, -Infinity, -1, 100, 7000, 2300]) {
    const expected = typeof pause === "number" && Number.isFinite(pause) ? Math.min(5000, Math.max(500, pause)) : 1500
    const invalid = { voiceAudioService: "unknown", voiceSubmissionMode: "unknown", voiceAutoSubmitSilenceMs: pause }
    const helper = writeConfig(invalid)
    const loaded = helper.loadConfig()
    assert.equal(loaded.voiceAutoSubmitSilenceMs, expected)
    assert.equal(loaded.voiceAudioService, "legacy")
    assert.equal(loaded.voiceSubmissionMode, "manual")
    const updated = helper.updateConfig(invalid as any)
    assert.equal(updated.voiceAutoSubmitSilenceMs, expected)
    assert.equal(updated.voiceAudioService, "legacy")
    assert.equal(updated.voiceSubmissionMode, "manual")
  }
})

test("each audio setting emits the full sanitized update; unrelated edits preserve choices", () => {
  const helper = writeConfig({})
  const events: unknown[] = []
  helper.on("config-updated", config => events.push(config))
  const service = helper.updateConfig({ voiceAudioService: "gpt-live" })
  assert.deepEqual(events.pop(), service)
  const mode = helper.updateConfig({ voiceSubmissionMode: "automatic" })
  assert.deepEqual(events.pop(), mode)
  const pause = helper.updateConfig({ voiceAutoSubmitSilenceMs: 9000 })
  assert.deepEqual(events.pop(), pause)
  assert.equal(pause.voiceAutoSubmitSilenceMs, 5000)
  const updated = helper.updateConfig({ opacity: 0.6 })
  assert.equal(updated.voiceAudioService, "gpt-live")
  assert.equal(updated.voiceSubmissionMode, "automatic")
  assert.equal(events.length, 0)
})

test("provider requirements explain incompatible selections without erasing saved choices", () => {
  for (const service of ["whisper", "gpt-live"] as const) {
    assert.match(voiceAudioRequirementError(service, "gemini", "key")!, /OpenAI provider/)
    assert.match(voiceAudioRequirementError(service, "openai", "  ")!, /API key/)
    assert.equal(voiceAudioRequirementError(service, "openai", "configured-key"), null)
    const helper = writeConfig({})
    helper.updateConfig({ voiceAudioService: service, apiProvider: "gemini", apiKey: "" })
    assert.equal(helper.loadConfig().voiceAudioService, service)
  }
  assert.equal(voiceAudioRequirementError("legacy", "gemini", ""), null)
})

test("recording snapshot is immutable; only a new recording captures changed settings", () => {
  const helper = writeConfig({})
  let active: ReturnType<typeof snapshotVoiceConfig> | undefined
  let starts = 0
  const controller = new VoiceAssistantController({
    getMainWindow: () => ({ isDestroyed: () => false, webContents: { send() {} } }) as any,
    onRecordingStart: () => { starts++; active = snapshotVoiceConfig(helper.loadConfig()) }
  })
  controller.start()
  const initial = active!
  helper.updateConfig({ voiceAudioService: "whisper", voiceSubmissionMode: "automatic", voiceAutoSubmitSilenceMs: 3000 })
  assert.equal(initial.voiceAudioService, "legacy")
  assert.equal(initial.voiceSubmissionMode, "manual")
  assert.equal(initial.voiceAutoSubmitSilenceMs, 1500)
  assert.equal(Object.isFrozen(initial), true)
  assert.throws(() => { (initial as any).voiceAudioService = "gpt-live" }, TypeError)
  controller.syncRenderer()
  assert.equal(starts, 1)
  controller.start()
  assert.equal(starts, 2)
  assert.equal(active!.voiceAudioService, "whisper")
  controller.stop()
  controller.start()
  assert.equal(starts, 3)
})
