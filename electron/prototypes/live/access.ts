import fs from "node:fs"
import path from "node:path"
import { LiveApi } from "./LiveApi"

export function readProbeKey(): string {
  if (process.env.OPENAI_API_KEY?.trim()) return process.env.OPENAI_API_KEY.trim()
  const configPath = process.env.ICA_CONFIG_PATH || (process.env.APPDATA
    ? path.join(process.env.APPDATA, "ica_v1", "config.json") : "")
  if (!configPath || !fs.existsSync(configPath)) throw new Error("Set OPENAI_API_KEY or ICA_CONFIG_PATH")
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"))
  if (config.apiProvider !== "openai" || typeof config.apiKey !== "string" || !config.apiKey.trim()) {
    throw new Error("The selected config must contain an OpenAI provider and key")
  }
  return config.apiKey.trim()
}

if (require.main === module) {
  void (async () => {
    const api = new LiveApi(readProbeKey())
    for (const model of ["gpt-live-1", "whisper-1"] as const) {
      const result = await api.checkModel(model)
      console.log(JSON.stringify(result))
      if (result.status !== 200) process.exitCode = 1
    }
  })().catch(() => { console.error("Access probe failed; check credentials, config path and network access."); process.exitCode = 1 })
}
