import test from "node:test"
import assert from "node:assert/strict"
import { createAudioAdapter, FileAudioAdapter, LegacyAudioAdapter, LiveAudioAdapter, type AudioAdapterDependencies } from "../../src/components/VoiceAssistant/AudioAdapters"
import { DEFAULT_VOICE_AUDIO_SETTINGS } from "../../src/types/voiceSettings"
import { MAX_VOICE_AUDIO_BYTES, type VoiceAdapterEvent, type VoiceFileUpload, type VoiceRecordingDescriptor } from "../../src/types/voiceAdapter"

const flush = () => new Promise(resolve => setImmediate(resolve))
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
const descriptor = (service: "legacy" | "whisper" | "gpt-live"): VoiceRecordingDescriptor => ({ recordingId: "r", language: "en-IN", settings: { ...DEFAULT_VOICE_AUDIO_SETTINGS, voiceAudioService: service } })

function harness() {
  const events: VoiceAdapterEvent[] = []
  const uploads: VoiceFileUpload[] = []
  const sent: string[] = []
  const track = { enabled: true, stopped: 0, stop() { this.stopped++ } }
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream
  let micCalls = 0
  let cancelled = 0
  let fileAuthorized = 0
  let peerClosed = 0
  let recorderCreated = 0
  const recorder = {
    state: "inactive", mimeType: "audio/webm;codecs=opus",
    ondataavailable: null as any, onstop: null as any, onerror: null as any,
    start() { this.state = "recording" },
    stop() {
      this.state = "inactive"
      queueMicrotask(() => {
        this.ondataavailable?.({ data: new Blob(["final-bytes"]) })
        this.onstop?.()
      })
    }
  }
  const channel = { readyState: "open", onmessage: null as any, onclose: null as any, onerror: null as any,
    send(value: string) { sent.push(JSON.parse(value).type) }, close() { this.readyState = "closed" } }
  const peer = { iceGatheringState: "complete", connectionState: "connected", onconnectionstatechange: null as any,
    localDescription: { sdp: "v=0\r\n" }, addTrack() {}, createDataChannel: () => channel,
    createOffer: async () => ({ type: "offer", sdp: "v=0" }), setLocalDescription: async () => {},
    setRemoteDescription: async () => { channel.onmessage?.({ data: JSON.stringify({ type: "session.started" }) }) },
    close() { peerClosed++ } }
  const deps: AudioAdapterDependencies = {
    bridge: { claim: async () => true, begin: async () => descriptor("whisper"), authorizeFile: async () => { fileAuthorized++ },
      upload: async payload => { uploads.push(payload); return "SQL question" },
      createLive: async () => ({ session: { id: "live_opaque" }, transport: { type: "webrtc", sdp: "v=0" } }),
      cancel: async () => { cancelled++ }, complete: async () => { throw new Error("Adapters must never generate answers") } },
    emit: event => events.push(event), getMicrophone: async () => { micCalls++; return stream },
    supportsMime: () => true, createRecorder: () => { recorderCreated++; return recorder as unknown as MediaRecorder },
    createPeer: () => peer as unknown as RTCPeerConnection
  }
  return { deps, events, uploads, sent, stream, track, recorder, channel, peer,
    counts: () => ({ micCalls, cancelled, fileAuthorized, peerClosed, recorderCreated }),
    emit: (event: unknown) => channel.onmessage?.({ data: JSON.stringify(event) }) }
}

test("factory selects exactly the requested service", () => {
  const h = harness()
  assert.ok(createAudioAdapter(descriptor("legacy"), h.deps) instanceof LegacyAudioAdapter)
  assert.ok(createAudioAdapter(descriptor("whisper"), h.deps) instanceof FileAudioAdapter)
  assert.ok(createAudioAdapter(descriptor("gpt-live"), h.deps) instanceof LiveAudioAdapter)
  assert.throws(() => createAudioAdapter({ ...descriptor("legacy"), settings: { ...DEFAULT_VOICE_AUDIO_SETTINGS, voiceAudioService: "unknown" as any } }, h.deps))
  assert.equal(h.counts().micCalls, 0)
})

