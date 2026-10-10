import { describe, expect, mock, test } from 'claude-code/testing'

const T0 = Date.parse('2026-10-06T10:00:00Z')
const BAND = { hasSurvey: false, isWorking: false, maxRows: 10 }

describe('token-bar', () => {
  test('the terminal band fills as the context and quota are used', async ($, on) => {
    // Hooks registered here run after the mod and stub what Claude Code would answer.
    let tokens = 36_100
    let rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[] = []
    on('clock.now', () => ({ value: T0 }))
    mock.store(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.usage', () => ({
      value: { startedAt: 0, rateLimits, context: { tokens, window: 200_000, percent: Math.round(tokens / 2_000) } },
    }))
    on('turn.complete', () => ({ text: '' }))

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const ui = await $.ui.mount({
      plugin: 'token-bar',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { ...BAND, bodyColumns: 140 },
    } as any)
    // All three read as used: 18% of a 200k window.
    expect(await ui.find({ type: 'Text', text: /^ 18%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ of context$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /left/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Charged|free of/ })).toBeUndefined()

    tokens = 134_400
    rateLimits = [
      { kind: 'five_hour', percentUsed: 24, resetsAt: new Date(T0 + 150 * 60_000).toISOString() },
      { kind: 'seven_day', percentUsed: 91 },
    ]
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as any)
    // 67% used: yellow.
    expect((await ui.find({ type: 'Text', text: /^ 67%$/ }))?.props.color).toBe('yellow')
    // The gauge fills as the context is used: 67% used is three cells of five.
    expect((await ui.find({ type: 'Text', text: /^\[███░░\]$/ }))?.props.color).toBe('yellow')
    expect(await ui.find({ type: 'Text', text: /last turn/ })).toBeUndefined()
    // Session and weekly read as used, as Claude's own usage page does.
    expect((await ui.find({ type: 'Text', text: /^ +24%$/ }))?.props.color).toBe('green')
    expect(await ui.find({ type: 'Text', text: /↻ 2h 30m/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /of session/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /of weekly/ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^ +91%$/ }))?.props.color).toBe('red')
    await ui.unmount()
  })

  test('the desktop draws the tank, the ring and the week', async ($, on) => {
    let tokens = 20_000
    on('clock.now', () => ({ value: T0 }))
    mock.store(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.usage', () => ({
      value: {
        startedAt: 0,
        rateLimits: [
          { kind: 'five_hour', percentUsed: 72, resetsAt: new Date(T0 + 45 * 60_000).toISOString() },
          { kind: 'seven_day', percentUsed: 7, resetsAt: new Date(T0 + (3 * 24 + 4) * 60 * 60_000).toISOString() },
        ],
        context: { tokens, window: 1_000_000, percent: Math.round(tokens / 10_000) },
      },
    }))
    on('turn.complete', () => ({ text: '' }))

    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' } as any)
    tokens = 883_000
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as any)
    const ui = await $.ui.mount({
      plugin: 'token-bar',
      surface: 'desktop',
      component: 'AbovePrompt',
      props: { ...BAND, bodyColumns: 140 },
    } as any)
    expect((await ui.find({ type: 'Svg' }))?.props.alt).toBe('88% of context used')
    expect((await ui.find({ type: 'Text', text: /^88%$/ }))?.props.color).toBe('#e5484d')
    expect(await ui.find({ type: 'Text', text: /Recharge soon|free of/ })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /^72%$/ }))?.props.color).toBe('#d99a00')
    expect((await ui.find({ type: 'Text', text: /^7%$/ }))?.props.color).toBe('#30a14e')
    expect(await ui.find({ type: 'Text', text: /↻ 45m/ })).toBeDefined()
    // The week counts down in days and hours.
    expect(await ui.find({ type: 'Text', text: /^↻ 3d 4h$/ })).toBeDefined()
    // Each group says what it measures.
    for (const label of ['of context', 'of session', 'of weekly']) {
      expect(await ui.find({ type: 'Text', text: new RegExp(`^${label}$`) })).toBeDefined()
    }
    await ui.unmount()
  })

  test('a response that reports one window keeps the other, and a narrow band marks what it hides', async ($, on) => {
    let rateLimits = [
      { kind: 'five_hour', percentUsed: 30, resetsAt: new Date(T0 + 60 * 60_000).toISOString() },
      { kind: 'seven_day', percentUsed: 5 },
    ]
    on('clock.now', () => ({ value: T0 }))
    mock.store(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.usage', () => ({
      value: { startedAt: 0, rateLimits, context: { tokens: 483_500, window: 1_000_000, percent: 48 } },
    }))
    on('turn.complete', () => ({ text: '' }))

    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' } as any)
    rateLimits = [{ kind: 'seven_day', percentUsed: 6 }]
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as any)

    const wide = await $.ui.mount({
      plugin: 'token-bar',
      surface: 'desktop',
      component: 'AbovePrompt',
      props: { ...BAND, bodyColumns: 140 },
    } as any)
    expect(await wide.find({ type: 'Text', text: /^30%$/ })).toBeDefined()
    expect(await wide.find({ type: 'Text', text: /^6%$/ })).toBeDefined()
    await wide.unmount()

    const narrow = await $.ui.mount({
      plugin: 'token-bar',
      surface: 'desktop',
      component: 'AbovePrompt',
      props: { ...BAND, bodyColumns: 50 },
    } as any)
    expect(await narrow.find({ type: 'Text', text: /^48%$/ })).toBeDefined()
    expect(await narrow.find({ type: 'Text', text: /^•$/ })).toBeDefined()
    await narrow.unmount()
  })
  test("today's tokens and cost come from the transcript scan, and a failed scan leaves the band", async ($, on) => {
    const runs: string[][] = []
    let scan: { exitCode: number; stdout: string } = { exitCode: 0, stdout: JSON.stringify({ day: '', tokens: 424_963_178, usd: 147.0413, unpriced: {} }) }
    const day = (ms: number) => {
      const d = new Date(ms)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
    on('clock.now', () => ({ value: T0 }))
    on('env.get', ($, e: any) => ({ value: e.name === 'CLAUDE_CONFIG_DIR' ? '/cfg, /work/.claude/projects/' : undefined }))
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.usage', () => ({
      value: {
        startedAt: 0,
        rateLimits: [
          { kind: 'five_hour', percentUsed: 24, resetsAt: new Date(T0 + 193 * 60_000).toISOString() },
          { kind: 'seven_day', percentUsed: 11 },
        ],
        context: { tokens: 50_000, window: 200_000, percent: 25 },
      },
    }))
    on('turn.complete', () => ({ text: '' }))
    on('process.run', ($, e: any) => {
      runs.push([...e.argv])
      const stdout = scan.stdout.replace('"day":""', `"day":"${day(T0)}"`)
      return { value: { exitCode: scan.exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })

    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' } as any)
    // The scan reads the configured transcripts for today's local date.
    expect(runs[0]?.slice(0, 4)).toEqual(['osascript', '-l', 'JavaScript', '-e'])
    // CLAUDE_CONFIG_DIR's entries, each a config home or a projects directory.
    expect(runs[0]?.slice(5)).toEqual(['/cfg/projects,/work/.claude/projects/', '~/.token-bar', day(T0)])

    for (const surface of ['desktop', 'terminal'] as const) {
      const ui = await $.ui.mount({ plugin: 'token-bar', surface, component: 'AbovePrompt', props: { ...BAND, bodyColumns: 160 } } as any)
      expect(await ui.find({ type: 'Text', text: /\$147$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /today · 425M tokens/ })).toBeDefined()
      await ui.unmount()
    }

    // The desktop reports 95 columns for a full-width band: it holds all four groups.
    const wide = await $.ui.mount({ plugin: 'token-bar', surface: 'desktop', component: 'AbovePrompt', props: { ...BAND, bodyColumns: 95 } } as any)
    expect(await wide.find({ type: 'Text', text: /\$147$/ })).toBeDefined()
    expect(await wide.find({ type: 'Text', text: '•' })).toBeUndefined()
    // A rule stands between groups.
    expect(await wide.find({ type: 'Text', text: '│' })).toBeDefined()
    await wide.unmount()

    // A main turn rescans; a subagent's turn does not.
    const before = runs.length
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as any)
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1, agentId: 'agent-1' } as any)
    expect(runs.length).toBe(before + 1)

    // A failed or garbled scan keeps the last count and the rest of the band.
    scan = { exitCode: 1, stdout: '' }
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as any)
    scan = { exitCode: 0, stdout: 'not json' }
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as any)
    const ui = await $.ui.mount({ plugin: 'token-bar', surface: 'desktop', component: 'AbovePrompt', props: { ...BAND, bodyColumns: 160 } } as any)
    expect(await ui.find({ type: 'Text', text: /\$147$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^25%$/ })).toBeDefined()
    await ui.unmount()
  })

  test('a compaction and a /clear empty the context without a turn', async ($, on) => {
    on('clock.now', () => ({ value: T0 }))
    mock.store(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    // The usage figures stay the last response's until the next one; /context's estimate
    // counts the system prompt and tools too.
    let estimate = 52_000
    on('session.usage', (_$, e) => ({
      value: {
        startedAt: 0,
        rateLimits: [],
        context: {
          tokens: 670_000,
          window: 1_000_000,
          percent: 67,
          ...(e?.breakdown ? { breakdown: { totalTokens: estimate } } : {}),
        },
      },
    }))
    const MSGS = [{ role: 'user', text: 'summary', toolUses: [] }]
    on('session.compact', (_$, e) => ({ messages: e.messages, tokensBefore: 670_000, tokensAfter: 4_000 }))
    on('session.end', (_$, e) => ({ sessionId: e.sessionId }))

    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' } as any)
    const ui = await $.ui.mount({
      plugin: 'token-bar',
      surface: 'desktop',
      component: 'AbovePrompt',
      props: { ...BAND, bodyColumns: 160 },
    } as any)
    expect(await ui.find({ type: 'Text', text: /^67%$/ })).toBeDefined()

    // Ahead-of-time and a subagent's own compactions leave the band alone.
    await $.session.compact({ trigger: 'precompute', messages: MSGS } as any)
    await $.session.compact({ trigger: 'auto', agentId: 'a1', messages: MSGS } as any)
    expect(await ui.find({ type: 'Text', text: /^67%$/ })).toBeDefined()

    await $.session.compact({ trigger: 'manual', messages: MSGS } as any)
    expect((await ui.find({ type: 'Text', text: /^5%$/ }))?.props.color).toBe('#30a14e')

    await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} } as any)
    expect(await ui.find({ type: 'Text', text: /^0%$/ })).toBeDefined()
    await ui.unmount()
  })

  test('a session with no response yet estimates the context and starts from the last quota', async ($, on) => {
    on('clock.now', () => ({ value: T0 }))
    mock.store(on, {
      limits: [
        { kind: 'five_hour', percentUsed: 30, resetsAt: new Date(T0 + 60 * 60_000).toISOString() },
        { kind: 'seven_day', percentUsed: 12, resetsAt: new Date(T0 + 3 * 86_400_000).toISOString() },
        // One that has reset since is dropped.
        { kind: 'spend_limit', percentUsed: 50, resetsAt: new Date(T0 - 60_000).toISOString() },
      ],
    })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.measure', (_$, e) => ({ changed: e.changed }))
    const usage = { startedAt: 0, rateLimits: [], context: { window: 1_000_000 } }
    on('session.usage', (_$, e) => ({
      value: e?.breakdown ? { ...usage, context: { ...usage.context, breakdown: { totalTokens: 41_000 } } } : usage,
    }))

    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' } as any)
    const ui = await $.ui.mount({ plugin: 'token-bar', surface: 'desktop', component: 'AbovePrompt', props: { ...BAND, bodyColumns: 160 } } as any)
    expect(await ui.find({ type: 'Text', text: /^4%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^0%$/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^30%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^12%$/ })).toBeDefined()

    // The engine's measurements move the band between turns.
    await $.session.measure({
      context: { tokens: 230_000, window: 1_000_000, percent: 23 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 41, resetsAt: new Date(T0 + 60 * 60_000).toISOString() }],
      changed: ['context', 'rateLimits'],
    } as any)
    expect(await ui.find({ type: 'Text', text: /^23%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^41%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^12%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^50%$/ })).toBeUndefined()
    await ui.unmount()
  })

  test("with no quota from the engine, the desktop app's usage card fills it in", async ($, on) => {
    on('clock.now', () => ({ value: T0 }))
    mock.store(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { tokens: 150_000, window: 1_000_000, percent: 15 } } }))
    on('tool.list', () => ({ value: [{ name: 'mcp__ccd_session_mgmt__get_usage' }] }) as any)
    const plan = {
      status: 'ok',
      windows: [
        { label: '5-hour limit', percentUsed: 4, resetsAt: new Date(T0 + 60 * 60_000).toISOString() },
        { label: 'Weekly · all models', percentUsed: 16, resetsAt: new Date(T0 + 86_400_000).toISOString() },
        { label: 'Weekly · Fable', percentUsed: 0, resetsAt: new Date(T0 + 86_400_000).toISOString() },
      ],
    }
    on('tool.call', { tool: 'mcp__ccd_session_mgmt__get_usage' } as any, () => ({ result: [{ type: 'text', text: JSON.stringify({ plan }) }] }) as any)

    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' } as any)
    const ui = await $.ui.mount({ plugin: 'token-bar', surface: 'desktop', component: 'AbovePrompt', props: { ...BAND, bodyColumns: 160 } } as any)
    expect(await ui.find({ type: 'Text', text: /^15%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^4%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^16%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /of weekly/ })).toBeDefined()
    await ui.unmount()
  })
})
