// The Session deck drawn as one SVG: tiles, agent lanes, live sessions and the log. Pure: it takes
// the values the pane reads and returns the image and its height.
import type { AgentCard, LogLine, SessionRow } from '../types'
import { icon } from './icons'
import type { IconName } from './icons'

export type Palette = {
  tile: string
  text: string
  dim: string
  track: string
  rule: string
  blue: string
  green: string
  red: string
  amber: string
  gray: string
  purple: string
  teal: string
}

export const PALETTES: Record<'light' | 'dark', Palette> = {
  light: {
    tile: '#F4F3EF',
    text: '#1F1E1D',
    dim: '#7A7873',
    track: '#E8E6DF',
    rule: '#E2E0D9',
    blue: '#378ADD',
    green: '#1D9E75',
    red: '#D9534F',
    amber: '#BA7517',
    gray: '#A3A19A',
    purple: '#7F77DD',
    teal: '#1D9E9E',
  },
  dark: {
    tile: '#2B2A28',
    text: '#ECEBE6',
    dim: '#9C9A93',
    track: '#3A3936',
    rule: '#3A3936',
    blue: '#5FA3E8',
    green: '#3DBE92',
    red: '#F07070',
    amber: '#EFA53A',
    gray: '#7A7873',
    purple: '#A39CF0',
    teal: '#4CC3C3',
  },
}

export type Hue = 'red' | 'amber' | 'blue' | 'green' | 'gray' | 'purple' | 'teal'
// accent colours the tile's dot and value; meter, 0-100, draws a bar under the value.
export type Tile = { name: string; value: string; accent: Hue; meter?: number; icon?: IconName }
export type AgentLine = { card: AgentCard; status: string; tone: 'blue' | 'green' | 'red' | 'gray' }
export type SessionLine = { row: SessionRow; state: string; tone: Hue | null }

export type DeckData = {
  tiles: Tile[]
  agentsNote: string
  agents: AgentLine[]
  t0: number
  tEnd: number
  now: number
  sessions: SessionLine[]
  log: { line: LogLine; time: string }[]
}

