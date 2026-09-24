// Context cursors for "Reinos": a gilded pointer plus a badge showing what a right-click will do.
const POINTER = '<path d="M3 2L3 21L8 16.6L11.5 24.2L15 22.6L11.6 15.2L18 15.2Z" fill="url(#g)" stroke="#2a1a08" stroke-width="1.4" stroke-linejoin="round"/>'
  + '<path d="M5 6L5 16.5" stroke="#fff6d8" stroke-opacity=".55" stroke-width="1.1" stroke-linecap="round"/>';
const DEFS = '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fbe6a6"/><stop offset="1" stop-color="#b3812c"/></linearGradient></defs>';

/** Badge glyphs, drawn in a 24x24 box. */
const BADGES = {
  attack: ['#ff6a55', '<path d="M5 19L16 8l3-3v3L8 19z"/><path d="M4 15l5 5M3 21l2-2"/>'],
  attackMove: ['#ff9a45', '<path d="M5 19L16 8l3-3v3L8 19z"/><path d="M4 15l5 5"/><path d="M14 20h6M17 17l3 3-3 3"/>'],
  hunt: ['#ffb35a', '<path d="M4 20L17 7"/><path d="M14 5l6-1-1 6z" fill="currentColor"/><path d="M6 15l3 3"/>'],
  chop: ['#e0a66a', '<path d="M6 20L16 8"/><path d="M12.5 5.5c3-2.5 7.5 0 6.5 4.5l-4.5-.5z" fill="currentColor"/>'],
  mine: ['#f2c94c', '<path d="M6 20L15 10"/><path d="M7 8c4-4 10-3 13 1"/>'],
  forage: ['#ef5b7a', '<path d="M5 11h14l-2 8H7z"/><path d="M8 11c0-4 8-4 8 0"/><circle cx="10" cy="15" r="1.2" fill="currentColor"/><circle cx="14" cy="15" r="1.2" fill="currentColor"/>'],
  farm: ['#e8c35a', '<path d="M12 21V7"/><path d="M12 9c-3-1-4-3.5-4-6 2 1 4 3 4 6zM12 13c3-1 4-3.5 4-6-2 1-4 3-4 6zM12 17c-3-1-4-3.5-4-6 2 1 4 3 4 6z" fill="currentColor" fill-opacity=".35"/>'],
  butcher: ['#e07a5f', '<path d="M4 20l9-9 3 1-8 9z" fill="currentColor" fill-opacity=".3"/><path d="M13 11l6-6"/>'],
  build: ['#9bd66e', '<path d="M12.5 6.5l4-3 4 4-4 3.5z" fill="currentColor" fill-opacity=".35"/><path d="M15 9L5 19"/>'],
  repair: ['#62e08c', '<path d="M12.5 6.5l4-3 4 4-4 3.5z" fill="currentColor" fill-opacity=".35"/><path d="M15 9L5 19"/><path d="M5 5v5M2.5 7.5h5"/>'],
  dropoff: ['#e3c98f', '<path d="M8 9h8l2 10H6z" fill="currentColor" fill-opacity=".25"/><path d="M9 5h6l-1 4h-4z"/><path d="M12 12v5M10 15l2 2 2-2"/>'],
  rally: ['#86b4ff', '<path d="M7 21V4"/><path d="M7 5h11l-3 4 3 4H7" fill="currentColor" fill-opacity=".35"/>'],
  blocked: ['#ff5a4a', '<circle cx="12" cy="12" r="7"/><path d="M7 17L17 7"/>'],
};

function svgCursor(badge) {
  let body = POINTER;
  if (badge) {
    const [color, glyph] = BADGES[badge];
    body += `<circle cx="23" cy="23" r="8.6" fill="#1a120a" fill-opacity=".92" stroke="${color}" stroke-width="1.4"/>`
      + `<g transform="translate(16.4 16.4) scale(.55)" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" color="${color}">${glyph}</g>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${DEFS}${body}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 3 2, auto`;
}

export const CURSOR = { default: svgCursor(null) };
for (const k of Object.keys(BADGES)) CURSOR[k] = svgCursor(k);
CURSOR.move = CURSOR.default;
CURSOR.select = CURSOR.default;

/** Accent colour of each action (hover rings, hints, target flashes). */
export const INTENT_COLOR = Object.fromEntries(Object.entries(BADGES).map(([k, v]) => [k, v[0]]));
INTENT_COLOR.move = '#9fe39a';
