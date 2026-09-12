import axios from "axios"
import type { LiveSessionAnswer } from "../../../src/types/voiceAudio"

/** Raw documented HTTP contract; intentionally independent of OpenAI SDK Live helpers. */
export class LiveApi {
  constructor(private readonly apiKey: string) {
    if (!apiKey.trim()) throw new Error("OpenAI API key is missing")
  }

  async hangup(sessionId: string): Promise<void> {
    try {
      const response = await axios.post(`https://api.openai.com/v1/live/sessions/${encodeURIComponent(sessionId)}/hangup`,
        undefined, { headers: { Authorization: `Bearer ${this.apiKey}` }, timeout: 10000,
          maxRedirects: 0, validateStatus: () => true })
      if (response.status < 200 || response.status >= 300) throw new Error("Session cleanup was not acknowledged")
    } catch { throw new Error("Session cleanup was not acknowledged") }
  }

  async checkModel(model: "gpt-live-1" | "whisper-1"): Promise<{ model: string; status: number }> {
    try {
      const response = await axios.get(`https://api.openai.com/v1/models/${model}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` }, timeout: 15000,
        maxRedirects: 0, validateStatus: () => true
      })
      return { model, status: response.status }
    } catch { throw new Error("OpenAI model access request failed (network or timeout)") }
  }

  async create(sdp: string): Promise<LiveSessionAnswer> {
    if (typeof sdp !== "string" || !sdp.startsWith("v=0") || Buffer.byteLength(sdp) > 65536) {
      throw new Error("Invalid or oversized SDP offer")
    }
    try {
      const response = await axios.post("https://api.openai.com/v1/live/sessions", {
        session: {
          model: "gpt-live-1", delegation: { type: "client" },
          instructions: "Listen to the software engineering practice question. The application controls submission and backend execution."
        }, transport: { type: "webrtc", sdp }
      }, { headers: { Authorization: `Bearer ${this.apiKey}` }, timeout: 20000, maxRedirects: 0,
        validateStatus: () => true })
      if (response.status !== 201) throw new Error(`Live session creation returned HTTP ${response.status}`)
      const answer = response.data
      if (typeof answer?.session?.id !== "string" || !answer.session.id ||
          answer?.transport?.type !== "webrtc" || typeof answer.transport.sdp !== "string") {
        throw new Error("Invalid Live session response")
      }
      return { session: { id: answer.session.id }, transport: { type: "webrtc", sdp: answer.transport.sdp } }
    } catch (error) {
      // Axios errors contain request headers, including credentials. Never forward them.
      if (error instanceof Error && !axios.isAxiosError(error)) throw error
      throw new Error("Live session creation failed (network or timeout)")
    }
  }
}
