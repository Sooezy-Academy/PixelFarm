#!/usr/bin/env node
/**
 * Generates the bundled "farm" theme pack:
 *   webview-ui/public/assets/themes/farm/
 *     theme.json                         Area → product map (themeLoaded.productsByArea)
 *     assets/furniture/<ID>/             manifest.json + PNGs (same format as assets/furniture)
 *     assets/pets/{hen,cow}/             manifest.json + 96×96 pet sheet
 *     assets/characters/char_0..5.png    the office characters in straw hats
 *     assets/floors/floor_0..5.png       grayscale patterns (colorized per tile)
 *     assets/default-layout-2.json       the farm map, with its Areas (revision 2: farmhouse)
 *
 * The art is drawn here from ASCII maps and primitives so it stays reviewable
 * and editable as source. Re-run after editing:  node scripts/generate-farm-theme.mjs
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BASE_ASSETS = path.join(ROOT, 'webview-ui', 'public', 'assets');
const THEME_DIR = path.join(BASE_ASSETS, 'themes', 'farm');
const OUT = path.join(THEME_DIR, 'assets');

// ── Palette ─────────────────────────────────────────────────────────────
const PAL = {
  '.': null,
  K: '#2b1d1a', // outline
  k: '#4a2f25', // dark brown
  w: '#8a5a34', // wood
  W: '#b07a45', // wood light
  l: '#d29b5c', // wood highlight
  y: '#b8862a', // hay dark
  Y: '#e0b84e', // hay
  h: '#f4dc8a', // hay light
  r: '#8e2f2a', // red dark
  R: '#c4473c', // red
  g: '#5f6873', // metal dark
  G: '#97a1ab', // metal
  s: '#d3d9de', // metal light / horn
  e: '#f5f0e6', // white (egg, feathers, cow)
  E: '#cfc5b3', // white shade
  n: '#3f7d2c', // green dark
  N: '#62a83f', // green
  m: '#9bd35e', // green light
  d: '#5a3d26', // soil dark
  D: '#7a5434', // soil
  b: '#26221f', // black (cow spots, eyes)
  o: '#e08a2a', // orange (beak, feet)
  p: '#e8a0a4', // pink
  u: '#3b6aa0', // blue
  U: '#79a7d8', // blue light
  c: '#c9a46a', // burlap
  C: '#e2c48e', // burlap light
};

function hexToRgba(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, 255];
}

class Canvas {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.px = Array.from({ length: h }, () => Array(w).fill(null));
  }
  set(x, y, c) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.px[y][x] = c === null ? null : (PAL[c] ?? c);
  }
  get(x, y) {
    return x < 0 || y < 0 || x >= this.w || y >= this.h ? null : this.px[y][x];
  }
  rect(x, y, w, h, c) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  /** Filled rectangle with a 1-px outline. */
  box(x, y, w, h, fill, outline = 'K') {
    this.rect(x, y, w, h, outline);
    this.rect(x + 1, y + 1, w - 2, h - 2, fill);
  }
  hline(x, y, w, c) {
    this.rect(x, y, w, 1, c);
  }
  vline(x, y, h, c) {
    this.rect(x, y, 1, h, c);
  }
  /** Filled disc with outline. */
  disc(cx, cy, r, fill, outline = 'K') {
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        const d = x * x + y * y;
        if (d <= r * r + r)
          this.set(cx + x, cy + y, d >= (r - 1) * (r - 1) + (r - 1) ? outline : fill);
      }
    }
  }
  /** Stamp an ASCII map ('.' = leave as is). Every row must be the same width. */
  ascii(x, y, rows, name = '?') {
    const width = rows[0].length;
    rows.forEach((row, j) => {
      if (row.length !== width) {
        throw new Error(`${name}: row ${j} is ${row.length} wide, expected ${width}: "${row}"`);
      }
      [...row].forEach((ch, i) => {
        if (ch === '.') return;
        if (!(ch in PAL)) throw new Error(`${name}: unknown palette char "${ch}"`);
        this.set(x + i, y + j, ch);
      });
    });
  }
  paste(other, x, y) {
    for (let j = 0; j < other.h; j++)
      for (let i = 0; i < other.w; i++) if (other.px[j][i]) this.set(x + i, y + j, other.px[j][i]);
  }
  flipX() {
    const c = new Canvas(this.w, this.h);
    for (let j = 0; j < this.h; j++)
      for (let i = 0; i < this.w; i++) c.px[j][i] = this.px[j][this.w - 1 - i];
    return c;
  }
  toPng() {
    const png = new PNG({ width: this.w, height: this.h });
    for (let j = 0; j < this.h; j++) {
      for (let i = 0; i < this.w; i++) {
        const c = this.px[j][i];
        const [r, g, b, a] = c ? hexToRgba(c) : [0, 0, 0, 0];
        const idx = (j * this.w + i) * 4;
        png.data[idx] = r;
        png.data[idx + 1] = g;
        png.data[idx + 2] = b;
        png.data[idx + 3] = a;
      }
    }
    return PNG.sync.write(png);
  }
}

