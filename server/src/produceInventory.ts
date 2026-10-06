import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { AgentStateStore } from './agentStateStore.js';
import { INVENTORY_FILE_NAME, LAYOUT_FILE_DIR } from './constants.js';

/** Product type id (a theme furniture type, e.g. "EGG_BASKET") → number collected. */
export type InventoryCounts = Record<string, number>;

function getInventoryFilePath(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, INVENTORY_FILE_NAME);
}

/** Read the tally, keeping only non-negative integer counts. Missing or unreadable file = empty. */
export function readInventory(): InventoryCounts {
  try {
    const raw = JSON.parse(fs.readFileSync(getInventoryFilePath(), 'utf-8')) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const counts: InventoryCounts = {};
    for (const [product, n] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof n === 'number' && Number.isInteger(n) && n >= 0) counts[product] = n;
    }
    return counts;
  } catch {
    return {};
  }
}

function writeInventory(counts: InventoryCounts): void {
  const filePath = getInventoryFilePath();
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(counts, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.error('[Pixel Agents] Failed to write inventory file:', err);
  }
}

/**
 * The produce tally. Clients decide WHICH product a finished turn yields (the
 * Area of the agent's seat lives in the webview), but only the server decides
 * WHETHER it counts: each finished turn opens one slot per agent, and the first
 * `collectProduct` for that agent consumes it. Several open clients, or a
 * reconnect replaying the waiting status, therefore never count a turn twice.
 */
export class ProduceInventory {
  /** Agents whose turn ended and whose product hasn't been collected yet. */
  private readonly uncollected = new Set<number>();

  constructor(store: AgentStateStore) {
    store.on('broadcast', (message) => {
      if (message.type !== 'agentStatus' || typeof message.id !== 'number') return;
      if (message.status === 'waiting' && message.awaitingInput !== true) {
        this.uncollected.add(message.id);
      } else if (message.status === 'active') {
        // A new turn started before anyone collected the last one: it's gone.
        this.uncollected.delete(message.id);
      }
    });
    store.on('agentRemoved', (id) => this.uncollected.delete(id));
  }

  /**
   * Count one `product` for `agentId`'s finished turn. Returns the new tally, or
   * null when nothing was counted (no uncollected turn, or a product the active
   * theme doesn't offer).
   */
  collect(agentId: unknown, product: unknown, allowed: Iterable<string>): InventoryCounts | null {
    if (typeof agentId !== 'number' || typeof product !== 'string') return null;
    if (!this.uncollected.has(agentId) || ![...allowed].includes(product)) return null;
    this.uncollected.delete(agentId);
    const counts = readInventory();
    counts[product] = (counts[product] ?? 0) + 1;
    writeInventory(counts);
    return counts;
  }
}
