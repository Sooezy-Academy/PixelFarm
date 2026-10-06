import {
  STATIC_DEMO_SNAPSHOT_FILE,
  TRANSPORT_STATE_CONNECTED,
} from '../../../core/src/constants.js';
import type { SimulatedCrew } from '../../../core/src/crewSimulation.js';
import { CrewSimulation } from '../../../core/src/crewSimulation.js';
import type { ClientMessage, ServerMessage } from '../../../core/src/messages.js';
import { STATIC_DEMO_INVENTORY_STORAGE_KEY } from '../constants.js';
import type { MessageTransport, TransportState } from './types.js';

/** What scripts/build-demo-snapshot.ts writes next to the built SPA. */
interface DemoSnapshot {
  theme: string;
  crew: SimulatedCrew;
  /** The handshake a server would send, in order. */
  messages: Array<Record<string, unknown>>;
}

function readStoredInventory(): Record<string, number> {
  try {
    const raw = JSON.parse(
      localStorage.getItem(STATIC_DEMO_INVENTORY_STORAGE_KEY) ?? '{}',
    ) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const counts: Record<string, number> = {};
    for (const [product, n] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof n === 'number' && Number.isInteger(n) && n >= 0) counts[product] = n;
    }
    return counts;
  } catch {
    return {};
  }
}

function storeInventory(counts: Record<string, number>): void {
  try {
    localStorage.setItem(STATIC_DEMO_INVENTORY_STORAGE_KEY, JSON.stringify(counts));
  } catch {
    // Private window / blocked storage: the tally just lives for this visit.
  }
}

/**
 * The transport of the static (serverless) demo build, e.g. the Netlify site:
 * it plays the server's part in the page. On `webviewReady` it replays the
 * build-time snapshot (assets, theme, layout), then runs the same
 * CrewSimulation the server's `--simulate` mode runs, and answers
 * `collectProduct` with the same once-per-finished-turn rule as the server's
 * ProduceInventory — the tally kept in this browser's storage.
 */
export class StaticDemoTransport implements MessageTransport {
  readonly state: TransportState = TRANSPORT_STATE_CONNECTED;
  readonly ready: Promise<void> = Promise.resolve();

  private readonly handlers = new Set<(message: ServerMessage) => void>();
  private simulation: CrewSimulation | null = null;
  private started = false;
  private products: string[] = [];
  private inventory: Record<string, number> = readStoredInventory();
  /** Agents whose turn ended and whose product hasn't been collected yet. */
  private readonly uncollected = new Set<number>();

  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  send(message: ClientMessage): void {
    const msg = message as unknown as Record<string, unknown>;
    if (msg.type === 'webviewReady') {
      void this.start();
    } else if (msg.type === 'collectProduct') {
      this.collect(msg.id, msg.product);
    }
    // Everything else (settings, layout edits, theme switches) has no server to
    // reach; the page keeps its own state for this visit.
  }

  onMessage(handler: (message: ServerMessage) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onStateChange(): () => void {
    return () => {};
  }

  dispose(): void {
    this.simulation?.stop();
    this.simulation = null;
  }

  private deliver(message: Record<string, unknown>): void {
    for (const handler of this.handlers) handler(message as unknown as ServerMessage);
  }

  private async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    let snapshot: DemoSnapshot;
    try {
      const res = await fetch(`${this.baseUrl}${STATIC_DEMO_SNAPSHOT_FILE}`);
      if (!res.ok) throw new Error(`HTTP ${res.status.toString()}`);
      snapshot = (await res.json()) as DemoSnapshot;
    } catch (err) {
      console.error('[Webview] Static demo: could not load the demo snapshot:', err);
      return;
    }

    for (const message of snapshot.messages) {
      this.deliver(message);
      if (message.type === 'themeLoaded') {
        const productsByArea = (message.productsByArea ?? {}) as Record<string, string>;
        this.products = [...new Set(Object.values(productsByArea))];
        this.deliver({ type: 'inventoryLoaded', counts: this.inventory });
      }
    }

    this.simulation = new CrewSimulation(snapshot.crew, {
      spawn: ({ id }) => this.deliver({ type: 'agentCreated', id, folderName: snapshot.theme }),
      message: (message) => {
        if (message.type === 'agentStatus' && typeof message.id === 'number') {
          if (message.status === 'waiting' && message.awaitingInput !== true) {
            this.uncollected.add(message.id);
          } else if (message.status === 'active') {
            this.uncollected.delete(message.id);
          }
        }
        this.deliver(message);
      },
    });
    this.simulation.start();
  }

  private collect(agentId: unknown, product: unknown): void {
    if (typeof agentId !== 'number' || typeof product !== 'string') return;
    if (!this.uncollected.has(agentId) || !this.products.includes(product)) return;
    this.uncollected.delete(agentId);
    this.inventory = { ...this.inventory, [product]: (this.inventory[product] ?? 0) + 1 };
    storeInventory(this.inventory);
    this.deliver({ type: 'inventoryLoaded', counts: this.inventory });
  }
}