function writeFile(rel, data) {
  const file = path.join(THEME_DIR, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}

function writeJson(rel, obj) {
  writeFile(rel, JSON.stringify(obj, null, 2) + '\n');
}

// ── Furniture ───────────────────────────────────────────────────────────

/** Single-sprite furniture item. */
function asset(id, name, category, canvas, opts = {}) {
  const footprintW = opts.footprintW ?? canvas.w / 16;
  const footprintH = opts.footprintH ?? canvas.h / 16;
  writeFile(`assets/furniture/${id}/${id}.png`, canvas.toPng());
  writeJson(`assets/furniture/${id}/manifest.json`, {
    id,
    name,
    category,
    type: 'asset',
    canPlaceOnWalls: false,
    canPlaceOnSurfaces: opts.canPlaceOnSurfaces ?? false,
    backgroundTiles: opts.backgroundTiles ?? 0,
    width: canvas.w,
    height: canvas.h,
    footprintW,
    footprintH,
  });
}

function stool() {
  const c = new Canvas(16, 16);
  c.ascii(
    0,
    0,
    [
      '................',
      '................',
      '................',
      '................',
      '................',
      '....KKKKKKKK....',
      '...KlllllllWK...',
      '...KWWWWWWWWK...',
      '....KwwwwwwK....',
      '....KwKKKKwK....',
      '....KwK..KwK....',
      '....KwK..KwK....',
      '....KwK..KwK....',
      '....KwK..KwK....',
      '....KKK..KKK....',
      '................',
    ],
    'STOOL',
  );
  return c;
}

function hayBale() {
  const c = new Canvas(16, 16);
  c.ascii(
    0,
    0,
    [
      '................',
      '................',
      '................',
      '..KKKKKKKKKKKK..',
      '.KhYhYYhYhYYhYK.',
      '.KYyYYyYYyYYyYK.',
      '.KkkkkkkkkkkkkK.',
      '.KYYyYhYYyYhYYK.',
      '.KyYYyYYyYYyYyK.',
      '.KYyYYhYyYYhYYK.',
      '.KkkkkkkkkkkkkK.',
      '.KyYyYYyYyYYyYK.',
      '.KyyyyyyyyyyyyK.',
      '..KKKKKKKKKKKK..',
      '................',
      '................',
    ],
    'HAY_BALE',
  );
  return c;
}

function egg(c, x, y) {
  c.ascii(x, y, ['.KK.', 'KeeK', 'KeEK', '.KK.'], 'egg');
}

function nestBox() {
  const c = new Canvas(32, 16);
  c.box(0, 2, 32, 14, 'W');
  c.hline(1, 3, 30, 'l');
  c.rect(15, 3, 2, 12, 'w');
  c.vline(15, 3, 12, 'K');
  for (const x of [3, 18]) {
    c.box(x - 1, 5, 13, 9, 'k');
    for (let i = 0; i < 11; i++) c.set(x + i, 11 + (i % 2), i % 3 === 0 ? 'h' : 'Y');
    c.hline(x, 12, 11, 'y');
  }
  egg(c, 5, 8);
  egg(c, 9, 9);
  egg(c, 22, 8);
  c.hline(1, 14, 30, 'w');
  return c;
}

function trough() {
  const c = new Canvas(32, 16);
  c.ascii(
    0,
    4,
    [
      'KKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKK',
      'KllllllllllllllllllllllllllllllK',
      '.KkYyYhYyYkYhYyYyYkYyYhYyYyYkK.',
      '.KkyYyYYhYyYyYYyhYyYYyYhYyYykK.',
      '..KWWWWWWWWWWWWWWWWWWWWWWWWWK..',
      '..KwwwwwwwwwwwwwwwwwwwwwwwwwK..',
      '...KKKKKKKKKKKKKKKKKKKKKKKKK...',
      '...KwK.................KwK.....',
      '...KwK.................KwK.....',
      '...KKK.................KKK.....',
    ].map((row) => row.padEnd(32, '.')),
    'TROUGH',
  );
  return c;
}

function soilPlot(c) {
  c.box(0, 2, 32, 14, 'D');
  for (const y of [5, 9, 13]) c.hline(1, y, 30, 'd');
}

function cropSprouts() {
  const c = new Canvas(32, 16);
  soilPlot(c);
  for (const y of [4, 8, 12]) {
    for (let x = 3; x < 30; x += 5) {
      c.set(x, y, 'N');
      c.set(x - 1, y - 1, 'm');
      c.set(x + 1, y - 1, 'N');
    }
  }
  return c;
}

function cropRipe() {
  const c = new Canvas(32, 16);
  soilPlot(c);
  for (let x = 2; x < 31; x += 3) {
    const top = 1 + (x % 2);
    c.vline(x, top + 2, 13 - top, 'y');
    c.vline(x + 1, top + 3, 12 - top, 'Y');
    c.rect(x, top, 2, 3, 'h');
    c.set(x, top + 1, 'Y');
  }
  return c;
}

function marketStall() {
  const c = new Canvas(48, 32);
  // Striped awning
  for (let x = 1; x < 47; x++) {
    const stripe = Math.floor((x - 1) / 4) % 2 === 0 ? 'R' : 'e';
    for (let y = 1; y < 8; y++) c.set(x, y, stripe);
    if ((x - 1) % 4 < 3) c.set(x, 8, stripe);
  }
  c.hline(0, 0, 48, 'K');
  c.vline(0, 0, 9, 'K');
  c.vline(47, 0, 9, 'K');
  for (let x = 0; x < 48; x++) if (!c.get(x, 8) || (x - 1) % 4 === 3) c.set(x, 9, 'K');
  c.hline(1, 1, 46, 'r');
  // Poles
  for (const x of [2, 44]) c.box(x, 9, 2, 12, 'w');
  // Counter
  c.box(0, 18, 48, 14, 'W');
  c.hline(1, 19, 46, 'l');
  for (let x = 6; x < 48; x += 8) c.vline(x, 21, 10, 'w');
  // Produce on the counter
  egg(c, 5, 15);
  egg(c, 8, 16);
  c.ascii(14, 13, ['.KK.', 'KsGK', 'KGGK', 'KGgK', 'KKKK', '....'], 'can');
  for (const [x, y] of [
    [22, 15],
    [25, 16],
    [28, 15],
  ])
    c.disc(x, y, 2, 'R');
  c.ascii(34, 13, ['..y.', '.yYy', 'yYhY', '.KrK', '.yYy', '....'], 'wheat');
  c.disc(41, 16, 2, 'N');
  return c;
}

function silo() {
  const c = new Canvas(32, 48);
  // Dome
  for (let y = 2; y <= 12; y++) {
    const half = Math.round(Math.sqrt(Math.max(0, 1 - ((12 - y) / 10) ** 2)) * 13);
    for (let x = 16 - half; x < 16 + half; x++) c.set(x, y, x < 16 - half + 2 ? 'r' : 'R');
    c.set(16 - half - 1, y, 'K');
    c.set(16 + half, y, 'K');
  }
  c.hline(13, 1, 6, 'K');
  c.hline(6, 4, 3, 'R');
  // Body
  c.box(2, 12, 28, 34, 'G');
  for (let y = 13; y < 45; y++) {
    c.set(3, y, 'g');
    c.set(4, y, 'g');
    c.set(10, y, 's');
    c.set(11, y, 's');
    c.set(27, y, 'g');
    c.set(28, y, 'g');
  }
  for (let y = 18; y < 45; y += 7) c.hline(3, y, 26, 'g');
  // Ladder
  for (let y = 13; y < 45; y++) {
    c.set(21, y, 'K');
    c.set(24, y, 'K');
    if (y % 3 === 0) c.hline(22, y, 2, 'K');
  }
  c.hline(1, 46, 30, 'K');
  return c;
}

function tractor() {
  const c = new Canvas(32, 32);
  // Cabin
  c.box(5, 6, 11, 12, 'R');
  c.box(7, 8, 7, 6, 'U');
  c.set(8, 9, 'e');
  c.hline(4, 5, 13, 'K');
  c.hline(5, 4, 11, 'r');
  // Hood and exhaust
  c.box(15, 12, 14, 8, 'R');
  c.hline(16, 13, 12, 'e');
  c.box(24, 6, 2, 7, 'g');
  c.set(24, 5, 'K');
  c.set(25, 5, 'K');
  // Chassis
  c.box(4, 17, 26, 4, 'r');
  // Wheels
  c.disc(10, 23, 7, 'b');
  c.disc(10, 23, 3, 'G');
  c.set(10, 23, 'K');
  c.disc(25, 26, 4, 'b');
  c.disc(25, 26, 1, 'G');
  return c;
}

function cart() {
  const c = new Canvas(32, 16);
  c.box(1, 2, 24, 9, 'W');
  c.hline(2, 3, 22, 'l');
  for (const x of [7, 13, 19]) c.vline(x, 3, 7, 'w');
  c.hline(25, 5, 6, 'K');
  c.hline(25, 6, 6, 'k');
  c.disc(8, 11, 4, 'w');
  c.disc(8, 11, 1, 'g');
  c.disc(19, 11, 4, 'w');
  c.disc(19, 11, 1, 'g');
  return c;
}

function fenceFront() {
  const c = new Canvas(16, 16);
  for (const x of [1, 12]) c.box(x, 2, 3, 14, 'w');
  c.box(0, 5, 16, 3, 'W');
  c.box(0, 10, 16, 3, 'W');
  for (const x of [1, 12]) {
    c.vline(x + 1, 6, 1, 'w');
    c.vline(x + 1, 11, 1, 'w');
  }
  return c;
}

function fenceSide() {
  const c = new Canvas(16, 16);
  c.box(6, 0, 4, 16, 'W');
  c.vline(7, 1, 14, 'l');
  c.box(5, 2, 6, 4, 'w');
  return c;
}

function scarecrow() {
  const c = new Canvas(16, 32);
  c.box(7, 10, 3, 22, 'w');
  c.box(1, 13, 15, 3, 'W');
  // Shirt
  c.box(4, 12, 9, 9, 'R');
  c.vline(8, 13, 7, 'r');
  // Straw hands
  c.ascii(0, 12, ['Y.', 'hY', 'Y.'], 'hand');
  c.ascii(15, 12, ['Y', 'Y', 'h'], 'hand');
  // Head and hat
  c.disc(8, 8, 3, 'C');
  c.set(7, 8, 'K');
  c.set(9, 8, 'K');
  c.hline(7, 10, 3, 'k');
  c.box(2, 4, 13, 2, 'Y');
  c.box(5, 1, 7, 4, 'Y');
  c.hline(6, 3, 5, 'r');
  return c;
}

function barrel() {
  const c = new Canvas(16, 16);
  c.ascii(
    0,
    0,
    [
      '................',
      '................',
      '....KKKKKKKK....',
      '...KwWWlWWWwK...',
      '...KgggggggggK..',
      '...KwWWlWWWwK...',
      '..KwwWWlWWWwwK..',
      '..KwwWWlWWWwwK..',
      '..KwwWWlWWWwwK..',
      '..KwwWWlWWWwwK..',
      '...KwWWlWWWwK...',
      '...KgggggggggK..',
      '...KwWWlWWWwK...',
      '....KKKKKKKK....',
      '................',
      '................',
    ].map((r) => r.slice(0, 16).padEnd(16, '.')),
    'BARREL',
  );
  return c;
}

function milkCan() {
  const c = new Canvas(16, 16);
  c.ascii(
    0,
    0,
    [
      '................',
      '......KKKK......',
      '.....KgggGK.....',
      '......KsGK......',
      '......KsGK......',
      '.....KssGGK.....',
      '....KGsGGGgK....',
      '...KkGsGGGgkK...',
      '....KGsGGGgK....',
      '....KGsGGGgK....',
      '....KGsGGGgK....',
      '....KGsGGGgK....',
      '....KGsGGGgK....',
      '....KggggggK....',
      '.....KKKKKK.....',
      '................',
    ],
    'MILK_CAN',
  );
  return c;
}

function eggBasket() {
  const c = new Canvas(16, 16);
  egg(c, 3, 5);
  egg(c, 6, 4);
  egg(c, 9, 5);
  c.ascii(
    0,
    8,
    [
      '.KKKKKKKKKKKKKK.',
      '.KlWlWlWlWlWlWK.',
      '..KWwWwWwWwWwK..',
      '..KwWwWwWwWwWK..',
      '...KWwWwWwWwK...',
      '....KKKKKKKK....',
    ],
    'EGG_BASKET',
  );
  return c;
}

function wheatSheaf() {
  const c = new Canvas(16, 16);
  c.ascii(
    0,
    0,
    [
      '................',
      '...h..h.h..h....',
      '..hYh.YhY.hYh...',
      '...Y.hYhYh.Y....',
      '....YyYhYyY.....',
      '.....yYhYy......',
      '.....yYyYy......',
      '......yYy.......',
      '.....KrrrK......',
      '......yYy.......',
      '.....yYyYy......',
      '....yY.y.Yy.....',
      '...yY..y..Yy....',
      '...K...K...K....',
      '................',
      '................',
    ],
    'WHEAT_SHEAF',
  );
  return c;
}

function grainSack() {
  const c = new Canvas(16, 16);
  c.ascii(
    0,
    0,
    [
      '................',
      '.......kk.......',
      '......KkkK......',
      '.....KcCcK......',
      '....KcCCCcK.....',
      '...KcCCCCCcK....',
      '..KcCCCCCCCcK...',
      '..KcCCuuuCCcK...',
      '..KcCCuUuCCcK...',
      '..KcCCuuuCCcK...',
      '..KcCCCCCCCcK...',
      '..KccCCCCCccK...',
      '...KcccccccK....',
      '....KKKKKKK.....',
      '................',
      '................',
    ],
    'GRAIN_SACK',
  );
  return c;
}

function crate() {
  const c = new Canvas(16, 16);
  for (const [x, y] of [
    [4, 5],
    [8, 4],
    [11, 5],
    [6, 6],
  ])
    c.disc(x, y, 2, 'R');
  c.set(8, 2, 'N');
  c.set(4, 3, 'N');
  c.box(1, 6, 14, 9, 'W');
  c.hline(2, 7, 12, 'l');
  c.hline(2, 10, 12, 'w');
  c.vline(4, 8, 6, 'w');
  c.vline(11, 8, 6, 'w');
  return c;
}

// ── Pets ────────────────────────────────────────────────────────────────

/** 96×96 sheet: row 0 walkDown×3 + idleDown×3 (16×32), row 1 the same facing up, row 2 walkRight×3 (32×32). */
function petSheet(down, up, right) {
  const sheet = new Canvas(96, 96);
  [...down.walk, ...down.idle].forEach((f, i) => sheet.paste(f, i * 16, 0));
  [...up.walk, ...up.idle].forEach((f, i) => sheet.paste(f, i * 16, 32));
  right.forEach((f, i) => sheet.paste(f, i * 32, 64));
  return sheet;
}

/** Bottom-align an ASCII body in a frame, swapping its last rows for a leg variant. */
function frame(w, rows, legs, name) {
  const all = [...rows, ...legs];
  const c = new Canvas(w, 32);
  c.ascii(Math.floor((w - all[0].length) / 2), 32 - all.length, all, name);
  return c;
}

function hen() {
  const front = [
    '.......RR.......',
    '......KRRK......',
    '.....KeeeeK.....',
    '.....KbeebK.....',
    '.....KeooeK.....',
    '....KeeRReeK....',
    '...KeeeeeeeeK...',
    '..KEeeeeeeeeEK..',
    '..KEeeeeeeeeEK..',
    '...KEeeeeeeEK...',
    '....KKKKKKKK....',
  ];
  const back = front.map((r, i) =>
    i >= 3 && i <= 5 ? r.replace(/[bo]/g, 'e').replace('RR', 'ee') : r,
  );
  back[7] = '..KEeEeeeeEeEK..';
  back[8] = '..KEeEeeeeEeEK..';
  const blink = front.map((r, i) => (i === 3 ? r.replace(/b/g, 'K') : r));
  const peck = [
    '................',
    ...front.slice(0, 10).map((r, i) => (i === 0 ? '................' : r)),
    front[10],
  ].slice(1);
  const legsStand = ['.....o....o.....', '....oo....oo....'];
  const legsL = ['.....o....o.....', '..........oo....'];
  const legsR = ['.....o....o.....', '....oo..........'];
  const side = [
    '..........RR....',
    '.........KRRK...',
    '........KeeeeK..',
    '........KeebeKo.',
    '........KeeeeKoo',
    '...K....KeeRK...',
    '..KEK..KeeeeK...',
    '..KEeKKeeeeeeK..',
    '..KEeeeeEEEeeK..',
    '...KeeeEEEEeeK..',
    '....KeeeeeeeK...',
    '.....KKKKKKK....',
  ];
  const sideLegs = [
    ['.......o..o.....', '......oo.oo.....'],
    ['......o....o....', '.....oo....oo...'],
    ['.......oo.......', '......ooo.......'],
  ];
  return petSheet(
    {
      walk: [
        frame(16, front, legsL, 'hen'),
        frame(16, front, legsStand, 'hen'),
        frame(16, front, legsR, 'hen'),
      ],
      idle: [
        frame(16, front, legsStand, 'hen'),
        frame(16, peck, legsStand, 'hen'),
        frame(16, blink, legsStand, 'hen'),
      ],
    },
    {
      walk: [
        frame(16, back, legsL, 'hen'),
        frame(16, back, legsStand, 'hen'),
        frame(16, back, legsR, 'hen'),
      ],
      idle: [
        frame(16, back, legsStand, 'hen'),
        frame(16, back, legsStand, 'hen'),
        frame(16, back, legsStand, 'hen'),
      ],
    },
    sideLegs.map((legs) => frame(32, side, legs, 'hen-side')),
  );
}

function cow() {
  const front = [
    '...s........s...',
    '...sKKKKKKKKs...',
    '.KKKbbeeeeeeKKK.',
    '.KbKbeeeeeeeKbK.',
    '..KKeKeeeeKeKK..',
    '....KeeeeeeK....',
    '....KppppppK....',
    '....KpKppKpK....',
    '.....KKKKKK.....',
    '..KKeeeebbeeKK..',
    '.KeebbeeeeeeeeK.',
    '.KeebbeeeeebbeK.',
    '.KeeeeeeeeebbeK.',
    '.KEeeeeppeeeeEK.',
    '..KKKKKKKKKKKK..',
  ];
  const blink = front.map((r, i) => (i === 4 ? '..KKeeeeeeeeKK..' : r));
  const back = [
    '...s........s...',
    '...sKKKKKKKKs...',
    '.KKKbbeeeeeeKKK.',
    '.KbKeeeeeeeeKbK.',
    '..KKKeeeeeeKKK..',
    '....KeeeeeeK....',
    '...KKeebbeeKK...',
    '..KeeeebbeeeeK..',
    '.KeebbeeeeeeeeK.',
    '.KeebbeeeeebbeK.',
    '.KeeeeeeeeebbeK.',
    '.KeeeeeeeeeeeeK.',
    '..KKKKKkKKKKKK..',
  ];
  const legs = [
    ['..KK.KK..KK.KK..', '..kk.kk..kk.kk..'],
    ['..KK.KK..KK.KK..', '.....kk..kk.....'],
    ['..KK.KK..KK.KK..', '..kk........kk..'],
  ];
  const side = [
    '.....................s..s.......',
    '....................KsKKsK......',
    '...................KbeeeeeK.....',
    '...................KeeeKeeeK....',
    '..K.KKKKKKKKKKKKKKKeeeeeeeeK....',
    '..KKKeeeebbbeeeeeeeKeeeeKppK....',
    '..K.KeeebbbbbeeeeeeeKeeeKpppK...',
    '..K.KeeeebbbeeeeebbeeKKKKKKKK...',
    '..K.KeeeeeeeeeeebbbbeK..........',
    '....KeeeeeeeeeeeebbeeK..........',
    '....KEeeeeeeeppeeeeeEK..........',
    '.....KKKKKKKKKKKKKKKK...........',
  ];
  const sideLegs = [
    [
      '.....KK..KK......KK..KK.........',
      '.....KK..KK......KK..KK.........',
      '.....kk..kk......kk..kk.........',
    ],
    [
      '....KK....KK....KK....KK........',
      '....KK....KK....KK....KK........',
      '....kk....kk....kk....kk........',
    ],
    [
      '......KKKK.........KKKK.........',
      '......KKKK.........KKKK.........',
      '......kkkk.........kkkk.........',
    ],
  ];
  return petSheet(
    {
      walk: legs.map((l) => frame(16, front, l, 'cow')),
      idle: [
        frame(16, front, legs[0], 'cow'),
        frame(16, front, legs[0], 'cow'),
        frame(16, blink, legs[0], 'cow'),
      ],
    },
    {
      walk: legs.map((l) => frame(16, back, l, 'cow-back')),
      idle: [0, 1, 2].map(() => frame(16, back, legs[0], 'cow-back')),
    },
    sideLegs.map((l) => frame(32, side, l, 'cow-side')),
  );
}

// ── Characters: the office crew in straw hats ───────────────────────────

function readPng(file) {
  return PNG.sync.read(fs.readFileSync(file));
}

/** Paint a straw hat over the top of the hair in one 16×32 frame (in place). */
function hatFrame(png, ox, oy) {
  const opaque = (x, y) => png.data[((oy + y) * png.width + ox + x) * 4 + 3] > 1;
  let top = -1;
  for (let y = 0; y < 32 && top < 0; y++)
    for (let x = 0; x < 16; x++)
      if (opaque(x, y)) {
        top = y;
        break;
      }
  if (top < 1) return;
  let minX = 16;
  let maxX = -1;
  for (let y = top; y < top + 4; y++) {
    for (let x = 0; x < 16; x++) {
      if (opaque(x, y)) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
    }
  }
  const put = (x, y, ch) => {
    if (x < 0 || x > 15 || y < 0 || y > 31) return;
    const [r, g, b, a] = hexToRgba(PAL[ch]);
    const idx = ((oy + y) * png.width + ox + x) * 4;
    png.data[idx] = r;
    png.data[idx + 1] = g;
    png.data[idx + 2] = b;
    png.data[idx + 3] = a;
  };
  // Crown: three rows, inset from the hair silhouette
  const cx0 = minX + 2;
  const cx1 = maxX - 2;
  for (let x = cx0; x <= cx1; x++) put(x, top - 1, 'K');
  for (let y = top; y <= top + 1; y++) {
    put(cx0 - 1, y, 'K');
    put(cx1 + 1, y, 'K');
    for (let x = cx0; x <= cx1; x++)
      put(x, y, y === top + 1 ? 'R' : (x - cx0) % 3 === 0 ? 'h' : 'Y');
  }
  // Brim: wider than the hair, outlined
  const by = top + 2;
  for (let x = minX - 1; x <= maxX + 1; x++) {
    put(x, by - 1 < top ? by : by, x === minX - 1 || x === maxX + 1 ? 'K' : x % 2 ? 'Y' : 'h');
    put(x, by + 1, 'K');
  }
  put(minX - 1, by, 'K');
  put(maxX + 1, by, 'K');
}

function farmerCharacters() {
  for (let i = 0; i < 6; i++) {
    const png = readPng(path.join(BASE_ASSETS, 'characters', `char_${i}.png`));
    for (let row = 0; row < 3; row++) for (let f = 0; f < 7; f++) hatFrame(png, f * 16, row * 32);
    writeFile(`assets/characters/char_${i}.png`, PNG.sync.write(png));
  }
}

// ── Floors (grayscale; colorized per tile) ──────────────────────────────

function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function floorCanvas(fn) {
  const c = new Canvas(16, 16);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const v = Math.max(0, Math.min(255, Math.round(fn(x, y))));
      const hex = v.toString(16).padStart(2, '0');
      c.set(x, y, `#${hex}${hex}${hex}`);
    }
  return c;
}

