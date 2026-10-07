import type { SimulatedAgent, SimulatedCrew } from '../../core/src/crewSimulation.js';
import { CrewSimulation } from '../../core/src/crewSimulation.js';
import type { AgentStateStore } from './agentStateStore.js';
import { DEFAULT_MAX_CONTEXT_TOKENS } from './constants.js';
import { assignPaletteIfNeeded } from './paletteAssigner.js';
import type { AgentState } from './types.js';

export type { SimulatedCrew } from '../../core/src/crewSimulation.js';

const SIM_FOLDER_NAME = 'farm';

/**
 * The server's host for a CrewSimulation (`--simulate`): each simulated agent
 * is a real AgentState in the store, and every simulation message is mirrored
 * onto it (team fields, live tools, waiting) before being broadcast — so a
 * client connecting mid-demo gets the same replay a real agent would give.
 * The webview can't tell the difference.
 */
export class FarmSimulator {
  private readonly ids: number[] = [];
  private readonly simulation: CrewSimulation;

  constructor(
    private readonly store: AgentStateStore,
    crew: SimulatedCrew,
    random: () => number = Math.random,
  ) {
    this.simulation = new CrewSimulation(
      crew,
      {
        spawn: (agent) => this.spawn(agent),
        message: (message) => this.apply(message),
      },
      random,
    );
  }

  start(): void {
    this.simulation.start();
  }

  /** Have a simulated agent work on `status` next (it agreed to it in chat). */
  assignChore(id: number, status: string): boolean {
    return this.simulation.assignChore(id, status);
  }

  stop(): void {
    this.simulation.stop();
    for (const id of this.ids) this.store.delete(id);
    this.ids.length = 0;
  }

  private spawn({ id, name }: SimulatedAgent): void {
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
      // Suppresses the heuristic permission/idle timers: the simulation says when turns end.
      hookDelivered: true,
      contextTokens: 0,
      maxContextTokens: DEFAULT_MAX_CONTEXT_TOKENS,
      simulated: true,
    };
    // Created as a plain agent so it gets its own look (teammates would copy the
    // lead's palette); the simulation's agentTeamInfo links it to the team next.
    assignPaletteIfNeeded(agent, this.store);
    this.store.set(id, agent);
    this.ids.push(id);
  }

  /** Mirror a simulation message onto the agent's state, then broadcast it. */
  private apply(message: Record<string, unknown>): void {
    const agent = typeof message.id === 'number' ? this.store.get(message.id) : undefined;
    if (!agent) return;
    const toolId = message.toolId as string;
    switch (message.type) {
      case 'agentTeamInfo':
        agent.teamName = message.teamName as string;
        agent.agentName = message.agentName as string;
        agent.isTeamLead = message.isTeamLead === true;
        agent.leadAgentId = message.leadAgentId as number | undefined;
        break;
      case 'agentStatus':
        agent.isWaiting = message.status === 'waiting';
        break;
      case 'agentToolStart':
        agent.activeToolIds.add(toolId);
        agent.activeToolStatuses.set(toolId, message.status as string);
        agent.activeToolNames.set(toolId, message.toolName as string);
        break;
      case 'agentToolDone':
        agent.activeToolIds.delete(toolId);
        agent.activeToolStatuses.delete(toolId);
        agent.activeToolNames.delete(toolId);
        break;
    }
    this.store.broadcast(message);
  }
}
