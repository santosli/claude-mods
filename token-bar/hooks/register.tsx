// Token Bar: how full the context window and the quota are, above the prompt.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TokenBarLimit, TokenBarReading, TokenBarToday } from '../types'
import { bars, barsWidth, ring, week } from './draw'
import { SCAN_SCRIPT, SCAN_STATE, scanRoots } from './scan'

const HISTORY = 12
const TICK_MS = 30_000
const BARS = '▁▂▃▄▅▆▇█'
// Colored by how much is used, as a phone's battery is: green, then yellow, then red.
// `color` is the terminal's name; `hex` the desktop's, chosen to read on a light card and a dark one.
const LEVELS: readonly { upTo: number; color: string; hex: string }[] = [
  { upTo: 60, color: 'green', hex: '#30a14e' },
  { upTo: 80, color: 'yellow', hex: '#d99a00' },
  { upTo: Infinity, color: 'red', hex: '#e5484d' },
]
// The rule between two groups on the desktop.
const RULE = 'rgba(128,128,128,0.45)'
// The turns chart and last-turn delta: off for now; the history is still kept.
const SHOW_TURNS = false

// Held by the host, so they survive a hot reload of this file.
const readings = atom({ plugin: 'token-bar', key: 'readings' } as const, [] as TokenBarReading[])
const limits = atom({ plugin: 'token-bar', key: 'limits' } as const, [] as TokenBarLimit[])
// The clock the countdown is drawn against; ticked so the band redraws.
const now = atom({ plugin: 'token-bar', key: 'now' } as const, 0)
const today = atom({ plugin: 'token-bar', key: 'today' } as const, null as TokenBarToday | null)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    // The quota is the account's: show the last one known until a response reports it again.
    const stored = await $.store.get('limits').catch(() => undefined)
    if (Array.isArray(stored)) await saveLimits($, stored as TokenBarLimit[])
    await takeReading($)
    await askApp($)
    await scanToday($)
    // Quota moves between turns too, and the countdown runs down: refresh both.
    $.clock.every(TICK_MS, () => refresh($))
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) {
      await takeReading($) // main-loop turns only, not subagents
    }
    if (!e.agentId) await scanToday($)
    return result
  })

  // The engine's own measurements: the context's fill and the quota, whenever either moves.
  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await saveLimits($, e.rateLimits, true)
    if (e.changed.includes('context') && e.context.tokens !== undefined) await addReading($, e.context.tokens, e.context.window)
    return next(e)
  })

  // A compaction is not a turn, and no response has measured the window since: estimate it,
  // system prompt and tools included, as /context does. The size the compaction reports
  // counts the conversation alone.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId || e.trigger === 'precompute' || 'skip' in result) return result
    const after = 'tokensAfter' in result ? result.tokensAfter : undefined
    await setContext($, (await estimate($)) ?? after)
    return result
  })

  // A /clear starts the conversation over, with no session.start.
  on('session.end', async ($, e, next) => {
    if (e.reason !== 'clear') return next(e)
    await setContext($, 0)
    const result = await next(e)
    // Once the conversation is gone, what is left is the system prompt and the tools.
    $.clock.after(1_000, () => void estimate($).then(t => setContext($, t)))
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const history = await read($, readings)
    const last = history.at(-1)
    if (e.props.hasSurvey || !last) {
      return next(e)
    }

    const quota = await read($, limits)
    const at = await read($, now)
    const lv = level(last.percent)
    const fiveHour = quota.find(l => l.kind === 'five_hour')
    const sevenDay = quota.find(l => l.kind === 'seven_day')
    const columns = e.props.bodyColumns
    const spent = await read($, today)

    if (e.surface !== 'terminal') {
      const { Box, Text, Svg } = $.ui.resolve(e)
      // Each group's width in columns, so a narrow band drops the right-most first.
      const groups: { key: string; color: string; cells: number; draw: () => JSX.Element }[] = [
        {
          key: 'context',
          color: lv.hex,
          cells: fit(RING, `${last.percent}%`, 'of context'),
          draw: () => (
            <Box key="context" flexDirection="row" alignItems="center" gap={1}>
              <Svg source={ring(last.percent, lv.hex)} alt={`${last.percent}% of context used`} width={18} height={18} />
              <Text color={lv.hex} bold>{`${last.percent}%`}</Text>
              <Text dimColor>of context</Text>
            </Box>
          ),
        },
      ]
      if (fiveHour) {
        const q = level(fiveHour.percentUsed)
        const qUsed = used(fiveHour.percentUsed)
        groups.push({
          key: 'five-hour',
          color: q.hex,
          cells: fit(RING, `${qUsed}%`, 'of session', fiveHour.resetsAt ? `↻ ${countdown(fiveHour.resetsAt, at)}` : ''),
          draw: () => (
            <Box key="five-hour" flexDirection="row" alignItems="center" gap={1}>
              <Svg source={ring(qUsed, q.hex)} alt={`${qUsed}% of session used`} width={18} height={18} />
              <Text color={q.hex} bold>{`${qUsed}%`}</Text>
              <Text dimColor>of session</Text>
              {fiveHour.resetsAt && <Text dimColor>{`↻ ${countdown(fiveHour.resetsAt, at)}`}</Text>}
            </Box>
          ),
        })
      }
      if (sevenDay) {
        const q = level(sevenDay.percentUsed)
        const qUsed = used(sevenDay.percentUsed)
        groups.push({
          key: 'seven-day',
          color: q.hex,
          cells: fit(RING, `${qUsed}%`, 'of weekly', sevenDay.resetsAt ? `↻ ${countdown(sevenDay.resetsAt, at)}` : ''),
          draw: () => (
            <Box key="seven-day" flexDirection="row" alignItems="center" gap={1}>
              <Svg source={week(qUsed, q.hex)} alt={`${qUsed}% of weekly used`} width={18} height={18} />
              <Text color={q.hex} bold>{`${qUsed}%`}</Text>
              <Text dimColor>of weekly</Text>
              {sevenDay.resetsAt && <Text dimColor>{`↻ ${countdown(sevenDay.resetsAt, at)}`}</Text>}
            </Box>
          ),
        })
      }
      if (spent) {
        groups.push({
          key: 'today',
          color: '#8a8a8a',
          cells: fit(0, money(spent.usd), `today · ${short(spent.tokens)} tokens`),
          draw: () => (
            <Box key="today" flexDirection="row" alignItems="center" gap={1}>
              <Text bold>{money(spent.usd)}</Text>
              <Text dimColor>{`today · ${short(spent.tokens)} tokens`}</Text>
            </Box>
          ),
        })
      }
      if (SHOW_TURNS && history.length > 1) {
        groups.push({
          key: 'trend',
          color: lv.hex,
          cells: 22,
          draw: () => (
            <Box key="trend" flexDirection="row" alignItems="center" gap={1}>
              <Svg source={bars(history.map(r => r.tokens), lv.hex)} alt={`Context after each of the last ${history.length} turns`} width={barsWidth(history.length)} height={14} />
              <Text dimColor>{trend(history).trim()}</Text>
            </Box>
          ),
        })
      }
      // Groups sit a rule apart: a column of space, the rule, and a column again. Those that
      // don't fit leave a dot each, a column apart, so the band never wraps.
      const rule = 2 + width('│')
      const dots = (n: number) => (n ? 1 + n * width('•') + (n - 1) : 0)
      const need = (k: number) =>
        groups.slice(0, k).reduce((n, g) => n + g.cells, 0) + (k - 1) * rule + dots(groups.length - k)
      let count = groups.length
      while (count > 1 && need(count) > columns - 2 - MARGIN) count--
      const shown = groups.slice(0, count)
      const hidden = groups.slice(count)

      return (
        <Box flexDirection="row" alignItems="center" paddingX={1} gap={1}>
          {shown.flatMap((g, i) => [
            ...(i > 0 ? [<Text key={`rule-${g.key}`} color={RULE}>│</Text>] : []),
            g.draw(),
          ])}
          {hidden.length > 0 && (
            <Box key="hidden" flexDirection="row" gap={1}>
              {hidden.map(g => (
                <Text key={g.key} color={g.color}>•</Text>
              ))}
            </Box>
          )}
        </Box>
      )
    }

    const { Box, Text } = $.ui.resolve(e)
    const q5 = fiveHour && level(fiveHour.percentUsed)
    const q7 = sevenDay && level(sevenDay.percentUsed)

    return (
      <Box flexDirection="row" paddingX={1}>
        <Text color={lv.color}>{gauge(last.percent)}</Text>
        <Text color={lv.color} bold>{` ${last.percent}%`}</Text>
        <Text dimColor>{' of context'}</Text>
        {columns >= 80 && fiveHour && <Text color={q5!.color} bold>{`   ${used(fiveHour.percentUsed)}%`}</Text>}
        {columns >= 80 && fiveHour && <Text dimColor>{' of session'}</Text>}
        {columns >= 80 && fiveHour?.resetsAt && <Text dimColor>{` ↻ ${countdown(fiveHour.resetsAt, at)}`}</Text>}
        {columns >= 80 && sevenDay && <Text color={q7!.color} bold>{`   ${used(sevenDay.percentUsed)}%`}</Text>}
        {columns >= 80 && sevenDay && <Text dimColor>{' of weekly'}</Text>}
        {columns >= 80 && sevenDay?.resetsAt && <Text dimColor>{` ↻ ${countdown(sevenDay.resetsAt, at)}`}</Text>}
        {columns >= 110 && spent && <Text bold>{`   ${money(spent.usd)}`}</Text>}
        {columns >= 110 && spent && <Text dimColor>{` today · ${short(spent.tokens)} tokens`}</Text>}
        {SHOW_TURNS && columns >= 120 && <Text dimColor>{'   last turns '}</Text>}
        {SHOW_TURNS && columns >= 120 && <Text color={lv.color}>{sparkline(history)}</Text>}
        {SHOW_TURNS && columns >= 120 && history.length > 1 && <Text dimColor>{trend(history)}</Text>}
      </Box>
    )
  })
}