function floors() {
  const r1 = rng(7);
  const grassTufts = new Set(
    Array.from({ length: 14 }, () => `${Math.floor(r1() * 16)},${Math.floor(r1() * 16)}`),
  );
  const r2 = rng(11);
  const pebbles = new Set(
    Array.from({ length: 6 }, () => `${Math.floor(r2() * 16)},${Math.floor(r2() * 16)}`),
  );
  const r3 = rng(23);
  return [
    // 0 grass: mid-gray with lighter blades and darker specks
    floorCanvas((x, y) =>
      grassTufts.has(`${x},${y}`)
        ? 205
        : grassTufts.has(`${x},${(y + 1) % 16}`)
          ? 185
          : (x * 7 + y * 13) % 11 === 0
            ? 135
            : 165,
    ),
    // 1 tilled soil: furrows every 4 rows
    floorCanvas((x, y) =>
      y % 4 === 3 ? 110 : y % 4 === 0 ? 175 : pebbles.has(`${x},${y}`) ? 190 : 150,
    ),
    // 2 straw: diagonal strands
    floorCanvas((x, y) => ((x + y * 2) % 5 === 0 ? 205 : (x * 3 + y) % 7 === 0 ? 130 : 170)),
    // 3 cobblestone path
    floorCanvas((x, y) => {
      const row = Math.floor(y / 5);
      const xs = (x + (row % 2) * 3) % 6;
      if (y % 5 === 4 || xs === 5) return 105;
      return xs === 0 || y % 5 === 0 ? 185 : 160;
    }),
    // 4 barn planks: vertical boards with grain
    floorCanvas((x, y) => (x % 4 === 3 ? 110 : (y * 5 + x * 2) % 9 === 0 ? 140 : 168)),
    // 5 meadow (grass with flowers)
    floorCanvas((x, y) => (grassTufts.has(`${x},${y}`) ? 195 : r3() < 0.03 ? 215 : 165)),
  ];
}

