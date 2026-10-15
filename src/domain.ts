export type Severity = "Critical" | "Urgent" | "Stable";
export type TripStatus =
  | "Awaiting assignment"
  | "Assigned"
  | "En route"
  | "On scene"
  | "Transporting"
  | "Handover"
  | "Completed";
export type ViewName = "Driver" | "Patient monitor" | "Hospitals";

export interface Coordinate {
  lat: number;
  lng: number;
}

export interface Vitals {
  heartRate: number;
  systolic: number;
  diastolic: number;
  spo2: number;
  temperature: number;
  gcs: number;
  recordedAt: string;
}

export interface PatientUpdate {
  id: string;
  time: string;
  author: string;
  text: string;
  type: "condition" | "vitals" | "system" | "handover";
  vitals?: Vitals;
}

export interface Incident {
  id: string;
  reference: string;
  createdAt: string;
  patientName: string;
  age: number;
  complaint: string;
  severity: Severity;
  location: Coordinate;
  locationLabel: string;
  status: TripStatus;
  ambulanceId: string | null;
  hospitalId: string | null;
  notes: string;
  vitals: Vitals;
  updates: PatientUpdate[];
}

export interface Ambulance {
  id: string;
  callSign: string;
  status: "Available" | "Assigned" | "On scene" | "Transporting";
  location: Coordinate;
  baseLabel: string;
  equipment: string[];
  responseMinutes: number;
}

export interface Hospital {
  id: string;
  name: string;
  location: Coordinate;
  capabilities: string[];
  fictional: true;
}

export interface RoadRoute {
  coordinates: [number, number][];
  distanceKm: number;
  durationMinutes: number;
  source: "OSRM road route" | "Fallback estimate";
}

export const STORAGE_KEY = "rapidresq.incidents.v1";

export const ambulances: Ambulance[] = [
  {
    id: "A-04",
    callSign: "Medic 04",
    status: "Available",
    location: { lat: 41.8896, lng: -87.6412 },
    baseLabel: "West Loop",
    equipment: ["ALS", "Trauma", "Cardiac"],
    responseMinutes: 7,
  },
  {
    id: "A-12",
    callSign: "Medic 12",
    status: "Available",
    location: { lat: 41.9254, lng: -87.6541 },
    baseLabel: "Lincoln Park",
    equipment: ["BLS", "Pediatric"],
    responseMinutes: 11,
  },
  {
    id: "A-21",
    callSign: "Medic 21",
    status: "Available",
    location: { lat: 41.8532, lng: -87.6298 },
    baseLabel: "South Loop",
    equipment: ["ALS", "Trauma", "Pediatric"],
    responseMinutes: 9,
  },
];

export const hospitals: Hospital[] = [
  {
    id: "H-01",
    name: "Northstar Trauma Centre",
    location: { lat: 41.8951, lng: -87.6214 },
    capabilities: ["Trauma", "Cardiac", "ALS"],
    fictional: true,
  },
  {
    id: "H-02",
    name: "Lakeside Children’s Hospital",
    location: { lat: 41.9394, lng: -87.6549 },
    capabilities: ["Pediatric", "ALS"],
    fictional: true,
  },
  {
    id: "H-03",
    name: "Mercy General Hospital",
    location: { lat: 41.8621, lng: -87.6236 },
    capabilities: ["ALS", "Cardiac"],
    fictional: true,
  },
];

export const initialVitals: Vitals = {
  heartRate: 104,
  systolic: 128,
  diastolic: 82,
  spo2: 97,
  temperature: 37.1,
  gcs: 15,
  recordedAt: new Date().toISOString(),
};

const makeUpdate = (
  text: string,
  type: PatientUpdate["type"] = "system",
  author = "Dispatch",
): PatientUpdate => ({
  id: crypto.randomUUID(),
  time: new Date().toISOString(),
  author,
  text,
  type,
});

export function createIncident(input: {
  patientName: string;
  age: number;
  complaint: string;
  severity: Severity;
  locationLabel: string;
  notes: string;
}): Incident {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const lat = 41.8818 + (Math.random() - 0.5) * 0.045;
  const lng = -87.6298 + (Math.random() - 0.5) * 0.055;

  return {
    id,
    reference: `RR-${new Date().getFullYear()}-${id.slice(0, 4).toUpperCase()}`,
    createdAt,
    patientName: input.patientName.trim(),
    age: input.age,
    complaint: input.complaint.trim(),
    severity: input.severity,
    location: { lat, lng },
    locationLabel: input.locationLabel.trim(),
    status: "Awaiting assignment",
    ambulanceId: null,
    hospitalId: null,
    notes: input.notes.trim(),
    vitals: { ...initialVitals, recordedAt: createdAt },
    updates: [makeUpdate("Emergency registered. Patient data is simulated.", "system")],
  };
}

export function requiredEquipment(severity: Severity): string[] {
  return severity === "Critical" ? ["ALS", "Trauma"] : severity === "Urgent" ? ["ALS"] : ["BLS"];
}

