import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  Circle,
  CircleMarker,
  MapContainer,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import {
  addUpdate,
  alertsFor,
  ambulances,
  chooseAmbulance,
  createIncident,
  fleetForIncidents,
  hospitalEligibility,
  hospitals,
  initialVitals,
  loadIncidents,
  nextTripStatus,
  requiredEquipment,
  STORAGE_KEY,
  type Coordinate,
  type Hospital,
  type Incident,
  type RoadRoute,
  type Severity,
  type TripStatus,
  type ViewName,
  type Vitals,
} from "./domain";
import { getRoadRoute } from "./routing";

type RouteSet = {
  ambulanceToPatient: RoadRoute;
  hospitalRoutes: Record<string, RoadRoute>;
};

const emptyRegistration = {
  patientName: "",
  age: "",
  complaint: "",
  severity: "Urgent" as Severity,
  locationLabel: "",
  notes: "",
};

const tabs: ViewName[] = ["Driver", "Patient monitor", "Hospitals"];

function loadHistoryState(): { incidents: Incident[]; error: unknown | null } {
  try {
    return { incidents: loadIncidents(window.localStorage), error: null };
  } catch (error) {
    console.error("Unable to load RapidResQ history:", error);
    return { incidents: [], error };
  }
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function statusClass(status: TripStatus): string {
  return status.toLowerCase().replaceAll(" ", "-");
}

function MapViewport({ points }: { points: Coordinate[] }) {
  const map = useMap();

  useEffect(() => {
    if (points.length > 1) {
      map.fitBounds(
        points.map((point) => [point.lat, point.lng] as [number, number]),
        { padding: [42, 42], maxZoom: 14 },
      );
    } else if (points[0]) {
      map.setView([points[0].lat, points[0].lng], 13);
    }
  }, [map, points]);

  return null;
}

function Glyph({ name, size = 18 }: { name: string; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  let body: ReactNode;
  switch (name) {
    case "grid":
      body = <><rect x="3.5" y="3.5" width="7" height="7" rx="1" /><rect x="13.5" y="3.5" width="7" height="7" rx="1" /><rect x="3.5" y="13.5" width="7" height="7" rx="1" /><rect x="13.5" y="13.5" width="7" height="7" rx="1" /></>;
      break;
    case "ambulance":
      body = <><path d="M3 7h11v10H3zM14 10h4l3 3v4h-7z" /><path d="M7 7V4h4v3M17 17h.01M7 17h.01M3 12h5M5.5 9.5v5" /></>;
      break;
    case "heart":
      body = <><path d="M20.5 8.7c0 5.1-8.5 10-8.5 10s-8.5-4.9-8.5-10a4.5 4.5 0 0 1 8.5-2 4.5 4.5 0 0 1 8.5 2Z" /><path d="M4.5 12h4l2-3 2.4 6 1.8-3h4.8" /></>;
      break;
    case "hospital":
      body = <><path d="M4 20V6l8-3 8 3v14M2 20h20M9 20v-5h6v5M12 7v5M9.5 9.5h5" /></>;
      break;
    case "pin":
      body = <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>;
      break;
    case "clock":
      body = <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>;
      break;
    case "arrow":
      body = <><path d="M5 12h14M13 6l6 6-6 6" /></>;
      break;
    case "plus":
      body = <><path d="M12 5v14M5 12h14" /></>;
      break;
    case "activity":
      body = <><path d="M3 12h4l3-8 4 16 3-8h4" /></>;
      break;
    case "alert":
      body = <><path d="m12 3 9.2 16H2.8L12 3Z" /><path d="M12 9v4M12 16h.01" /></>;
      break;
    case "check":
      body = <><path d="m5 12 4 4L19 6" /></>;
      break;
    case "close":
      body = <><path d="m6 6 12 12M18 6 6 18" /></>;
      break;
    case "chevron":
      body = <><path d="m9 18 6-6-6-6" /></>;
      break;
    default:
      body = <circle cx="12" cy="12" r="8" />;
  }
  return <svg {...common}>{body}</svg>;
}

function IncidentBadge({ severity }: { severity: Severity }) {
  return <span className={`severity severity-${severity.toLowerCase()}`}><span className="severity-dot" />{severity}</span>;
}

function IncidentRail({
  incidents,
  selectedId,
  onSelect,
  onRegister,
}: {
  incidents: Incident[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRegister: () => void;
}) {
  return (
    <aside className="incident-rail">
      <div className="rail-heading">
        <div><span className="eyebrow">LIVE OPERATIONS</span><h2>Incidents <span className="count-pill">{incidents.filter((item) => item.status !== "Completed").length}</span></h2></div>
        <button className="icon-button" onClick={onRegister} aria-label="Register emergency"><Glyph name="plus" /></button>
      </div>
      <div className="incident-list">
        {incidents.length === 0 && (
          <div className="rail-empty"><div className="empty-icon"><Glyph name="activity" size={20} /></div><strong>No incidents yet</strong><p>Register an emergency to start a response.</p><button className="text-button" onClick={onRegister}>Register patient <Glyph name="arrow" size={14} /></button></div>
        )}
        {incidents.map((incident) => (
          <button key={incident.id} className={`incident-item ${selectedId === incident.id ? "selected" : ""}`} onClick={() => onSelect(incident.id)}>
            <div className="incident-item-top"><IncidentBadge severity={incident.severity} /><span className={`status-mini ${statusClass(incident.status)}`}><i />{incident.status}</span></div>
            <strong>{incident.patientName}</strong>
            <span className="incident-location"><Glyph name="pin" size={13} />{incident.locationLabel || "Location not provided"}</span>
            <span className="incident-meta"><span>{incident.reference}</span><span>{formatTime(incident.createdAt)}</span></span>
          </button>
        ))}
      </div>
      <div className="rail-footnote"><span className="footnote-mark">i</span> Scenario records are simulated and stored in this browser.</div>
    </aside>
  );
}

function OperationalMap({
  incident,
  routes,
  activeHospital,
  fleet,
}: {
  incident: Incident;
  routes: RouteSet | null;
  activeHospital: Hospital | undefined;
  fleet: ReturnType<typeof fleetForIncidents>;
}) {
  const points: Coordinate[] = [
    incident.location,
    ...(routes?.ambulanceToPatient.coordinates.map(([lat, lng]) => ({ lat, lng })) ?? []),
    ...(routes && activeHospital ? routes.hospitalRoutes[activeHospital.id]?.coordinates.map(([lat, lng]) => ({ lat, lng })) ?? [] : []),
  ];
  return (
    <div className="map-frame">
      <MapContainer key={incident.id} center={[incident.location.lat, incident.location.lng]} zoom={13} scrollWheelZoom className="map">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapViewport points={points} />
        <Circle center={[incident.location.lat, incident.location.lng]} radius={800} pathOptions={{ color: "#f4b94f", fillColor: "#f4b94f", fillOpacity: 0.05, weight: 1, dashArray: "5 7" }} />
        {routes?.ambulanceToPatient.coordinates && (
          <Polyline positions={routes.ambulanceToPatient.coordinates} pathOptions={{ color: "#39c9e8", weight: 4, opacity: 0.9 }} />
        )}
        {activeHospital && routes?.hospitalRoutes[activeHospital.id] && (
          <Polyline positions={routes.hospitalRoutes[activeHospital.id].coordinates} pathOptions={{ color: "#bea0ff", weight: 4, opacity: 0.88, dashArray: "9 7" }} />
        )}
        <CircleMarker center={[incident.location.lat, incident.location.lng]} radius={9} pathOptions={{ color: "#f4b94f", fillColor: "#f4b94f", fillOpacity: 1, weight: 3 }}>
          <Tooltip direction="top" offset={[0, -8]}>{incident.patientName} · simulated patient location</Tooltip>
        </CircleMarker>
        {fleet.map((ambulance) => (
          <CircleMarker key={ambulance.id} center={[ambulance.location.lat, ambulance.location.lng]} radius={7} pathOptions={{ color: "#39c9e8", fillColor: "#123d52", fillOpacity: 1, weight: 2 }}>
            <Tooltip direction="top" offset={[0, -7]}>{ambulance.callSign} · simulated unit location</Tooltip>
          </CircleMarker>
        ))}
        {hospitals.map((hospital) => (
          <CircleMarker key={hospital.id} center={[hospital.location.lat, hospital.location.lng]} radius={7} pathOptions={{ color: "#bea0ff", fillColor: "#42395c", fillOpacity: 1, weight: 2 }}>
            <Tooltip direction="top" offset={[0, -7]}>{hospital.name} · fictional hospital</Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
      <div className="map-topline"><span className="live-label"><i /> ROUTE OVERVIEW</span><span className="map-disclaimer">Simulated locations · no live GPS</span></div>
      <div className="map-legend"><span><i className="legend-patient" />Patient</span><span><i className="legend-ambulance" />Ambulance</span><span><i className="legend-hospital" />Fictional hospital</span></div>
    </div>
  );
}

function RouteMetric({ route, title }: { route: RoadRoute | undefined; title: string }) {
  return (
    <div className="route-metric">
      <span>{title}</span>
      <strong>{route ? `${route.durationMinutes} min` : "—"}</strong>
      <small>{route ? `${route.distanceKm.toFixed(1)} km · ${route.source}` : "Routing estimate loading"}</small>
    </div>
  );
}

function TrendChart({ incidents }: { incidents: Incident[] }) {
  const values = incidents.slice(0, 8).reverse().map((item) => item.vitals.spo2);
  const data = values.length ? values : [98, 97, 96, 97, 96, 97, 97, 98];
  const points = data.map((value, index) => `${(index / Math.max(1, data.length - 1)) * 100},${38 - (value - 88) * 2.2}`).join(" ");
  return (
    <div className="trend-chart">
      <div className="chart-top"><div><span className="eyebrow">OXYGEN SATURATION</span><strong>{incidents[0]?.vitals.spo2 ?? 98}<small>%</small></strong></div><span className="chart-range">LATEST</span></div>
      <svg viewBox="0 0 100 44" preserveAspectRatio="none" role="img" aria-label="Recent oxygen saturation readings">
        {[8, 20, 32, 44].map((y) => <line key={y} x1="0" x2="100" y1={y} y2={y} className="chart-grid" />)}
        <polyline points={points} fill="none" className="chart-line" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="chart-labels"><span>Earlier</span><span>Latest entry</span></div>
    </div>
  );
}

function App() {
  const [historyState] = useState(loadHistoryState);
  const [incidents, setIncidents] = useState<Incident[]>(historyState.incidents);
  const [storageBlocked, setStorageBlocked] = useState(historyState.error !== null);
  const [selectedId, setSelectedId] = useState<string | null>(historyState.incidents[0]?.id ?? null);
  const [activeView, setActiveView] = useState<ViewName>("Driver");
  const [showRegistration, setShowRegistration] = useState(false);
  const [registration, setRegistration] = useState(emptyRegistration);
  const [routeLoad, setRouteLoad] = useState<{
    incidentId: string;
    status: "ready" | "fallback" | "error";
    routes?: RouteSet;
  } | null>(null);
  const [notice, setNotice] = useState(
    historyState.error ? "Saved history is unreadable. Clear this site's data before continuing to avoid overwriting it." : "",
  );
  const [patientUpdate, setPatientUpdate] = useState("");
  const [vitalsDraft, setVitalsDraft] = useState<Vitals>(
    () => historyState.incidents[0]?.vitals ?? initialVitals,
  );
  const fleet = useMemo(() => fleetForIncidents(incidents), [incidents]);

  const selectedIncident = incidents.find((item) => item.id === selectedId) ?? incidents[0] ?? null;
  const activeHospital = hospitals.find((hospital) => hospital.id === selectedIncident?.hospitalId);
  const activeAmbulance = fleet.find((ambulance) => ambulance.id === selectedIncident?.ambulanceId);
  const patientAlerts = selectedIncident ? alertsFor(selectedIncident.vitals) : [];
  const activeRouteLoad =
    selectedIncident && routeLoad?.incidentId === selectedIncident.id ? routeLoad : null;
  const routes = activeRouteLoad?.routes ?? null;
  const routingState = activeRouteLoad?.status ?? "loading";
  const routeIncidentId = selectedIncident?.id;
  const routeAmbulanceId = selectedIncident?.ambulanceId;
  const routePatientLocation = selectedIncident?.location;

  useEffect(() => {
    if (!routeIncidentId || !routePatientLocation) return;
    const incident = {
      id: routeIncidentId,
      ambulanceId: routeAmbulanceId,
      location: routePatientLocation,
    };
    const controller = new AbortController();

    const runRouting = async () => {
      try {
        const ambulance = ambulances.find((item) => item.id === incident.ambulanceId) ?? ambulances[0];
        const [ambulanceToPatient, hospitalResults] = await Promise.all([
          getRoadRoute(ambulance.location, incident.location, controller.signal),
          Promise.all(hospitals.map(async (hospital) => [
            hospital.id,
            await getRoadRoute(incident.location, hospital.location, controller.signal),
          ] as const)),
        ]);
        if (controller.signal.aborted) return;
        const usedFallback = ambulanceToPatient.source === "Fallback estimate" || hospitalResults.some(([, route]) => route.source === "Fallback estimate");
        setRouteLoad({
          incidentId: incident.id,
          status: usedFallback ? "fallback" : "ready",
          routes: {
            ambulanceToPatient,
            hospitalRoutes: Object.fromEntries(hospitalResults),
          },
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("Unable to load route estimates:", error);
        setRouteLoad({ incidentId: incident.id, status: "error" });
        setNotice("Route estimates could not be loaded. Registration and trip controls remain available.");
      }
    };

    void runRouting();
    return () => controller.abort();
  }, [routeIncidentId, routeAmbulanceId, routePatientLocation]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const commitIncidents = useCallback((next: Incident[]) => {
    if (!storageBlocked) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch (error) {
        console.error("Unable to persist RapidResQ history:", error);
        setStorageBlocked(true);
        setNotice("Could not save history to this browser. Check available storage.");
      }
    }
    setIncidents(next);
  }, [storageBlocked]);

  const selectIncident = useCallback((id: string) => {
    const incident = incidents.find((item) => item.id === id);
    if (incident) setVitalsDraft(incident.vitals);
    setSelectedId(id);
  }, [incidents]);

  const updateIncident = useCallback((id: string, updater: (current: Incident) => Incident) => {
    commitIncidents(incidents.map((incident) => (incident.id === id ? updater(incident) : incident)));
  }, [commitIncidents, incidents]);

  const eligibleHospitals = useMemo(
    () => (selectedIncident ? hospitals.map((hospital) => ({ hospital, ...hospitalEligibility(selectedIncident, hospital) })).filter((item) => item.eligible) : []),
    [selectedIncident],
  );

  const sortedHospitalOptions = useMemo(() => {
    if (!selectedIncident) return [];
    return hospitals.map((hospital) => ({
      hospital,
      ...hospitalEligibility(selectedIncident, hospital),
      route: routes?.hospitalRoutes[hospital.id],
    })).sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      return (a.route?.durationMinutes ?? Infinity) - (b.route?.durationMinutes ?? Infinity);
    });
  }, [selectedIncident, routes]);

  const handleRegister = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const patientName = registration.patientName.trim();
    const complaint = registration.complaint.trim();
    const locationLabel = registration.locationLabel.trim();
    const age = Number(registration.age);
    if (!patientName || !complaint || !locationLabel || !Number.isInteger(age) || age < 0 || age > 120) {
      setNotice("Enter a patient name, age from 0–120, complaint, and location.");
      return;
    }
    const incident = createIncident({ ...registration, patientName, age, complaint, locationLabel });
    const recommended = chooseAmbulance(registration.severity, fleet, incident.location);
    if (recommended) {
      incident.ambulanceId = recommended.id;
      incident.status = "Assigned";
      incident.updates.unshift({
        id: crypto.randomUUID(),
        time: new Date().toISOString(),
        author: "Dispatch",
        text: `${recommended.callSign} assigned based on equipment match and ${recommended.responseMinutes}-minute distance-based response estimate. No live traffic is included.`,
        type: "system",
      });
      if (registration.severity === "Critical") incident.hospitalId = "H-01";
      else if (registration.severity === "Stable") incident.hospitalId = "H-03";
      else incident.hospitalId = "H-01";
    } else {
      setNotice("No available ambulance meets the required equipment for this severity.");
    }
    commitIncidents([incident, ...incidents]);
    setSelectedId(incident.id);
    setVitalsDraft(incident.vitals);
    setActiveView("Driver");
    setShowRegistration(false);
    setRegistration(emptyRegistration);
  };

  const assignAmbulance = () => {
    if (!selectedIncident) return;
    const recommended = chooseAmbulance(selectedIncident.severity, fleet, selectedIncident.location);
    if (!recommended) {
      setNotice(`No available unit matches required equipment: ${requiredEquipment(selectedIncident.severity).join(", ")}.`);
      return;
    }
    updateIncident(selectedIncident.id, (current) => ({
      ...addUpdate(current, `${recommended.callSign} assigned. Distance-based response estimate: ${recommended.responseMinutes} minutes; no live traffic is included.`, "system", "Dispatch"),
      ambulanceId: recommended.id,
      status: "Assigned",
    }));
  };

  const advanceTrip = () => {
    if (!selectedIncident) return;
    const next = nextTripStatus(selectedIncident.status);
    if (!next) return;
    if (selectedIncident.status === "Awaiting assignment") {
      assignAmbulance();
      return;
    }
    if (next === "Completed") {
      updateIncident(selectedIncident.id, (current) => addUpdate(
        { ...current, status: "Completed", ambulanceId: null },
        `Handover confirmed at ${activeHospital?.name ?? "selected hospital"}. Ambulance released to available fleet.`,
        "handover",
        "Hospital desk",
      ));
      setNotice("Handover complete. Ambulance released and incident saved to history.");
      return;
    }
    updateIncident(selectedIncident.id, (current) => addUpdate(
      { ...current, status: next },
      `Trip status updated: ${next}.`,
      "system",
      "Dispatch",
    ));
  };

  const savePatientUpdate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedIncident || !patientUpdate.trim()) return;
    updateIncident(selectedIncident.id, (current) => addUpdate(current, patientUpdate.trim(), "condition", "Field crew"));
    setPatientUpdate("");
  };

  const saveVitals = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedIncident) return;
    const vitals = { ...vitalsDraft, recordedAt: new Date().toISOString() };
    const abnormal = alertsFor(vitals);
    updateIncident(selectedIncident.id, (current) => addUpdate(
      current,
      `Vitals recorded${abnormal.length ? ` · alert: ${abnormal.join("; ")}` : " · within configured alert thresholds"}.`,
      "vitals",
      "Field crew",
      vitals,
    ));
    setNotice(abnormal.length ? `Vital alert: ${abnormal.join(" · ")}` : "Vitals saved to the shared patient record.");
  };

  const selectHospital = (hospital: Hospital) => {
    if (!selectedIncident) return;
    const check = hospitalEligibility(selectedIncident, hospital);
    if (!check.eligible) {
      setNotice("This fictional facility does not meet the listed capability for this severity.");
      return;
    }
    updateIncident(selectedIncident.id, (current) => addUpdate(
      { ...current, hospitalId: hospital.id },
      `Destination selected: ${hospital.name}. Travel time is an estimate, not live availability.`,
      "system",
      "Dispatch",
    ));
  };

  const tripAction = selectedIncident?.status === "Handover" ? "Confirm handover & release unit" : selectedIncident?.status === "Completed" ? "Incident completed" : selectedIncident?.status === "Awaiting assignment" ? "Assign best available unit" : `Advance to ${nextTripStatus(selectedIncident?.status ?? "Completed") ?? "Completed"}`;

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="RapidResQ home" onClick={(event) => event.preventDefault()}><span className="brand-mark"><Glyph name="plus" size={21} /></span><span>rapid<span>resq</span></span><i>OPERATIONS</i></a>
        <div className="topbar-center"><span className="system-health"><i /> ALL SYSTEMS OPERATIONAL</span><span className="topbar-divider" /><span className="topbar-region"><Glyph name="pin" size={14} /> Chicago, IL <em>· simulation</em></span></div>
        <div className="topbar-right"><span className="demo-badge">DEMO ENVIRONMENT</span><button className="avatar" aria-label="Demo operator">JD</button></div>
      </header>

      <div className="workspace">
        <IncidentRail incidents={incidents} selectedId={selectedIncident?.id ?? null} onSelect={selectIncident} onRegister={() => setShowRegistration(true)} />
        <main className="main-content">
          <div className="page-head">
            <div><div className="breadcrumb">Operations <Glyph name="chevron" size={13} /> Dispatch centre</div><h1>Response operations</h1><p className="page-subtitle">Coordinate emergency response from dispatch to hospital handover.</p></div>
            <button className="primary-button" onClick={() => setShowRegistration(true)}><Glyph name="plus" size={17} /> New emergency</button>
          </div>

          <div className="summary-grid">
            <div className="summary-card"><span className="summary-icon icon-cyan"><Glyph name="activity" /></span><div><span className="eyebrow">ACTIVE INCIDENTS</span><strong>{incidents.filter((item) => item.status !== "Completed").length.toString().padStart(2, "0")}</strong><small>Across current response area</small></div><span className="summary-corner">LIVE</span></div>
            <div className="summary-card"><span className="summary-icon icon-green"><Glyph name="ambulance" /></span><div><span className="eyebrow">UNITS AVAILABLE</span><strong>{fleet.filter((unit) => unit.status === "Available").length.toString().padStart(2, "0")}<small className="of-count"> / {fleet.length.toString().padStart(2, "0")}</small></strong><small>Equipment-matched dispatch</small></div><span className="summary-corner muted">SIMULATED</span></div>
            <div className="summary-card"><span className="summary-icon icon-purple"><Glyph name="hospital" /></span><div><span className="eyebrow">RECEIVING FACILITIES</span><strong>{hospitals.length.toString().padStart(2, "0")}</strong><small>Fictional facilities · capability checked</small></div><span className="summary-corner muted">FICTIONAL</span></div>
            <div className="summary-card summary-chart-card"><TrendChart incidents={incidents} /></div>
          </div>

          <div className="section-toolbar">
            <div className="view-tabs" role="tablist" aria-label="Operational views">{tabs.map((tab) => <button key={tab} role="tab" aria-selected={activeView === tab} className={`view-tab ${activeView === tab ? "active" : ""}`} onClick={() => setActiveView(tab)}><Glyph name={tab === "Driver" ? "ambulance" : tab === "Patient monitor" ? "heart" : "hospital"} size={16} />{tab}</button>)}</div>
            <span className="last-sync"><i /> SHARED RECORD <span>·</span> autosaved locally</span>
          </div>

          {!selectedIncident ? (
            <section className="welcome-panel"><div className="welcome-graphic"><Glyph name="activity" size={28} /></div><span className="eyebrow">DISPATCH READY</span><h2>Every second, coordinated.</h2><p>Register a simulated emergency to assign the right ambulance, monitor patient updates, and compare eligible receiving facilities.</p><button className="primary-button" onClick={() => setShowRegistration(true)}><Glyph name="plus" size={17} /> Register first emergency</button></section>
          ) : (
            <div className="dashboard-grid">
              <section className="map-panel panel">
                <div className="panel-heading map-heading"><div><span className="eyebrow">RESPONSE AREA</span><h2>Incident map</h2></div><div className="route-badge"><span className={`route-indicator ${routingState}`} />{routingState === "loading" ? "Routing…" : routingState === "ready" ? "Road routes" : routingState === "fallback" ? "Fallback estimate" : "Route unavailable"}</div></div>
                <OperationalMap incident={selectedIncident} routes={routes} activeHospital={activeHospital} fleet={fleet} />
                <div className="route-strip">
                  <RouteMetric title="UNIT → PATIENT" route={routes?.ambulanceToPatient} />
                  <span className="route-arrow"><Glyph name="arrow" size={16} /></span>
                  <RouteMetric title="PATIENT → FACILITY" route={activeHospital ? routes?.hospitalRoutes[activeHospital.id] : undefined} />
                  <div className="route-note"><Glyph name="clock" size={14} /><span>Road duration estimates<br /><b>not live traffic</b></span></div>
                </div>
                <div className="map-footer"><span><b>Routing:</b> OSRM road route when available. Straight-line fallback is labeled and is not a road route.</span><a href="https://project-osrm.org/" target="_blank" rel="noreferrer">OSRM</a></div>
              </section>

              <section className="dispatch-panel panel">
                <div className="panel-heading"><div><span className="eyebrow">DISPATCH RECORD</span><h2>{selectedIncident.reference}</h2></div><IncidentBadge severity={selectedIncident.severity} /></div>
                <div className="patient-card">
                  <div className="patient-avatar">{selectedIncident.patientName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</div>
                  <div className="patient-details"><strong>{selectedIncident.patientName}</strong><span>{selectedIncident.age} yrs <i>·</i> {selectedIncident.complaint}</span></div>
                  <span className={`status-pill status-${statusClass(selectedIncident.status)}`}><i />{selectedIncident.status}</span>
                </div>
                <div className="dispatch-details">
                  <div><span>INCIDENT LOCATION</span><strong><Glyph name="pin" size={14} />{selectedIncident.locationLabel}</strong></div>
                  <div><span>ASSIGNED UNIT</span><strong><Glyph name="ambulance" size={14} />{activeAmbulance?.callSign ?? "Not assigned"}</strong></div>
                  <div><span>RECEIVING FACILITY</span><strong><Glyph name="hospital" size={14} />{activeHospital?.name ?? "Not selected"}</strong></div>
                  <div><span>REGISTERED</span><strong><Glyph name="clock" size={14} />{formatTime(selectedIncident.createdAt)} local</strong></div>
                </div>
                {selectedIncident.notes && <p className="dispatch-note"><span>DISPATCH NOTE</span>{selectedIncident.notes}</p>}
                <div className="dispatch-equipment"><span>REQUIRED EQUIPMENT</span>{requiredEquipment(selectedIncident.severity).map((item) => <span className="equipment-chip" key={item}>{item}</span>)}</div>
                <button className="trip-button" disabled={selectedIncident.status === "Completed"} onClick={advanceTrip}>{selectedIncident.status === "Completed" ? <Glyph name="check" size={17} /> : <Glyph name={selectedIncident.status === "Handover" ? "check" : "arrow"} size={17} />}{tripAction}</button>
                {selectedIncident.status === "Handover" && <p className="handover-hint">Confirm only after the receiving team has accepted the patient.</p>}
              </section>

              {activeView === "Patient monitor" && <section className="monitor-panel panel">
                <div className="panel-heading"><div><span className="eyebrow">PATIENT MONITOR</span><h2>Clinical snapshot</h2></div><span className="record-time">Updated {formatTime(selectedIncident.vitals.recordedAt)}</span></div>
                {patientAlerts.length > 0 && <div className="alert-banner"><Glyph name="alert" size={17} /><div><strong>{patientAlerts.length} vital alert{patientAlerts.length > 1 ? "s" : ""}</strong><span>{patientAlerts.join(" · ")}</span></div></div>}
                      <form className="vitals-grid" onSubmit={saveVitals}>
                  <label className="vital-tile"><span>HEART RATE</span><div><input aria-label="Heart rate" type="number" min="0" max="300" value={vitalsDraft.heartRate} onChange={(event) => setVitalsDraft((current) => ({ ...current, heartRate: Number(event.target.value) }))} required /><small>bpm</small></div><i className={vitalsDraft.heartRate < 50 || vitalsDraft.heartRate > 120 ? "vital-alert" : ""} /></label>
                  <label className="vital-tile"><span>BLOOD PRESSURE</span><div><input aria-label="Systolic blood pressure" type="number" min="0" max="300" value={vitalsDraft.systolic} onChange={(event) => setVitalsDraft((current) => ({ ...current, systolic: Number(event.target.value) }))} required /><small>/</small><input aria-label="Diastolic blood pressure" type="number" min="0" max="200" value={vitalsDraft.diastolic} onChange={(event) => setVitalsDraft((current) => ({ ...current, diastolic: Number(event.target.value) }))} required /><small>mmHg</small></div><i className={vitalsDraft.systolic < 90 ? "vital-alert" : ""} /></label>
                  <label className="vital-tile"><span>OXYGEN SATURATION</span><div><input aria-label="Oxygen saturation" type="number" min="0" max="100" value={vitalsDraft.spo2} onChange={(event) => setVitalsDraft((current) => ({ ...current, spo2: Number(event.target.value) }))} required /><small>%</small></div><i className={vitalsDraft.spo2 < 92 ? "vital-alert" : ""} /></label>
                  <label className="vital-tile"><span>GLASGOW COMA SCALE</span><div><input aria-label="Glasgow Coma Scale" type="number" min="3" max="15" value={vitalsDraft.gcs} onChange={(event) => setVitalsDraft((current) => ({ ...current, gcs: Number(event.target.value) }))} required /><small>/ 15</small></div><i className={vitalsDraft.gcs <= 8 ? "vital-alert" : ""} /></label>
                  <label className="vital-tile"><span>TEMPERATURE</span><div><input aria-label="Temperature" type="number" min="25" max="45" step="0.1" value={vitalsDraft.temperature} onChange={(event) => setVitalsDraft((current) => ({ ...current, temperature: Number(event.target.value) }))} required /><small>°C</small></div><i /></label>
                  <button className="save-vitals" type="submit"><Glyph name="check" size={15} /> Save vitals</button>
                </form>
                <TrendChart incidents={incidents.filter((item) => item.id === selectedIncident.id)} />
              </section>}

              <section className="history-panel panel">
                <div className="panel-heading"><div><span className="eyebrow">{activeView === "Hospitals" ? "FACILITY COMPARISON" : "SHARED PATIENT RECORD"}</span><h2>{activeView === "Hospitals" ? "Eligible destinations" : "Condition & history"}</h2></div><span className="history-count">{activeView === "Hospitals" ? `${eligibleHospitals.length} eligible` : `${selectedIncident.updates.length} updates`}</span></div>
                {activeView === "Hospitals" ? (
                  <>
                    <div className="hospital-list">{sortedHospitalOptions.map(({ hospital, eligible, reasons, route }) => (
                      <article className={`hospital-option ${!eligible ? "ineligible" : ""} ${selectedIncident.hospitalId === hospital.id ? "chosen" : ""}`} key={hospital.id}>
                        <div className="facility-icon"><Glyph name="hospital" size={18} /></div>
                        <div className="facility-copy"><strong>{hospital.name}</strong><span>{reasons[0]}</span><small>{hospital.capabilities.join(" · ")} · fictional facility</small></div>
                        <div className="facility-time"><strong>{eligible ? route ? `${route.durationMinutes} min` : "—" : "—"}</strong><span>{eligible ? route?.source ?? "Loading route" : "Not eligible"}</span></div>
                        <button className="select-hospital" disabled={!eligible || selectedIncident.hospitalId === hospital.id} onClick={() => selectHospital(hospital)}>{selectedIncident.hospitalId === hospital.id ? "Selected" : eligible ? "Select" : "Ineligible"}</button>
                      </article>
                    ))}</div>
                    <div className="facility-note"><Glyph name="alert" size={15} /><span>Capability and ETA are scenario estimates only. No real hospital availability is queried.</span></div>
                  </>
                ) : (
                  <>
                    <form className="condition-form" onSubmit={savePatientUpdate}><input aria-label="Add condition update" placeholder="Add a condition update…" value={patientUpdate} onChange={(event) => setPatientUpdate(event.target.value)} /><button type="submit" disabled={!patientUpdate.trim()} aria-label="Save condition update"><Glyph name="arrow" size={16} /></button></form>
                    <div className="history-list">{selectedIncident.updates.map((update) => (
                      <article className="history-entry" key={update.id}><span className={`history-icon history-${update.type}`}><Glyph name={update.type === "vitals" ? "heart" : update.type === "handover" ? "check" : update.type === "condition" ? "activity" : "clock"} size={14} /></span><div><div className="history-meta"><strong>{update.author}</strong><time>{formatTime(update.time)}</time></div><p>{update.text}</p>{update.vitals && <small>HR {update.vitals.heartRate} bpm · BP {update.vitals.systolic}/{update.vitals.diastolic} · SpO₂ {update.vitals.spo2}% · GCS {update.vitals.gcs}</small>}</div></article>
                    ))}</div>
                  </>
                )}
              </section>
            </div>
          )}

          <footer className="page-footer"><span>RAPIDRESQ <i>·</i> RESPONSE COORDINATION MVP</span><span>Simulation only. Not for clinical use.</span></footer>
        </main>
      </div>

      {notice && <div className="toast" role="status"><span className="toast-dot" />{notice}<button onClick={() => setNotice("")} aria-label="Dismiss notification"><Glyph name="close" size={15} /></button></div>}
      {showRegistration && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowRegistration(false); }}><section className="registration-modal" role="dialog" aria-modal="true" aria-labelledby="registration-title">
        <div className="modal-heading"><div><span className="eyebrow">DISPATCH INTAKE</span><h2 id="registration-title">Register emergency</h2></div><button className="icon-button" onClick={() => setShowRegistration(false)} aria-label="Close registration"><Glyph name="close" /></button></div>
        <div className="simulation-warning"><Glyph name="alert" size={16} /><span>Enter simulated patient information only. Location coordinates are generated for this demo; no live patient or GPS data is used.</span></div>
        <form className="registration-form" onSubmit={handleRegister}>
          <label>Patient name<input autoFocus maxLength={70} placeholder="e.g. Alex Morgan" value={registration.patientName} onChange={(event) => setRegistration((current) => ({ ...current, patientName: event.target.value }))} required /></label>
          <div className="form-row"><label>Age<input type="number" min="0" max="120" placeholder="Age" value={registration.age} onChange={(event) => setRegistration((current) => ({ ...current, age: event.target.value }))} required /></label><label>Severity<select value={registration.severity} onChange={(event) => setRegistration((current) => ({ ...current, severity: event.target.value as Severity }))}><option>Critical</option><option>Urgent</option><option>Stable</option></select></label></div>
          <label>Chief complaint<input maxLength={100} placeholder="e.g. Chest pain, fall, breathing difficulty" value={registration.complaint} onChange={(event) => setRegistration((current) => ({ ...current, complaint: event.target.value }))} required /></label>
          <label>Simulated location<input maxLength={100} placeholder="Street, neighborhood, or landmark" value={registration.locationLabel} onChange={(event) => setRegistration((current) => ({ ...current, locationLabel: event.target.value }))} required /></label>
          <label>Dispatch notes <span className="optional-label">OPTIONAL</span><textarea maxLength={280} rows={2} placeholder="Relevant details for the response team" value={registration.notes} onChange={(event) => setRegistration((current) => ({ ...current, notes: event.target.value }))} /></label>
          <div className="form-footnote"><Glyph name="ambulance" size={15} /><span>Assignment matches equipment and simulated response time. No available compatible unit? You can retry after a unit is released.</span></div>
          <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setShowRegistration(false)}>Cancel</button><button className="primary-button" type="submit"><Glyph name="plus" size={16} /> Register & dispatch</button></div>
        </form>
      </section></div>}
    </div>
  );
}

export default App;
