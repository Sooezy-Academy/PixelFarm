import {
  SIM_FIRST_AGENT_ID,
  SIM_IDLE_MIN_MS,
  SIM_IDLE_RANGE_MS,
  SIM_SPAWN_STAGGER_MS,
  SIM_STEP_MIN_MS,
  SIM_STEP_RANGE_MS,
  SIM_STEPS_MIN,
  SIM_STEPS_RANGE,
} from './constants.js';

/** Who a simulation plays: a lead and named members, each with chore lines. */
export interface SimulatedCrew {
  teamName: string;
  leadName: string;
  /** Member names; a theme seats each by name (themeLoaded.roleAreas). */
  members: string[];
  /** Name (lead included) → status lines it cycles through. */
  chores: Record<string, string[]>;
}

/** One simulated agent: the lead has no `leadAgentId`. */
export interface SimulatedAgent {
  id: number;
  name: string;
  leadAgentId?: number;
}

/**
 * What a host does with the simulation. `spawn` creates the agent the way the
 * host creates any agent (the server: an AgentState in its store; the static
 * demo: an `agentCreated`), then `message` carries every ServerMessage about it
 * — `agentTeamInfo`, `agentStatus`, `agentToolStart`/`Done`, `agentToolsClear`.
 */
export interface CrewSimulationHost {
  spawn(agent: SimulatedAgent): void;
  message(message: Record<string, unknown>): void;
}

/** Chores read as "reading" (inspecting) rather than "typing" (working) animations. */
const READING_CHORE = /^(Checking|Counting|Inspecting|Reading|Reviewing|Planning)\b/;
const FALLBACK_CHORES = ['Working', 'Checking the work'];

/**
 * Plays a team of agents with no real sessions behind them: the lead and its
 * members arrive one by one, then each loops through turns — active, a few
 * chore steps, a finished turn (so themes drop products and the inventory
 * counts them), an idle pause. It only decides WHAT happens WHEN; the host
 * turns that into agents and broadcasts. Shared by the server's `--simulate`
 * mode and the static (serverless) demo build.
 */
export class CrewSimulation {
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private stepSeq = 0;
  private running = false;

  private readonly crew: SimulatedCrew;
  private readonly host: CrewSimulationHost;
  private readonly random: () => number;

  constructor(crew: SimulatedCrew, host: CrewSimulationHost, random: () => number = Math.random) {
    this.crew = crew;
    this.host = host;
    this.random = random;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const leadId = SIM_FIRST_AGENT_ID;
    [this.crew.leadName, ...this.crew.members].forEach((name, i) => {
      this.later(i * SIM_SPAWN_STAGGER_MS, () => {
        const id = leadId + i;
        const leadAgentId = i === 0 ? undefined : leadId;
        this.host.spawn({ id, name, leadAgentId });
        this.host.message({
          type: 'agentTeamInfo',
          id,
          teamName: this.crew.teamName,
          agentName: name,
          isTeamLead: leadAgentId === undefined || undefined,
          leadAgentId,
        });
        this.later(SIM_SPAWN_STAGGER_MS, () => this.startTurn(id, name));
      });
    });
  }

  stop(): void {
    this.running = false;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
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

  private startTurn(id: number, name: string): void {
    this.host.message({ type: 'agentStatus', id, status: 'active' });
    this.step(id, name, this.between(SIM_STEPS_MIN, SIM_STEPS_RANGE + 1));
  }

  private step(id: number, name: string, remaining: number): void {
    if (remaining === 0) {
      this.endTurn(id, name);
      return;
    }
    const chores = this.crew.chores[name] ?? FALLBACK_CHORES;
    const status = chores[Math.floor(this.random() * chores.length)];
    const toolName = READING_CHORE.test(status) ? 'Read' : 'Write';
    const toolId = `sim-${id}-${++this.stepSeq}`;
    this.host.message({ type: 'agentToolStart', id, toolId, status, toolName });
    this.later(this.between(SIM_STEP_MIN_MS, SIM_STEP_RANGE_MS), () => {
      this.host.message({ type: 'agentToolDone', id, toolId });
      this.step(id, name, remaining - 1);
    });
  }

  private endTurn(id: number, name: string): void {
    this.host.message({ type: 'agentToolsClear', id });
    // A finished turn ("Done"), so the theme drops this member's product.
    this.host.message({ type: 'agentStatus', id, status: 'waiting', awaitingInput: false });
    this.later(this.between(SIM_IDLE_MIN_MS, SIM_IDLE_RANGE_MS), () => this.startTurn(id, name));
  }
}
