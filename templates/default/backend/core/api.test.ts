import { describe, expect, it } from "vitest";
import { formatRealtimeReply, health } from "./api";

describe("health", () => {
  it("reports the backend as available", async () => {
    await expect(health()).resolves.toEqual({ ok: true });
  });
});

describe("formatRealtimeReply", () => {
  it("builds the typed realtime response", () => {
    expect(formatRealtimeReply({ text: "ping" }, "2026-01-01T00:00:00.000Z")).toEqual({
      text: "Echo: ping",
      receivedAt: "2026-01-01T00:00:00.000Z",
    });
  });
});
