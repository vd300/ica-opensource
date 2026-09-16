import axios from "axios"

export const MAX_GITHUB_CONTEXT_CHARACTERS = 30_000

const usernameFromInput = (input: string): string => {
  const value = input.trim().replace(/\/$/, "")
  const match = value.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9-]+)$/i)
  const username = match?.[1] || (/^[A-Za-z0-9-]+$/.test(value) ? value : "")
  if (!username || username.length > 39) throw new Error("Enter a valid GitHub username or profile URL.")
  return username
}

export interface GitHubProfileSnapshot {
  profileUrl: string
  context: string
  projectCount: number
  syncedAt: string
}

/** Fetches public profile/repository metadata and turns it into a local factual snapshot. */
export async function fetchGitHubProfile(input: string): Promise<GitHubProfileSnapshot> {
  const username = usernameFromInput(input)
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "Interview-Coder" }
  try {
    const [profileResponse, repositoriesResponse] = await Promise.all([
      axios.get(`https://api.github.com/users/${encodeURIComponent(username)}`, {
        headers, timeout: 15_000, maxRedirects: 0, validateStatus: () => true
      }),
      axios.get(`https://api.github.com/users/${encodeURIComponent(username)}/repos`, {
        headers, timeout: 15_000, maxRedirects: 0, params: { per_page: 100, sort: "updated", direction: "desc" },
        validateStatus: () => true
      })
    ])
    if (profileResponse.status === 404) throw new Error("GitHub profile not found.")
    if (profileResponse.status !== 200 || repositoriesResponse.status !== 200) {
      throw new Error(`GitHub returned HTTP ${profileResponse.status !== 200 ? profileResponse.status : repositoriesResponse.status}. Try again later.`)
    }
    const profile = profileResponse.data || {}
    const repositories = Array.isArray(repositoriesResponse.data) ? repositoriesResponse.data : []
    const projects = repositories.filter(repo => repo && !repo.fork).slice(0, 50)
    const lines = [
      `# GitHub profile: ${String(profile.login || username)}`,
      `Profile: ${String(profile.html_url || `https://github.com/${username}`)}`,
      profile.name ? `Name: ${String(profile.name)}` : "",
      profile.bio ? `Bio: ${String(profile.bio)}` : "",
      profile.company ? `Company: ${String(profile.company)}` : "",
      profile.location ? `Location: ${String(profile.location)}` : "",
      "",
      "## Public source repositories",
      ...projects.map(repo => {
        const facts = [repo.language && `primary language: ${repo.language}`,
          Array.isArray(repo.topics) && repo.topics.length ? `topics: ${repo.topics.join(", ")}` : "",
          repo.description && `description: ${repo.description}`,
          repo.homepage && `homepage: ${repo.homepage}`,
          repo.html_url && `repository: ${repo.html_url}`].filter(Boolean)
        return `- ${String(repo.name)}${facts.length ? ` — ${facts.join("; ")}` : ""}`
      })
    ].filter(line => line !== "")
    const context = lines.join("\n").slice(0, MAX_GITHUB_CONTEXT_CHARACTERS)
    return {
      profileUrl: String(profile.html_url || `https://github.com/${username}`),
      context,
      projectCount: projects.length,
      syncedAt: new Date().toISOString()
    }
  } catch (error) {
    if (error instanceof Error && !axios.isAxiosError(error)) throw error
    throw new Error("Unable to reach GitHub. Check your connection and try again.")
  }
}
