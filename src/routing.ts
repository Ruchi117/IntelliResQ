import { fallbackRoute } from "./domain";
import type { Coordinate, RoadRoute } from "./domain";

type RoutingResponse = {
  routes: Array<{
    distance: number;
    duration: number;
    geometry: { coordinates: unknown[] };
  }>;
};

function isRoutingResponse(value: unknown): value is RoutingResponse {
  if (!value || typeof value !== "object" || !("routes" in value) || !Array.isArray(value.routes)) {
    return false;
  }
  const route: unknown = value.routes[0];
  if (
    !route ||
    typeof route !== "object" ||
    !("distance" in route) ||
    !("duration" in route) ||
    !("geometry" in route)
  ) return false;
  const geometry: unknown = route.geometry;
  return (
    typeof route.distance === "number" &&
    typeof route.duration === "number" &&
    !!geometry &&
    typeof geometry === "object" &&
    "coordinates" in geometry &&
    Array.isArray(geometry.coordinates) &&
    geometry.coordinates.length > 0
  );
}

export async function getRoadRoute(
  start: Coordinate,
  end: Coordinate,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<RoadRoute> {
  const fallback = fallbackRoute(start, end);
  try {
    const response = await fetcher(
      `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson&steps=false`,
      { signal },
    );
    if (!response.ok) throw new Error(`Routing service returned ${response.status}`);
    const result: unknown = await response.json();
    if (!isRoutingResponse(result)) throw new Error("Routing service returned an invalid route.");
    const route = result.routes[0];
    return {
      coordinates: route.geometry.coordinates.map((point: unknown): [number, number] => {
        if (
          !Array.isArray(point) ||
          typeof point[0] !== "number" ||
          typeof point[1] !== "number"
        ) {
          throw new Error("Routing service returned invalid route geometry.");
        }
        return [point[1], point[0]];
      }),
      distanceKm: route.distance / 1000,
      durationMinutes: Math.max(1, Math.round(route.duration / 60)),
      source: "OSRM road route",
    };
  } catch (error) {
    if (signal.aborted) throw error;
    console.warn("Road routing unavailable; showing a labeled fallback estimate:", error);
    return fallback;
  }
}
