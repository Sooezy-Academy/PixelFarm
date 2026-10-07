/**
 * Shared constants used across server, extension, and webview.
 * Only constants needed by core interfaces live here.
 * Server-specific timing constants stay in server/src/constants.ts.
 * Webview-specific rendering constants stay in webview-ui/src/constants.ts.
 * Provider-specific constants stay in their provider directory.
 */

// ── Hook API ─────────────────────────────────────────────────

export const HOOK_API_PREFIX = '/api/hooks';
export const SERVER_JSON_DIR = '.pixel-agents';
export const SERVER_JSON_NAME = 'server.json';
export const HOOK_SCRIPTS_DIR = '.pixel-agents/hooks';

// ── Display ──────────────────────────────────────────────────

export const BASH_COMMAND_DISPLAY_MAX_LENGTH = 30;
export const TASK_DESCRIPTION_DISPLAY_MAX_LENGTH = 40;

// ── Themes ───────────────────────────────────────────────────
// The built-in visual theme (the bundled assets with no theme pack over them).

export const DEFAULT_THEME = 'office';

// ── Crew simulation (server --simulate and the static demo) ──
/** Delay between simulated crew members arriving (the lead first). */
export const SIM_SPAWN_STAGGER_MS = 1500;
/** How long one simulated tool step runs (random in [min, min+range)). */
export const SIM_STEP_MIN_MS = 2500;
export const SIM_STEP_RANGE_MS = 3500;
/** Steps per simulated turn (random in [min, min+range]). */
export const SIM_STEPS_MIN = 2;
export const SIM_STEPS_RANGE = 2;
/** Idle pause between simulated turns (random in [min, min+range)). */
export const SIM_IDLE_MIN_MS = 4000;
export const SIM_IDLE_RANGE_MS = 8000;
/** Ids for simulated agents, far above anything a real session gets. */
export const SIM_FIRST_AGENT_ID = 900_000;

// ── Static demo (serverless build, e.g. Netlify) ─────────────
/** Build-time snapshot of the server handshake, written next to the built SPA. */
export const STATIC_DEMO_SNAPSHOT_FILE = 'demo-snapshot.json';

// ── AgentChat (LLM chat with agents, via Ollama Cloud) ────────
export const OLLAMA_CHAT_URL = 'https://ollama.com/api/chat';
/** Used when OLLAMA_MODEL isn't set. */
export const DEFAULT_OLLAMA_MODEL = 'gpt-oss:20b';
/** Longest chat message accepted from a user, and longest reply line kept. */
export const AGENT_CHAT_MAX_TEXT = 500;
/** Chat lines an agent sees as context (the room's most recent). */
export const AGENT_CHAT_HISTORY_LINES = 12;
/** Chat lines a client that connects later is shown. */
export const AGENT_CHAT_REPLAY_LINES = 50;
/** Upper bound on reply length (Ollama `num_predict`), reasoning tokens included. */
export const AGENT_CHAT_MAX_REPLY_TOKENS = 600;
/** Reasoning effort for models that think (gpt-oss): low keeps replies quick and non-empty. */
export const OLLAMA_THINK_LEVEL = 'low';
/** How many times work can be handed on in one exchange (user → lead → worker → worker). */
export const AGENT_CHAT_MAX_HANDOVERS = 2;
/** A reply that @mentions more teammates than this is a roll call, not a handover. */
export const AGENT_CHAT_MAX_HANDOVER_TARGETS = 2;
/** Agent replies one user message can trigger in total, handovers included. */
export const AGENT_CHAT_MAX_REPLIES_PER_MESSAGE = 8;
/** An agent's ACTION line is cut to this many characters (it becomes a status label). */
export const AGENT_CHAT_MAX_ACTION = 60;
/** The static demo's chat endpoint (a Netlify Function holding the key; see its config.path). */
export const STATIC_DEMO_CHAT_ENDPOINT = '/api/agent-chat';

// ── Transport ────────────────────────────────────────────────
// Connection-state names for the MessageTransport state machine.

export const TRANSPORT_STATE_CONNECTING = 'connecting';
export const TRANSPORT_STATE_CONNECTED = 'connected';
export const TRANSPORT_STATE_RECONNECTING = 'reconnecting';
export const TRANSPORT_STATE_DISCONNECTED = 'disconnected';
