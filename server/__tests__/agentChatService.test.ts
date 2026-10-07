import { describe, expect, it, vi } from 'vitest';

import { AgentChatService } from '../src/agentChatService.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { handleClientMessage } from '../src/clientMessageHandler.js';
import type { AgentState } from '../src/types.js';

function agent(id: number, fields: Partial<AgentState> = {}): AgentState {
  return {
    id,
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    backgroundAgentToolIds: new Set(),
    isWaiting: false,
    contextTokens: 0,
    ...fields,
  } as AgentState;
}

const THEME = {
  theme: 'farm',
  themes: ['office', 'farm'],
  productsByArea: {},
  roleAreas: { hens: 'Hen house' },
  leadArea: 'Farmhouse',
  prices: {},
};

/** `apiKey: null` = no key configured. */
function setup(opts: { apiKey?: string | null } = {}) {
  const apiKey = opts.apiKey === null ? undefined : (opts.apiKey ?? 'key');
  const store = new AgentStateStore();
  store.set(1, agent(1, { agentName: 'manager', isTeamLead: true }));
  store.set(
    2,
    agent(2, { agentName: 'hens', activeToolStatuses: new Map([['t', 'Collecting eggs']]) }),
  );
  store.set(3, agent(3, { folderName: 'api', isWaiting: true }));
  const fetchFn = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ message: { content: 'Cluck! ACTION: Feeding the hens' } }),
  }));
  const actions: Array<[number, string]> = [];
  const chat = new AgentChatService(store, {
    apiKey,
    model: 'gpt-oss:20b',
    theme: () => THEME,
    onAction: (id, action) => actions.push([id, action]),
    fetchFn: fetchFn as unknown as typeof fetch,
  });
  const broadcasts: Array<Record<string, unknown>> = [];
  store.on('broadcast', (m) => broadcasts.push(m));
  return { store, chat, fetchFn, actions, broadcasts };
}

describe('AgentChatService', () => {
  it('describes every agent from the store and the theme', () => {
    expect(setup().chat.profiles()).toEqual([
      {
        id: 1,
        handle: 'manager',
        role: 'the manager, running things from the Farmhouse',
        isLead: true,
        activity: 'between tasks',
      },
      {
        id: 2,
        handle: 'hens',
        role: 'the worker in the Hen house',
        isLead: false,
        activity: 'Collecting eggs',
      },
      {
        id: 3,
        handle: 'api',
        role: 'an AI coding agent working on api',
        isLead: false,
        activity: 'just finished a task',
      },
    ]);
  });

  it('answers through Ollama, broadcasts the room, and reports actions', async () => {
    const { chat, fetchFn, actions, broadcasts } = setup();
    await chat.send('@hens hungry?', []);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(actions).toEqual([[2, 'Feeding the hens']]);
    expect(broadcasts.filter((m) => m.type === 'chatMessage').map((m) => m.text)).toEqual([
      '@hens hungry?',
      'Cluck!',
    ]);
    // A later client is shown the conversation so far.
    expect(chat.handshakeMessages().map((m) => m.type)).toEqual([
      'chatStatus',
      'chatMessage',
      'chatMessage',
    ]);
  });

  it('reports itself unavailable without a key and never calls the LLM', async () => {
    const { chat, fetchFn } = setup({ apiKey: null });
    expect(chat.statusMessage()).toMatchObject({ type: 'chatStatus', available: false });
    await chat.send('@hens hi', []);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('only privileged clients may chat (it spends the operator’s quota)', () => {
    const { store, chat } = setup();
    const send = vi.spyOn(chat, 'send').mockResolvedValue();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const msg = { type: 'chatSend', toAgentIds: [2], text: 'hi' };
    handleClientMessage(msg, () => {}, { store, cache: null, chat, privileged: false });
    expect(send).not.toHaveBeenCalled();
    handleClientMessage(msg, () => {}, { store, cache: null, chat, privileged: true });
    expect(send).toHaveBeenCalledWith('hi', [2]);
    warn.mockRestore();
  });

  it('sends the chat status in the handshake only when chat is wired', () => {
    const { store, chat } = setup();
    const sent: Array<Record<string, unknown>> = [];
    handleClientMessage({ type: 'webviewReady' }, (m) => sent.push(m), {
      store,
      cache: null,
      chat,
    });
    expect(sent.find((m) => m.type === 'chatStatus')).toMatchObject({
      available: true,
      model: 'gpt-oss:20b',
    });
    const bare: Array<Record<string, unknown>> = [];
    handleClientMessage({ type: 'webviewReady' }, (m) => bare.push(m), { store, cache: null });
    expect(bare.some((m) => m.type === 'chatStatus')).toBe(false);
  });
});
