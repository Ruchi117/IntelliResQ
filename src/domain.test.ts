import { describe, expect, it } from "vitest";
import {
  alertsFor,
  chooseAmbulance,
  fallbackRoute,
  fleetForIncidents,
  hospitalEligibility,
  hospitals,
  initialVitals,
  loadIncidents,
  nextTripStatus,
  requiredEquipment,
  STORAGE_KEY,
  type Incident,
} from "./domain";

const incident: Incident = {
  id: "case-1",
  reference: "RR-2026-CASE",
  createdAt: new Date().toISOString(),
  patientName: "Simulated patient",
  age: 34,
  complaint: "Injury",
  severity: "Critical",
  location: { lat: 41.88, lng: -87.63 },
  locationLabel: "Simulated location",
  status: "Assigned",
  ambulanceId: "A-04",
  hospitalId: null,
  notes: "",
  vitals: initialVitals,
  updates: [],
};

describe("dispatch domain", () => {
  it("matches severity to equipment and the fastest available qualified unit", () => {
    expect(requiredEquipment("Critical")).toEqual(["ALS", "Trauma"]);
    expect(
      chooseAmbulance("Critical", [
        {
          id: "slow",
          callSign: "Slow",
          status: "Available",
          location: incident.location,
          baseLabel: "",
          equipment: ["ALS", "Trauma"],
          responseMinutes: 8,
        },
        {
          id: "fast",
          callSign: "Fast",
          status: "Available",
          location: incident.location,
          baseLabel: "",
          equipment: ["ALS", "Trauma"],
          responseMinutes: 5,
        },
        {
          id: "busy",
          callSign: "Busy",
          status: "Assigned",
          location: incident.location,
          baseLabel: "",
          equipment: ["ALS", "Trauma"],
          responseMinutes: 1,
        },
      ])?.id,
    ).toBe("fast");
    expect(chooseAmbulance("Critical", [])).toBeNull();
    expect(
      chooseAmbulance("Critical", fleetForIncidents([]), {
        lat: 41.8532,
        lng: -87.6298,
      })?.id,
    ).toBe("A-21");
  });

  it("keeps an assigned unit unavailable until its incident is completed", () => {
    const assigned = { ...incident, ambulanceId: "A-04", status: "Assigned" as const };
    expect(fleetForIncidents([assigned]).find((unit) => unit.id === "A-04")?.status).toBe("Assigned");
    expect(fleetForIncidents([{ ...assigned, status: "Completed" }]).find((unit) => unit.id === "A-04")?.status).toBe("Available");
  });

  it("checks hospital capabilities and advances trip status in order", () => {
    expect(hospitalEligibility(incident, hospitals[0]).eligible).toBe(true);
    expect(hospitalEligibility(incident, hospitals[2]).eligible).toBe(false);
    expect(nextTripStatus("Handover")).toBe("Completed");
    expect(nextTripStatus("Completed")).toBeNull();
  });

  it("produces transparent fallback route estimates and vital alerts", () => {
    const route = fallbackRoute({ lat: 41.88, lng: -87.63 }, hospitals[0].location);
    expect(route.source).toBe("Fallback estimate");
    expect(route.durationMinutes).toBeGreaterThan(0);
    expect(alertsFor({ ...initialVitals, spo2: 88, gcs: 7 })).toHaveLength(2);
  });

  it("loads persistent history and surfaces corrupt saved data", () => {
    expect(loadIncidents({ getItem: () => JSON.stringify([incident]) })).toHaveLength(1);
    expect(loadIncidents({ getItem: () => null })).toEqual([]);
    expect(() => loadIncidents({ getItem: () => "not json" })).toThrow();
    expect(() => loadIncidents({ getItem: () => JSON.stringify([{ id: "incomplete" }]) })).toThrow();
    expect(STORAGE_KEY).toBe("rapidresq.incidents.v1");
  });
});
