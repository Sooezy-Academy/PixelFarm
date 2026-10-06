import type { AgentStateStore } from './agentStateStore.js';
import {
  DEFAULT_MAX_CONTEXT_TOKENS,
  SIM_FIRST_AGENT_ID,
  SIM_IDLE_MIN_MS,
  SIM_IDLE_RANGE_MS,
  SIM_SPAWN_STAGGER_MS,
  SIM_STEP_MIN_MS,
  SIM_STEP_RANGE_MS,
  SIM_STEPS_MIN,
  SIM_STEPS_RANGE,
} from './constants.js';
import { assignPaletteIfNeeded } from './paletteAssigner.js';
import type { AgentState } from './types.js';

/** Who the simulator plays: a lead and named members, each with chore lines. */
export interface SimulatedCrew {
  teamName: string;
  leadName: string;
  /** Member names; a theme seats each by name (themeLoaded.roleAreas). */
  members: string[];
  /** Name (lead included) → status lines it cycles through. */
  chores: Record<string, string[]>;
}

/** Chores read as "reading" (inspecting) rather than "typing" (working) animations. */
const READING_CHORE = /^(Checking|Counting|Inspecting|Reading|Reviewing|Planning)\b/;
const FALLBACK_CHORES = ['Working', 'Checking the work'];
const SIM_FOLDER_NAME = 'farm';

/**
 * Plays a team of agents without any real sessions, for demos: the lead and
 * its members arrive one by one, then each loops through turns of chores —
 * active, a few tool steps, a finished turn (so themes drop products and the
 * inventory counts them), an idle pause — through exactly the store mutations
 * and broadcasts real agents produce. The webview can't tell the difference.
 */
export class FarmSimulator {
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly ids: number[] = [];
  private stepSeq = 0;
  private running = false;

  constructor(
    private readonly store: AgentStateStore,
    private readonly crew: SimulatedCrew,
    private readonly random: () => number = Math.random,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    const leadId = SIM_FIRST_AGENT_ID;
    const names = [this.crew.leadName, ...this.crew.members];
    names.forEach((name, i) => {
      this.later(i * SIM_SPAWN_STAGGER_MS, () => {
        const id = leadId + i;
        this.spawn(id, name, i === 0 ? undefined : leadId);
        this.later(SIM_SPAWN_STAGGER_MS, () => this.startTurn(id, name));
      });
    });
  }

  stop(): void {
    this.running = false;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    for (const id of this.ids) this.store.delete(id);
    this.ids.length = 0;
  }

  private later(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (this.running) fn();
    }, ms);
    this.timers.add(t);
  }

  private between(min: number, range: number): number {
    return min + Math.floor(this.random() * range);
  }

  private spawn(id: number, name: string, leadAgentId: number | undefined): void {
    const agent: AgentState = {
      id,
      sessionId: `simulated-${name}`,
      terminalRef: undefined,
      isExternal: true,
      projectDir: '',
      jsonlFile: '',
      fileOffset: 0,
      lineBuffer: '',
      activeToolIds: new Set(),
      activeToolStatuses: new Map(),
      activeToolNames: new Map(),
      activeSubagentToolIds: new Map(),
      activeSubagentToolNames: new Map(),
      backgroundAgentToolIds: new Set(),
      isWaiting: false,
      permissionSent: false,
      hadToolsInTurn: false,
      lastDataAt: Date.now(),
      linesProcessed: 0,
      seenUnknownRecordTypes: new Set(),
      folderName: SIM_FOLDER_NAME,
      // Suppresses the heuristic permission/idle timers: the simulator says when turns end.
      hookDelivered: true,
      contextTokens: 0,
      maxContextTokens: DEFAULT_MAX_CONTEXT_TOKENS,
      simulated: true,
    };
    // Created as a plain agent so it gets its own look (teammates would copy the
    // lead's palette), then linked to the team below.
    assignPaletteIfNeeded(agent, this.store);
    this.store.set(id, agent);
    this.ids.push(id);

    agent.teamName = this.crew.teamName;
    agent.agentName = name;
    agent.isTeamLead = leadAgentId === undefined;
    agent.leadAgentId = leadAgentId;
    this.store.broadcast({
      type: 'agentTeamInfo',
      id,
      teamName: agent.teamName,
      agentName: name,
      isTeamLead: agent.isTeamLead || undefined,
      leadAgentId,
    });
  }

  private startTurn(id: number, name: string): void {
    const agent = this.store.get(id);
    if (!agent) return;
    agent.isWaiting = false;
    this.store.broadcast({ type: 'agentStatus', id, status: 'active' });
    this.step(id, name, this.between(SIM_STEPS_MIN, SIM_STEPS_RANGE + 1));
  }

  private step(id: number, name: string, remaining: number): void {
    const agent = this.store.get(id);
    if (!agent) return;
    if (remaining === 0) {
      this.endTurn(id, name);
      return;
    }
    const chores = this.crew.chores[name] ?? FALLBACK_CHORES;
    const status = chores[Math.floor(this.random() * chores.length)];
    const toolName = READING_CHORE.test(status) ? 'Read' : 'Write';
    const toolId = `sim-${id}-${++this.stepSeq}`;
    agent.activeToolIds.add(toolId);
    agent.activeToolStatuses.set(toolId, status);
    agent.activeToolNames.set(toolId, toolName);
    this.store.broadcast({ type: 'agentToolStart', id, toolId, status, toolName });

    this.later(this.between(SIM_STEP_MIN_MS, SIM_STEP_RANGE_MS), () => {
      agent.activeToolIds.delete(toolId);
      agent.activeToolStatuses.delete(toolId);
      agent.activeToolNames.delete(toolId);
      this.store.broadcast({ type: 'agentToolDone', id, toolId });
      this.step(id, name, remaining - 1);
    });
  }

  private endTurn(id: number, name: string): void {
    const agent = this.store.get(id);
    if (!agent) return;
    agent.isWaiting = true;
    this.store.broadcast({ type: 'agentToolsClear', id });
    // A finished turn ("Done"), so the theme drops this member's product.
    this.store.broadcast({ type: 'agentStatus', id, status: 'waiting', awaitingInput: false });
    this.later(this.between(SIM_IDLE_MIN_MS, SIM_IDLE_RANGE_MS), () => this.startTurn(id, name));
  }
}
