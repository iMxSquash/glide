import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { debounce } from "./debounce";

describe("debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not call the function before the delay elapses", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 150);

    debounced(50);
    vi.advanceTimersByTime(100);

    expect(fn).not.toHaveBeenCalled();
  });

  it("calls the function once the delay elapses", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 150);

    debounced(50);
    vi.advanceTimersByTime(150);

    expect(fn).toHaveBeenCalledExactlyOnceWith(50);
  });

  it("only sends the last value when called repeatedly within the delay window", () => {
    // Mirrors dragging a volume slider: many intermediate values, only the
    // final one should ever reach the server.
    const fn = vi.fn();
    const debounced = debounce(fn, 150);

    debounced(10);
    vi.advanceTimersByTime(50);
    debounced(20);
    vi.advanceTimersByTime(50);
    debounced(30);
    vi.advanceTimersByTime(150);

    expect(fn).toHaveBeenCalledExactlyOnceWith(30);
  });

  it("cancel() prevents a pending call from firing", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 150);

    debounced(10);
    debounced.cancel();
    vi.advanceTimersByTime(150);

    expect(fn).not.toHaveBeenCalled();
  });
});
