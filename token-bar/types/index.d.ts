export type TokenBarReading = { tokens: number; window: number; percent: number }
export type TokenBarLimit = { kind: string; percentUsed: number; resetsAt?: string }
// What today has used across every session, as the transcript scan last counted it.
export type TokenBarToday = { day: string; tokens: number; usd: number }

declare module 'claude-code' {
  interface PluginState {
    'token-bar': {
      readings: TokenBarReading[]
      limits: TokenBarLimit[]
      now: number
      today: TokenBarToday | null
    }
  }
}
