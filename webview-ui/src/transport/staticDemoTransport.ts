import type { ChatAgentProfile, ChatLine } from '../../../core/src/agentChat.js';
import { AgentChatRoom, chatHandles, describeRole } from '../../../core/src/agentChat.js';
import {
  STATIC_DEMO_CHAT_ENDPOINT,
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

/** What the page knows about each simulated agent, for chat personas. */
interface DemoAgent {
  id: number;
  name?: string;
  isLead: boolean;
  activity?: string;
  waiting: boolean;
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
 * ProduceInventory — the tally kept in this browser's storage. AgentChat runs
 * the same AgentChatRoom the server does; only the LLM call differs — it goes
 * to the site's Netlify Function, which holds the key and builds the prompt.
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
  private readonly agents = new Map<number, DemoAgent>();
  private theme: { roleAreas?: Record<string, string>; leadArea?: string } = {};
  private chat: AgentChatRoom | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  send(message: ClientMessage): void {
    const msg = message as unknown as Record<string, unknown>;
    if (msg.type === 'webviewReady') {
      void this.start();
    } else if (msg.type === 'collectProduct') {
      this.collect(msg.id, msg.product);
    } else if (msg.type === 'chatSend' && typeof msg.text === 'string') {
      const ids = Array.isArray(msg.toAgentIds)
        ? msg.toAgentIds.filter((id): id is number => typeof id === 'number')
        : [];
      void this.chat?.send(msg.text, ids);
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
        this.theme = {
          roleAreas: (message.roleAreas ?? {}) as Record<string, string>,
          leadArea: typeof message.leadArea === 'string' ? message.leadArea : undefined,
        };
        const productsByArea = (message.productsByArea ?? {}) as Record<string, string>;
        this.products = [...new Set(Object.values(productsByArea))];
        this.deliver({ type: 'inventoryLoaded', counts: this.inventory });
      }
    }

    this.simulation = new CrewSimulation(snapshot.crew, {
      spawn: ({ id }) => {
        this.agents.set(id, { id, isLead: false, waiting: false });
        this.deliver({ type: 'agentCreated', id, folderName: snapshot.theme });
      },
      message: (message) => {
        this.track(message);
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
    void this.startChat();
  }

  /** Mirror simulation messages into what chat personas need (name, lead, activity). */
  private track(message: Record<string, unknown>): void {
    const agent = typeof message.id === 'number' ? this.agents.get(message.id) : undefined;
    if (!agent) return;
    if (message.type === 'agentTeamInfo') {
      agent.name = typeof message.agentName === 'string' ? message.agentName : agent.name;
      agent.isLead = message.isTeamLead === true;
    } else if (message.type === 'agentToolStart' && typeof message.status === 'string') {
      agent.activity = message.status;
    } else if (message.type === 'agentStatus') {
      agent.waiting = message.status === 'waiting';
      if (agent.waiting) agent.activity = undefined;
    }
  }

  private profiles(): ChatAgentProfile[] {
    const agents = [...this.agents.values()];
    const handles = chatHandles(agents.map((a) => ({ id: a.id, agentName: a.name })));
    return agents.map((a) => {
      const handle = handles.get(a.id) ?? `agent-${a.id.toString()}`;
      return {
        id: a.id,
        handle,
        isLead: a.isLead,
        role: describeRole({ handle, isLead: a.isLead }, this.theme),
        activity: a.activity ?? (a.waiting ? 'just finished a task' : 'between tasks'),
      };
    });
  }

  /** Ask the site's chat function whether chat is set up, then open the room. */
  private async startChat(): Promise<void> {
    const endpoint = STATIC_DEMO_CHAT_ENDPOINT;
    let status: { available?: boolean; model?: string } = {};
    try {
      const res = await fetch(endpoint);
      if (res.ok) status = (await res.json()) as typeof status;
    } catch {
      // No function deployed (e.g. a plain static server): chat stays offline.
    }
    if (!status.available) {
      this.deliver({
        type: 'chatStatus',
        available: false,
        reason: "Chat isn't set up on this site yet.",
      });
      return;
    }
    this.chat = new AgentChatRoom({
      profiles: () => this.profiles(),
      complete: async (agent, team, history: ChatLine[], message: ChatLine) => {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agent, team, history, message }),
        });
        if (res.status === 429) throw new Error('too many messages, wait a minute');
        if (!res.ok) throw new Error(`chat service HTTP ${res.status.toString()}`);
        const body = (await res.json()) as { reply?: unknown };
        if (typeof body.reply !== 'string') throw new Error('empty reply');
        return body.reply;
      },
      emit: (message) => this.deliver(message),
      onAction: (agentId, action) => {
        this.simulation?.assignChore(agentId, action);
      },
    });
    this.deliver({ type: 'chatStatus', available: true, model: status.model });
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
