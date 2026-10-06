import { describe, expect, test } from 'claude-code/testing'

const T0 = Date.parse('2026-10-06T10:00:00Z')
const BAND = { hasSurvey: false, isWorking: false, maxRows: 10 }

describe('token-bar', () => {
  test('the terminal band fills as the context and quota are used', async ($, on) => {
    // Hooks registered here run after the mod and stub what Claude Code would answer.
    let tokens = 36_100
    let rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[] = []
    on('clock.now', () => ({ value: T0 }))
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
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.usage', () => ({
      value: {
        startedAt: 0,
        rateLimits: [
          { kind: 'five_hour', percentUsed: 72, resetsAt: new Date(T0 + 45 * 60_000).toISOString() },
          { kind: 'seven_day', percentUsed: 7 },
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
})
