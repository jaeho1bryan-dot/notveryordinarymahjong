/**
 * Minimal browser stand-in for node's `assert`, used by the `riichi` scoring
 * library (it only calls `assert.deepStrictEqual`).
 */

class AssertionError extends Error {}

const isEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => isEqual(left[key], right[key]));
};

function ok(value: unknown, message?: string): void {
  if (!value) throw new AssertionError(message ?? "assertion failed");
}

function deepStrictEqual(actual: unknown, expected: unknown, message?: string): void {
  if (!isEqual(actual, expected)) throw new AssertionError(message ?? "values are not deeply equal");
}

const assert = Object.assign(ok, {
  ok,
  equal: (a: unknown, b: unknown, message?: string) => ok(a === b, message),
  strictEqual: (a: unknown, b: unknown, message?: string) => ok(a === b, message),
  notStrictEqual: (a: unknown, b: unknown, message?: string) => ok(a !== b, message),
  deepEqual: deepStrictEqual,
  deepStrictEqual,
  AssertionError,
});

export { ok, deepStrictEqual, AssertionError };
export default assert;
