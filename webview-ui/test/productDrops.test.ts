/**
 * Theme product drops: when an agent finishes a turn, the active theme can show
 * an item beside it based on the Area its seat is in (an egg basket in the hen
 * house). The mapping comes from `themeLoaded.productsByArea`.
 *
 * Domain-model test of OfficeState (like greeter/teammateSeating): which seat
 * resolves to which product, and when nothing should appear.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { beforeAll, test } from 'vitest';

import { PRODUCT_DROP_DURATION_SEC } from '../src/constants.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import type { OfficeLayout } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';

const COLS = 6;
const ROWS = 3;

beforeAll(() => {
  const pixel = [['#ffffff']]; // eslint-disable-line pixel-agents/no-inline-colors
  buildDynamicCatalog({
    catalog: [
      {
        id: 'STOOL',
        label: 'Stool',
        footprintW: 1,
        footprintH: 1,
        isDesk: false,
        category: 'chairs',
        width: 16,
        height: 16,
      },
      {
        id: 'EGG_BASKET',
        label: 'Eggs',
        footprintW: 1,
        footprintH: 1,
        isDesk: false,
        category: 'misc',
        width: 16,
        height: 16,
      },
    ],
    sprites: { STOOL: pixel, EGG_BASKET: pixel },
  });
});

/** One stool inside "Hen house" (col 1) and one outside any Area (col 4). */
function farmLayout(): OfficeLayout {
  const areaTiles = new Array<string | null>(COLS * ROWS).fill(null);
  areaTiles[1 * COLS + 1] = 'Hen house';
  return {
    version: 1,
    cols: COLS,
    rows: ROWS,
    tiles: new Array<TileType>(COLS * ROWS).fill(TileType.FLOOR_1),
    furniture: [
      { uid: 'hen-stool', type: 'STOOL', col: 1, row: 1 },
      { uid: 'yard-stool', type: 'STOOL', col: 4, row: 1 },
    ],
    areas: [{ label: 'Hen house', color: '#f4dc8a' }], // eslint-disable-line pixel-agents/no-inline-colors
    areaTiles,
  };
}

function seated(seatId: string): OfficeState {
  const os = new OfficeState(farmLayout());
  os.setProductsByArea({ 'Hen house': 'EGG_BASKET' });
  os.addAgent(1, 0, 0, seatId, true);
  return os;
}

test("drops the Area's product beside an agent seated in that Area", () => {
  const os = seated('hen-stool');
  assert.equal(os.dropProduct(1), 'EGG_BASKET', 'reports what dropped, for the inventory');

  assert.equal(os.productDrops.length, 1);
  assert.equal(os.productDrops[0].type, 'EGG_BASKET');
  assert.equal(os.productDrops[0].timer, PRODUCT_DROP_DURATION_SEC);
});

test('drops nothing for a seat outside every Area', () => {
  const os = seated('yard-stool');
  assert.equal(os.dropProduct(1), null);
  assert.equal(os.productDrops.length, 0);
});

test('drops nothing when the theme maps no products (the office)', () => {
  const os = seated('hen-stool');
  os.setProductsByArea({});
  os.dropProduct(1);
  assert.equal(os.productDrops.length, 0);
});

test('drops nothing when the mapped type is not in the furniture catalog', () => {
  const os = seated('hen-stool');
  os.setProductsByArea({ 'Hen house': 'NOT_A_REAL_ITEM' });
  os.dropProduct(1);
  assert.equal(os.productDrops.length, 0);
});

test('a drop expires after its duration, and a theme switch clears drops', () => {
  const os = seated('hen-stool');
  os.dropProduct(1);
  os.update(PRODUCT_DROP_DURATION_SEC / 2);
  assert.equal(os.productDrops.length, 1, 'still visible halfway through');
  os.update(PRODUCT_DROP_DURATION_SEC);
  assert.equal(os.productDrops.length, 0, 'gone after its lifetime');

  os.dropProduct(1);
  os.setProductsByArea({ 'Hen house': 'EGG_BASKET' });
  assert.equal(os.productDrops.length, 0, 'new theme starts with no drops on screen');
});