// ── Layout ──────────────────────────────────────────────────────────────

const COLS = 36;
const ROWS = 22;
const T = { WALL: 0, GRASS: 1, SOIL: 2, STRAW: 3, PATH: 4, PLANKS: 5, MEADOW: 6, VOID: 255 };
const COLOR = {
  [T.GRASS]: { h: 95, s: 45, b: -12, c: 5 },
  [T.MEADOW]: { h: 100, s: 40, b: -6, c: 5 },
  [T.SOIL]: { h: 28, s: 45, b: -30, c: 0 },
  [T.STRAW]: { h: 45, s: 65, b: 5, c: 0 },
  [T.PATH]: { h: 35, s: 12, b: -8, c: 0 },
  [T.PLANKS]: { h: 22, s: 45, b: -22, c: 0 },
  [T.WALL]: { h: 6, s: 60, b: -72, c: -30 },
};

function buildLayout() {
  const tiles = Array(COLS * ROWS).fill(T.GRASS);
  const areaTiles = Array(COLS * ROWS).fill(null);
  const furniture = [];
  let uid = 0;
  const at = (c, r) => r * COLS + c;
  const fill = (c, r, w, h, t) => {
    for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) tiles[at(x, y)] = t;
  };
  const area = (c, r, w, h, label) => {
    for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) areaTiles[at(x, y)] = label;
  };
  const put = (type, col, row) => furniture.push({ uid: `farm-${++uid}`, type, col, row });
  /** A walled building: walls on the rim, `floor` inside, a door gap at the bottom. */
  const building = (c, r, w, h, floor, doorCol) => {
    fill(c, r, w, h, T.WALL);
    fill(c + 1, r + 1, w - 2, h - 2, floor);
    tiles[at(doorCol, r + h - 1)] = floor;
    tiles[at(doorCol + 1, r + h - 1)] = floor;
  };

  // Meadow patches and the dirt road along the bottom to town
  fill(0, 0, COLS, ROWS, T.GRASS);
  fill(13, 0, 4, 9, T.MEADOW);
  fill(0, 19, COLS, 3, T.PATH);
  fill(14, 9, 2, 10, T.PATH);

  // ── Hen house (top left)
  building(1, 1, 11, 8, T.STRAW, 5);
  area(2, 2, 9, 6, 'Hen house');
  put('NEST_BOX', 3, 3);
  put('NEST_BOX', 7, 3);
  put('STOOL', 3, 4);
  put('STOOL', 5, 4);
  put('STOOL', 8, 4);
  put('HAY_BALE', 10, 6);
  put('EGG_BASKET', 2, 6);

  // ── Cow barn (top right)
  building(18, 1, 11, 8, T.PLANKS, 22);
  area(19, 2, 9, 6, 'Cow barn');
  put('TROUGH', 20, 3);
  put('TROUGH', 24, 3);
  put('STOOL', 21, 4);
  put('STOOL', 25, 4);
  put('MILK_CAN', 27, 2);
  put('MILK_CAN', 19, 6);
  put('HAY_BALE', 27, 6);

  // ── Field (bottom left)
  fill(1, 11, 11, 7, T.SOIL);
  area(1, 11, 11, 7, 'Field');
  put('CROP_RIPE', 2, 12);
  put('CROP_RIPE', 6, 12);
  put('CROP_SPROUTS', 2, 15);
  put('CROP_SPROUTS', 6, 15);
  put('HAY_BALE', 3, 13);
  put('HAY_BALE', 7, 13);
  put('HAY_BALE', 3, 16);
  put('SCARECROW', 10, 12);
  put('TRACTOR', 9, 15);

  // ── Silo yard (bottom right)
  area(18, 11, 6, 7, 'Silo yard');
  put('SILO', 19, 11);
  put('GRAIN_SACK', 21, 15);
  put('GRAIN_SACK', 22, 15);
  put('HAY_BALE', 21, 16);
  put('BARREL', 18, 16);
  put('CART', 22, 17);

  // ── Market (bottom right corner, by the road to town)
  fill(25, 12, 4, 6, T.PATH);
  area(25, 11, 4, 7, 'Market');
  put('MARKET_STALL', 25, 12);
  put('STOOL', 26, 14);
  put('STOOL', 27, 14);
  put('CRATE', 25, 16);
  put('CRATE', 28, 16);
  put('WHEAT_SHEAF', 28, 11);

  // ── Farmhouse (top right): the team lead's office, reached by its own path
  building(30, 1, 6, 8, T.PLANKS, 32);
  area(31, 2, 4, 6, 'Farmhouse');
  fill(32, 9, 2, 10, T.PATH);
  put('BOOKSHELF', 31, 1);
  put('CLOCK', 34, 0);
  put('DESK_FRONT', 31, 3);
  put('STOOL', 32, 5);
  put('PLANT', 34, 5);

  // Fences along the road, with gaps for the two paths
  for (let c = 0; c < COLS; c++) {
    if (c === 14 || c === 15 || c === 32 || c === 33) continue;
    put('FENCE_FRONT', c, 18);
  }

  const tileColors = tiles.map((t) => (t === T.VOID ? null : (COLOR[t] ?? null)));
  return {
    version: 1,
    cols: COLS,
    rows: ROWS,
    layoutRevision: 2,
    tiles,
    tileColors,
    furniture,
    // Hens and cows wander the farm. petType indexes the merged pet list:
    // bundled (claudio, gitcat) first, then this pack (cow, hen).
    pets: [
      { id: 'farm-cow-1', petType: 2 },
      { id: 'farm-cow-2', petType: 2 },
      { id: 'farm-hen-1', petType: 3 },
      { id: 'farm-hen-2', petType: 3 },
      { id: 'farm-hen-3', petType: 3 },
    ],
    areas: [
      { label: 'Hen house', color: '#f4dc8a' },
      { label: 'Cow barn', color: '#c4473c' },
      { label: 'Field', color: '#62a83f' },
      { label: 'Silo yard', color: '#97a1ab' },
      { label: 'Market', color: '#79a7d8' },
      { label: 'Farmhouse', color: '#b07a45' },
    ],
    areaTiles,
  };
}