// The desktop's band is 13px system text, and a column there is 8px. Each character's width in
// columns, measured in Chromium and rounded up; anything not listed counts as wide.
const CHARS: Record<string, number> = {
  '0': 1.02, '1': 0.75, '2': 0.98, '3': 1.01, '4': 1.04, '5': 1, '6': 1.03, '7': 0.92, '8': 1.03, '9': 1.03,
  a: 0.89, b: 0.99, c: 0.9, d: 0.99, e: 0.92, f: 0.58, g: 0.99, h: 0.95, i: 0.4, j: 0.4, k: 0.88, l: 0.41, m: 1.41,
  n: 0.94, o: 0.96, p: 0.99, q: 0.99, r: 0.61, s: 0.85, t: 0.59, u: 0.94, v: 0.88, w: 1.25, x: 0.85, y: 0.88, z: 0.87,
  ' ': 0.45, '.': 0.48, $: 1.02, '%': 1.5, M: 1.42, '↻': 1.32, '·': 0.48, '•': 0.76, '│': 0.42,
}
// Bold figures run about 7% wider. The rings are 18px.
const BOLD = 1.07
const RING = 18 / 8
// Half a column to spare for rounding in the desktop's layout.
const MARGIN = 0.5

function width(text: string) {
  return [...text].reduce((n, c) => n + (CHARS[c] ?? 1.6), 0)
}