// Named per text: the image renderer may not inherit the root's font, and has only the system's.
export const SANS = "Inter, 'Noto Sans', 'DejaVu Sans', 'Segoe UI', Arial, sans-serif"
export const MONO = "'JetBrains Mono', 'DejaVu Sans Mono', Menlo, Consolas, monospace"
const PAD = 2
const TILE_H = 66
const HEAD_H = 36
const AGENT_H = 42
const SESSION_H = 28
const LOG_H = 22

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// SVG text does not wrap or cut: cut by an estimate of the glyph width.
export const fit = (s: string, px: number, size: number, isMono = false) => {
  const max = Math.max(1, Math.floor(px / (size * (isMono ? 0.62 : 0.56))))
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

export const hue = (p: Palette, h: string | null) =>
  h === 'red' ? p.red : h === 'amber' ? p.amber : h === 'blue' ? p.blue : h === 'green' ? p.green
    : h === 'gray' ? p.gray : h === 'purple' ? p.purple : h === 'teal' ? p.teal : p.text

export const text = (x: number, y: number, s: string, size: number, fill: string, extra = '') =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${extra.includes('font-family') ? '' : `font-family="${SANS}"`} ${extra}>${esc(s)}</text>`

export const drawDeck = (d: DeckData, width: number, p: Palette) => {
  const parts: string[] = []
  let y = PAD
  const tone = (t: string | null) => hue(p, t)

  // Tiles: three equal cards.
  const gap = 8
  const tileW = (width - gap * (d.tiles.length - 1)) / Math.max(1, d.tiles.length)
  d.tiles.forEach((t, i) => {
    const x = i * (tileW + gap)
    const color = tone(t.accent)
    parts.push(`<rect x="${x}" y="${y}" width="${tileW}" height="${TILE_H}" rx="10" fill="${p.tile}"/>`)
    parts.push(t.icon ? icon(t.icon, x + 12, y + 10, 15, color) : `<circle cx="${x + 18}" cy="${y + 18}" r="4" fill="${color}"/>`)
    parts.push(text(x + 33, y + 22, t.name, 13, p.dim))
    parts.push(text(x + 12, y + 46, fit(t.value, tileW - 24, 18.5), 18.5, color, 'font-weight="600"'))
    if (t.meter !== undefined) {
      const mw = tileW - 24
      parts.push(`<rect x="${x + 12}" y="${y + 54}" width="${mw}" height="4" rx="2" fill="${p.track}"/>`)
      parts.push(`<rect x="${x + 12}" y="${y + 54}" width="${Math.max(3, (Math.min(100, t.meter) / 100) * mw)}" height="4" rx="2" fill="${color}"/>`)
    }
  })
  y += TILE_H

  const heading = (title: string, note: string, mark: Hue, glyph: IconName) => {
    y += HEAD_H
    parts.push(icon(glyph, 0, y - 24, 17, tone(mark)))
    parts.push(text(24, y - 10, title, 14.5, p.text, 'font-weight="600"'))
    if (note) parts.push(text(width, y - 10, note, 13, p.dim, 'text-anchor="end"'))
  }

  // Agents: label column, lane on a shared time axis, status on the right.
  heading('Agents', d.agentsNote, 'blue', 'agents')
  const labelW = Math.min(190, Math.round(width * 0.38))
  const statusW = 96
  const laneX = labelW + 10
  const laneW = Math.max(40, width - laneX - statusW - 10)
  const total = Math.max(1, d.tEnd - d.t0)
  if (d.agents.length === 0) {
    y += 24
    parts.push(text(0, y - 6, 'No agents in this session yet.', 14, p.dim))
  }
  for (const a of d.agents) {
    const top = y + 4
    parts.push(text(0, top + 14, fit(a.card.description || a.card.type, labelW, 14), 14, p.text))
    parts.push(text(0, top + 31, fit(a.card.type, labelW, 12), 12, p.dim))
    const x = laneX + Math.round(((a.card.spawnedAt - d.t0) / total) * laneW)
    const w = Math.max(6, Math.round((((a.card.endedAt ?? d.now) - a.card.spawnedAt) / total) * laneW))
    parts.push(`<rect x="${laneX}" y="${top + 10}" width="${laneW}" height="10" rx="5" fill="${p.track}"/>`)
    parts.push(
      `<rect x="${Math.min(x, laneX + laneW - 6)}" y="${top + 10}" width="${Math.min(w, laneX + laneW - x)}" height="10" rx="5" fill="${tone(a.tone)}"/>`,
    )
    parts.push(text(width, top + 20, fit(a.status, statusW, 13), 13, tone(a.tone), 'text-anchor="end"'))
    y += AGENT_H
  }

  // Live sessions: a coloured dot, the label, its folder dim, the state on the right.
  heading('Sessions', `${d.sessions.length}`, 'teal', 'layers')
  for (const s of d.sessions) {
    const mid = y + SESSION_H / 2 + 2
    parts.push(`<circle cx="6" cy="${mid - 5}" r="5" fill="${s.tone === null ? p.gray : tone(s.tone)}"/>`)
    const name = fit(s.row.label, width * 0.5, 14.5)
    parts.push(text(19, mid, name, 14.5, p.text, s.row.isSelf ? 'font-weight="600"' : ''))
    // Sessions in one folder with no prompt yet share a label: the id's head tells them apart.
    const aside = s.row.dir !== s.row.label ? s.row.dir : `#${s.row.id.slice(0, 4)}`
    parts.push(text(19 + name.length * 8.2 + 10, mid, fit(aside, 100, 12.5), 12.5, p.dim))
    parts.push(text(width, mid, s.state, 13, s.tone === null ? p.dim : tone(s.tone), 'text-anchor="end"'))
    y += SESSION_H
  }

  // Log: newest first, monospaced.
  heading('Log', '', 'purple', 'list')
  if (d.log.length === 0) {
    y += LOG_H
    parts.push(text(0, y - 6, 'No events yet.', 13, p.dim))
  }
  for (const l of d.log) {
    y += LOG_H
    const t = l.line.text
    const color =
      l.line.tone === 'error' ? p.red
        : l.line.tone === 'warning' ? p.amber
          : l.line.tone === 'success' ? p.green
            : t.startsWith('›') ? p.blue
              : t.startsWith('+') ? p.purple
                : p.dim
    parts.push(text(0, y - 6, l.time, 12.5, p.dim, `font-family="${MONO}"`))
    parts.push(text(54, y - 6, fit(l.line.text, width - 54, 12.5, true), 12.5, color, `font-family="${MONO}"`))
  }

  const height = Math.ceil(y + PAD)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" ` +
    `font-family="${SANS}">${parts.join('')}</svg>`
  return { svg, height }
}
