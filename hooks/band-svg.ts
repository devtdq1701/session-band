// The band's pieces, each its own small SVG sized to its content, so the band's native layout
// places them (left, right, wrapping) without knowing the band's width in pixels.
import { esc, hue, SANS } from './deck-svg'
import type { Hue, Palette } from './deck-svg'
import { icon } from './icons'
import type { IconName } from './icons'

export type Pill = { label: string; value: string; detail: string; accent: Hue | null; meter?: number; icon?: IconName }
export type Piece = { svg: string; width: number; height: number }

const H = 26
const BASE = 17.5
const CHAR = 0.56
const LABEL = 13
const VALUE = 14.5
const ICON = 15

const w = (s: string, size: number) => Math.ceil(s.length * size * CHAR)

const t = (x: number, s: string, size: number, fill: string, extra = '') =>
  `<text x="${x}" y="${BASE}" font-size="${size}" fill="${fill}" font-family="${SANS}" ${extra}>${esc(s)}</text>`

const piece = (parts: string[], width: number): Piece => ({
  svg:
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}">` +
    `${parts.join('')}</svg>`,
  width,
  height: H,
})

// The goal chip (when on), the folder icon and name.
export const where = (dir: string, isGoalMode: boolean, p: Palette): Piece => {
  const parts: string[] = []
  let x = 0
  if (isGoalMode) {
    const cw = w('GOAL', 12.5) + 18
    parts.push(`<rect x="0" y="2" width="${cw}" height="22" rx="11" fill="${p.red}"/>`)
    parts.push(t(9, 'GOAL', 12.5, '#FFFFFF', 'font-weight="700"'))
    x += cw + 10
  }
  parts.push(icon('folder', x, 4.5, 17, p.dim))
  x += 23
  parts.push(t(x, dir, 16, p.text, 'font-weight="600"'))
  return piece(parts, x + w(dir, 16) + 2)
}

export const branchChip = (branch: string, p: Palette): Piece => {
  const width = w(branch, LABEL) + ICON + 24
  return piece(
    [
      `<rect x="0" y="2" width="${width}" height="22" rx="11" fill="${p.track}"/>`,
      icon('branch', 8, 5.5, ICON - 1, p.teal),
      t(ICON + 13, branch, LABEL, p.teal),
    ],
    width,
  )
}

export const changedMark = (changed: number, p: Palette): Piece => {
  const label = `${changed} changed`
  return piece(
    [`<circle cx="5" cy="${BASE - 5}" r="4.5" fill="${p.amber}"/>`, t(15, label, LABEL, p.dim)],
    15 + w(label, LABEL),
  )
}

export const totalsMark = (totals: string, p: Palette): Piece =>
  piece([icon('clock', 0, 5.5, ICON, p.dim), t(ICON + 6, totals, LABEL, p.dim)], ICON + 6 + w(totals, LABEL))

export const pillOf = (pill: Pill, p: Palette): Piece => {
  const color = pill.accent === null ? p.text : hue(p, pill.accent)
  const meterW = pill.meter === undefined ? 0 : 44
  const parts: string[] = []
  let x = 12
  const body: string[] = []
  if (pill.icon) {
    body.push(icon(pill.icon, x, 5.5, ICON, color))
    x += ICON + 6
  }
  body.push(t(x, pill.label, LABEL, p.dim))
  x += w(pill.label, LABEL) + 7
  if (pill.meter !== undefined) {
    body.push(`<rect x="${x}" y="${BASE - 8.5}" width="${meterW}" height="6" rx="3" fill="${p.tile}"/>`)
    body.push(`<rect x="${x}" y="${BASE - 8.5}" width="${Math.max(3, (Math.min(100, pill.meter) / 100) * meterW)}" height="6" rx="3" fill="${color}"/>`)
    x += meterW + 7
  }
  if (pill.value) {
    body.push(t(x, pill.value, VALUE, color, 'font-weight="600"'))
    x += w(pill.value, VALUE) + 7
  }
  if (pill.detail) {
    body.push(t(x, pill.detail, LABEL, p.dim))
    x += w(pill.detail, LABEL)
  }
  const width = x + 12
  parts.push(`<rect x="0" y="0" width="${width}" height="${H}" rx="13" fill="${p.track}"/>`, ...body)
  return piece(parts, width)
}