// A group's width in columns: its icon's, its bold figure's, its texts' and a column between each.
function fit(icon: number, figure: string, ...texts: string[]) {
  const parts = texts.filter(Boolean)
  return icon + width(figure) * BOLD + parts.reduce((n, t) => n + width(t), 0) + parts.length + (icon ? 1 : 0)
}

async function takeReading($: EngineInterface) {
  const { context, rateLimits } = await $.session.usage()
  await saveLimits($, rateLimits, true)
  if (!context?.window) return
  // Before a response has measured the window (a new session, or one just compacted) there
  // is no fill: estimate it rather than draw an empty window.
  const tokens = context.tokens ?? (await estimate($))
  if (tokens !== undefined) await addReading($, tokens, context.window)
}

// The window's fill as /context estimates it locally, without a request.
async function estimate($: EngineInterface) {
  try {
    const { context } = await $.session.usage({ breakdown: 'summary' })
    return context.breakdown?.totalTokens
  } catch {
    return undefined
  }
}

// A reading of the size given, against the window the last reading had.
async function setContext($: EngineInterface, tokens: number | undefined) {
  if (tokens === undefined) return
  const last = (await read($, readings)).at(-1)
  const window = last?.window ?? (await $.session.usage()).context?.window
  if (window) await addReading($, tokens, window)
}

async function addReading($: EngineInterface, tokens: number, window: number) {
  const percent = Math.round((tokens / window) * 100)
  await update($, readings, history => {
    const last = history.at(-1)
    if (last && last.tokens === tokens && last.window === window) return history
    return [...history, { tokens, window, percent }].slice(-HISTORY)
  })
}

async function refresh($: EngineInterface) {
  const { rateLimits } = await $.session.usage()
  await saveLimits($, rateLimits, true)
  await askApp($)
  await scanToday($) // other sessions add to today too
  const at = await $.clock.now()
  await update($, now, () => at)
}

// Whether the engine has reported the quota in this session. The desktop app's sessions
// may not pass it on; the app's own usage card is asked then.
let engineReports = false
let askedAt = -Infinity
const APP_USAGE = 'mcp__ccd_session_mgmt__get_usage'
const ASK_EVERY_MS = 120_000

