// The drawings the surfaces with Svg show, as plain SVG markup.
// Each takes how much is used (0 to 100) and the level's color.

// A mid-tone that reads on the desktop's light card and on its dark one.
const TRACK = 'rgba(128,128,128,0.28)'
const RIM = 'rgba(128,128,128,0.5)'
const QUIET = 'rgba(128,128,128,0.55)'

// The context window as a container that fills from the bottom as it is used.
export function tank(used: number, color: string) {
  const h = used > 0 ? Math.max(share(used) * 12, 1.5) : 0
  return svg(
    18,
    18,
    `<rect x="1" y="1" width="16" height="16" rx="4" fill="none" stroke="${RIM}" stroke-width="1.6"/>` +
      `<rect x="3" y="${(15 - h).toFixed(1)}" width="12" height="${h.toFixed(1)}" rx="2" fill="${color}"/>`,
  )
}

// A ring that fills clockwise from twelve as the quota is used.
export function ring(used: number, color: string) {
  const r = 6
  const c = 2 * Math.PI * r
  return svg(
    16,
    16,
    `<circle cx="8" cy="8" r="${r}" fill="none" stroke="${TRACK}" stroke-width="2.5"/>` +
      `<circle cx="8" cy="8" r="${r}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" ` +
      `stroke-dasharray="${(share(used) * c).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 8 8)"/>`,
  )
}

// Seven day cells, filled as far as the week's quota is used.
export function week(used: number, color: string) {
  const filled = share(used) * 7
  let cells = ''
  for (let i = 0; i < 7; i++) {
    const x = i * 7
    const part = Math.min(Math.max(filled - i, 0), 1)
    cells += `<rect x="${x}" width="5" height="10" rx="1.5" fill="${TRACK}"/>`
    // A sliver under 3px reads as a glitch, so a started day shows at least that.
    const h = part > 0 ? Math.max(10 * part, 3) : 0
    if (h > 0) cells += `<rect x="${x}" y="${(10 - h).toFixed(1)}" width="5" height="${h.toFixed(1)}" rx="1.5" fill="${color}"/>`
  }
  return svg(47, 10, cells)
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
