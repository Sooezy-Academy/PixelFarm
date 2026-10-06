/** Bronze per silver, and silver per gold. */
const COINS_PER_NEXT_METAL = 100;

/** Split a balance in bronze into gold / silver / bronze coins (100 : 1 each step). */
export function toCoins(bronzeTotal: number): { gold: number; silver: number; bronze: number } {
  const total = Math.max(0, Math.floor(bronzeTotal));
  return {
    gold: Math.floor(total / (COINS_PER_NEXT_METAL * COINS_PER_NEXT_METAL)),
    silver: Math.floor(total / COINS_PER_NEXT_METAL) % COINS_PER_NEXT_METAL,
    bronze: total % COINS_PER_NEXT_METAL,
  };
}
