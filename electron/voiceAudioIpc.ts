import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron"
import type { VoiceAudioService } from "./VoiceAudioService"

import { VOICE_AUDIO_IPC } from "./voiceIpc"

export function assertVoiceAudioSender(event: IpcMainInvokeEvent, window: BrowserWindow | null): number {
  if (!window || window.isDestroyed() || event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame) throw new Error("Unauthorized voice audio sender")
  return event.sender.id
}

export function initializeVoiceAudioIpc(service: VoiceAudioService, getWindow: () => BrowserWindow | null, canRecord: () => boolean): void {
  const handle = (channel: string, operation: (owner: number, payload: any) => unknown) => {
    ipcMain.handle(channel, (event, payload) => operation(assertVoiceAudioSender(event, getWindow()), payload))
  }
  handle(VOICE_AUDIO_IPC.BEGIN, owner => {
    if (!canRecord()) throw new Error("Start voice mode before recording")
    return service.begin(owner)
  })
  handle(VOICE_AUDIO_IPC.CLAIM, (owner, payload) => service.claim(owner, payload))
  handle(VOICE_AUDIO_IPC.AUTHORIZE_FILE, (owner, id) => service.authorizeFile(owner, id))
  handle(VOICE_AUDIO_IPC.UPLOAD, (owner, payload) => service.upload(owner, payload))
  handle(VOICE_AUDIO_IPC.CREATE_LIVE, (owner, payload) => service.createLive(owner, payload))
  handle(VOICE_AUDIO_IPC.CANCEL, (owner, id) => service.cancel(owner, id))
  handle(VOICE_AUDIO_IPC.COMPLETE, (owner, payload) => service.complete(owner, payload))
}
