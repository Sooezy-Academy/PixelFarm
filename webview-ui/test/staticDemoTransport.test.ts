/**
 * The static (serverless) demo transport plays the server's part in the page:
 * it replays the build-time snapshot, runs the crew simulation, and counts
 * collected products once per finished turn (like the server's inventory).
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { afterEach, beforeEach, test, vi } from 'vitest';

import {
  SIM_FIRST_AGENT_ID,
  SIM_SPAWN_STAGGER_MS,
  STATIC_DEMO_CHAT_ENDPOINT,
} from '../../core/src/constants.js';
import { StaticDemoTransport } from '../src/transport/staticDemoTransport.js';

const SNAPSHOT = {
  theme: 'farm',
  crew: { teamName: 'farm-team', leadName: 'manager', members: ['hens'], chores: {} },
  messages: [
    { type: 'settingsLoaded' },
    { type: 'themeLoaded', productsByArea: { 'Hen house': 'EGG_BASKET' } },
    { type: 'layoutLoaded', layout: null },
  ],
};

let received: Array<Record<string, unknown>>;
let transport: StaticDemoTransport;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => SNAPSHOT })),
  );
  received = [];
  transport = new StaticDemoTransport('./');
  transport.onMessage((m) => received.push(m as unknown as Record<string, unknown>));
});

afterEach(() => {
  transport.dispose();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Send webviewReady and let the snapshot fetch resolve. */
async function connect(): Promise<void> {
  transport.send({ type: 'webviewReady' } as never);
  await vi.advanceTimersByTimeAsync(0);
}

test('replays the snapshot in order, with the inventory right after the theme', async () => {
  await connect();
  assert.deepEqual(
    received.slice(0, 4).map((m) => m.type),
    ['settingsLoaded', 'themeLoaded', 'inventoryLoaded', 'layoutLoaded'],
  );
});

test('brings the crew in: agents created and linked as a team', async () => {
  await connect();
  await vi.advanceTimersByTimeAsync(SIM_SPAWN_STAGGER_MS);
  const created = received.filter((m) => m.type === 'agentCreated').map((m) => m.id);
  assert.deepEqual(created, [SIM_FIRST_AGENT_ID, SIM_FIRST_AGENT_ID + 1]);
  const lead = received.find((m) => m.type === 'agentTeamInfo' && m.id === SIM_FIRST_AGENT_ID);
  assert.equal(lead?.isTeamLead, true);
});

test('counts a product once per finished turn, and only the theme’s products', async () => {
  await connect();
  const hens = SIM_FIRST_AGENT_ID + 1;
  // Turn lengths are random: wait until the worker's latest status is a finished turn.
  const lastStatus = () =>
    received.filter((m) => m.type === 'agentStatus' && m.id === hens).at(-1)?.status;
  for (let i = 0; i < 400 && lastStatus() !== 'waiting'; i++) {
    await vi.advanceTimersByTimeAsync(250);
  }
  assert.equal(lastStatus(), 'waiting', 'a turn finished');
  const tally = () =>
    received.filter((m) => m.type === 'inventoryLoaded').at(-1)?.counts as Record<string, number>;

  transport.send({ type: 'collectProduct', id: hens, product: 'GOLD_BAR' } as never);
  transport.send({ type: 'collectProduct', id: hens, product: 'EGG_BASKET' } as never);
  transport.send({ type: 'collectProduct', id: hens, product: 'EGG_BASKET' } as never);

  assert.equal(tally().GOLD_BAR, undefined, 'not a product of this theme');
  assert.equal(tally().EGG_BASKET, 1, 'one finished turn counts once');
});

test('logs and stops when the snapshot is missing', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
  );
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  await connect();
  assert.equal(received.length, 0);
  assert.equal(error.mock.calls.length, 1);
  error.mockRestore();
});

/** fetch for the static site: the snapshot, plus the chat function (or none). */
function stubSite(chat: 'online' | 'offline') {
  const posts: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (!url.endsWith(STATIC_DEMO_CHAT_ENDPOINT)) {
        return { ok: true, status: 200, json: async () => SNAPSHOT };
      }
      if (chat === 'offline') return { ok: false, status: 404, json: async () => ({}) };
      if (init?.method === 'POST') {
        posts.push(JSON.parse(init.body as string) as Record<string, unknown>);
        return {
          ok: true,
          status: 200,
          json: async () => ({ reply: 'Cluck! ACTION: Feeding the hens' }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ available: true, model: 'gpt-oss:20b' }),
      };
    }),
  );
  return posts;
}

test('chat stays offline (with a reason) when the site has no chat function', async () => {
  stubSite('offline');
  await connect();
  await vi.advanceTimersByTimeAsync(0);
  const status = received.find((m) => m.type === 'chatStatus');
  assert.equal(status?.available, false);
  assert.ok(typeof status?.reason === 'string');
});

test('chats through the site function with structured fields, never a raw prompt', async () => {
  const posts = stubSite('online');
  await connect();
  await vi.advanceTimersByTimeAsync(2 * SIM_SPAWN_STAGGER_MS);
  assert.equal(received.find((m) => m.type === 'chatStatus')?.available, true);

  transport.send({ type: 'chatSend', toAgentIds: [], text: '@hens hungry?' } as never);
  await vi.advanceTimersByTimeAsync(0);

  assert.equal(posts.length, 1);
  assert.deepEqual(Object.keys(posts[0]).sort(), ['agent', 'history', 'message', 'team']);
  assert.equal((posts[0].agent as { handle: string }).handle, 'hens');
  const lines = received
    .filter((m) => m.type === 'chatMessage')
    .map((m) => `${String(m.fromName)}: ${String(m.text)}`);
  assert.deepEqual(lines, ['you: @hens hungry?', 'hens: Cluck!']);
});