test("Whisper bypasses browser recognition and uploads final recorder bytes once", async () => {
  const h = harness()
  h.deps.createRecognition = () => { throw new Error("Must not use browser recognition") }
  const adapter = createAudioAdapter(descriptor("whisper"), h.deps)
  try {
    await adapter.start()
    h.recorder.ondataavailable({ data: new Blob(["container-start|"]) })
    assert.equal(h.uploads.length, 0)
    const submission = adapter.submit()
    assert.equal(await adapter.submit(), null)
    const result = await submission
    assert.equal(result?.text, "SQL question")
    assert.equal(h.uploads.length, 1)
    assert.equal(Buffer.from(h.uploads[0].audioBase64, "base64").toString(), "container-start|final-bytes")
    assert.ok(h.track.stopped > 0)
  } finally { adapter.cancel() }
})

test("file cancellation during permission and upload releases capture and suppresses stale text", async () => {
  const h = harness()
  const permission = deferred<MediaStream>()
  h.deps.getMicrophone = () => permission.promise
  const adapter = createAudioAdapter(descriptor("whisper"), h.deps)
  const starting = adapter.start()
  await flush()
  adapter.cancel()
  permission.resolve(h.stream)
  await assert.rejects(starting, /cancelled/)
  assert.ok(h.track.stopped > 0)
  assert.equal(h.counts().recorderCreated, 0)
  const next = harness()
  const upload = deferred<string>()
  next.deps.bridge.upload = () => upload.promise
  const second = createAudioAdapter(descriptor("whisper"), next.deps)
  await second.start()
  const submitting = second.submit()
  await flush()
  second.cancel()
  upload.resolve("stale")
  await assert.rejects(submitting, /cancelled/)
  assert.ok(next.track.stopped > 0)
})

test("file permission rejection, recorder errors and byte overflow cancel without upload", async () => {
  const h = harness()
  h.deps.getMicrophone = async () => { throw new Error("Permission denied") }
  const adapter = createAudioAdapter(descriptor("whisper"), h.deps)
  await assert.rejects(adapter.start(), /Permission denied/)
  assert.equal(h.counts().recorderCreated, 0)
  for (const overflow of [false, true]) {
    const next = harness()
    const second = createAudioAdapter(descriptor("whisper"), next.deps)
    await second.start()
    if (overflow) next.recorder.ondataavailable({ data: { size: MAX_VOICE_AUDIO_BYTES + 1 } })
    else next.recorder.onerror()
    assert.ok(next.track.stopped > 0)
    assert.equal(await second.submit(), null)
    assert.equal(next.uploads.length, 0)
  }
})

test("Live streams both speakers continuously without file submission or local silence detection", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  for (const mode of ["manual", "automatic"] as const) {
    const h = harness()
    h.peer.setRemoteDescription = async () => {}
    h.deps.observeSpeech = () => { throw new Error("Live must not use local submission detection") }
    const recording = descriptor("gpt-live")
    recording.settings = { ...recording.settings, voiceSubmissionMode: mode }
    const adapter = createAudioAdapter(recording, h.deps)
    try {
      const start = adapter.start()
      await flush()
      assert.equal(h.track.enabled, false)
      h.emit({ type: "session.started" })
      await start
      assert.equal(h.track.enabled, true)
      const delta = (type: string, event_id: string, delta: string, start_ms: number) => ({ type, event_id, delta, start_ms, end_ms: start_ms + 10 })
      h.emit(delta("session.input_transcript.delta", "1", "What is SQL?", 0))
      h.emit(delta("session.output_transcript.delta", "3", " query language.", 30))
      h.emit(delta("session.output_transcript.delta", "2", "SQL is a", 20))
      h.emit(delta("session.output_transcript.delta", "2", "SQL is a", 20))
      const captions = h.events.filter(event => event.type === "live-captions").at(-1)
      assert.ok(captions?.type === "live-captions")
      assert.deepEqual(captions.captions.map(row => row.text), ["What is SQL?", "SQL is a query language."])
      assert.equal(await adapter.submit(), null)
      context.mock.timers.tick(240001)
      assert.equal(h.track.stopped, 0)
      assert.deepEqual(h.sent, [])
      assert.equal(h.counts().recorderCreated, 0)
      assert.equal(h.counts().fileAuthorized, 0)
      h.emit(delta("session.input_transcript.delta", "4", "And indexes?", 3000))
      assert.ok(h.events.filter(event => event.type === "live-captions").length >= 4)
      const late = h.channel.onmessage
      adapter.cancel()
      const count = h.events.length
      late({ data: JSON.stringify(delta("session.output_transcript.delta", "5", "late", 3100)) })
      assert.equal(h.events.length, count)
      assert.ok(h.track.stopped > 0)
    } finally { adapter.cancel() }
  }
})

