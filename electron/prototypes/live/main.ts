import { app, BrowserWindow, ipcMain } from "electron"
import path from "node:path"
import fs from "node:fs"
import os from "node:os"
import { LiveApi } from "./LiveApi"
import { readProbeKey } from "./access"

// Isolate this development harness from the user's normal Electron profile.
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "ica-live-probe-")))
if (process.env.ICA_LIVE_PROBE_SMOKE === "1") app.disableHardwareAcceleration()

void app.whenReady().then(async () => {
  const api = new LiveApi(readProbeKey())
  const smoke = process.env.ICA_LIVE_PROBE_SMOKE === "1"
  const window = new BrowserWindow({ show: !smoke, width: 800, height: 650, webPreferences: {
    preload: path.join(__dirname, "preload.js"), contextIsolation: true,
    nodeIntegration: false, sandbox: false
  } })
  let creating = false
  let closing = false
  let pendingCreation: Promise<unknown> = Promise.resolve()
  const sessions = new Set<string>()
  ipcMain.handle("live-probe:create", async (event, sdp: string) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || creating || closing) {
      throw new Error("Invalid probe request")
    }
    creating = true
    try {
      const request = api.create(sdp)
      pendingCreation = request.catch(() => undefined)
      const answer = await request
      sessions.add(answer.session.id)
      if (window.isDestroyed()) await api.hangup(answer.session.id)
      return answer
    } finally { creating = false }
  })
  ipcMain.handle("live-probe:abandon", async (event, sessionId: string) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !sessions.has(sessionId)) {
      throw new Error("Unknown probe session")
    }
    await api.hangup(sessionId)
    sessions.delete(sessionId)
  })
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  window.webContents.on("will-navigate", event => event.preventDefault())
  window.on("close", event => {
    event.preventDefault()
    if (closing) return
    closing = true
    void (async () => {
      await pendingCreation
      const results = await Promise.allSettled([...sessions].map(id => api.hangup(id)))
      if (results.some(result => result.status === "rejected")) console.warn("Probe cleanup unconfirmed for one or more sessions")
      window.destroy()
    })()
  })
  await window.loadFile(path.resolve(__dirname, "../../../../electron/prototypes/live/index.html"))
  if (smoke) {
    const valid = await window.webContents.executeJavaScript(
      "typeof window.liveProbe?.start === 'function' && typeof window.liveProbe?.submit === 'function' && !!document.getElementById('start')")
    console.log(valid ? "Live probe UI/preload smoke passed" : "Live probe UI/preload smoke failed")
    app.exit(valid ? 0 : 1)
  }
}).catch(() => { console.error("Live probe could not start. Check OpenAI configuration."); app.quit() })
app.on("window-all-closed", () => app.quit())
