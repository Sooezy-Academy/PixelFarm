import { describe, expect, it, vi } from 'vitest';

import type { ChatAgentProfile, ChatLine } from '../../core/src/agentChat.js';
import {
  AgentChatRoom,
  buildAgentPrompt,
  chatHandles,
  describeRole,
  ollamaChat,
  parseAgentReply,
  resolveRecipients,
} from '../../core/src/agentChat.js';
import { AGENT_CHAT_MAX_REPLIES_PER_MESSAGE } from '../../core/src/constants.js';

const TEAM: ChatAgentProfile[] = [
  { id: 1, handle: 'manager', role: 'the manager', isLead: true, activity: 'Planning the day' },
  {
    id: 2,
    handle: 'hens',
    role: 'the worker in the Hen house',
    isLead: false,
    activity: 'Collecting eggs',
  },
  {
    id: 3,
    handle: 'cows',
    role: 'the worker in the Cow barn',
    isLead: false,
    activity: 'Milking the cows',
  },
  {
    id: 4,
    handle: 'field',
    role: 'the worker in the Field',
    isLead: false,
    activity: 'Sowing wheat',
  },
];

describe('chat handles and routing', () => {
  it('names agents by team name, then folder, then id — always unique', () => {
    const handles = chatHandles([
      { id: 1, agentName: 'Hens' },
      { id: 2, folderName: 'My Project' },
      { id: 3 },
      { id: 4, agentName: 'twin' },
      { id: 5, agentName: 'twin' },
      { id: 6, agentName: 'all' },
    ]);
    expect([...handles.values()]).toEqual([
      'hens',
      'my-project',
      'agent-3',
      'twin-4',
      'twin-5',
      'all-6',
    ]);
  });

  it('sends to @mentioned and picked agents; @all reaches everyone', () => {
    expect(resolveRecipients('hi @hens and @nobody', [3], TEAM).sort()).toEqual([2, 3]);
    expect(resolveRecipients('@all hello', [], TEAM)).toEqual([1, 2, 3, 4]);
    expect(resolveRecipients('hello', [], TEAM)).toEqual([]);
  });

  it('describes theme roles, the lead, and plain coding agents', () => {
    const theme = { roleAreas: { hens: 'Hen house' }, leadArea: 'Farmhouse' };
    expect(describeRole({ handle: 'hens', isLead: false }, theme)).toBe(
      'the worker in the Hen house',
    );
    expect(describeRole({ handle: 'boss', isLead: true }, theme)).toContain('Farmhouse');
    expect(describeRole({ handle: 'api', isLead: false, folderName: 'api' }, undefined)).toBe(
      'an AI coding agent working on api',
    );
  });
});

describe('prompts and replies', () => {
  it('puts the agent, its team and their activity in the system prompt', () => {
    const messages = buildAgentPrompt(TEAM[1], TEAM, [{ from: 'you', text: 'hi' }], {
      from: 'manager',
      text: '@hens more eggs please',
    });
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('You are @hens');
    expect(messages[0].content).toContain(
      '@cows: the worker in the Cow barn; now: Milking the cows',
    );
    expect(messages.at(-1)).toEqual({
      role: 'user',
      content: '@manager says: @hens more eggs please',
    });
  });

  it('splits off the ACTION (own line or inline) and keeps only real teammate mentions', () => {
    expect(
      parseAgentReply('On it, @cows can help.\nACTION: Collecting eggs', 'hens', ['hens', 'cows']),
    ).toEqual({
      text: 'On it, @cows can help.',
      action: 'Collecting eggs',
      mentions: ['cows'],
    });
    const inline = parseAgentReply(
      'hens: Sure thing @hens @ghost. ACTION: "Scrub nest boxes."',
      'hens',
      ['hens', 'cows'],
    );
    expect(inline).toEqual({
      text: 'Sure thing @hens @ghost.',
      action: 'Scrub nest boxes',
      mentions: [],
    });
  });

  it('calls Ollama with the key, low reasoning for gpt-oss, and returns the content', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ message: { content: 'Hello!' } }),
    }));
    const reply = await ollamaChat(fetchFn as unknown as typeof fetch, {
      apiKey: 'k',
      model: 'gpt-oss:20b',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(reply).toBe('Hello!');
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k');
    expect(JSON.parse(init.body as string)).toMatchObject({ stream: false, think: 'low' });
  });
});