test("Live microphone toggles locally while the answer streams and the same session stays open", async () => {
  for (const mode of ["manual", "automatic"] as const) {
    const h = harness()
    const recording = descriptor("gpt-live")
    recording.settings = { ...recording.settings, voiceSubmissionMode: mode }
    const adapter = createAudioAdapter(recording, h.deps)
    try {
      await adapter.start()
      adapter.toggleMicrophone!()
      assert.equal(h.track.enabled, false)
      assert.equal(h.track.stopped, 0)
      assert.deepEqual(h.events.at(-1), { recordingId: "r", type: "microphone-muted", muted: true })
      h.emit({ type: "session.output_transcript.delta", event_id: "answer", delta: "The answer continues.", start_ms: 0, end_ms: 10 })
      const captions = h.events.at(-1)
      assert.ok(captions?.type === "live-captions")
      assert.equal(captions.captions[0].text, "The answer continues.")
      assert.equal(h.track.enabled, false)
      adapter.toggleMicrophone!()
      assert.equal(h.track.enabled, true)
      assert.deepEqual(h.events.at(-1), { recordingId: "r", type: "microphone-muted", muted: false })
      assert.equal(h.counts().micCalls, 1)
      assert.equal(h.counts().peerClosed, 0)
      assert.deepEqual(h.sent, [])
      assert.deepEqual(h.uploads, [])
      // Rapid successive toggles use the adapter's current state, not stale React state.
      adapter.toggleMicrophone!()
      adapter.toggleMicrophone!()
      adapter.toggleMicrophone!()
      assert.equal(h.track.enabled, false)
      adapter.cancel()
      const count = h.events.length
      adapter.toggleMicrophone!()
      assert.equal(h.track.enabled, false)
      assert.equal(h.events.length, count)
      assert.ok(h.track.stopped > 0)
    } finally { adapter.cancel() }
  }
})

test("Live ignores microphone toggles during startup; a new session begins unmuted", async () => {
  const h = harness()
  h.peer.setRemoteDescription = async () => {}
  const adapter = createAudioAdapter(descriptor("gpt-live"), h.deps)
  try {
    const start = adapter.start()
    await flush()
    adapter.toggleMicrophone!()
    assert.equal(h.track.enabled, false)
    h.emit({ type: "session.started" })
    await start
    assert.equal(h.track.enabled, true)
    assert.equal(h.events.some(event => event.type === "microphone-muted"), false)
  } finally { adapter.cancel() }
  assert.equal(createAudioAdapter(descriptor("whisper"), harness().deps).toggleMicrophone, undefined)
  assert.equal(createAudioAdapter(descriptor("legacy"), harness().deps).toggleMicrophone, undefined)
})

