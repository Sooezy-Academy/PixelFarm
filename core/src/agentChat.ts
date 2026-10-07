import {
  AGENT_CHAT_HISTORY_LINES,
  AGENT_CHAT_MAX_ACTION,
  AGENT_CHAT_MAX_HANDOVER_TARGETS,
  AGENT_CHAT_MAX_HANDOVERS,
  AGENT_CHAT_MAX_REPLIES_PER_MESSAGE,
  AGENT_CHAT_MAX_REPLY_TOKENS,
  AGENT_CHAT_MAX_TEXT,
  OLLAMA_CHAT_URL,
  OLLAMA_THINK_LEVEL,
} from './constants.js';

/**
 * AgentChat: the user talks to agents in the office/farm, and each answers in
 * character through an LLM (Ollama Cloud). Everything here is host-agnostic:
 * the server runs a room with its own API key, and the static demo runs one in
 * the page that reaches the LLM through a Netlify Function. Neither the key nor
 * a prompt the page could tamper with ever reaches the browser — the host's
 * `complete` builds the prompt from structured fields on the trusted side.
 */

/** What an agent knows about itself when it answers. */
export interface ChatAgentProfile {
  id: number;
  /** What `@` addresses it as: lower case, no spaces (e.g. "hens"). */
  handle: string;
  /** One line on who it is ("works in the Hen house", "an AI coding agent on project api"). */
  role: string;
  isLead: boolean;
  /** What it is doing right now ("Collecting eggs", "idle"). */
  activity: string;
}

/** One line of the room's conversation. */
export interface ChatLine {
  /** "you" for the user, otherwise the speaking agent's handle. */
  from: string;
  text: string;
}

/** A reply, split into what it says, what it starts doing, and whom it hands work to. */
export interface ParsedReply {
  text: string;
  action?: string;
  mentions: string[];
}

export type OllamaMessage = { role: 'system' | 'user' | 'assistant'; content: string };

const USER_HANDLE = 'you';
const ALL_HANDLE = 'all';
const MENTION = /@([a-z0-9][a-z0-9_-]*)/gi;
// Usually its own last line, but models sometimes tack it onto the sentence.
const ACTION_LINE = /\bACTION:\s*(.+?)\s*$/im;

/** A name usable after `@`: lower case, spaces and odd characters folded to '-'. */
function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * `@` handles for a set of agents: the agent's team name, else its project
 * folder, else `agent-<id>`; duplicates get `-<id>` so every handle is unique.
 */
export function chatHandles(
  agents: Array<{ id: number; agentName?: string; folderName?: string }>,
): Map<number, string> {
  const base = agents.map((a) => ({
    id: a.id,
    handle: slug(a.agentName ?? '') || slug(a.folderName ?? '') || `agent-${a.id.toString()}`,
  }));
  const counts = new Map<string, number>();
  for (const { handle } of base) counts.set(handle, (counts.get(handle) ?? 0) + 1);
  const out = new Map<number, string>();
  for (const { id, handle } of base) {
    const unique =
      (counts.get(handle) ?? 0) > 1 || handle === ALL_HANDLE
        ? `${handle}-${id.toString()}`
        : handle;
    out.set(id, unique);
  }
  return out;
}

/** How an agent introduces itself: a theme role (its Area, or the lead's), else a coding agent on its project. */
export function describeRole(
  agent: { handle: string; isLead: boolean; folderName?: string },
  theme: { roleAreas?: Record<string, string>; leadArea?: string } | undefined,
): string {
  if (agent.isLead && theme?.leadArea) {
    return `the manager, running things from the ${theme.leadArea}`;
  }
  const area = theme?.roleAreas?.[agent.handle];
  if (area) return `the worker in the ${area}`;
  return `an AI coding agent working on ${agent.folderName ?? 'a project'}`;
}

/**
 * Who a message is for: everyone on `@all`, otherwise every `@handle` in the
 * text plus the agents picked in the UI. Unknown handles are ignored.
 */
export function resolveRecipients(
  text: string,
  selectedIds: number[],
  roster: Array<{ id: number; handle: string }>,
): number[] {
  const byHandle = new Map(roster.map((r) => [r.handle, r.id]));
  const ids = new Set<number>();
  for (const m of text.matchAll(MENTION)) {
    const handle = m[1].toLowerCase();
    if (handle === ALL_HANDLE) return roster.map((r) => r.id);
    const id = byHandle.get(handle);
    if (id !== undefined) ids.add(id);
  }
  const known = new Set(roster.map((r) => r.id));
  for (const id of selectedIds) if (known.has(id)) ids.add(id);
  return [...ids];
}

