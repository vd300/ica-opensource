import test from "node:test"
import assert from "node:assert/strict"
import { LiveTranscriptDrain } from "../../src/components/VoiceAssistant/LiveTranscriptDrain"
import { LiveConnectionProbe } from "../../src/components/VoiceAssistant/LiveConnectionProbe"
import { LiveApi } from "../prototypes/live/LiveApi"

const delta = (id: string, text: string, start = 0) => ({
  type: "session.input_transcript.delta", event_id: id, delta: text, start_ms: start, end_ms: start + 100
})

for (const mode of ["manual", "automatic"] as const) {
  test(`${mode}: drains late fragments, deduplicates events, never certifies completeness`, () => {
    const drain = new LiveTranscriptDrain("recording", mode)
    assert.equal(drain.append("stale", delta("old", "wrong")), false)
    drain.append("recording", delta("1", "What is"))
    const turn = { recordingId: "recording", turnId: "turn", reason: mode === "manual" ? "shortcut" as const : "silence" as const }
    assert.equal(drain.claim(turn), true)
    assert.equal(drain.claim(turn), false)
    drain.append("recording", delta("3", " in Python?", 200))
    drain.append("recording", delta("2", " GIL", 100))
    assert.equal(drain.append("recording", delta("2", " GIL", 100)), false)
    const result = drain.finish("confirmed", "close_requested")!
    assert.equal(result.text, "What is GIL in Python?")
    assert.equal(result.completeness, "requires-review")
    assert.equal(result.finalization, "confirmed")
    assert.equal(drain.append("recording", delta("4", "stale")), false)
    assert.equal(drain.finish("confirmed"), null)
  })
}

test("manual rejects silence; provider activity cannot claim a submission", () => {
  const drain = new LiveTranscriptDrain("r", "manual")
  assert.equal(drain.claim({ recordingId: "r", turnId: "t", reason: "silence" }), false)
  assert.equal(drain.append("r", { type: "session.delegation.created" }), false)
  assert.equal(drain.append("r", { ...delta("1", "bad"), end_ms: NaN }), false)
  assert.equal(drain.finish("confirmed"), null)
  drain.cancel()
  assert.equal(drain.claim({ recordingId: "r", turnId: "t", reason: "shortcut" }), false)
})

function harness(closeTimeout = 1000) {
  const sent: string[] = []
  const reports: string[] = []
  const track = { enabled: true, stopCount: 0, stop() { this.stopCount++ } }
  const channel = {
    readyState: "open", onmessage: null as any, onclose: null as any, onerror: null as any,
    send: (value: string) => sent.push(JSON.parse(value).type),
    close() { this.readyState = "closed"; this.onclose?.() }
  }
  const peer = {
    iceGatheringState: "complete", connectionState: "connected", onconnectionstatechange: null,
    localDescription: { sdp: "v=0\r\n" }, closed: false, addTrack() {},
    createDataChannel: () => channel, createOffer: async () => ({ type: "offer", sdp: "v=0\r\n" }),
    setLocalDescription: async () => {}, setRemoteDescription: async () => {}, close() { this.closed = true }
  }
  const deps = {
    createPeer: () => peer as unknown as RTCPeerConnection,
    getMicrophone: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) as unknown as MediaStream,
    createSession: async () => ({ session: { id: "opaque_live_id" }, transport: { type: "webrtc" as const, sdp: "answer" } }),
    abandonSession: async (_sessionId: string) => {},
    report: (text: string) => reports.push(text)
  }
  const probe = new LiveConnectionProbe("r", "manual", deps, closeTimeout)
  const emit = (event: unknown) => channel.onmessage({ data: JSON.stringify(event) })
  return { probe, deps, emit, track, channel, peer, sent, reports }
}

test("WebRTC startup gates microphone, drains before closing, and never connects playback", async () => {
  const h = harness()
  await h.probe.start()
  assert.equal(h.track.enabled, false)
  h.emit({ type: "session.started" })
  assert.equal(h.track.enabled, true)
  assert.equal("ontrack" in h.peer, false)
  h.emit({ type: "session.delegation.created" })
  assert.deepEqual(h.sent, [])
  h.emit(delta("1", "Explain"))
  const resultPromise = h.probe.submit("shortcut")
  assert.equal(h.track.stopCount, 1)
  assert.equal(h.peer.closed, false)
  assert.deepEqual(h.sent, ["session.close"])
  assert.equal(await h.probe.submit("shortcut"), null)
  h.emit(delta("2", " SQL joins", 100))
  h.emit({ type: "session.closed", reason: "close_requested" })
  const result = await resultPromise
  assert.equal(result?.text, "Explain SQL joins")
  assert.equal(result?.finalization, "confirmed")
  assert.equal(h.peer.closed, true)
})

test("close timeout reports unconfirmed finalization and releases resources", async () => {
  const h = harness(5)
  await h.probe.start()
  h.emit({ type: "session.started" })
  const result = await h.probe.submit("shortcut")
  assert.equal(result?.finalization, "unconfirmed")
  assert.equal(result?.completeness, "requires-review")
  assert.equal(h.peer.closed, true)
})

test("cancel during permission request stops tracks when permission eventually resolves", async () => {
  const h = harness()
  let release: (stream: MediaStream) => void
  h.deps.getMicrophone = () => new Promise(resolve => { release = resolve })
  const pending = h.probe.start()
  h.probe.cancel()
  release!({ getTracks: () => [h.track] } as unknown as MediaStream)
  await pending
  assert.equal(h.track.stopCount, 1)
  assert.equal(h.peer.closed, true)
})

test("transport loss after submission returns unconfirmed text; cancellation returns no turn", async () => {
  for (const cancel of [false, true]) {
    const h = harness()
    await h.probe.start()
    h.emit({ type: "session.started" })
    h.emit(delta("1", "partial"))
    const pending = h.probe.submit("shortcut")
    if (cancel) h.probe.cancel()
    h.channel.onclose()
    const result = await pending
    assert.equal(result?.finalization ?? null, cancel ? null : "unconfirmed")
    assert.equal(h.peer.closed, true)
  }
})

test("HTTP prototype rejects missing keys and malformed SDP before network access", async () => {
  assert.throws(() => new LiveApi(""))
  const api = new LiveApi("test-placeholder")
  await assert.rejects(api.create("invalid"), /Invalid or oversized/)
  await assert.rejects(api.create("v=0" + "x".repeat(65536)), /Invalid or oversized/)
})

test("cancelling during session creation cleans up the late provider session", async () => {
  const h = harness()
  let release: (answer: any) => void
  let entered: () => void
  const creating = new Promise<void>(resolve => { entered = resolve })
  const abandoned: string[] = []
  h.deps.createSession = () => new Promise(resolve => { release = resolve; entered() })
  h.deps.abandonSession = async id => { abandoned.push(id) }
  const start = h.probe.start()
  await creating
  h.probe.cancel()
  release!({ session: { id: "opaque_late_id" }, transport: { type: "webrtc", sdp: "answer" } })
  await start
  assert.deepEqual(abandoned, ["opaque_late_id"])
  assert.equal(h.peer.closed, true)
})

test("session creation rejection stops the microphone and closes the peer", async () => {
  const h = harness()
  h.deps.createSession = async () => { throw new Error("HTTP 401") }
  await h.probe.start()
  assert.equal(h.peer.closed, true)
  assert.ok(h.track.stopCount > 0)
  assert.equal(await h.probe.submit("shortcut"), null)
})