describe('AgentChatRoom', () => {
  function room(replies: Record<string, string | Error>) {
    const emitted: Array<Record<string, unknown>> = [];
    const actions: Array<[number, string]> = [];
    const asked: string[] = [];
    const chat = new AgentChatRoom({
      profiles: () => TEAM,
      complete: async (agent: ChatAgentProfile, _team, _history, message: ChatLine) => {
        asked.push(`${agent.handle}<-${message.from}`);
        const reply = replies[agent.handle] ?? 'ok';
        if (reply instanceof Error) throw reply;
        return reply;
      },
      emit: (m) => emitted.push(m),
      onAction: (id, action) => actions.push([id, action]),
    });
    const lines = () =>
      emitted
        .filter((m) => m.type === 'chatMessage')
        .map((m) => `${String(m.fromName)}: ${String(m.text)}`);
    return { chat, emitted, actions, asked, lines };
  }

  it('the lead hands a job to one teammate, who answers and starts working', async () => {
    const r = room({
      manager: 'Sure. @hens please collect extra eggs.',
      hens: 'On my way!\nACTION: Collecting extra eggs',
    });
    await r.chat.send('@manager we need eggs', []);
    expect(r.asked).toEqual(['manager<-you', 'hens<-manager']);
    expect(r.actions).toEqual([[2, 'Collecting extra eggs']]);
    expect(r.lines()).toEqual([
      'you: @manager we need eggs',
      'manager: Sure. @hens please collect extra eggs.',
      'hens: On my way!',
    ]);
  });

  it('a roll call naming the whole team is not a handover', async () => {
    const r = room({ manager: '@hens counts eggs, @cows milks, @field sows.' });
    await r.chat.send('@manager status?', []);
    expect(r.asked).toEqual(['manager<-you']);
  });

  it('a message to everyone gets one reply each, no handovers', async () => {
    const r = room({
      manager: '@hens go!',
      hens: '@cows help',
      cows: '@field go',
      field: '@hens hi',
    });
    await r.chat.send('@all good morning', []);
    expect(r.asked.sort()).toEqual(['cows<-you', 'field<-you', 'hens<-you', 'manager<-you']);
  });

  it('never revisits an agent in a handover chain, and caps replies per message', async () => {
    const r = room({
      manager: '@hens go',
      hens: '@manager @cows back to you',
      cows: '@manager done',
    });
    await r.chat.send('@manager start', []);
    expect(r.asked).toEqual(['manager<-you', 'hens<-manager', 'cows<-hens']);
    expect(r.asked.length).toBeLessThanOrEqual(AGENT_CHAT_MAX_REPLIES_PER_MESSAGE);
  });

  it('asks the user to pick someone when nobody is addressed', async () => {
    const r = room({});
    await r.chat.send('hello?', []);
    expect(r.lines()).toEqual(['you: hello?', 'system: Pick an agent, or @mention one (or @all).']);
  });

  it('turns a failed or empty reply into a visible system note, and clears typing', async () => {
    const r = room({ hens: new Error('boom'), cows: '   ' });
    await r.chat.send('@hens @cows hi', []);
    expect(r.lines().filter((l) => l.startsWith('system'))).toHaveLength(2);
    const typing = r.emitted.filter((m) => m.type === 'chatTyping');
    expect(typing.filter((m) => m.typing === true)).toHaveLength(2);
    expect(typing.filter((m) => m.typing === false)).toHaveLength(2);
  });
});
