export type TokenBarReading = { tokens: number; window: number; percent: number }
export type TokenBarLimit = { kind: string; percentUsed: number; resetsAt?: string }

declare module 'claude-code' {
  interface PluginState {
    'token-bar': { readings: TokenBarReading[]; limits: TokenBarLimit[]; now: number }
  }
}
