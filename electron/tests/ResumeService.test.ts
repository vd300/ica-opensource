import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import axios from "axios"
import { parseResumeFile } from "../ResumeService"

test("resume is sent to OpenAI for parsing and its temporary file is deleted", async context => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ica-resume-"))
  const resumePath = path.join(directory, "resume.pdf")
  await fs.writeFile(resumePath, Buffer.from("fake-pdf-content"))
  const calls: string[] = []
  context.mock.method(axios, "post", async (url: string, body: any) => {
    calls.push(url)
    if (url.endsWith("/files")) return { status: 200, data: { id: "file_resume" } }
    assert.equal(body.input[0].content[1].file_id, "file_resume")
    return { status: 200, data: { output_text: "# Candidate\nRecent project: Agentic workflow using Python and LangGraph." } }
  })
  context.mock.method(axios, "delete", async (url: string) => {
    calls.push(url)
    return { status: 200 }
  })
  try {
    const result = await parseResumeFile(resumePath, "test-secret")
    assert.match(result.text, /Agentic workflow/)
    assert.deepEqual(calls, [
      "https://api.openai.com/v1/files",
      "https://api.openai.com/v1/responses",
      "https://api.openai.com/v1/files/file_resume"
    ])
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})
