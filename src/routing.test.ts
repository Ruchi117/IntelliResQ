import { describe, expect, it, vi } from "vitest";
import { getRoadRoute } from "./routing";

const start = { lat: 41.88, lng: -87.63 };
const end = { lat: 41.9, lng: -87.62 };

describe("road routing", () => {
  it("uses actual OSRM route geometry, distance, and duration when available", async () => {
    const response = new Response(JSON.stringify({
      routes: [{
        distance: 4200,
        duration: 600,
        geometry: { coordinates: [[-87.63, 41.88], [-87.62, 41.9]] },
      }],
    }), { status: 200 });
    const route = await getRoadRoute(start, end, new AbortController().signal, async () => response);

    expect(route.source).toBe("OSRM road route");
    expect(route.distanceKm).toBe(4.2);
    expect(route.durationMinutes).toBe(10);
    expect(route.coordinates).toEqual([[41.88, -87.63], [41.9, -87.62]]);
  });

  it("labels failed or malformed routing responses as fallback estimates", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const failed = await getRoadRoute(
        start,
        end,
        new AbortController().signal,
        async () => new Response("", { status: 503 }),
      );
      const malformed = await getRoadRoute(
        start,
        end,
        new AbortController().signal,
        async () => new Response(JSON.stringify({ routes: [{ distance: 12, duration: 5, geometry: { coordinates: [] } }] })),
      );
      expect(failed.source).toBe("Fallback estimate");
      expect(malformed.source).toBe("Fallback estimate");
      expect(warning).toHaveBeenCalledTimes(2);
    } finally {
      warning.mockRestore();
    }
  });

  it("does not mask a cancelled route request with a fallback", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(getRoadRoute(start, end, controller.signal, async () => {
      throw new Error("cancelled");
    })).rejects.toThrow("cancelled");
  });
});
