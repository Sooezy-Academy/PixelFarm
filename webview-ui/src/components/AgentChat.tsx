import { useEffect, useMemo, useRef, useState } from 'react';

import { chatHandles } from '../../../core/src/agentChat.js';
import { CHAT_AVATAR_ZOOM, CHAT_ROSTER_REFRESH_MS } from '../constants.js';
import type { ChatLogLine, ChatStatusInfo } from '../hooks/useExtensionMessages.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { getCachedSprite } from '../office/sprites/spriteCache.js';
import { getCharacterSprites } from '../office/sprites/spriteData.js';
import { Direction } from '../office/types.js';
import { transport } from '../transport/index.js';

/** Side of the square head crop taken from a character sprite. */
const AVATAR_CROP_PX = 16;
const AVATAR_SIZE_PX = AVATAR_CROP_PX * CHAT_AVATAR_ZOOM;
const ALL_HANDLE = 'all';

interface RosterEntry {
  id: number;
  handle: string;
  palette: number;
  hueShift: number;
}

/** The agents you can talk to: every character except sub-agents (negative ids). */
function readRoster(os: OfficeState): RosterEntry[] {
  const chars = [...os.characters.values()].filter((ch) => ch.id > 0);
  const handles = chatHandles(chars);
  return chars.map((ch) => ({
    id: ch.id,
    handle: handles.get(ch.id) ?? `agent-${ch.id.toString()}`,
    palette: ch.palette,
    hueShift: ch.hueShift,
  }));
}

/** An agent's face: the top of its standing sprite, cropped from the first visible row. */
function Avatar({ palette, hueShift }: { palette: number; hueShift: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const sprite = getCharacterSprites(palette, hueShift).walk[Direction.DOWN][1];
    const top = Math.max(
      0,
      sprite.findIndex((row) => row.some((px) => px !== '')),
    );
    const cached = getCachedSprite(sprite, CHAT_AVATAR_ZOOM);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, AVATAR_SIZE_PX, AVATAR_SIZE_PX);
    ctx.drawImage(
      cached,
      0,
      top * CHAT_AVATAR_ZOOM,
      AVATAR_SIZE_PX,
      AVATAR_SIZE_PX,
      0,
      0,
      AVATAR_SIZE_PX,
      AVATAR_SIZE_PX,
    );
  }, [palette, hueShift]);

  return <canvas ref={canvasRef} width={AVATAR_SIZE_PX} height={AVATAR_SIZE_PX} />;
}

interface AgentButtonProps {
  entry: RosterEntry;
  selected: boolean;
  typing: boolean;
  onToggle: () => void;
}

function AgentButton({ entry, selected, typing, onToggle }: AgentButtonProps) {
  return (
    <button
      onClick={onToggle}
      title={`@${entry.handle}${selected ? ' (selected)' : ''}`}
      className={`relative p-0 shrink-0 rounded-none cursor-pointer border-2 bg-bg ${
        selected ? 'border-accent' : 'border-border'
      }`}
      style={{ width: AVATAR_SIZE_PX + 4, height: AVATAR_SIZE_PX + 4 }}
    >
      <Avatar palette={entry.palette} hueShift={entry.hueShift} />
      {typing && (
        <span className="absolute -top-8 left-1/2 -translate-x-1/2 text-2xs text-accent-bright">
          ...
        </span>
      )}
    </button>
  );
}

interface AgentChatProps {
  getOfficeState: () => OfficeState;
  /** Agent ids, so the roster refreshes as agents come and go. */
  agentIds: number[];
  status: ChatStatusInfo;
  log: ChatLogLine[];
  typing: number[];
}

/**
 * AgentChat, bottom-center: talk to the agents. Pick them with the face
 * buttons on either side, or @mention them (@all for everyone); each answers
 * in character, and one that takes a task on starts working on it.
 */