export function fleetForIncidents(incidents: Incident[]): Ambulance[] {
  return ambulances.map((ambulance) => {
    const assignment = incidents.find(
      (incident) => incident.ambulanceId === ambulance.id && incident.status !== "Completed",
    );
    return {
      ...ambulance,
      status: assignment
        ? assignment.status === "On scene"
          ? "On scene" as const
          : assignment.status === "Transporting" || assignment.status === "Handover"
            ? "Transporting" as const
            : "Assigned" as const
        : "Available" as const,
    };
  });
}

export function chooseAmbulance(
  severity: Severity,
  available: Ambulance[],
  patientLocation?: Coordinate,
): Ambulance | null {
  const requirements = requiredEquipment(severity);
  return (
    available
      .filter(
        (ambulance) =>
          ambulance.status === "Available" &&
          requirements.every((item) => ambulance.equipment.includes(item)),
      )
      .map((ambulance) => ({
        ...ambulance,
        responseMinutes: patientLocation
          ? Math.max(3, Math.round((haversineKm(ambulance.location, patientLocation) * 1.32 / 27) * 60))
          : ambulance.responseMinutes,
      }))
      .sort((a, b) => a.responseMinutes - b.responseMinutes)[0] ?? null
  );
}

export function hospitalEligibility(incident: Incident, hospital: Hospital): {
  eligible: boolean;
  reasons: string[];
} {
  const required = incident.severity === "Critical" ? "Trauma" : "ALS";
  const eligible = hospital.capabilities.includes(required);
  return {
    eligible,
    reasons: eligible
      ? [`${required} capability listed in this fictional scenario`]
      : [`No ${required} capability listed in this fictional scenario`],
  };
}

export function fallbackRoute(start: Coordinate, end: Coordinate): RoadRoute {
  const distanceKm = haversineKm(start, end) * 1.32;
  const durationMinutes = Math.max(3, Math.round((distanceKm / 27) * 60));
  return {
    coordinates: [
      [start.lat, start.lng],
      [end.lat, end.lng],
    ],
    distanceKm,
    durationMinutes,
    source: "Fallback estimate",
  };
}

export function haversineKm(start: Coordinate, end: Coordinate): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latDifference = radians(end.lat - start.lat);
  const lngDifference = radians(end.lng - start.lng);
  const value =
    Math.sin(latDifference / 2) ** 2 +
    Math.cos(radians(start.lat)) *
      Math.cos(radians(end.lat)) *
      Math.sin(lngDifference / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function alertsFor(vitals: Vitals): string[] {
  const alerts: string[] = [];
  if (vitals.heartRate < 50 || vitals.heartRate > 120) alerts.push("Heart rate outside 50–120 bpm");
  if (vitals.spo2 < 92) alerts.push("Oxygen saturation below 92%");
  if (vitals.systolic < 90) alerts.push("Systolic blood pressure below 90 mmHg");
  if (vitals.gcs <= 8) alerts.push("Low Glasgow Coma Scale (≤8)");
  return alerts;
}

export function nextTripStatus(status: TripStatus): TripStatus | null {
  const sequence: TripStatus[] = [
    "Awaiting assignment",
    "Assigned",
    "En route",
    "On scene",
    "Transporting",
    "Handover",
    "Completed",
  ];
  const next = sequence[sequence.indexOf(status) + 1];
  return next ?? null;
}

export function loadIncidents(storage: Pick<Storage, "getItem">): Incident[] {
  const saved = storage.getItem(STORAGE_KEY);
  if (saved === null) return [];
  const parsed: unknown = JSON.parse(saved);
  const statuses: TripStatus[] = [
    "Awaiting assignment",
    "Assigned",
    "En route",
    "On scene",
    "Transporting",
    "Handover",
    "Completed",
  ];
  const severities: Severity[] = ["Critical", "Urgent", "Stable"];
  if (
    !Array.isArray(parsed) ||
    parsed.some(
      (item) =>
        !item ||
        typeof item.id !== "string" ||
        typeof item.reference !== "string" ||
        typeof item.patientName !== "string" ||
        !severities.includes(item.severity) ||
        !statuses.includes(item.status) ||
        !item.location ||
        typeof item.location.lat !== "number" ||
        typeof item.location.lng !== "number" ||
        !item.vitals ||
        typeof item.vitals.heartRate !== "number" ||
        typeof item.vitals.spo2 !== "number" ||
        !Array.isArray(item.updates) ||
        (item.ambulanceId !== null && typeof item.ambulanceId !== "string") ||
        (item.hospitalId !== null && typeof item.hospitalId !== "string"),
    )
  ) {
    throw new Error("Saved incident history is invalid. Clear site data to reset it.");
  }
  return parsed as Incident[];
}

export function addUpdate(
  incident: Incident,
  text: string,
  type: PatientUpdate["type"],
  author: string,
  vitals?: Vitals,
): Incident {
  return {
    ...incident,
    ...(vitals ? { vitals } : {}),
    updates: [
      { ...makeUpdate(text, type, author), ...(vitals ? { vitals } : {}) },
      ...incident.updates,
    ],
  };
}