/**
 * The prompt for one agent's reply: who it is, who its teammates are and what
 * each is doing, the recent conversation, and the message it is answering.
 */
export function buildAgentPrompt(
  agent: ChatAgentProfile,
  team: ChatAgentProfile[],
  history: ChatLine[],
  message: ChatLine,
): OllamaMessage[] {
  const teammates = team
    .filter((t) => t.id !== agent.id)
    .map((t) => `- @${t.handle}${t.isLead ? ' (the lead)' : ''}: ${t.role}; now: ${t.activity}`)
    .join('\n');
  const system = [
    `You are @${agent.handle}, ${agent.role}${agent.isLead ? ', and the team lead' : ''}.`,
    `You are one of the agents shown as characters in a pixel-art world.`,
    teammates ? `Your teammates:\n${teammates}` : 'You work alone.',
    `Right now you are: ${agent.activity}.`,
    'Stay in character. Reply in 1 to 3 short sentences of plain text, no markdown, and do not start with your own name.',
    agent.isLead
      ? 'As the lead you plan and delegate: when a job belongs to a teammate, hand it over by @mentioning them with a clear instruction.'
      : 'If a job clearly belongs to a teammate, you may @mention them to hand it over.',
    'Use @ ONLY to hand someone a job; otherwise refer to teammates by name without the @.',
    'If you take on a task yourself, end with a separate last line: ACTION: <what you start doing, at most 6 words>.',
  ].join('\n');
  const said = (line: ChatLine) =>
    line.from === USER_HANDLE ? `The user says: ${line.text}` : `@${line.from} says: ${line.text}`;
  return [
    { role: 'system', content: system },
    ...history.map((line): OllamaMessage =>
      line.from === agent.handle
        ? { role: 'assistant', content: line.text }
        : { role: 'user', content: said(line) },
    ),
    { role: 'user', content: said(message) },
  ];
}

/** Split a raw reply into its text, an optional ACTION, and the teammates it @mentions. */
export function parseAgentReply(raw: string, ownHandle: string, handles: string[]): ParsedReply {
  let text = raw.trim();
  let action: string | undefined;
  const match = ACTION_LINE.exec(text);
  if (match) {
    action = match[1]
      .replace(/^["'<]+|["'>.]+$/g, '')
      .slice(0, AGENT_CHAT_MAX_ACTION)
      .trim();
    text = text.replace(ACTION_LINE, '').trim();
  }
  // Models sometimes echo their own name as a speaker label.
  text = text
    .replace(new RegExp(`^@?${ownHandle}\\s*:\\s*`, 'i'), '')
    .slice(0, AGENT_CHAT_MAX_TEXT);
  const known = new Set(handles);
  const mentions = [...new Set([...text.matchAll(MENTION)].map((m) => m[1].toLowerCase()))].filter(
    (h) => h !== ownHandle && known.has(h),
  );
  return { text, action: action || undefined, mentions };
}

/** One non-streaming chat completion from Ollama Cloud. Throws on HTTP or shape errors. */
export async function ollamaChat(
  fetchFn: typeof fetch,
  opts: { apiKey: string; model: string; messages: OllamaMessage[] },
): Promise<string> {
  const res = await fetchFn(OLLAMA_CHAT_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      stream: false,
      // Reasoning models spend the token budget thinking first; keep that short
      // (other models may reject the field, so it is only sent to gpt-oss).
      ...(opts.model.startsWith('gpt-oss') ? { think: OLLAMA_THINK_LEVEL } : {}),
      options: { num_predict: AGENT_CHAT_MAX_REPLY_TOKENS },
    }),
  });
  if (!res.ok) throw new Error(`Ollama returned HTTP ${res.status.toString()}`);
  const body = (await res.json()) as { message?: { content?: unknown } };
  if (typeof body.message?.content !== 'string') throw new Error('Ollama reply had no message');
  return body.message.content;
}

/** What a room needs from its host. */
export interface AgentChatHost {
  /** The agents that can be talked to right now (handles unique). */
  profiles(): ChatAgentProfile[];
  /** One raw reply from `agent` to `message`. The host decides how the LLM is reached. */
  complete(
    agent: ChatAgentProfile,
    team: ChatAgentProfile[],
    history: ChatLine[],
    message: ChatLine,
  ): Promise<string>;
  /** Deliver a ServerMessage (chatMessage / chatTyping) to the clients. */
  emit(message: Record<string, unknown>): void;
  /** An agent took on a task: the host may make it start working on it. */
  onAction?(agentId: number, action: string): void;
}

