import axios from "axios"
import type { LiveSessionAnswer } from "../src/types/voiceAudio"

const LIVE_INSTRUCTIONS = `You help with software engineering questions in a natural conversation.
Use a brisk but clear pace. Lead with the answer and include the details needed for accuracy.
Technical vocabulary: Python, FastAPI (fast A P I), Flask, Django, Starlette, Pydantic, SQL, PostgreSQL, Redis, Kafka, REST APIs, TypeScript, React, Docker, Kubernetes.
Use the question's context when interpreting technical names and accents. Do not force unrelated speech into this vocabulary.
If a key name is uncertain, ask a short clarification such as "Did you mean FastAPI and Flask?" before answering a different question. Honor the user's corrections.
Backchannel policy: Use minimal acknowledgments. Do not repeatedly say "checking", "sorting that out", or "let me think" in place of an answer or clarification.
Interruption policy: Listen when the user interrupts or corrects a term.
Delegation policy:
Backend tools: A reasoning model can explain programming concepts, compare frameworks, and write code examples. Its written output is streamed directly into the user's on-screen panel, including formatted code blocks. No web browsing, screen access, or code execution is available.
Delegate to the backend when: The user asks for code, an implementation, a programming example, or says "write it down" or "show me" about the current topic. Also delegate technical explanations needing reasoning beyond a simple reply. Include the current topic and requested programming language in the request.
Do not delegate to the backend when: You can answer a conversational question directly, or need to clarify a name first. Requests for written examples should always use the backend.
For code requests, let the backend write the code in the panel and give only a brief explanation in the spoken conversation. You can show written code here; do not say you cannot write it out. Do not dictate punctuation or substitute a verbal analogy for requested code.
Return the backend's answer to the conversation. Do not wait for a submission shortcut or transcript review.`

const LIVE_BACKEND_INSTRUCTIONS = `Help answer the user's software engineering question using the Live conversation context and latest corrections.
Spoken technical names and captions can be imperfect. Relevant vocabulary includes Python, FastAPI, Flask, Django, Starlette, Pydantic, SQL, PostgreSQL, Redis, Kafka, REST APIs, TypeScript, React, Docker and Kubernetes.
Resolve names using context; if the intended technology is still ambiguous, return a short clarification question rather than inventing a meaning.
Give the substantive answer immediately, with concise distinctions and practical tradeoffs for comparisons. Expand when requested.
Your output is displayed verbatim in an on-screen written-answer panel. When asked for code, an example, or to "write it down", provide actual code in fenced Markdown blocks with a language tag and preserved indentation. Use the current conversation topic to resolve "that" or "the example" and honor the requested language. Add a short explanation and expected output where useful. Do not merely describe imaginary code or say you cannot write it here. Label expected output as expected; code is not executed by this app.
Do not return holding phrases or claim to browse, run code, or check external sources. No external tools are available.`

/** Fixed provider operations. No arbitrary URLs, model overrides or request forwarding. */
export class LiveVoiceService {
  constructor(private readonly apiKey: string) {}

  async create(sdp: string): Promise<LiveSessionAnswer> {
    if (typeof sdp !== "string" || !sdp.startsWith("v=0") || Buffer.byteLength(sdp) > 65536) {
      throw new Error("Invalid or oversized SDP offer")
    }
    try {
      const response = await axios.post("https://api.openai.com/v1/live/sessions", {
        session: {
          model: "gpt-live-1",
          delegation: { type: "responses", responses: {
            model: "gpt-5.6-luna",
            instructions: LIVE_BACKEND_INSTRUCTIONS
          } },
          audio: { output: { voice: "gleam" } },
          instructions: LIVE_INSTRUCTIONS
        }, transport: { type: "webrtc", sdp }
      }, {
        headers: { Authorization: `Bearer ${this.apiKey}` }, timeout: 20000,
        maxRedirects: 0, maxContentLength: 131072, validateStatus: () => true
      })
      if (response.status === 401) {
        throw new Error("OpenAI rejected the configured API key (HTTP 401). Open Settings, select OpenAI, replace the API key and save, then start a new recording.")
      }
      if (response.status !== 201) throw new Error(`Live session creation returned HTTP ${response.status}`)
      const answer = response.data
      if (typeof answer?.session?.id !== "string" || !answer.session.id || answer.session.id.length > 256 ||
          answer?.transport?.type !== "webrtc" || typeof answer.transport.sdp !== "string" ||
          !answer.transport.sdp.startsWith("v=0") || Buffer.byteLength(answer.transport.sdp) > 65536) {
        if (typeof answer?.session?.id === "string" && answer.session.id.length <= 256) {
          await this.hangup(answer.session.id).catch(() => {})
        }
        throw new Error("Invalid Live session response")
      }
      return { session: { id: answer.session.id }, transport: { type: "webrtc", sdp: answer.transport.sdp } }
    } catch (error) {
      // Axios errors contain authorization headers; never log or forward those objects.
      if (error instanceof Error && !axios.isAxiosError(error)) throw error
      throw new Error("Live session creation failed (network or timeout)")
    }
  }

  async hangup(sessionId: string): Promise<void> {
    try {
      const response = await axios.post(`https://api.openai.com/v1/live/sessions/${encodeURIComponent(sessionId)}/hangup`, undefined, {
        headers: { Authorization: `Bearer ${this.apiKey}` }, timeout: 10000,
        maxRedirects: 0, validateStatus: () => true
      })
      if (response.status < 200 || response.status >= 300) throw new Error()
    } catch { throw new Error("Live remote cleanup unconfirmed") }
  }
}
