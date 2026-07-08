import { describe, expect, it } from "vitest";
import { applyAcceleration } from "./gestures";

describe("applyAcceleration", () => {
  it("scales a slow movement by roughly the base sensitivity", () => {
    // magnitude = 3, well under the acceleration divisor (40): small bonus
    // (7.5%), so this should stay close to sensitivity * dx (2 * 3 = 6).
    const { x, y } = applyAcceleration(3, 0, 2);
    expect(x).toBeCloseTo(6.45, 5);
    expect(y).toBeCloseTo(0, 5);
  });

  it("applies a bigger multiplier for a fast movement", () => {
    const slow = applyAcceleration(3, 0, 2);
    const fast = applyAcceleration(80, 0, 2);
    // Same direction, but the fast move's per-unit multiplier is larger.
    expect(fast.x / 80).toBeGreaterThan(slow.x / 3);
  });

  it("saturates the acceleration bonus for very fast movements", () => {
    // magnitude = 400, far beyond ACCEL_SPEED_DIVISOR * ACCEL_MAX_BONUS (60):
    // the bonus multiplier caps at 1.5, so the per-unit ratio should match
    // sensitivity * (1 + 1.5) regardless of how much faster it gets.
    const atCap = applyAcceleration(400, 0, 2);
    const beyondCap = applyAcceleration(4000, 0, 2);
    expect(atCap.x / 400).toBeCloseTo(beyondCap.x / 4000, 5);
    expect(atCap.x / 400).toBeCloseTo(2 * (1 + 1.5), 5);
  });

  it("preserves the direction of the delta", () => {
    const { x, y } = applyAcceleration(-3, 4, 1);
    expect(x).toBeLessThan(0);
    expect(y).toBeGreaterThan(0);
  });

  it("returns zero for a zero delta", () => {
    expect(applyAcceleration(0, 0, 2)).toEqual({ x: 0, y: 0 });
  });
});
