/** Deterministic, seedable PRNG (mulberry32) so games can be replayed from a seed. */
export class Rng {
  private state: number;

  constructor(seed: number | string) {
    this.state = typeof seed === "number" ? seed >>> 0 : Rng.hashString(seed);
    if (this.state === 0) this.state = 0x9e3779b9;
  }

  static hashString(value: string): number {
    let hash = 2166136261 >>> 0;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
  }

  static randomSeed(): number {
    const globalCrypto = (globalThis as {
      crypto?: { getRandomValues?: (array: Uint32Array) => Uint32Array };
    }).crypto;
    if (globalCrypto?.getRandomValues) {
      const buffer = new Uint32Array(1);
      globalCrypto.getRandomValues(buffer);
      return buffer[0];
    }
    return Math.floor(Math.random() * 0xffffffff) >>> 0;
  }

  /** Float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [0, max). */
  int(max: number): number {
    return Math.floor(this.next() * max);
  }

  /** In-place Fisher-Yates shuffle. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = this.int(i + 1);
      const tmp = items[i];
      items[i] = items[j];
      items[j] = tmp;
    }
    return items;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }
}
