// Token Bar: how full the context window and the quota are, above the prompt.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TokenBarLimit, TokenBarReading } from '../types'
import { bars, barsWidth, ring, tank, week } from './draw'

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
// The turns chart and last-turn delta: off for now; the history is still kept.
const SHOW_TURNS = false

// Held by the host, so they survive a hot reload of this file.
const readings = atom({ plugin: 'token-bar', key: 'readings' } as const, [] as TokenBarReading[])
const limits = atom({ plugin: 'token-bar', key: 'limits' } as const, [] as TokenBarLimit[])
// The clock the countdown is drawn against; ticked so the band redraws.
const now = atom({ plugin: 'token-bar', key: 'now' } as const, 0)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await takeReading($)
    // Quota moves between turns too, and the countdown runs down: refresh both.
    $.clock.every(TICK_MS, () => refresh($))
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) {
      await takeReading($) // main-loop turns only, not subagents
    }
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

    if (e.surface !== 'terminal') {
      const { Box, Text, Svg } = $.ui.resolve(e)
      // Each group's rough width in columns, so a narrow band drops the right-most first.
      const groups: { key: string; color: string; cells: number; draw: () => JSX.Element }[] = [
        {
          key: 'context',
          color: lv.hex,
          cells: 27,
          draw: () => (
            <Box key="context" flexDirection="row" alignItems="center" gap={1}>
              <Svg source={tank(last.percent, lv.hex)} alt={`${last.percent}% of context used`} width={18} height={18} />
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
          cells: 27,
          draw: () => (
            <Box key="five-hour" flexDirection="row" alignItems="center" gap={1}>
              <Svg source={ring(qUsed, q.hex)} alt={`${qUsed}% of session used`} width={16} height={16} />
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
          cells: 21,
          draw: () => (
            <Box key="seven-day" flexDirection="row" alignItems="center" gap={1}>
              <Svg source={week(qUsed, q.hex)} alt={`${qUsed}% of weekly used`} width={47} height={10} />
              <Text color={q.hex} bold>{`${qUsed}%`}</Text>
              <Text dimColor>of weekly</Text>
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
      let room = columns - 2
      const shown = groups.filter((g, i) => (room -= g.cells + (i > 0 ? 3 : 0)) >= 0 || i === 0)
      const hidden = groups.slice(shown.length)

      return (
        <Box flexDirection="row" alignItems="center" paddingX={1} gap={3}>
          {shown.map(g => g.draw())}
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
        {SHOW_TURNS && columns >= 120 && <Text dimColor>{'   last turns '}</Text>}
        {SHOW_TURNS && columns >= 120 && <Text color={lv.color}>{sparkline(history)}</Text>}
        {SHOW_TURNS && columns >= 120 && history.length > 1 && <Text dimColor>{trend(history)}</Text>}
      </Box>
    )
  })
}

async function takeReading($: EngineInterface) {
  const { context, rateLimits } = await $.session.usage()
  await saveLimits($, rateLimits)
  if (!context?.window) return
  const tokens = context.tokens ?? 0
  const percent = context.percent ?? Math.round((tokens / context.window) * 100)
  await update($, readings, history =>
    [...history, { tokens, window: context.window, percent }].slice(-HISTORY),
  )
}

async function refresh($: EngineInterface) {
  const { rateLimits } = await $.session.usage()
  await saveLimits($, rateLimits)
  const at = await $.clock.now()
  await update($, now, () => at)
}

async function saveLimits($: EngineInterface, rateLimits: readonly TokenBarLimit[]) {
  const at = await $.clock.now()
  // A response may report only some windows: keep each window's last reading until it resets.
  await update($, limits, kept => {
    const byKind = new Map(kept.map(l => [l.kind, l]))
    for (const { kind, percentUsed, resetsAt } of rateLimits) byKind.set(kind, { kind, percentUsed, resetsAt })
    return [...byKind.values()].filter(l => !l.resetsAt || Date.parse(l.resetsAt) > at)
  })
  await update($, now, () => at)
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
