// The drawings the surfaces with Svg show, as plain SVG markup.
// Each takes how much is used (0 to 100) and the level's color.

// A mid-tone that reads on the desktop's light card and on its dark one.
const TRACK = 'rgba(128,128,128,0.28)'
const QUIET = 'rgba(128,128,128,0.55)'

// A ring that fills clockwise from twelve as the share is used.
export function ring(used: number, color: string) {
  const r = 7
  const c = 2 * Math.PI * r
  return svg(
    18,
    18,
    `<circle cx="9" cy="9" r="${r}" fill="none" stroke="${TRACK}" stroke-width="3"/>` +
      (used > 0
        ? `<circle cx="9" cy="9" r="${r}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" ` +
          `stroke-dasharray="${Math.max(share(used) * c, 0.1).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 9 9)"/>`
        : ''),
  )
}

// The week as a ring of seven arcs, one a day, filled clockwise as the quota is used.
export function week(used: number, color: string) {
  const filled = share(used) * 7
  const span = 360 / 7
  const gap = 9
  let body = ''
  for (let i = 0; i < 7; i++) {
    const from = i * span + gap / 2
    const to = (i + 1) * span - gap / 2
    body += `<path d="${arc(from, to)}" fill="none" stroke="${TRACK}" stroke-width="3"/>`
    const part = Math.min(Math.max(filled - i, 0), 1)
    // A started day shows at least a quarter of its arc, so a sliver does not read as a glitch.
    if (part > 0) body += `<path d="${arc(from, from + (to - from) * Math.max(part, 0.25))}" fill="none" stroke="${color}" stroke-width="3"/>`
  }
  return svg(18, 18, body)
}

// An arc of the ring, clockwise from twelve, between two angles in degrees.
function arc(from: number, to: number) {
  const at = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180
    return `${(9 + 7 * Math.cos(rad)).toFixed(2)} ${(9 + 7 * Math.sin(rad)).toFixed(2)}`
  }
  return `M ${at(from)} A 7 7 0 0 1 ${at(to)}`
}

// The context after each of the last turns, as bars; the newest in the level's color.
export function bars(values: number[], color: string) {
  const top = Math.max(...values, 1)
  const body = values
    .map((v, i) => {
      const h = Math.max((v / top) * 14, 1.5)
      const fill = i === values.length - 1 ? color : QUIET
      return `<rect x="${i * 5}" y="${(14 - h).toFixed(1)}" width="3.5" height="${h.toFixed(1)}" rx="1" fill="${fill}"/>`
    })
    .join('')
  return svg(barsWidth(values.length), 14, body)
}

export function barsWidth(count: number) {
  return Math.max(count * 5 - 1.5, 1)
}

// One row of the backdrop's panel: a ring (or the week's seven arcs, or none), a big figure, a line under it.
export type PanelRow = { icon: 'ring' | 'week' | null; used: number; color: string; figure: string; label: string }

// The backdrop: the band's figures, large, in a quiet card at the window's top left, clear of
// the conversation in the middle and the message box at the foot. The drawing is laid out on a
// 1600 by 1000 board pinned to the top left, so it keeps its size on a wide window and shrinks
// with a narrow one.
export function panel(rows: PanelRow[]) {
  const left = 24
  const top = 56
  const step = 68
  const width = 232
  const height = rows.length * step + 20
  let body = `<rect x="${left}" y="${top}" width="${width}" height="${height}" rx="16" class="card"/>`
  rows.forEach((row, i) => {
    const y = top + 10 + i * step
    const cx = left + 36
    const cy = y + 30
    if (row.icon === 'ring') body += bigRing(cx, cy, row.used, row.color)
    if (row.icon === 'week') body += bigWeek(cx, cy, row.used, row.color)
    const x = left + 68
    body +=
      // A row with no color of its own (today's spend) takes the mode's text color.
      (row.color
        ? `<text x="${x}" y="${cy + 5}" class="fig" fill="${row.color}">${row.figure}</text>`
        : `<text x="${x}" y="${cy + 5}" class="fig plain">${row.figure}</text>`) +
      `<text x="${x}" y="${cy + 22}" class="lab">${row.label}</text>`
  })
  const style =
    '<style>' +
    'text{font-family:-apple-system,system-ui,sans-serif}' +
    '.fig{font-size:24px;font-weight:700}' +
    '.lab{font-size:12px;fill:rgba(60,60,67,0.66)}' +
    '.card{fill:rgba(128,128,128,0.08);stroke:rgba(128,128,128,0.16);stroke-width:1}' +
    '.plain{fill:#1d1d1f}' +
    '@media (prefers-color-scheme: dark){.lab{fill:rgba(235,235,245,0.6)}.plain{fill:#f2f2f2}}' +
    '</style>'
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" width="100%" height="100%" ` +
    `preserveAspectRatio="xMinYMin meet">${style}${body}</svg>`
  )
}

const BIG_R = 17
const BIG_STROKE = 5

function bigRing(cx: number, cy: number, used: number, color: string) {
  const c = 2 * Math.PI * BIG_R
  return (
    `<circle cx="${cx}" cy="${cy}" r="${BIG_R}" fill="none" stroke="${TRACK}" stroke-width="${BIG_STROKE}"/>` +
    (used > 0
      ? `<circle cx="${cx}" cy="${cy}" r="${BIG_R}" fill="none" stroke="${color}" stroke-width="${BIG_STROKE}" stroke-linecap="round" ` +
        `stroke-dasharray="${Math.max(share(used) * c, 0.1).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`
      : '')
  )
}

function bigWeek(cx: number, cy: number, used: number, color: string) {
  const filled = share(used) * 7
  const span = 360 / 7
  const gap = 9
  const at = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180
    return `${(cx + BIG_R * Math.cos(rad)).toFixed(2)} ${(cy + BIG_R * Math.sin(rad)).toFixed(2)}`
  }
  const path = (from: number, to: number, stroke: string) =>
    `<path d="M ${at(from)} A ${BIG_R} ${BIG_R} 0 0 1 ${at(to)}" fill="none" stroke="${stroke}" stroke-width="${BIG_STROKE}"/>`
  let body = ''
  for (let i = 0; i < 7; i++) {
    const from = i * span + gap / 2
    const to = (i + 1) * span - gap / 2
    body += path(from, to, TRACK)
    const part = Math.min(Math.max(filled - i, 0), 1)
    if (part > 0) body += path(from, from + (to - from) * Math.max(part, 0.25), color)
  }
  return body
}

function share(percent: number) {
  return Math.min(Math.max(percent, 0), 100) / 100
}

function svg(w: number, h: number, body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`
}