test("Live lets managed reasoning finish and displays its spoken answer without rerouting or rewriting captions", async () => {
  const h = harness()
  const adapter = createAudioAdapter(descriptor("gpt-live"), h.deps)
  try {
    await adapter.start()
    h.emit({ type: "session.input_transcript.delta", event_id: "heard", delta: "past API and RaaS", start_ms: 0, end_ms: 100 })
    h.emit({ type: "session.delegation.created", delegation: { id: "d1", target: "responses" }, response_id: "resp1" })
    h.emit({ type: "response.event", delegation_id: "d1", event: { type: "response.created", response: { id: "resp1" } } })
    h.emit({ type: "response.event", delegation_id: "d1", event: { type: "response.output_text.delta", delta: "backend result" } })
    h.emit({ type: "response.event", delegation_id: "d1", event: { type: "response.completed", response: { id: "resp1", output: [] } } })
    h.emit({ type: "session.output_transcript.delta", event_id: "clarify", delta: "Did you mean FastAPI and Flask?", start_ms: 110, end_ms: 200 })
    const event = h.events.at(-1)
    assert.ok(event?.type === "live-captions")
    assert.deepEqual(event.captions.map(row => row.text), ["past API and RaaS", "Did you mean FastAPI and Flask?"])
    assert.deepEqual(h.sent, []) // No dummy client reply or response.create.
    assert.equal(h.counts().fileAuthorized, 0)
    assert.deepEqual(h.uploads, [])
    assert.equal(h.track.stopped, 0)
    assert.equal(h.events.some(event => event.type === "error"), false)
  } finally { adapter.cancel() }
})

test("Live streams written code while muted, keeps captions separate, and ignores text after disposal", async () => {
  const h = harness()
  const adapter = createAudioAdapter(descriptor("gpt-live"), h.deps)
  try {
    await adapter.start()
    adapter.toggleMicrophone!()
    const envelope = (sequence: number, delta: string) => ({ type: "response.event", delegation_id: "d1", event: {
      type: "response.output_text.delta", item_id: "m1", content_index: 0, sequence_number: sequence, delta
    } })
    h.emit(envelope(1, "```python\nimport copy\n"))
    h.emit(envelope(2, "original = [[1]]\nshallow = copy.copy(original)\ndeep = copy.deepcopy(original)\n```"))
    const written = h.events.at(-1)
    assert.ok(written?.type === "live-written-answers")
    assert.match(written.answers[0].text, /deep = copy.deepcopy\(original\)/)
    assert.equal(h.track.enabled, false)
    h.emit({ type: "response.event", delegation_id: "d1", event: { type: "response.completed", response: { output: [] } } })
    const complete = h.events.at(-1)
    assert.ok(complete?.type === "live-written-answers")
    assert.equal(complete.answers[0].status, "complete")
    h.emit({ type: "session.output_transcript.delta", event_id: "spoken", delta: "The example is in the panel.", start_ms: 0, end_ms: 10 })
    const caption = h.events.at(-1)
    assert.ok(caption?.type === "live-captions")
    assert.equal(caption.captions[0].text, "The example is in the panel.")
    const late = h.channel.onmessage
    adapter.cancel()
    const count = h.events.length
    late({ data: JSON.stringify(envelope(3, "late")) })
    assert.equal(h.events.length, count)
    assert.deepEqual(h.uploads, [])
    assert.deepEqual(h.sent, [])
  } finally { adapter.cancel() }
})

test("Live surfaces managed backend failure instead of leaving the user waiting", async () => {
  for (const type of ["response.failed", "response.incomplete", "error"]) {
    const h = harness()
    const adapter = createAudioAdapter(descriptor("gpt-live"), h.deps)
    try {
      await adapter.start()
      h.emit({ type: "response.event", delegation_id: "d1", event: { type, error: { message: "secret-provider-detail" } } })
      assert.ok(h.events.some(event => event.type === "error" && event.message.includes("Live's reasoning")))
      assert.equal(JSON.stringify(h.events).includes("secret-provider-detail"), false)
      assert.ok(h.track.stopped > 0)
      assert.ok(h.counts().peerClosed > 0)
      assert.deepEqual(h.uploads, [])
    } finally { adapter.cancel() }
  }
})

