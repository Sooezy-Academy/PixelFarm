import type { SpriteData } from '../types.js';

/**
 * 12×12 coin: K outline, h highlight (upper left), f face, s shade (lower
 * right), with an embossed ring in the middle.
 */
const COIN_SHAPE = [
  '....KKKK....',
  '..KKhhhhKK..',
  '.KhhffffssK.',
  '.KhfffffffsK',
  'KhffssssffsK',
  'KhfsffffsfsK',
  'KhfsffffsfsK',
  'KhffssssffsK',
  '.KffffffffsK',
  '.KsffffffssK',
  '..KKssssKK..',
  '....KKKK....',
];

type CoinPalette = Record<'K' | 'h' | 'f' | 's', string>;

function coin(palette: CoinPalette): SpriteData {
  return COIN_SHAPE.map((row) =>
    [...row].map((ch) => (ch === '.' ? '' : palette[ch as keyof CoinPalette])),
  );
}

export const GOLD_COIN_SPRITE: SpriteData = coin({
  K: '#6b4a0e',
  h: '#fff2a8',
  f: '#e8b830',
  s: '#b8861a',
});

export const SILVER_COIN_SPRITE: SpriteData = coin({
  K: '#4a5058',
  h: '#ffffff',
  f: '#c8d0d8',
  s: '#8e98a2',
});

export const BRONZE_COIN_SPRITE: SpriteData = coin({
  K: '#4e2a12',
  h: '#f0b07a',
  f: '#c27a3a',
  s: '#8e5226',
});
