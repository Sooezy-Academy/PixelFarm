import { useEffect, useRef } from 'react';

import { toCoins } from '../office/coins.js';
import {
  BRONZE_COIN_SPRITE,
  GOLD_COIN_SPRITE,
  SILVER_COIN_SPRITE,
} from '../office/sprites/coinSprites.js';
import { getCachedSprite } from '../office/sprites/spriteCache.js';
import type { SpriteData } from '../office/types.js';

const COIN_ICON_ZOOM = 2;
const COIN_ICON_SIZE_PX = 12 * COIN_ICON_ZOOM;

function CoinIcon({ sprite }: { sprite: SpriteData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, COIN_ICON_SIZE_PX, COIN_ICON_SIZE_PX);
    ctx.drawImage(getCachedSprite(sprite, COIN_ICON_ZOOM), 0, 0);
  }, [sprite]);

  return (
    <canvas
      ref={canvasRef}
      width={COIN_ICON_SIZE_PX}
      height={COIN_ICON_SIZE_PX}
      className="shrink-0"
    />
  );
}

interface CoinPanelProps {
  /** Account balance in bronze coins. */
  bronzeTotal: number;
}

/**
 * The account balance, bottom-right: what the collected produce has earned,
 * shown as gold, silver and bronze coins.
 */
export function CoinPanel({ bronzeTotal }: CoinPanelProps) {
  const { gold, silver, bronze } = toCoins(bronzeTotal);
  const rows: Array<[string, SpriteData, number]> = [
    ['Gold', GOLD_COIN_SPRITE, gold],
    ['Silver', SILVER_COIN_SPRITE, silver],
    ['Bronze', BRONZE_COIN_SPRITE, bronze],
  ];

  return (
    <div className="absolute bottom-10 right-80 z-20 pixel-panel py-4 px-8 min-w-128">
      <div className="text-accent-bright text-base pb-2 mb-2 border-b border-border">Coins</div>
      {rows.map(([label, sprite, count]) => (
        <div key={label} className="flex items-center gap-8 text-sm" title={`${label} coins`}>
          <CoinIcon sprite={sprite} />
          <span className="flex-1 text-text">{label}</span>
          <span className="text-text tabular-nums">{count}</span>
        </div>
      ))}
    </div>
  );
}