test("Live sends the prepared microphone and disposes it when cancelled", async () => {
  const h = harness()
  const track = { enabled: true, stop() {} }
  const prepared = { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream
  let disposed = 0
  let sentTrack: unknown
  h.deps.prepareMicrophone = input => {
    assert.equal(input, h.stream)
    return { stream: prepared, dispose: () => { disposed++; h.track.stop() } }
  }
  h.peer.addTrack = (value?: unknown) => { sentTrack = value }
  const adapter = createAudioAdapter(descriptor("gpt-live"), h.deps)
  await adapter.start()
  assert.equal(sentTrack, track)
  adapter.cancel()
  adapter.cancel()
  assert.equal(disposed, 1)
  assert.ok(h.track.stopped > 0)
})

test("Live setup rejection, disconnect and cancellation dispose RTC and never fall back", async () => {
  for (const reason of ["setup", "disconnect", "cancel"] as const) {
    const h = harness()
    const adapter = createAudioAdapter(descriptor("gpt-live"), h.deps)
    if (reason === "setup") {
      h.deps.bridge.createLive = async () => { throw new Error("Model unavailable") }
      await assert.rejects(adapter.start(), /Model unavailable/)
    } else {
      await adapter.start()
      if (reason === "cancel") adapter.cancel()
      else { h.peer.connectionState = "disconnected"; h.peer.onconnectionstatechange() }
    }
    assert.ok(h.track.stopped > 0)
    assert.ok(h.counts().peerClosed > 0)
    assert.equal(h.counts().fileAuthorized, 0)
    assert.equal(await adapter.submit(), null)
  }
})

test("legacy browser-first captions do not submit; fallback retains the compatibility route", async () => {
  const h = harness()
  const recognition = { continuous: false, interimResults: false, lang: "", onresult: null as any, onerror: null as any, onend: null as any,
    onstart: null as any, start() { this.onstart?.() }, stop() { this.onend?.() }, abort() {} }
  h.deps.createRecognition = () => recognition
  const adapter = createAudioAdapter(descriptor("legacy"), h.deps)
  try {
    await adapter.start()
    assert.equal(recognition.lang, "en-IN")
    assert.equal(h.counts().micCalls, 0)
    recognition.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "explain SQL" } }] })
    assert.equal(h.uploads.length, 0)
    assert.equal((await adapter.submit())?.text, "explain SQL")
  } finally { adapter.cancel() }
  const fallback = createAudioAdapter(descriptor("legacy"), harness().deps)
  await fallback.start()
  assert.equal((await fallback.submit())?.text, "SQL question")
  fallback.cancel()
})

test("browser startup waits for acknowledgment and handles timeout, cancellation and permission denial", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  try {
    for (const outcome of ["ready", "timeout", "cancel", "denied", "fallback"] as const) {
      const h = harness()
      let aborted = 0
      const recognition = { continuous: false, interimResults: false, lang: "", onstart: null as any,
        onresult: null as any, onerror: null as any, onend: null as any,
        start() {}, stop() { this.onend?.() }, abort() { aborted++ } }
      h.deps.createRecognition = () => recognition
      const adapter = createAudioAdapter(descriptor("legacy"), h.deps)
      try {
        const starting = adapter.start()
        const completion = outcome === "ready" || outcome === "fallback" ? starting : assert.rejects(starting, /timed out|cancelled/)
        await flush()
        assert.equal(h.events.some(event => event.type === "state" && event.state === "recording"), false)
        assert.equal(await adapter.submit(), null)
        const lateStart = recognition.onstart
        if (outcome === "ready") recognition.onstart()
        else if (outcome === "timeout") context.mock.timers.tick(30001)
        else if (outcome === "cancel") adapter.cancel()
        else recognition.onerror({ error: outcome === "denied" ? "not-allowed" : "network" })
        await completion
        if (outcome === "ready" || outcome === "fallback") {
          assert.ok(h.events.some(event => event.type === "state" && event.state === "recording"))
          assert.equal(h.counts().fileAuthorized, outcome === "fallback" ? 1 : 0)
        } else {
          lateStart()
          assert.ok(aborted > 0)
          assert.equal(recognition.onstart, null)
          assert.equal(h.events.some(event => event.type === "state" && event.state === "recording"), false)
        }
      } finally { adapter.cancel() }
    }
  } finally { context.mock.timers.reset() }
})

