import { useEffect, useRef } from 'react';

import { getCatalogEntry } from '../office/layout/furnitureCatalog.js';
import { getCachedSprite } from '../office/sprites/spriteCache.js';
import type { SpriteData } from '../office/types.js';

const ICON_ZOOM = 2;
const ICON_SIZE_PX = 16 * ICON_ZOOM;

interface InventoryPanelProps {
  /** The active theme's products, in display order (unique values of productsByArea). */
  products: string[];
  /** Product type → number collected (inventoryLoaded). */
  counts: Record<string, number>;
}

function ProductIcon({ sprite }: { sprite: SpriteData | undefined }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, ICON_SIZE_PX, ICON_SIZE_PX);
    if (sprite) ctx.drawImage(getCachedSprite(sprite, ICON_ZOOM), 0, 0);
  }, [sprite]);

  return <canvas ref={canvasRef} width={ICON_SIZE_PX} height={ICON_SIZE_PX} className="shrink-0" />;
}

/**
 * The produce tally (shown above the bottom toolbar): one row per product the
 * active theme offers, with how many agents have collected (one per finished
 * turn in that product's Area). Hidden for themes without products.
 */
export function InventoryPanel({ products, counts }: InventoryPanelProps) {
  if (products.length === 0) return null;

  return (
    <div className="pixel-panel py-4 px-8 min-w-160">
      <div className="text-accent-bright text-base pb-2 mb-2 border-b border-border">Inventory</div>
      {products.map((product) => {
        const entry = getCatalogEntry(product);
        return (
          <div key={product} className="flex items-center gap-8 text-sm" title={product}>
            <ProductIcon sprite={entry?.sprite} />
            <span className="flex-1 text-text">{entry?.label ?? product}</span>
            <span className="text-text tabular-nums">{counts[product] ?? 0}</span>
          </div>
        );
      })}
    </div>
  );
}