export function AgentChat({ getOfficeState, agentIds, status, log, typing }: AgentChatProps) {
  const [open, setOpen] = useState(true);
  const [text, setText] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [rosterTick, setRosterTick] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);

  // Names and team roles land on characters imperatively; refresh now and then.
  useEffect(() => {
    const timer = setInterval(() => setRosterTick((t) => t + 1), CHAT_ROSTER_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const roster = useMemo(() => readRoster(getOfficeState()), [agentIds, rosterTick]);
  const handleOf = useMemo(() => new Map(roster.map((r) => [r.id, r.handle])), [roster]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log, open]);

  const mention = /@([a-z0-9_-]*)$/i.exec(text);
  const suggestions = mention
    ? [ALL_HANDLE, ...roster.map((r) => r.handle)].filter((h) =>
        h.startsWith(mention[1].toLowerCase()),
      )
    : [];

  const toggle = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const send = () => {
    const clean = text.trim();
    if (!clean || !status.available) return;
    transport.send({ type: 'chatSend', toAgentIds: selected, text: clean });
    setText('');
  };

  const complete = (handle: string) => setText(text.replace(/@([a-z0-9_-]*)$/i, `@${handle} `));

  const half = Math.ceil(roster.length / 2);
  const button = (entry: RosterEntry) => (
    <AgentButton
      key={entry.id}
      entry={entry}
      selected={selected.includes(entry.id)}
      typing={typing.includes(entry.id)}
      onToggle={() => toggle(entry.id)}
    />
  );
  const names = (ids: number[]) => ids.map((id) => `@${handleOf.get(id) ?? id}`).join(', ');

  return (
    <div
      className="absolute bottom-10 left-1/2 -translate-x-1/2 z-20 pixel-panel p-4 flex flex-col gap-4"
      style={{ width: 'min(560px, max(300px, calc(100vw - 460px)))' }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between w-full bg-transparent border-none rounded-none cursor-pointer px-4 text-left"
      >
        <span className="text-accent-bright text-base">AgentChat</span>
        <span className="text-2xs text-text-muted">
          {status.available ? (status.model ?? '') : 'offline'} {open ? '▾' : '▴'}
        </span>
      </button>

      {open && (
        <>
          <div
            ref={logRef}
            className="flex flex-col gap-2 overflow-y-auto px-4 text-xs border-y-2 border-border"
            style={{ height: 140 }}
          >
            {!status.available && (
              <div className="italic text-text-muted py-2">
                {status.reason ?? 'Chat is not available here.'}
              </div>
            )}
            {status.available && log.length === 0 && (
              <div className="italic text-text-muted py-2">
                Pick agents with the faces, or type @name (or @all), and say hello.
              </div>
            )}
            {log.map((line) => (
              <div key={line.messageId} className="py-1">
                {line.fromName === 'system' ? (
                  <span className="italic text-text-muted">{line.text}</span>
                ) : line.fromAgentId === undefined ? (
                  <>
                    <span className="text-text-muted">
                      you{line.toAgentIds.length > 0 ? ` → ${names(line.toAgentIds)}` : ''}:{' '}
                    </span>
                    <span className="text-text">{line.text}</span>
                  </>
                ) : (
                  <>
                    <span className="text-accent-bright">@{line.fromName}</span>
                    {line.toAgentIds.length > 0 && (
                      <span className="text-text-muted"> → {names(line.toAgentIds)}</span>
                    )}
                    <span className="text-text-muted">: </span>
                    <span className="text-text">{line.text}</span>
                  </>
                )}
              </div>
            ))}
            {typing.length > 0 && (
              <div className="italic text-text-muted py-1">{names(typing)} typing...</div>
            )}
          </div>

          <div className="flex items-center gap-4">
            <div className="flex gap-2 flex-wrap">{roster.slice(0, half).map(button)}</div>
            <div className="relative flex-1 min-w-0 flex gap-2">
              {suggestions.length > 0 && (
                <div className="absolute bottom-full left-0 mb-2 pixel-panel flex flex-col z-30">
                  {suggestions.slice(0, 8).map((h) => (
                    <button
                      key={h}
                      onClick={() => complete(h)}
                      className="text-left text-xs px-6 py-2 bg-transparent border-none rounded-none cursor-pointer text-text hover:bg-btn-bg"
                    >
                      @{h}
                    </button>
                  ))}
                </div>
              )}
              <input
                value={text}
                disabled={!status.available}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (suggestions.length > 0 && mention && mention[1] !== suggestions[0]) {
                      complete(suggestions[0]);
                    } else {
                      send();
                    }
                  }
                  // Keep office shortcuts (R, T, Esc, Ctrl+Z) out of the chat box.
                  e.stopPropagation();
                }}
                placeholder={
                  selected.length > 0 ? `To ${names(selected)}...` : 'Message @name or @all...'
                }
                className="flex-1 min-w-0 text-xs py-2 px-4 bg-bg border-2 border-border rounded-none text-text"
              />
              <button
                onClick={() => setText((t) => (t.includes('@all') ? t : `@all ${t}`))}
                disabled={!status.available}
                title="Talk to everyone"
                className="text-xs px-4 bg-btn-bg border-2 border-border rounded-none cursor-pointer text-text"
              >
                @all
              </button>
            </div>
            <div className="flex gap-2 flex-wrap">{roster.slice(half).map(button)}</div>
          </div>
        </>
      )}
    </div>
  );
}
