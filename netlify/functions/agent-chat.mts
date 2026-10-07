/**
 * AgentChat for the static (Netlify) demo. The page has no server, so this
 * function is the only place the Ollama key lives (the OLLAMA_API_KEY site
 * environment variable — never sent to the browser).
 *
 * It is deliberately NOT a general LLM proxy: the page sends structured farm
 * fields (who the agent is, its team, the recent lines, the message), every one
 * validated and size-capped, and the prompt is built here with the same
 * buildAgentPrompt the local server uses. Replies are token-capped, and
 * Netlify's edge rate-limits each visitor (`config.rateLimit` below).
 *
 *   GET  → { available, model }         (no LLM call; the page's chat status)
 *   POST → { reply }  for { agent, team, history, message }
 *
 * Kill switch: set AGENT_CHAT_DISABLED=1 in the site's environment.
 */
import type { ChatAgentProfile, ChatLine } from '../../core/src/agentChat.js';
import { buildAgentPrompt, ollamaChat } from '../../core/src/agentChat.js';
import {
  AGENT_CHAT_HISTORY_LINES,
  AGENT_CHAT_MAX_TEXT,
  DEFAULT_OLLAMA_MODEL,
} from '../../core/src/constants.js';

const MAX_TEAM = 12;
const MAX_ROLE = 120;
const MAX_ACTIVITY = 80;
const HANDLE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

function profile(raw: unknown): ChatAgentProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const role = text(p.role, MAX_ROLE);
  const activity = text(p.activity, MAX_ACTIVITY);
  if (
    typeof p.id !== 'number' ||
    !Number.isInteger(p.id) ||
    typeof p.handle !== 'string' ||
    !HANDLE.test(p.handle) ||
    !role ||
    !activity
  ) {
    return null;
  }
  return { id: p.id, handle: p.handle, role, activity, isLead: p.isLead === true };
}

function line(raw: unknown): ChatLine | null {
  if (!raw || typeof raw !== 'object') return null;
  const l = raw as Record<string, unknown>;
  const said = text(l.text, AGENT_CHAT_MAX_TEXT);
  return typeof l.from === 'string' && HANDLE.test(l.from) && said
    ? { from: l.from, text: said }
    : null;
}

export default async (req: Request): Promise<Response> => {
  const apiKey = process.env.OLLAMA_API_KEY;
  const model = process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
  const enabled = Boolean(apiKey) && process.env.AGENT_CHAT_DISABLED !== '1';

  if (req.method === 'GET')
    return json(200, { available: enabled, model: enabled ? model : undefined });
  if (req.method !== 'POST') return json(405, { error: 'method-not-allowed' });
  if (!enabled || !apiKey) return json(503, { error: 'chat-not-configured' });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json(400, { error: 'bad-json' });
  }
  const agent = profile(body.agent);
  const message = line(body.message);
  const team = Array.isArray(body.team)
    ? body.team
        .slice(0, MAX_TEAM)
        .map(profile)
        .filter((p): p is ChatAgentProfile => p !== null)
    : [];
  const history = Array.isArray(body.history)
    ? body.history
        .slice(-AGENT_CHAT_HISTORY_LINES)
        .map(line)
        .filter((l): l is ChatLine => l !== null)
    : [];
  if (!agent || !message) return json(400, { error: 'bad-request' });

  try {
    const reply = await ollamaChat(fetch, {
      apiKey,
      model,
      messages: buildAgentPrompt(agent, team, history, message),
    });
    return json(200, { reply });
  } catch (err) {
    console.error('[agent-chat] Ollama call failed:', err);
    return json(502, { error: 'llm-unavailable' });
  }
};

/**
 * Served at /api/agent-chat (STATIC_DEMO_CHAT_ENDPOINT). Netlify enforces the
 * rate limit at its edge — answering 429 — on every plan, per visitor IP.
 */
export const config = {
  path: '/api/agent-chat',
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