// ── Main ────────────────────────────────────────────────────────────────

fs.rmSync(OUT, { recursive: true, force: true });

asset('STOOL', 'Stool', 'chairs', stool());
asset('HAY_BALE', 'Hay Bale', 'chairs', hayBale());
asset('NEST_BOX', 'Nest Box', 'desks', nestBox());
asset('TROUGH', 'Feed Trough', 'desks', trough());
asset('CROP_SPROUTS', 'Crop Sprouts', 'desks', cropSprouts());
asset('CROP_RIPE', 'Ripe Wheat', 'desks', cropRipe());
asset('MARKET_STALL', 'Market Stall', 'desks', marketStall(), { backgroundTiles: 1 });
asset('SILO', 'Silo', 'storage', silo(), { backgroundTiles: 1 });
asset('TRACTOR', 'Tractor', 'misc', tractor(), { backgroundTiles: 1 });
asset('CART', 'Cart', 'storage', cart());
asset('SCARECROW', 'Scarecrow', 'decor', scarecrow(), { backgroundTiles: 1 });
asset('BARREL', 'Barrel', 'storage', barrel());
asset('MILK_CAN', 'Milk Can', 'storage', milkCan(), { canPlaceOnSurfaces: true });
asset('EGG_BASKET', 'Egg Basket', 'misc', eggBasket(), { canPlaceOnSurfaces: true });
asset('WHEAT_SHEAF', 'Wheat Sheaf', 'misc', wheatSheaf(), { canPlaceOnSurfaces: true });
asset('GRAIN_SACK', 'Grain Sack', 'storage', grainSack());
asset('CRATE', 'Produce Crate', 'storage', crate(), { canPlaceOnSurfaces: true });

