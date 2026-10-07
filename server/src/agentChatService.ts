import type { ChatAgentProfile } from '../../core/src/agentChat.js';
import {
  AgentChatRoom,
  buildAgentPrompt,
  chatHandles,
  describeRole,
  ollamaChat,
} from '../../core/src/agentChat.js';
import { AGENT_CHAT_REPLAY_LINES } from '../../core/src/constants.js';
import type { AgentStateStore } from './agentStateStore.js';
import type { ThemeState } from './clientMessageHandler.js';

export interface AgentChatServiceOptions {
  /** Ollama Cloud key (OLLAMA_API_KEY). Without one, chat reports itself unavailable. */
  apiKey: string | undefined;
  model: string;
  /** The active theme, for role descriptions (which Area each role works in). */
  theme: () => ThemeState | undefined;
  /** An agent took on a task in chat (the demo simulator makes it start working). */
  onAction?: (agentId: number, action: string) => void;
  fetchFn?: typeof fetch;
}

/**
 * The server's AgentChat: one shared room over the agents in the store. The
 * key stays here — clients only ever send `chatSend` and receive
 * `chatMessage` / `chatTyping` broadcasts.
 */
export class AgentChatService {
  private readonly room: AgentChatRoom;
  private readonly store: AgentStateStore;
  private readonly opts: AgentChatServiceOptions;
  /** The room's recent lines, replayed to a client that connects later. */
  private readonly recent: Array<Record<string, unknown>> = [];

  constructor(store: AgentStateStore, opts: AgentChatServiceOptions) {
    this.store = store;
    this.opts = opts;
    const fetchFn = opts.fetchFn ?? fetch;
    this.room = new AgentChatRoom({
      profiles: () => this.profiles(),
      complete: (agent, team, history, message) =>
        ollamaChat(fetchFn, {
          apiKey: opts.apiKey ?? '',
          model: opts.model,
          messages: buildAgentPrompt(agent, team, history, message),
        }),
      emit: (message) => {
        if (message.type === 'chatMessage') {
          this.recent.push(message);
          if (this.recent.length > AGENT_CHAT_REPLAY_LINES) this.recent.shift();
        }
        this.store.broadcast(message);
      },
      onAction: opts.onAction,
    });
  }

  get available(): boolean {
    return Boolean(this.opts.apiKey);
  }

  /** The handshake's `chatStatus`. */
  statusMessage(): Record<string, unknown> {
    return this.available
      ? { type: 'chatStatus', available: true, model: this.opts.model }
      : {
          type: 'chatStatus',
          available: false,
          reason: 'Set OLLAMA_API_KEY for the Pixel Agents server to chat with agents.',
        };
  }

  /** The handshake: status, then the recent conversation. */
  handshakeMessages(): Array<Record<string, unknown>> {
    return [this.statusMessage(), ...(this.available ? this.recent : [])];
  }

  /** The user's chat message (`chatSend`). Never rejects: failures become system lines. */
  async send(text: string, selectedIds: number[]): Promise<void> {
    if (!this.available) return;
    try {
      await this.room.send(text, selectedIds);
    } catch (err) {
      console.error('[Pixel Agents] AgentChat failed:', err);
    }
  }

  /** Every agent in the store as someone you can talk to. */
  profiles(): ChatAgentProfile[] {
    const agents = [...this.store.values()];
    const handles = chatHandles(agents);
    const theme = this.opts.theme();
    return agents.map((agent) => {
      const handle = handles.get(agent.id) ?? `agent-${agent.id.toString()}`;
      const isLead = agent.isTeamLead === true;
      const role = describeRole({ handle, isLead, folderName: agent.folderName }, theme);
      const statuses = [...agent.activeToolStatuses.values()];
      const activity =
        statuses.at(-1) ?? (agent.isWaiting ? 'just finished a task' : 'between tasks');
      return { id: agent.id, handle, role, isLead, activity };
    });
  }
}