/**
 * A shared chat room: the user's message goes to its recipients, each answers
 * in parallel, and a reply that @mentions teammates hands the work on — those
 * teammates answer the replying agent in turn (one hop, so agents can't loop).
 */
export class AgentChatRoom {
  private readonly host: AgentChatHost;
  private readonly history: ChatLine[] = [];
  private seq = 0;

  constructor(host: AgentChatHost) {
    this.host = host;
  }

  /** The user's message, to the agents picked in the UI and/or @mentioned in the text. */
  async send(text: string, selectedIds: number[]): Promise<void> {
    const clean = text.trim().slice(0, AGENT_CHAT_MAX_TEXT);
    if (!clean) return;
    const team = this.host.profiles();
    const to = resolveRecipients(clean, selectedIds, team);
    this.post(undefined, USER_HANDLE, to, clean);
    if (to.length === 0) {
      this.post(undefined, 'system', [], 'Pick an agent, or @mention one (or @all).');
      return;
    }
    const message: ChatLine = { from: USER_HANDLE, text: clean };
    // A message to several agents already reached everyone it concerns: no
    // handovers. Either way, one message can trigger only so many replies.
    const handovers = to.length > 1 ? 0 : AGENT_CHAT_MAX_HANDOVERS;
    const budget = { left: AGENT_CHAT_MAX_REPLIES_PER_MESSAGE };
    await Promise.all(to.map((id) => this.answer(id, message, handovers, new Set([id]), budget)));
  }

  /**
   * One agent's reply. `handovers` is how many more times work may be handed
   * on; `chain` holds every agent already in this exchange, so a handover never
   * goes back to someone who already answered (no ping-pong). `budget` is the
   * replies the whole exchange may still produce.
   */
  private async answer(
    agentId: number,
    message: ChatLine,
    handovers: number,
    chain: Set<number>,
    budget: { left: number },
  ): Promise<void> {
    const team = this.host.profiles();
    const agent = team.find((t) => t.id === agentId);
    if (!agent || budget.left <= 0) return;
    budget.left--;
    const context = this.history.slice(-AGENT_CHAT_HISTORY_LINES);
    this.host.emit({ type: 'chatTyping', id: agentId, typing: true });
    let reply: ParsedReply;
    try {
      const raw = await this.host.complete(agent, team, context, message);
      reply = parseAgentReply(
        raw,
        agent.handle,
        team.map((t) => t.handle),
      );
    } catch (err) {
      this.host.emit({ type: 'chatTyping', id: agentId, typing: false });
      this.post(undefined, 'system', [], `@${agent.handle} couldn't answer (${String(err)}).`);
      return;
    }
    this.host.emit({ type: 'chatTyping', id: agentId, typing: false });
    if (!reply.text && !reply.action) {
      this.post(undefined, 'system', [], `@${agent.handle} didn't say anything. Try asking again.`);
      return;
    }
    const named = team.filter((t) => reply.mentions.includes(t.handle) && !chain.has(t.id));
    // Naming the whole team is a roll call, not a handover.
    const handedTo =
      handovers > 0 && named.length <= AGENT_CHAT_MAX_HANDOVER_TARGETS
        ? named.map((t) => t.id)
        : [];
    this.post(agentId, agent.handle, handedTo, reply.text || `(starts ${reply.action ?? ''})`);
    if (reply.action) this.host.onAction?.(agentId, reply.action);
    if (handedTo.length > 0) {
      const handover: ChatLine = { from: agent.handle, text: reply.text };
      const nextChain = new Set([...chain, ...handedTo]);
      await Promise.all(
        handedTo.map((id) => this.answer(id, handover, handovers - 1, nextChain, budget)),
      );
    }
  }

  private post(
    fromAgentId: number | undefined,
    fromName: string,
    toAgentIds: number[],
    text: string,
  ): void {
    if (fromName !== 'system') {
      this.history.push({ from: fromName, text });
      if (this.history.length > AGENT_CHAT_HISTORY_LINES * 2) {
        this.history.splice(0, this.history.length - AGENT_CHAT_HISTORY_LINES);
      }
    }
    this.host.emit({
      type: 'chatMessage',
      messageId: `chat-${(++this.seq).toString()}`,
      fromAgentId,
      fromName,
      toAgentIds,
      text,
      at: Date.now(),
    });
  }
}
