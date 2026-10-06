/**
 * Theme role seating: a theme can seat a team by role instead of clustering
 * teammates around their lead — the farm puts the teammate named "hens" in the
 * hen house and the team lead in the farmhouse (themeLoaded.roleAreas/leadArea).
 *
 * Domain-model test of OfficeState (like teammateSeating): which seat each role
 * ends up in, and that agents without a role are only ever moved to make room.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { beforeAll, test } from 'vitest';

import { OfficeState } from '../src/office/engine/officeState.js';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import type { OfficeLayout } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';

const COLS = 8;
const ROWS = 2;

beforeAll(() => {
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
    ],
    sprites: { STOOL: [['#ffffff']] }, // eslint-disable-line pixel-agents/no-inline-colors
  });
});

/** Row 1: two hen-house stools (cols 0-1), one farmhouse stool (col 3), two yard stools (cols 5-6). */
function farm(): OfficeState {
  const areaTiles = new Array<string | null>(COLS * ROWS).fill(null);
  areaTiles[COLS + 0] = 'Hen house';
  areaTiles[COLS + 1] = 'Hen house';
  areaTiles[COLS + 3] = 'Farmhouse';
  const layout: OfficeLayout = {
    version: 1,
    cols: COLS,
    rows: ROWS,
    tiles: new Array<TileType>(COLS * ROWS).fill(TileType.FLOOR_1),
    furniture: [
      { uid: 'hen-1', type: 'STOOL', col: 0, row: 1 },
      { uid: 'hen-2', type: 'STOOL', col: 1, row: 1 },
      { uid: 'office', type: 'STOOL', col: 3, row: 1 },
      { uid: 'yard-1', type: 'STOOL', col: 5, row: 1 },
      { uid: 'yard-2', type: 'STOOL', col: 6, row: 1 },
    ],
    areas: [
      { label: 'Hen house', color: '#f4dc8a' }, // eslint-disable-line pixel-agents/no-inline-colors
      { label: 'Farmhouse', color: '#b07a45' }, // eslint-disable-line pixel-agents/no-inline-colors
    ],
    areaTiles,
  };
  const os = new OfficeState(layout);
  os.setThemeRoles({ hens: 'Hen house' }, 'Farmhouse');
  return os;
}

test('a teammate named for a role walks to that role’s Area instead of staying by its lead', () => {
  const os = farm();
  os.addAgent(1, 0, 0, 'yard-1', true);
  os.addAgent(2, 0, 0, 'yard-2', true, undefined, 1);
  os.characters.get(2)!.agentName = 'Hens';

  assert.equal(os.placeByRole(2), true);
  assert.equal(os.seatZone(os.characters.get(2)!.seatId!), 'Hen house');
});

test('the team lead takes the farmhouse once it is known to be the lead', () => {
  const os = farm();
  os.addAgent(1, 0, 0, 'yard-1', true);
  os.setTeamInfo(1, undefined, undefined, true);
  assert.equal(os.characters.get(1)!.seatId, 'office');
});

test('a full role Area makes room by moving an agent that has no role there', () => {
  const os = farm();
  os.addAgent(9, 0, 0, 'office', true); // an unrelated session took the farmhouse stool
  os.addAgent(1, 0, 0, 'yard-1', true);

  os.setTeamInfo(1, undefined, undefined, true);

  assert.equal(os.characters.get(1)!.seatId, 'office', 'the lead gets the farmhouse');
  assert.notEqual(os.characters.get(9)!.seatId, 'office', 'the bystander moved');
  assert.notEqual(os.characters.get(9)!.seatId, null, 'the bystander still has a seat');
});

test('agents without a role, or with an unknown name, keep their seat', () => {
  const os = farm();
  os.addAgent(1, 0, 0, 'yard-1', true);
  os.addAgent(2, 0, 0, 'yard-2', true);
  os.characters.get(2)!.agentName = 'tractor';

  assert.equal(os.placeByRole(1), false);
  assert.equal(os.placeByRole(2), false);
  assert.equal(os.characters.get(1)!.seatId, 'yard-1');
  assert.equal(os.characters.get(2)!.seatId, 'yard-2');
});

test('an agent that learns its role while still appearing is placed in its Area directly', () => {
  const os = farm();
  os.addAgent(1, 0, 0, 'yard-1', true);
  os.characters.get(1)!.agentName = 'hens';
  os.placeByRole(1); // same frame as the add: nothing to watch it walk away from

  const ch = os.characters.get(1)!;
  assert.equal(os.seatZone(ch.seatId!), 'Hen house');
  const seat = os.seats.get(ch.seatId!)!;
  assert.deepEqual([ch.tileCol, ch.tileRow], [seat.seatCol, seat.seatRow]);
  assert.equal(ch.path.length, 0);
});

test('an agent already on the map walks to its role Area', () => {
  const os = farm();
  os.addAgent(1, 0, 0, 'yard-1', true);
  os.update(0.016); // a frame passes: the agent is established where it sits
  os.characters.get(1)!.agentName = 'hens';
  os.placeByRole(1);

  const ch = os.characters.get(1)!;
  assert.equal(os.seatZone(ch.seatId!), 'Hen house', 'its seat moved to the hen house');
  assert.deepEqual([ch.tileCol, ch.tileRow], [5, 1], 'but it is still at the yard stool');
  assert.ok(ch.path.length > 0, 'and walking there');
});
