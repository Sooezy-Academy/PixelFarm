import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StateAdapter } from '../../core/src/adapter.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { SIM_FIRST_AGENT_ID, SIM_SPAWN_STAGGER_MS } from '../src/constants.js';
import { FarmSimulator } from '../src/farmSimulator.js';

const CREW = {
  teamName: 'farm-team',
  leadName: 'manager',
  members: ['hens', 'cows'],
  chores: { manager: ['Planning the day'], hens: ['Collecting eggs'], cows: ['Milking the cows'] },
};

describe('FarmSimulator', () => {
  let store: AgentStateStore;
  let broadcasts: Array<Record<string, unknown>>;
  let sim: FarmSimulator;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new AgentStateStore();
    broadcasts = [];
    store.on('broadcast', (m) => broadcasts.push(m));
    // random() = 0 → every range takes its minimum: deterministic timing.
    sim = new FarmSimulator(store, CREW, () => 0);
  });

  afterEach(() => {
    sim.stop();
    store.dispose();
    vi.useRealTimers();
  });

  it('brings in the lead first, then each member one by one, linked as a team', () => {
    sim.start();
    vi.advanceTimersByTime(0);
    expect([...store.keys()]).toEqual([SIM_FIRST_AGENT_ID]);

    vi.advanceTimersByTime(2 * SIM_SPAWN_STAGGER_MS);
    expect([...store.keys()]).toEqual([
      SIM_FIRST_AGENT_ID,
      SIM_FIRST_AGENT_ID + 1,
      SIM_FIRST_AGENT_ID + 2,
    ]);

    const teamInfo = broadcasts.filter((m) => m.type === 'agentTeamInfo');
    expect(teamInfo.map((m) => [m.agentName, m.isTeamLead ?? false, m.leadAgentId])).toEqual([
      ['manager', true, undefined],
      ['hens', false, SIM_FIRST_AGENT_ID],
      ['cows', false, SIM_FIRST_AGENT_ID],
    ]);
    // Created as plain agents (own palette), linked afterwards.
    expect(store.get(SIM_FIRST_AGENT_ID + 1)?.palette).toBeDefined();
  });

  it('plays turns: active, chore steps, then a finished turn that drops a product', () => {
    sim.start();
    vi.advanceTimersByTime(60_000);

    const hens = SIM_FIRST_AGENT_ID + 1;
    const mine = broadcasts.filter((m) => m.id === hens).map((m) => m.type);
    const firstTurn = mine.slice(mine.indexOf('agentStatus'), mine.indexOf('agentToolsClear') + 2);
    expect(firstTurn[0]).toBe('agentStatus');
    expect(firstTurn).toContain('agentToolStart');
    expect(firstTurn).toContain('agentToolDone');
    expect(firstTurn.at(-1)).toBe('agentStatus');

    const statuses = broadcasts.filter((m) => m.id === hens && m.type === 'agentStatus');
    expect(statuses[0]).toMatchObject({ status: 'active' });
    expect(statuses[1]).toMatchObject({ status: 'waiting', awaitingInput: false });

    const tool = broadcasts.find((m) => m.id === hens && m.type === 'agentToolStart');
    expect(tool).toMatchObject({ status: 'Collecting eggs', toolName: 'Write' });
    const plan = broadcasts.find((m) => m.id === SIM_FIRST_AGENT_ID && m.type === 'agentToolStart');
    expect(plan).toMatchObject({ status: 'Planning the day', toolName: 'Read' });
  });

  it('stop removes every simulated agent and plays nothing more', () => {
    sim.start();
    vi.advanceTimersByTime(10_000);
    sim.stop();
    expect(store.size).toBe(0);
    const count = broadcasts.length;
    vi.advanceTimersByTime(60_000);
    expect(broadcasts.length).toBe(count);
  });

  it('never persists simulated agents', () => {
    const saved: unknown[] = [];
    store.setAdapter({
      saveAgents: (agents: unknown[]) => saved.push(...agents),
    } as unknown as StateAdapter);
    sim.start();
    vi.advanceTimersByTime(10_000);
    store.persist();
    expect(saved).toEqual([]);
  });
});