async function askApp($: EngineInterface) {
  if (engineReports) return
  const at = await $.clock.now()
  if (at - askedAt < ASK_EVERY_MS) return
  askedAt = at
  try {
    if (!(await $.tool.list()).some(t => t.name === APP_USAGE)) return
    const answer = await $.tool.call({ tool: APP_USAGE } as Parameters<EngineInterface['tool']['call']>[0])
    if (answer.isError || answer.deny !== undefined) return
    const text = answer.text ?? textOf(answer.result)
    const plan = JSON.parse(text.slice(text.indexOf('{'))).plan as
      | { status: string; windows?: { label: string; percentUsed: number; resetsAt?: string }[] }
      | undefined
    if (plan?.status !== 'ok' || !plan.windows) return
    const found: TokenBarLimit[] = []
    for (const w of plan.windows) {
      const kind = /^5-hour/i.test(w.label) ? 'five_hour' : /^weekly · all/i.test(w.label) ? 'seven_day' : undefined
      if (kind && typeof w.percentUsed === 'number') found.push({ kind, percentUsed: w.percentUsed, resetsAt: w.resetsAt })
    }
    if (!engineReports) await saveLimits($, found)
  } catch {
    // No app to ask, or it could not answer: keep what is shown.
  }
}

// An MCP tool's output as text: a string, or its content blocks' text joined.
function textOf(result: unknown): string {
  if (typeof result === 'string') return result
  if (Array.isArray(result)) return result.map(b => (b && typeof b.text === 'string' ? b.text : '')).join('')
  return ''
}

async function saveLimits($: EngineInterface, rateLimits: readonly TokenBarLimit[], fromEngine = false) {
  if (fromEngine && rateLimits.length > 0) engineReports = true
  const at = await $.clock.now()
  // A response may report only some windows: keep each window's last reading until it resets.
  await update($, limits, kept => {
    const byKind = new Map(kept.map(l => [l.kind, l]))
    for (const { kind, percentUsed, resetsAt } of rateLimits) byKind.set(kind, { kind, percentUsed, resetsAt })
    return [...byKind.values()].filter(l => !l.resetsAt || Date.parse(l.resetsAt) > at)
  })
  // Kept across sessions too, for the next one to start from.
  if (rateLimits.length > 0) await $.store.set('limits', await read($, limits)).catch(() => {})
  await update($, now, () => at)
}

// The local calendar day, as YYYY-MM-DD.
function dayOf(ms: number) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// One scan at a time per session; a request while one runs is folded into it.
let scanning: Promise<void> | null = null

function scanToday($: EngineInterface) {
  scanning ??= runScan($).finally(() => (scanning = null))
  return scanning
}

// Counts today from the transcripts. Off macOS, or when the scan fails, the band
// simply goes without today's group.
async function runScan($: EngineInterface) {
  try {
    const day = dayOf(await $.clock.now())
    const roots = scanRoots(await $.env.get('CLAUDE_CONFIG_DIR'))
    const { exitCode, stdout } = await $.process.run(
      ['osascript', '-l', 'JavaScript', '-e', SCAN_SCRIPT, roots, SCAN_STATE, day],
      { timeoutMs: 60_000 },
    )
    if (exitCode !== 0) return
    const r = JSON.parse(stdout) as { day: string; tokens: number; usd: number }
    if (r.day !== day || typeof r.tokens !== 'number' || typeof r.usd !== 'number') return
    await update($, today, () => ({ day: r.day, tokens: r.tokens, usd: r.usd }))
  } catch {
    // Leave the last count in place.
  }
}

function money(usd: number) {
  return usd >= 100 ? `$${Math.round(usd)}` : `$${usd.toFixed(2)}`
}

function level(percentUsed: number) {
  return LEVELS.find(l => percentUsed < l.upTo) ?? LEVELS[LEVELS.length - 1]!
}

function used(percentUsed: number) {
  return Math.round(percentUsed)
}

// The terminal's gauge: five cells, filled as far as the context is used.
function gauge(used: number) {
  const full = Math.round((Math.min(Math.max(used, 0), 100) / 100) * 5)
  return `[${'█'.repeat(full)}${'░'.repeat(5 - full)}]`
}

function countdown(resetsAt: string, at: number) {
  const minutes = Math.max(0, Math.floor((Date.parse(resetsAt) - at) / 60_000))
  // The weekly window runs for days: days and hours read better than a count of hours.
  if (minutes >= 24 * 60) return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
  return `${minutes}m`
}

function sparkline(history: TokenBarReading[]) {
  const top = Math.max(...history.map(r => r.tokens), 1)
  return history.map(r => BARS[Math.floor((r.tokens / top) * (BARS.length - 1))]).join('')
}

function trend(history: TokenBarReading[]) {
  const delta = (history.at(-1)?.tokens ?? 0) - (history.at(-2)?.tokens ?? 0)
  if (delta === 0) return '  steady'
  return delta > 0 ? `  ▲ +${short(delta)} last turn` : `  ▼ ${short(-delta)} last turn`
}

function short(n: number) {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${+(n / 1_000).toFixed(1)}k`
  return String(n)
}
