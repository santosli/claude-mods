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

function share(percent: number) {
  return Math.min(Math.max(percent, 0), 100) / 100
}

function svg(w: number, h: number, body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`
}
