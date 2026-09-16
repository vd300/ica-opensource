import test from "node:test"
import assert from "node:assert/strict"
import axios from "axios"
import { fetchGitHubProfile } from "../GitHubProfileService"

test("GitHub profile import creates a bounded factual snapshot and excludes forks", async context => {
  context.mock.method(axios, "get", async (url: string) => {
    if (url.endsWith("/repos")) return { status: 200, data: [
      { name: "api", fork: false, language: "Python", topics: ["fastapi"], description: "Public API", html_url: "https://github.com/octocat/api" },
      { name: "forked", fork: true, language: "Go" }
    ] }
    return { status: 200, data: { login: "octocat", name: "Octo Cat", bio: "Builder", html_url: "https://github.com/octocat" } }
  })
  const result = await fetchGitHubProfile("https://github.com/octocat/")
  assert.equal(result.profileUrl, "https://github.com/octocat")
  assert.equal(result.projectCount, 1)
  assert.match(result.context, /api — primary language: Python; topics: fastapi; description: Public API/)
  assert.doesNotMatch(result.context, /forked/)
  assert.ok(result.context.length <= 30_000)
})

test("GitHub profile import rejects invalid profiles before making a request", async context => {
  let calls = 0
  context.mock.method(axios, "get", async () => { calls++; return { status: 500 } })
  await assert.rejects(fetchGitHubProfile("https://example.com/not-github"), /valid GitHub/)
  assert.equal(calls, 0)
})
