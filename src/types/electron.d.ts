import type {
  VoiceAnswerChunkPayload,
  VoiceAnswerCompletePayload,
  VoiceAnswerStartPayload,
  VoiceAudioChunkPayload,
  VoiceErrorPayload,
  VoiceIpcResult,
  VoiceModeStatusPayload,
  VoiceRecognitionErrorPayload,
  VoiceTranscriptSegment,
  VoiceTriggerDetectedPayload
} from "./voice"

export type APIProvider = "openai" | "gemini" | "anthropic"
export type VoiceResponseStyle = "concise" | "code-first" | "detailed"

export interface AppConfig {
  apiKey: string
  apiProvider: APIProvider
  extractionModel: string
  solutionModel: string
  debuggingModel: string
  language: string
  voiceAssistantEnabled: boolean
  voiceRecognitionLanguage: string
  voiceTriggerConfidenceThreshold: number
  voiceResponseStyle: VoiceResponseStyle
  opacity: number
}

export interface ElectronAPI {
  // Original methods
  openSubscriptionPortal: (authData: {
    id: string
    email: string
  }) => Promise<{ success: boolean; error?: string }>
  updateContentDimensions: (dimensions: {
    width: number
    height: number
  }) => Promise<void>
  clearStore: () => Promise<{ success: boolean; error?: string }>
  getScreenshots: () => Promise<{
    success: boolean
    previews?: Array<{ path: string; preview: string }> | null
    error?: string
  }>
  deleteScreenshot: (
    path: string
  ) => Promise<{ success: boolean; error?: string }>
  onScreenshotTaken: (
    callback: (data: { path: string; preview: string }) => void
  ) => () => void
  onResetView: (callback: () => void) => () => void
  onSolutionStart: (callback: () => void) => () => void
  onDebugStart: (callback: () => void) => () => void
  onDebugSuccess: (callback: (data: any) => void) => () => void
  onSolutionError: (callback: (error: string) => void) => () => void
  onProcessingNoScreenshots: (callback: () => void) => () => void
  onProblemExtracted: (callback: (data: any) => void) => () => void
  onSolutionStream: (callback: (chunk: string) => void) => () => void
  onSolutionSuccess: (callback: (data: any) => void) => () => void
  onUnauthorized: (callback: () => void) => () => void
  onDebugError: (callback: (error: string) => void) => () => void
  openExternal: (url: string) => void
  toggleMainWindow: () => Promise<{ success: boolean; error?: string }>
  triggerScreenshot: () => Promise<{ success: boolean; error?: string }>
  triggerProcessScreenshots: () => Promise<{ success: boolean; error?: string }>
  triggerReset: () => Promise<{ success: boolean; error?: string }>
  triggerMoveLeft: () => Promise<{ success: boolean; error?: string }>
  triggerMoveRight: () => Promise<{ success: boolean; error?: string }>
  triggerMoveUp: () => Promise<{ success: boolean; error?: string }>
  triggerMoveDown: () => Promise<{ success: boolean; error?: string }>
  onSubscriptionUpdated: (callback: () => void) => () => void
  onSubscriptionPortalClosed: (callback: () => void) => () => void
  startUpdate: () => Promise<{ success: boolean; error?: string }>
  installUpdate: () => void
  onUpdateAvailable: (callback: (info: any) => void) => () => void
  onUpdateDownloaded: (callback: (info: any) => void) => () => void

  decrementCredits: () => Promise<void>
  setInitialCredits: (credits: number) => Promise<void>
  onCreditsUpdated: (callback: (credits: number) => void) => () => void
  onOutOfCredits: (callback: () => void) => () => void
  openSettingsPortal: () => Promise<void>
  getPlatform: () => string
  
  // New methods for OpenAI integration
  getConfig: () => Promise<AppConfig>
  updateConfig: (config: Partial<AppConfig>) => Promise<AppConfig>
  checkApiKey: () => Promise<boolean>
  validateApiKey: (apiKey: string) => Promise<{ valid: boolean; error?: string }>
  openLink: (url: string) => void
  onApiKeyInvalid: (callback: () => void) => () => void
  sendVoiceTranscriptSegment: (
    segment: VoiceTranscriptSegment
  ) => Promise<VoiceIpcResult>
  sendVoiceAudioChunk: (
    chunk: VoiceAudioChunkPayload
  ) => Promise<VoiceIpcResult>
  stopVoiceMode: () => Promise<VoiceIpcResult>
  voiceRendererReady: () => Promise<VoiceIpcResult>
  reportVoiceRecognitionError: (
    error: VoiceRecognitionErrorPayload
  ) => Promise<VoiceIpcResult>
  onVoiceModeStarted: (callback: () => void) => () => void
  onVoiceModeStopped: (callback: () => void) => () => void
  onVoiceSubmitRecording: (callback: () => void) => () => void
  onVoiceStatus: (
    callback: (payload: VoiceModeStatusPayload) => void
  ) => () => void
  onVoiceInterimTranscript: (callback: (text: string) => void) => () => void
  onVoiceFinalTranscript: (
    callback: (segment: VoiceTranscriptSegment) => void
  ) => () => void
  onVoiceTriggerDetected: (
    callback: (payload: VoiceTriggerDetectedPayload) => void
  ) => () => void
  onVoiceAnswerStart: (
    callback: (payload: VoiceAnswerStartPayload) => void
  ) => () => void
  onVoiceAnswerChunk: (
    callback: (payload: VoiceAnswerChunkPayload) => void
  ) => () => void
  onVoiceAnswerComplete: (
    callback: (payload: VoiceAnswerCompletePayload) => void
  ) => () => void
  onVoiceError: (callback: (payload: VoiceErrorPayload) => void) => () => void
  removeListener: (eventName: string, callback: (...args: any[]) => void) => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
    electron: {
      ipcRenderer: {
        on: (channel: string, func: (...args: any[]) => void) => void
        removeListener: (
          channel: string,
          func: (...args: any[]) => void
        ) => void
      }
    }
    __CREDITS__: number
    __LANGUAGE__: string
    __IS_INITIALIZED__: boolean
    __AUTH_TOKEN__?: string | null
  }
}
