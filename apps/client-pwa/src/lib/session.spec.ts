import { beforeEach, describe, expect, it } from "vitest";
import { clearLastConnection, parseSessionIdFromHash, readLastConnection, saveLastConnection } from "./session";

describe("parseSessionIdFromHash", () => {
  it("extracts the session id from a #s=<id> hash", () => {
    expect(parseSessionIdFromHash("#s=abc-123")).toBe("abc-123");
  });

  it("decodes URI-encoded characters", () => {
    expect(parseSessionIdFromHash("#s=abc%20123")).toBe("abc 123");
  });

  it("returns null when the hash has no session marker", () => {
    expect(parseSessionIdFromHash("#something-else")).toBeNull();
  });

  it("returns null for an empty hash", () => {
    expect(parseSessionIdFromHash("")).toBeNull();
  });
});

describe("readLastConnection / saveLastConnection / clearLastConnection", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns null when nothing was saved", () => {
    expect(readLastConnection()).toBeNull();
  });

  it("round-trips a saved connection", () => {
    saveLastConnection({ sessionId: "abc-123", pin: "654321" });
    expect(readLastConnection()).toEqual({ sessionId: "abc-123", pin: "654321" });
  });

  it("returns null and does not throw on corrupted storage data", () => {
    localStorage.setItem("glide-last-connection", "{not json");
    expect(readLastConnection()).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    localStorage.setItem("glide-last-connection", JSON.stringify({ sessionId: "abc-123" }));
    expect(readLastConnection()).toBeNull();
  });

  it("clears the saved connection", () => {
    saveLastConnection({ sessionId: "abc-123", pin: "654321" });
    clearLastConnection();
    expect(readLastConnection()).toBeNull();
  });
});
