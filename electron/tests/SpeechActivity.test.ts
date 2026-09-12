import test from "node:test"
import assert from "node:assert/strict"
import { SpeechActivity } from "../../src/components/VoiceAssistant/SpeechActivity"

test("quiet speech submits after silence while low background noise does not", () => {
  const detector = new SpeechActivity("automatic", 1500)
  for (let now = 0; now < 2000; now += 50) assert.equal(detector.sample(0.002, now), false)
  for (let now = 2000; now <= 2400; now += 50) assert.equal(detector.sample(0.008, now), false)
  assert.equal(detector.sample(0.002, 3899), false)
  assert.equal(detector.sample(0.002, 3900), true)
  assert.equal(detector.sample(0.002, 6000), false)
})

test("manual long pauses and automatic silence-only recordings never submit", () => {
  for (const mode of ["manual", "automatic"] as const) {
    const detector = new SpeechActivity(mode, 1500)
    for (let now = 0; now <= 120000; now += 50) assert.equal(detector.sample(mode === "manual" && now < 1000 ? 0.1 : 0, now), false)
  }
})
test("short noise is ignored; resumed speech resets silence; submission is one-shot", () => {
  const detector = new SpeechActivity("automatic", 1500)
  assert.equal(detector.sample(0.1, 0), false)
  assert.equal(detector.sample(0, 50), false)
  assert.equal(detector.sample(0, 2000), false)
  for (let now = 3000; now <= 3300; now += 50) assert.equal(detector.sample(0.1, now), false)
  assert.equal(detector.sample(0, 4750), false)
  assert.equal(detector.sample(0.1, 4790), false)
  assert.equal(detector.sample(0, 6289), false)
  assert.equal(detector.sample(0, 6290), true)
  assert.equal(detector.sample(0, 9000), false)
})
