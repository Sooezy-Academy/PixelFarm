import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import { type ClientMessageContext, handleClientMessage } from '../src/clientMessageHandler.js';
import { ProduceInventory, readInventory } from '../src/produceInventory.js';
import type { AgentState } from '../src/types.js';

const FARM = ['EGG_BASKET', 'MILK_CAN'];

describe('ProduceInventory', () => {
  let tempHome: string;
  let originalHome: string | undefined;
  let store: AgentStateStore;
  let inventory: ProduceInventory;

  const turnEnds = (id: number, awaitingInput = false) =>
    store.broadcast({ type: 'agentStatus', id, status: 'waiting', awaitingInput });

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-inventory-test-'));
    originalHome = process.env.HOME;
    process.env.HOME = tempHome;
    store = new AgentStateStore();
    inventory = new ProduceInventory(store);
  });

  afterEach(() => {
    store.dispose();
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('counts one product per finished turn and persists the tally', () => {
    turnEnds(1);
    expect(inventory.collect(1, 'EGG_BASKET', FARM)).toEqual({ EGG_BASKET: 1 });
    turnEnds(1);
    expect(inventory.collect(1, 'EGG_BASKET', FARM)).toEqual({ EGG_BASKET: 2 });
    expect(readInventory()).toEqual({ EGG_BASKET: 2 });
  });

  it('never counts a turn twice (a second client, or a reconnect replaying the status)', () => {
    turnEnds(1);
    expect(inventory.collect(1, 'EGG_BASKET', FARM)).not.toBeNull();
    expect(inventory.collect(1, 'EGG_BASKET', FARM)).toBeNull();
    expect(readInventory()).toEqual({ EGG_BASKET: 1 });
  });

  it('counts nothing without a finished turn, or when the agent is only awaiting input', () => {
    expect(inventory.collect(1, 'EGG_BASKET', FARM)).toBeNull();
    turnEnds(1, true);
    expect(inventory.collect(1, 'EGG_BASKET', FARM)).toBeNull();
  });

  it('drops an uncollected turn once the next turn starts or the agent leaves', () => {
    turnEnds(1);
    store.broadcast({ type: 'agentStatus', id: 1, status: 'active' });
    expect(inventory.collect(1, 'EGG_BASKET', FARM)).toBeNull();

    store.set(2, { id: 2 } as AgentState);
    turnEnds(2);
    store.delete(2);
    expect(inventory.collect(2, 'EGG_BASKET', FARM)).toBeNull();
  });

  it("refuses products the active theme doesn't offer, keeping the turn collectable", () => {
    turnEnds(1);
    expect(inventory.collect(1, 'GOLD_BAR', FARM)).toBeNull();
    expect(inventory.collect(1, 'MILK_CAN', FARM)).toEqual({ MILK_CAN: 1 });
  });

  it('reads a damaged tally file as empty and ignores invalid counts', () => {
    fs.mkdirSync(path.join(tempHome, '.pixel-agents'), { recursive: true });
    const file = path.join(tempHome, '.pixel-agents', 'inventory.json');
    fs.writeFileSync(file, '{ nope');
    expect(readInventory()).toEqual({});
    fs.writeFileSync(file, JSON.stringify({ EGG_BASKET: 3, MILK_CAN: -1, CRATE: 1.5, X: 'a' }));
    expect(readInventory()).toEqual({ EGG_BASKET: 3 });
  });

  describe('over the wire', () => {
    function ctx(): ClientMessageContext {
      return {
        store,
        inventory,
        cache: {
          characters: null,
          pets: null,
          floorTiles: null,
          wallTiles: null,
          carpetTiles: null,
          furniture: null,
          defaultLayout: null,
          theme: {
            theme: 'farm',
            themes: ['office', 'farm'],
            productsByArea: { Field: 'MILK_CAN' },
            roleAreas: {},
          },
        },
      };
    }

    it('broadcasts the new tally to every client when a product is collected', () => {
      const broadcasts: Array<Record<string, unknown>> = [];
      store.on('broadcast', (m) => broadcasts.push(m));
      turnEnds(1);

      handleClientMessage({ type: 'collectProduct', id: 1, product: 'MILK_CAN' }, () => {}, ctx());

      expect(broadcasts.at(-1)).toEqual({ type: 'inventoryLoaded', counts: { MILK_CAN: 1 } });
    });

    it('sends the persisted tally during the handshake', () => {
      turnEnds(1);
      inventory.collect(1, 'MILK_CAN', ['MILK_CAN']);
      const sent: Array<Record<string, unknown>> = [];

      handleClientMessage({ type: 'webviewReady' }, (m) => sent.push(m), ctx());

      expect(sent.find((m) => m.type === 'inventoryLoaded')).toEqual({
        type: 'inventoryLoaded',
        counts: { MILK_CAN: 1 },
      });
    });
  });
});