// Fence: a 2-way rotation group (along a row / along a column)
writeFile('assets/furniture/FENCE/FENCE_FRONT.png', fenceFront().toPng());
writeFile('assets/furniture/FENCE/FENCE_SIDE.png', fenceSide().toPng());
writeJson('assets/furniture/FENCE/manifest.json', {
  id: 'FENCE',
  name: 'Fence',
  category: 'decor',
  type: 'group',
  groupType: 'rotation',
  rotationScheme: '2-way',
  canPlaceOnWalls: false,
  canPlaceOnSurfaces: false,
  backgroundTiles: 0,
  members: [
    {
      type: 'asset',
      id: 'FENCE_FRONT',
      file: 'FENCE_FRONT.png',
      width: 16,
      height: 16,
      footprintW: 1,
      footprintH: 1,
      orientation: 'front',
    },
    {
      type: 'asset',
      id: 'FENCE_SIDE',
      file: 'FENCE_SIDE.png',
      width: 16,
      height: 16,
      footprintW: 1,
      footprintH: 1,
      orientation: 'side',
    },
  ],
});

writeFile('assets/pets/cow/pet.png', cow().toPng());
writeJson('assets/pets/cow/manifest.json', { id: 'cow', name: 'Cow' });
writeFile('assets/pets/hen/pet.png', hen().toPng());
writeJson('assets/pets/hen/manifest.json', { id: 'hen', name: 'Hen' });

