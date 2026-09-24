// Deterministic random utilities shared by main thread and workers.

/** Mulberry32 PRNG — returns a function producing floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer avalanche hash (lowbias32). */
export function hash32(x) {
  x = x >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

export function hash2i(x, y, seed = 0) {
  return hash32((x | 0) ^ hash32((y | 0) ^ hash32(seed | 0)));
}

export function hash3i(x, y, z, seed = 0) {
  return hash32((x | 0) ^ hash32((y | 0) ^ hash32((z | 0) ^ hash32(seed | 0))));
}

/** Hash of 2 ints mapped to [0, 1). */
export function rand2(x, y, seed = 0) {
  return hash2i(x, y, seed) / 4294967296;
}

export function rand3(x, y, z, seed = 0) {
  return hash3i(x, y, z, seed) / 4294967296;
}

/** Converts an arbitrary string to a 32-bit seed. */
export function seedFromString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return hash32(h);
}