test("file upload deadline releases tracks and rejects a hung request", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const h = harness()
  h.deps.bridge.upload = () => new Promise(() => {})
  const adapter = createAudioAdapter(descriptor("whisper"), h.deps)
  try {
    await adapter.start()
    const submission = adapter.submit()
    await flush()
    const rejection = assert.rejects(submission, /timed out/)
    context.mock.timers.tick(45001)
    await rejection
    assert.ok(h.track.stopped > 0)
  } finally { adapter.cancel(); context.mock.timers.reset() }
})

test("Live remote closure releases the session without review or an answer submission", async () => {
  const h = harness()
  const adapter = createAudioAdapter(descriptor("gpt-live"), h.deps)
  await adapter.start()
  h.emit({ type: "session.closed" })
  assert.ok(h.track.stopped > 0)
  assert.ok(h.counts().peerClosed > 0)
  assert.equal(await adapter.submit(), null)
  assert.deepEqual(h.uploads, [])
})

test("Live cancel during ICE gathering removes its listener and releases all resources", async () => {
  const h = harness()
  let listener: (() => void) | undefined
  Object.assign(h.peer, {
    iceGatheringState: "gathering",
    addEventListener: (_name: string, fn: () => void) => { listener = fn },
    removeEventListener: () => { listener = undefined }
  })
  const adapter = createAudioAdapter(descriptor("gpt-live"), h.deps)
  const starting = adapter.start()
  await flush()
  assert.ok(listener)
  adapter.cancel()
  await assert.rejects(starting, /cancelled/)
  assert.equal(listener, undefined)
  assert.ok(h.track.stopped > 0)
  assert.ok(h.counts().peerClosed > 0)
})

test("recording duration limit cancels instead of submitting", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const h = harness()
  const adapter = createAudioAdapter(descriptor("whisper"), h.deps)
  try {
    await adapter.start()
    context.mock.timers.tick(120001)
    assert.ok(h.events.some(event => event.type === "error" && event.message.includes("limit")))
    assert.equal(await adapter.submit(), null)
    assert.equal(h.uploads.length, 0)
    assert.ok(h.track.stopped > 0)
  } finally { adapter.cancel(); context.mock.timers.reset() }
})

test("automatic adapter observes its microphone and disposes detection on submission", async () => {
  const h = harness()
  let boundary: (() => void) | undefined
  let disposed = 0
  let requests = 0
  h.deps.observeSpeech = (stream, pause, submit) => {
    assert.equal(stream, h.stream)
    assert.equal(pause, 1500)
    boundary = submit
    return () => { disposed++ }
  }
  h.deps.onSilence = () => { requests++ }
  const recording = descriptor("whisper")
  recording.settings = { ...recording.settings, voiceSubmissionMode: "automatic" }
  const adapter = createAudioAdapter(recording, h.deps)
  try {
    await adapter.start()
    assert.ok(boundary)
    boundary()
    assert.equal(requests, 1)
    await adapter.submit()
    assert.equal(disposed, 1)
    assert.equal(h.uploads.length, 1)
  } finally { adapter.cancel() }
  assert.equal(disposed, 1)
})

test("browser no-speech during manual pauses restarts without error or submission", async () => {
  const h = harness()
  let starts = 0
  const recognition = { continuous: false, interimResults: false, lang: "", onresult: null as any,
    onerror: null as any, onend: null as any, onstart: null as any,
    start() { starts++; this.onstart?.() }, stop() { this.onend?.() }, abort() {} }
  h.deps.createRecognition = () => recognition
  const adapter = createAudioAdapter(descriptor("legacy"), h.deps)
  try {
    await adapter.start()
    recognition.onerror({ error: "no-speech" })
    recognition.onend()
    assert.equal(starts, 2)
    assert.equal(h.events.filter(event => event.type === "error").length, 0)
    assert.equal(h.uploads.length, 0)
    recognition.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "SQL indexes" } }] })
    assert.equal((await adapter.submit())?.text, "SQL indexes")
  } finally { adapter.cancel() }
})