farmerCharacters();
floors().forEach((c, i) => writeFile(`assets/floors/floor_${i}.png`, c.toPng()));
writeJson('assets/default-layout-2.json', buildLayout());

writeJson('theme.json', {
  productsByArea: {
    'Hen house': 'EGG_BASKET',
    'Cow barn': 'MILK_CAN',
    Field: 'WHEAT_SHEAF',
    'Silo yard': 'GRAIN_SACK',
    Market: 'CRATE',
  },
  // The farm team: teammates with these names each work in their own Area, and the
  // team lead runs things from the farmhouse. `npm run farm:demo` plays this team.
  leadArea: 'Farmhouse',
  roleAreas: {
    hens: 'Hen house',
    cows: 'Cow barn',
    field: 'Field',
    market: 'Market',
    silo: 'Silo yard',
  },
  // What the demo simulator (pixel-agents --simulate) has each role do.
  // Lines starting with Checking/Counting/Inspecting/Reading/Reviewing/Planning
  // play the reading animation; the rest play the working one.
  simulation: {
    teamName: 'farm-team',
    leadName: 'manager',
    chores: {
      manager: [
        'Planning the day',
        'Assigning chores',
        'Reviewing the ledger',
        'Checking the weather',
        'Ordering feed',
      ],
      hens: ['Feeding the hens', 'Collecting eggs', 'Cleaning the nest boxes', 'Counting eggs'],
      cows: ['Feeding the cows', 'Milking the cows', 'Mucking out the barn', 'Checking the herd'],
      field: ['Ploughing the field', 'Sowing wheat', 'Harvesting wheat', 'Inspecting the crops'],
      market: [
        'Loading the cart',
        'Driving to town',
        'Selling eggs and milk',
        'Counting the takings',
      ],
      silo: [
        'Carrying grain to the silo',
        'Loading the truck',
        'Sweeping the yard',
        'Checking grain levels',
      ],
    },
  },
});

console.log(`[farm-theme] wrote ${path.relative(ROOT, THEME_DIR)}`);
