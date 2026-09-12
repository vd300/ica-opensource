import { contextBridge, ipcRenderer } from "electron"
import { LiveConnectionProbe } from "../../../src/components/VoiceAssistant/LiveConnectionProbe"
import type { VoiceSubmissionMode, VoiceSubmissionReason } from "../../../src/types/voiceAudio"

let probe: LiveConnectionProbe | undefined
contextBridge.exposeInMainWorld("liveProbe", {
  async start(mode: VoiceSubmissionMode, report: (text: string) => void) {
    if (probe) throw new Error("Reload the prototype before starting another session")
    if (mode !== "manual" && mode !== "automatic") throw new Error("Invalid mode")
    probe = new LiveConnectionProbe(crypto.randomUUID(), mode, {
      createSession: sdp => ipcRenderer.invoke("live-probe:create", sdp),
      abandonSession: sessionId => ipcRenderer.invoke("live-probe:abandon", sessionId),
      createPeer: () => new RTCPeerConnection(),
      getMicrophone: () => navigator.mediaDevices.getUserMedia({ audio: true }), report
    })
    await probe.start()
  },
  submit: (reason: VoiceSubmissionReason) => probe?.submit(reason),
  cancel: () => probe?.cancel()
})
window.addEventListener("beforeunload", () => probe?.cancel())
