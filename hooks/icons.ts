// Outline icons on a 24-unit grid, drawn with strokes so they take any colour.
const PATHS = {
  folder: '<path d="M4 6.5h5l2 2h9v9.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/>',
  branch:
    '<circle cx="6" cy="5.5" r="2"/><circle cx="6" cy="18.5" r="2"/><circle cx="18" cy="8" r="2"/>' +
    '<path d="M6 7.5v9"/><path d="M18 10c0 4.5-6.5 3.5-11 7"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  gauge: '<path d="M4 16.5a8 8 0 1 1 16 0"/><path d="M12 16.5l4-5"/>',
  bolt: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
  database:
    '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/>' +
    '<path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>',
  agents:
    '<circle cx="9" cy="8" r="3"/><path d="M3.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/>' +
    '<circle cx="17" cy="9" r="2.5"/><path d="M16.5 14.5c2.5 0 4.5 1.8 4.5 4.5"/>',
  layers: '<path d="M12 4L3 9l9 5 9-5z"/><path d="M3 14l9 5 9-5"/>',
  list: '<path d="M9 6h11"/><path d="M9 12h11"/><path d="M9 18h11"/><path d="M4.5 6h.01"/><path d="M4.5 12h.01"/><path d="M4.5 18h.01"/>',
  dot: '<circle cx="12" cy="12" r="5" fill="currentColor"/>',
} as const

export type IconName = keyof typeof PATHS

// x, y: the icon's top-left corner; size in px.
export const icon = (name: IconName, x: number, y: number, size: number, color: string) =>
  `<g transform="translate(${x} ${y}) scale(${size / 24})" fill="none" stroke="${color}" color="${color}" ` +
  `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${PATHS[name]}</g>`
