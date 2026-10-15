const state = {
    dashboard: null,
    maps: {},
    markers: [],
    vehicleAnimations: {},
    serverClockOffset: 0,
    selectedPatientId: null,
    manualVitalsEditing: false,
    arrivalTimeEditing: false,
};

const tabButtons = document.querySelectorAll('.tab');
const tabPanels = document.querySelectorAll('.tab-panel');
const emergencyForm = document.getElementById('emergency-form');
const alertForm = document.getElementById('alert-form');

function setActiveTab(tabName) {
    document.body.setAttribute('data-role', tabName);

    tabButtons.forEach((button) => {
        const active = button.dataset.tab === tabName;
        button.classList.toggle('active', active);
    });

    tabPanels.forEach((panel) => {
        panel.classList.toggle('hidden', panel.id !== `${tabName}-panel`);
    });

    window.setTimeout(() => Object.values(state.maps).forEach((map) => map.invalidateSize()), 0);
}

tabButtons.forEach((button) => {
    button.addEventListener('click', () => setActiveTab(button.dataset.tab));
});

setActiveTab('driver');

async function fetchDashboard() {
    const response = await fetch('/api/dashboard');
    if (!response.ok) throw new Error('Unable to load dashboard data.');
    const data = await response.json();
    state.dashboard = data;
    const serverTime = Date.parse(data.server_time);
    if (!Number.isNaN(serverTime)) state.serverClockOffset = serverTime - Date.now();
    updateDashboardClock(data.server_time);
    renderStats(data.stats);
    if (!state.arrivalTimeEditing) renderDriver(data);
    if (!state.manualVitalsEditing) renderPatient(data);
    renderHospital(data);
    renderMap(data);
}

function renderStats(stats) {
    document.querySelector('[data-stat="total"]').textContent = stats.total;
    document.querySelector('[data-stat="pending"]').textContent = stats.pending;
    document.querySelector('[data-stat="assigned"]').textContent = stats.assigned;
    document.querySelector('[data-stat="available_ambulances"]').textContent = stats.available_ambulances;
    document.getElementById('critical-patient-count').textContent = stats.critical_patients ?? 0;
}

function updateDashboardClock(timestamp) {
    const clock = document.getElementById('dashboard-time');
    if (!clock) return;
    const date = timestamp ? new Date(timestamp) : new Date();
    clock.dateTime = date.toISOString();
    clock.textContent = new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'medium',
    }).format(date);
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    })[character]);
}

function displayTime(value) {
    if (!value) return 'Not recorded';
    const parsed = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
    return Number.isNaN(parsed.getTime())
        ? escapeHtml(value)
        : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
}

function mapsDirectionsUrl(origin, destination) {
    if (!origin || !destination) return '';
    return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=driving`;
}

function coordinates(item) {
    return item?.latitude != null && item?.longitude != null
        ? `${item.latitude},${item.longitude}`
        : '';
}

function statusClass(status) {
    if (!status) return 'pending';
    const normalized = String(status).toLowerCase();
    if (normalized.includes('critical') || normalized.includes('alert')) return 'critical';
    if (normalized.includes('attention')) return 'attention';
    if (normalized === 'normal' || normalized === 'stable') return 'stable';
    if (normalized.includes('assigned') || normalized.includes('route') || normalized.includes('patient') || normalized.includes('transport')) return 'assigned';
    return 'pending';
}

function localDateTimeValue(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
}

function localDateTimeNow() {
    return localDateTimeValue(new Date(Date.now() + 60000));
}

function signalStatus(value, needsReview, isCritical) {
    if (value == null || value === '') return 'Awaiting nurse entry';
    const numericValue = Number(value);
    if (isCritical(numericValue)) return 'Critical';
    return needsReview(numericValue) ? 'Review' : 'Normal';
}

function bloodPressureStatus(value) {
    if (!value) return 'Awaiting nurse entry';
    const [systolic, diastolic] = value.split('/').map(Number);
    if (systolic < 80 || systolic >= 180 || diastolic < 50 || diastolic >= 120) return 'Critical';
    if (systolic < 90 || systolic >= 140 || diastolic < 60 || diastolic >= 90) return 'Review';
    return 'Normal';
}

function hospitalLogo(name) {
    const normalized = String(name || '').toLowerCase();
    if (normalized.includes('svims')) {
        return '<span class="hospital-logo logo-svims" aria-label="SVIMS medical logo">S<span>+</span></span>';
    }
    if (normalized.includes('ruia')) {
        return '<span class="hospital-logo logo-ruia" aria-label="Ruia medical logo">R<span>+</span></span>';
    }
    if (normalized.includes('apollo')) {
        return '<span class="hospital-logo logo-apollo" aria-label="Apollo medical logo">A<span>✦</span></span>';
    }
    return '<span class="hospital-logo logo-default" aria-label="Hospital medical logo">+</span>';
}

function vitalValue(value, unit) {
    return value == null || value === ''
        ? 'Awaiting nurse entry'
        : `${escapeHtml(value)} ${unit}`;
}

function renderDriver(data) {
    const assigned = data.emergencies.find((item) => !['Pending', 'Completed'].includes(item.status))
        || data.emergencies.find((item) => item.status !== 'Completed');
    const assignmentEl = document.getElementById('driver-assignment');
    const directionsEl = document.getElementById('driver-directions');
    if (!assigned) {
        assignmentEl.innerHTML = '<p class="empty-state">No active emergency is currently assigned.</p>';
        directionsEl.innerHTML = '<p class="empty-state">Directions will appear after a dispatch and destination are selected.</p>';
        return;
    }

    const nextTripStep = {
        'Ambulance Assigned': ['En Route', 'Start trip to patient'],
        'En Route': ['At Patient', 'Confirm arrival at patient'],
        'At Patient': ['Transporting', 'Start patient transport'],
        'Transporting': ['Arrived at Hospital', 'Confirm hospital arrival'],
        'Arrived at Hospital': ['Completed', 'Complete handover'],
    }[assigned.status];
    const statusActions = assigned.status === 'Pending'
        ? `<button class="primary-btn" data-action="allocate-ambulance" data-id="${assigned.id}">Dispatch available ambulance</button>`
        : nextTripStep
            ? `<button class="secondary-btn" data-action="update-status" data-id="${assigned.id}" data-status="${nextTripStep[0]}">${nextTripStep[1]}</button>`
            : '';

    const hospitalOptions = data.hospitals.map((hospital) => `
        <option value="${hospital.id}" ${Number(hospital.id) === Number(assigned.hospital_id) ? 'selected' : ''}>${escapeHtml(hospital.hospital_name)} · ${hospital.available_beds} beds available</option>
    `).join('');
    const selectedHospital = data.hospitals.find((hospital) => Number(hospital.id) === Number(assigned.hospital_id));
    const vehicle = data.ambulances.find((item) => Number(item.id) === Number(assigned.ambulance_id));
    const pickupDirections = mapsDirectionsUrl(coordinates(vehicle), coordinates(assigned));
    const hospitalDirections = selectedHospital
        ? mapsDirectionsUrl(coordinates(assigned), coordinates(selectedHospital))
        : '';
    const arrivalTimeInput = document.getElementById('arrival-time-input');
    const arrivalValue = state.arrivalTimeEditing && arrivalTimeInput
        ? arrivalTimeInput.value
        : localDateTimeValue(assigned.hospital_eta);
    const canSetArrival = vehicle
        && !['Pending', 'Completed', 'Arrived at Hospital'].includes(assigned.status);
    const routeTarget = ['Ambulance Assigned', 'En Route'].includes(assigned.status)
        ? `patient pickup at ${assigned.location}`
        : selectedHospital?.hospital_name || 'the selected receiving hospital';
    const routeStarted = vehicle?.route_started_at && Number(vehicle.route_emergency_id) === Number(assigned.id);
    const arrivalSummary = routeStarted
        ? `<p><strong>Simulated arrival:</strong> ${displayTime(vehicle.route_arrival_at)} at ${escapeHtml(routeTarget)} <span id="route-countdown" class="route-countdown"></span></p>`
        : '<p class="map-caption">Set a target arrival time to simulate vehicle movement.</p>';

    assignmentEl.innerHTML = `
        <div class="assignment-card">
            <strong>Emergency #${assigned.id} · ${escapeHtml(assigned.patient_name)}</strong>
            <p><strong>Patient:</strong> ${assigned.age == null ? 'Age not recorded' : `${assigned.age} years`} · ${escapeHtml(assigned.emergency_type)}</p>
            <p><strong>Severity:</strong> <span class="status-badge ${statusClass(assigned.severity)}">${escapeHtml(assigned.severity)}</span></p>
            <p><strong>Trip status:</strong> <span class="status-badge ${statusClass(assigned.status)}">${escapeHtml(assigned.status)}</span></p>
            <p><strong>Pickup:</strong> ${escapeHtml(assigned.location)}</p>
            <p><strong>Ambulance:</strong> ${escapeHtml(assigned.ambulance_name || 'Not assigned')} · ${escapeHtml(vehicle?.driver_name || 'Driver not assigned')}</p>
            <p><strong>Destination:</strong> ${assigned.hospital_name ? `${hospitalLogo(assigned.hospital_name)} ${escapeHtml(assigned.hospital_name)}` : 'Select a receiving hospital'}</p>
            <p><strong>Reported:</strong> ${displayTime(assigned.created_at)} · Updated ${displayTime(assigned.last_update)}</p>
            <label>
                <span>Receiving hospital (sample capacity)</span>
                <select id="driver-hospital-select">
                    <option value="">Choose receiving hospital</option>
                    ${hospitalOptions}
                </select>
            </label>
            <div class="action-row">
                <button class="primary-btn" data-action="select-hospital" data-id="${assigned.id}">Confirm destination</button>
                ${statusActions}
            </div>
            ${canSetArrival ? `
                <form id="driver-arrival-form" class="arrival-form" data-id="${assigned.id}">
                    <label for="arrival-time-input">Target arrival at ${escapeHtml(routeTarget)}</label>
                    <div class="arrival-input-row">
                        <input id="arrival-time-input" name="arrival_time" type="datetime-local" min="${localDateTimeNow()}" value="${escapeHtml(arrivalValue)}" required />
                        <button class="secondary-btn" type="submit" ${!selectedHospital && !['Ambulance Assigned', 'En Route'].includes(assigned.status) ? 'disabled' : ''}>Set arrival time</button>
                    </div>
                    <p id="arrival-save-status" class="form-status" role="status" aria-live="polite"></p>
                </form>
            ` : ''}
        </div>
    `;

    directionsEl.innerHTML = `
        ${arrivalSummary}
        ${pickupDirections ? `<a class="direction-link" href="${pickupDirections}" target="_blank" rel="noopener noreferrer">Directions: current vehicle position → patient pickup ↗</a>` : ''}
        ${hospitalDirections ? `<a class="direction-link" href="${hospitalDirections}" target="_blank" rel="noopener noreferrer">Directions: patient pickup → ${escapeHtml(selectedHospital.hospital_name)} ↗</a>` : '<p class="empty-state">Choose a receiving hospital to open driving directions.</p>'}
        <p class="map-caption">The moving icon follows a simulated straight line, not roads or live GPS. Directions open in an external map service.</p>
    `;
}

function renderPatient(data) {
    const patientSelect = document.getElementById('monitor-patient-select');
    const activePatients = data.emergencies.filter((item) => item.status !== 'Completed');
    if (!state.selectedPatientId || !activePatients.some((item) => Number(item.id) === Number(state.selectedPatientId))) {
        state.selectedPatientId = activePatients[0]?.id;
    }
    patientSelect.innerHTML = activePatients.map((item) =>
        `<option value="${item.id}" ${Number(item.id) === Number(state.selectedPatientId) ? 'selected' : ''}>#${item.id} · ${escapeHtml(item.patient_name)} · ${escapeHtml(item.severity)}</option>`
    ).join('');
    patientSelect.disabled = activePatients.length === 0;
    const selected = activePatients.find((item) => Number(item.id) === Number(state.selectedPatientId));
    const profileEl = document.getElementById('patient-profile');
    const vitalEl = document.getElementById('vitals-cards');
    const historyEl = document.getElementById('condition-history');

    if (!selected) {
        profileEl.innerHTML = '<p class="empty-state">No active patient monitoring records.</p>';
        vitalEl.innerHTML = '';
        historyEl.innerHTML = '';
        manualVitalsForm.querySelectorAll('input, button').forEach((control) => { control.disabled = true; });
        return;
    }
    manualVitalsForm.querySelectorAll('input, button').forEach((control) => { control.disabled = false; });

    profileEl.innerHTML = `
        <div class="patient-card">
            <strong>${escapeHtml(selected.patient_name)}</strong>
            <p><strong>Emergency:</strong> #${selected.id} · ${escapeHtml(selected.emergency_type)}</p>
            <p><strong>Age:</strong> ${selected.age == null ? 'Not recorded' : `${selected.age} years`}</p>
            <p><strong>Severity / condition:</strong> <span class="status-badge ${statusClass(selected.severity)}">${escapeHtml(selected.severity)}</span> <span class="status-badge ${statusClass(selected.condition_status)}">${escapeHtml(selected.condition_status || 'Not assessed')}</span></p>
            <p><strong>Reported location:</strong> ${escapeHtml(selected.location)}</p>
            <p><strong>Trip status:</strong> ${escapeHtml(selected.status)}</p>
            <p><strong>Ambulance:</strong> ${escapeHtml(selected.ambulance_name || 'Not assigned')}</p>
            <p><strong>Receiving hospital:</strong> ${escapeHtml(selected.hospital_name || 'Not selected')}</p>
            <p><strong>Reported:</strong> ${displayTime(selected.created_at)}</p>
            <p><strong>Last record update:</strong> ${displayTime(selected.last_update)}</p>
            <p><strong>Care note:</strong> ${escapeHtml(selected.condition_notes || selected.alert_message || 'No care note recorded')}</p>
        </div>
    `;

    const vitals = [
        ['Heart rate', selected.heart_rate, 'bpm', 'heart-rate', signalStatus(selected.heart_rate, (value) => value < 60 || value > 100, (value) => value < 40 || value > 150)],
        ['Oxygen saturation (SpO₂)', selected.spo2, '%', 'spo2', signalStatus(selected.spo2, (value) => value < 95, (value) => value < 90)],
        ['Temperature', selected.temperature, '°C', 'temp', signalStatus(selected.temperature, (value) => value < 36 || value >= 38.5, (value) => value < 35 || value >= 40)],
        ['Blood pressure', selected.blood_pressure, 'mmHg', 'bp', bloodPressureStatus(selected.blood_pressure)],
        ['Respiratory rate', selected.respiratory_rate, 'breaths/min', 'rr', signalStatus(selected.respiratory_rate, (value) => value < 12 || value > 20, (value) => value < 8 || value > 30)],
        ['Overall vital screen', selected.condition_status, '', 'condition', selected.condition_status || 'Awaiting nurse entry'],
    ];

    vitalEl.innerHTML = vitals.map(([label, value, unit, key, status]) => `
        <article class="vital-card vital-${key} ${status === 'Review' ? 'vital-review' : ''} ${status === 'Critical' ? 'vital-critical' : ''} ${status === 'Awaiting nurse entry' ? 'vital-pending' : ''}">
            <span class="vital-indicator" aria-hidden="true"></span>
            <span class="label">${label}</span>
            <strong class="value">${vitalValue(value, unit)}</strong>
            <span class="vital-status">${escapeHtml(status)}</span>
        </article>
    `).join('');

    if (!state.manualVitalsEditing) {
        const vitalsForm = document.getElementById('manual-vitals-form');
        vitalsForm.elements.recorded_by.value = selected.vitals_recorded_by ?? '';
        vitalsForm.elements.heart_rate.value = selected.heart_rate ?? '';
        vitalsForm.elements.spo2.value = selected.spo2 ?? '';
        vitalsForm.elements.temperature.value = selected.temperature ?? '';
        vitalsForm.elements.blood_pressure.value = selected.blood_pressure ?? '';
        vitalsForm.elements.respiratory_rate.value = selected.respiratory_rate ?? '';
    }

    historyEl.innerHTML = `
        <div class="timeline-item">
            <p><strong>Current coordination record</strong></p>
            <p>Last updated ${displayTime(selected.last_update)} · ${escapeHtml(selected.alert_message || 'No alert recorded')}</p>
            <p>Vital source: ${escapeHtml(selected.vitals_source || 'Demo sample')}${selected.vitals_recorded_by ? ` by ${escapeHtml(selected.vitals_recorded_by)}` : ''} · ${displayTime(selected.vitals_updated_at || selected.last_update)}</p>
            <p>Screening rules: one critical reading or two or more out-of-range readings set Critical; one out-of-range reading sets Needs Attention; all readings inside the listed ranges set Normal. Demonstration aid only, not a diagnosis.</p>
        </div>
    `;
}

function renderHospital(data) {
    const queueEl = document.getElementById('incoming-queue');
    const readinessEl = document.getElementById('hospital-readiness');
    const summaryEl = document.getElementById('hospital-resource-summary');
    const activeEmergencies = data.emergencies.filter((item) => item.status !== 'Completed');
    const criticalCount = activeEmergencies.filter((item) => item.condition_status === 'Critical').length;
    const availableBeds = data.hospitals.reduce((total, hospital) => total + Number(hospital.available_beds || 0), 0);
    const availableDoctors = data.hospitals.reduce((total, hospital) => total + Number(hospital.doctors_available || 0), 0);

    summaryEl.innerHTML = `
        <article class="resource-card resource-critical"><span>Critical patients</span><strong>${criticalCount}</strong><small>Active coordination records</small></article>
        <article class="resource-card"><span>Available beds</span><strong>${availableBeds}</strong><small>Across listed hospitals · demo count</small></article>
        <article class="resource-card"><span>Available doctors</span><strong>${availableDoctors}</strong><small>Across listed hospitals · demo count</small></article>
        <article class="resource-card"><span>Active ambulance trips</span><strong>${activeEmergencies.filter((item) => ['Transporting', 'En Route', 'At Patient'].includes(item.status)).length}</strong><small>Based on recorded trip status</small></article>
    `;

    queueEl.innerHTML = activeEmergencies.map((item) => {
        const vehicle = data.ambulances.find((entry) => Number(entry.id) === Number(item.ambulance_id));
        const hasRoute = vehicle
            && Number(vehicle.route_emergency_id) === Number(item.id)
            && vehicle.route_arrival_at;
        const routeTarget = ['Ambulance Assigned', 'En Route'].includes(item.status)
            ? 'patient pickup'
            : item.hospital_name || 'receiving hospital';
        return `
        <article class="hospital-card ${item.condition_status === 'Critical' ? 'critical-case' : ''}">
            <strong>${escapeHtml(item.patient_name)} <span class="status-badge ${statusClass(item.severity)}">${escapeHtml(item.severity)}</span></strong>
            <p><strong>Case:</strong> #${item.id} · ${escapeHtml(item.emergency_type)} · ${item.age == null ? 'Age not recorded' : `${item.age} years`}</p>
            <p><strong>Vital screen:</strong> <span class="status-badge ${statusClass(item.condition_status)}">${escapeHtml(item.condition_status || 'Awaiting nurse entry')}</span> · <strong>Emergency severity:</strong> ${escapeHtml(item.severity)} · <strong>Trip:</strong> ${escapeHtml(item.status)}</p>
            <div class="hospital-vitals">
                <span>Heart rate <strong>${vitalValue(item.heart_rate, 'bpm')}</strong></span>
                <span>Oxygen (SpO₂) <strong>${vitalValue(item.spo2, '%')}</strong></span>
                <span>Temperature <strong>${vitalValue(item.temperature, '°C')}</strong></span>
                <span>Blood pressure <strong>${vitalValue(item.blood_pressure, 'mmHg')}</strong></span>
                <span>Respiratory rate <strong>${vitalValue(item.respiratory_rate, 'breaths/min')}</strong></span>
            </div>
            <p><strong>Vitals source:</strong> ${escapeHtml(item.vitals_source || 'Demo sample')}${item.vitals_recorded_by ? ` by ${escapeHtml(item.vitals_recorded_by)}` : ''} · <strong>Recorded:</strong> ${displayTime(item.vitals_updated_at || item.last_update)}</p>
            <p><strong>Location:</strong> ${escapeHtml(item.location)} · <strong>Ambulance:</strong> ${escapeHtml(item.ambulance_name || 'Not assigned')}</p>
            <p><strong>Receiving hospital:</strong> ${item.hospital_name ? `${hospitalLogo(item.hospital_name)} ${escapeHtml(item.hospital_name)}` : 'Not selected'} · <strong>Reported:</strong> ${displayTime(item.created_at)}</p>
            <p><strong>Simulated arrival target:</strong> ${item.hospital_eta ? `${displayTime(item.hospital_eta)}${hasRoute ? ` · en route to ${escapeHtml(routeTarget)}` : ''}` : 'Not set'}</p>
            <p><strong>Last update:</strong> ${displayTime(item.last_update)} · <strong>Alert:</strong> ${escapeHtml(item.alert_message || 'None recorded')}</p>
        </article>
    `;
    }).join('') || '<p class="empty-state">No active patient arrivals in the coordination queue.</p>';

    readinessEl.innerHTML = data.hospitals.map((hospital) => `
        <div class="readiness-block">
            <strong class="hospital-heading">${hospitalLogo(hospital.hospital_name)} ${escapeHtml(hospital.hospital_name)}</strong>
            <p>Location: ${escapeHtml(hospital.location)}</p>
            <p>Available beds: <b>${hospital.available_beds}</b> · ICU beds: <b>${hospital.icu_beds}</b> · Emergency beds: <b>${hospital.emergency_beds}</b></p>
            <p>Available doctors: <b>${hospital.doctors_available ?? 'Not reported'}</b></p>
            <p>Facilities: ${escapeHtml(hospital.facilities || 'Not reported')}</p>
            <p>Readiness: ${escapeHtml(hospital.readiness_status)} · Diversion: ${escapeHtml(hospital.diversion_status)}</p>
        </div>
    `).join('');
}

function renderFleet(data) {
    const fleetEl = document.getElementById('fleet-status');
    fleetEl.innerHTML = data.ambulances.map((item) => `
        <div class="fleet-card">
            <strong>${escapeHtml(item.ambulance_name)}</strong>
            <p>Driver: ${escapeHtml(item.driver_name || 'Unassigned')}</p>
            <p>Last known location: ${escapeHtml(item.current_location || 'Not reported')}</p>
            <p>Status: <span class="status-badge ${statusClass(item.status)}">${escapeHtml(item.status)}</span></p>
        </div>
    `).join('');
}

function renderMap(data) {
    if (typeof L === 'undefined') return;
    ['map', 'hospital-map'].forEach((mapId) => {
        const mapElement = document.getElementById(mapId);
        if (!mapElement) return;
        if (!state.maps[mapId]) {
            state.maps[mapId] = L.map(mapId).setView([13.638, 79.425], 12.5);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; OpenStreetMap contributors',
            }).addTo(state.maps[mapId]);
        }

        state.markers.filter((entry) => entry.mapId === mapId).forEach((entry) => entry.marker.remove());
        state.markers = state.markers.filter((entry) => entry.mapId !== mapId);
        const markerLayer = L.layerGroup().addTo(state.maps[mapId]);
        data.hospitals.forEach((hospital) => {
            if (hospital.latitude == null || hospital.longitude == null) return;
            L.marker([hospital.latitude, hospital.longitude]).addTo(markerLayer)
                .bindPopup(`<strong>${escapeHtml(hospital.hospital_name)}</strong><br>${escapeHtml(hospital.location)}<br>Available beds: ${hospital.available_beds}`);
        });
        data.emergencies.filter((item) => item.status !== 'Completed').forEach((item) => {
            if (item.latitude == null || item.longitude == null) return;
            const condition = String(item.condition_status || '').toLowerCase();
            const markerColor = condition === 'critical'
                ? '#c52d3a'
                : condition.includes('attention')
                    ? '#d28712'
                    : '#25835f';
            L.circleMarker([item.latitude, item.longitude], {
                radius: condition === 'critical' ? 10 : 7,
                color: markerColor,
                fillOpacity: 0.8,
            }).addTo(markerLayer).bindPopup(
                `<strong>${escapeHtml(item.patient_name)}</strong><br>${escapeHtml(item.emergency_type)}<br>Vital screen: ${escapeHtml(item.condition_status || 'Awaiting nurse entry')}<br>${escapeHtml(item.severity)} · ${escapeHtml(item.status)}`
            );
        });
        const activeTrip = data.emergencies.find((item) => !['Pending', 'Completed'].includes(item.status));
        const vehicle = activeTrip
            ? data.ambulances.find((item) => Number(item.id) === Number(activeTrip.ambulance_id))
            : null;
        if (vehicle && vehicle.latitude != null && vehicle.longitude != null) {
            const routeIsActive = Number(vehicle.route_emergency_id) === Number(activeTrip.id)
                && vehicle.route_started_at && vehicle.route_arrival_at;
            let start = [vehicle.latitude, vehicle.longitude];
            let end = start;
            if (routeIsActive) {
                start = [Number(vehicle.route_origin_latitude), Number(vehicle.route_origin_longitude)];
                end = [Number(vehicle.route_destination_latitude), Number(vehicle.route_destination_longitude)];
                L.polyline([start, end], { color: '#087f8c', weight: 4, opacity: 0.75, dashArray: '8 8' })
                    .addTo(markerLayer)
                    .bindPopup('Simulated straight-line route · not road navigation');
            }
            const vehicleIcon = L.divIcon({
                className: 'vehicle-marker-wrap',
                html: '<span class="vehicle-marker" aria-label="Ambulance">🚑</span>',
                iconSize: [38, 38],
                iconAnchor: [19, 19],
            });
            const vehicleMarker = L.marker(start, { icon: vehicleIcon, zIndexOffset: 1000 })
                .addTo(markerLayer)
                .bindPopup(`<strong>${escapeHtml(vehicle.ambulance_name)}</strong><br>${escapeHtml(vehicle.status)}<br>Simulated position · no live GPS`);
            state.vehicleAnimations[mapId] = {
                marker: vehicleMarker,
                start,
                end,
                startedAt: routeIsActive ? new Date(vehicle.route_started_at).getTime() : 0,
                arrivalAt: routeIsActive ? new Date(vehicle.route_arrival_at).getTime() : 0,
                moving: Boolean(routeIsActive),
            };
        } else {
            delete state.vehicleAnimations[mapId];
        }
        state.markers.push({ mapId, marker: markerLayer });
    });
    renderFleet(data);
    updateVehicleAnimations();
}

function updateVehicleAnimations() {
    const now = Date.now() + state.serverClockOffset;
    const animation = state.vehicleAnimations.map;
    if (animation) {
        const fraction = animation.moving && animation.arrivalAt > animation.startedAt
            ? Math.max(0, Math.min(1, (now - animation.startedAt) / (animation.arrivalAt - animation.startedAt)))
            : 0;
        animation.marker.setLatLng([
            animation.start[0] + (animation.end[0] - animation.start[0]) * fraction,
            animation.start[1] + (animation.end[1] - animation.start[1]) * fraction,
        ]);
    }
    const countdown = document.getElementById('route-countdown');
    if (countdown && animation?.moving) {
        const remaining = Math.max(0, animation.arrivalAt - now);
        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        countdown.textContent = remaining > 0
            ? `· ${minutes}m ${String(seconds).padStart(2, '0')}s remaining`
            : '· simulated arrival time reached';
    }
    const hospitalAnimation = state.vehicleAnimations['hospital-map'];
    if (hospitalAnimation) {
        const fraction = hospitalAnimation.moving && hospitalAnimation.arrivalAt > hospitalAnimation.startedAt
            ? Math.max(0, Math.min(1, (now - hospitalAnimation.startedAt) / (hospitalAnimation.arrivalAt - hospitalAnimation.startedAt)))
            : 0;
        hospitalAnimation.marker.setLatLng([
            hospitalAnimation.start[0] + (hospitalAnimation.end[0] - hospitalAnimation.start[0]) * fraction,
            hospitalAnimation.start[1] + (hospitalAnimation.end[1] - hospitalAnimation.start[1]) * fraction,
        ]);
    }
}

async function submitEmergency(event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const response = await fetch('/register_emergency', { method: 'POST', body: formData });
    const result = await response.json();
    alert(result.message || 'Emergency submitted.');
    if (result.success) {
        emergencyForm.reset();
        await fetchDashboard();
    }
}

async function triggerAlert(event) {
    event.preventDefault();
    const emergencyId = state.selectedPatientId;
    if (!emergencyId) {
        alert('No emergency available for alerting.');
        return;
    }
    const formData = new FormData(event.target);
    const response = await fetch(`/raise_alert/${emergencyId}`, { method: 'POST', body: formData });
    const result = await response.json();
    alert(result.message || 'Alert recorded.');
    if (result.success) {
        alertForm.reset();
        await fetchDashboard();
    }
}

async function handleActionButton(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;

    const action = button.dataset.action;
    const id = Number(button.dataset.id);

    if (action === 'allocate-ambulance') {
        const response = await fetch(`/allocate_ambulance/${id}`, { method: 'POST' });
        const result = await response.json();
        alert(result.message || 'Dispatch request processed.');
        if (result.success) await fetchDashboard();
        return;
    }

    if (action === 'update-status') {
        const formData = new FormData();
        formData.append('status', button.dataset.status);
        const response = await fetch(`/update_status/${id}`, { method: 'POST', body: formData });
        const result = await response.json();
        alert(result.message || 'Status updated.');
        await fetchDashboard();
        return;
    }

    if (action === 'select-hospital') {
        const select = document.getElementById('driver-hospital-select');
        const hospitalId = select?.value;
        if (!hospitalId) {
            alert('Please choose a hospital before updating destination.');
            return;
        }
        const formData = new FormData();
        formData.append('hospital_id', hospitalId);
        const response = await fetch(`/select_hospital/${id}`, { method: 'POST', body: formData });
        const result = await response.json();
        alert(result.message || 'Hospital selected.');
        await fetchDashboard();
    }
}

document.addEventListener('click', handleActionButton);
document.addEventListener('focusin', (event) => {
    if (event.target.id === 'arrival-time-input') state.arrivalTimeEditing = true;
});
document.addEventListener('focusout', (event) => {
    if (event.target.id === 'arrival-time-input') {
        window.setTimeout(() => {
            state.arrivalTimeEditing = Boolean(document.activeElement?.closest('#driver-arrival-form'));
            if (!state.arrivalTimeEditing && state.dashboard) renderDriver(state.dashboard);
        }, 0);
    }
});
document.addEventListener('submit', async (event) => {
    if (event.target.id !== 'driver-arrival-form') return;
    event.preventDefault();
    const form = event.target;
    const status = document.getElementById('arrival-save-status');
    const formData = new FormData(form);
    const requestedArrival = new Date(form.elements.arrival_time.value);
    if (!Number.isNaN(requestedArrival.getTime())) {
        formData.set('arrival_time', requestedArrival.toISOString());
    }
    const response = await fetch(`/set_vehicle_arrival/${form.dataset.id}`, {
        method: 'POST',
        body: formData,
    });
    const result = await response.json();
    status.textContent = result.message || 'Unable to set simulated arrival time.';
    status.classList.toggle('error', !response.ok || !result.success);
    if (response.ok && result.success) {
        state.arrivalTimeEditing = false;
        await fetchDashboard();
    }
});
document.getElementById('monitor-patient-select')?.addEventListener('change', (event) => {
    state.selectedPatientId = Number(event.target.value) || null;
    if (state.dashboard) renderPatient(state.dashboard);
});
const manualVitalsForm = document.getElementById('manual-vitals-form');
manualVitalsForm?.addEventListener('focusin', () => {
    state.manualVitalsEditing = true;
    document.getElementById('monitor-patient-select').disabled = true;
});
manualVitalsForm?.addEventListener('focusout', () => {
    window.setTimeout(() => {
        state.manualVitalsEditing = manualVitalsForm.contains(document.activeElement);
        document.getElementById('monitor-patient-select').disabled =
            !state.dashboard?.emergencies?.some((item) => item.status !== 'Completed')
            || state.manualVitalsEditing;
        if (!state.manualVitalsEditing && state.dashboard) renderPatient(state.dashboard);
    }, 0);
});
manualVitalsForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.selectedPatientId) {
        document.getElementById('vitals-save-status').textContent = 'Select an active patient first.';
        return;
    }
    const status = document.getElementById('vitals-save-status');
    const response = await fetch(`/update_vitals/${state.selectedPatientId}`, {
        method: 'POST',
        body: new FormData(manualVitalsForm),
    });
    const result = await response.json();
    status.textContent = result.success
        ? `${result.message} Recorded by ${result.recorded_by}.`
        : (result.message || 'Unable to save readings.');
    status.classList.toggle('error', !response.ok || !result.success);
    if (response.ok && result.success) {
        state.manualVitalsEditing = false;
        await fetchDashboard();
    }
});
emergencyForm?.addEventListener('submit', submitEmergency);
alertForm?.addEventListener('submit', triggerAlert);

fetchDashboard().catch((error) => {
    console.error(error);
    alert('Dashboard data could not be loaded. Check that the Flask server is running.');
});
setInterval(() => {
    fetchDashboard().catch((error) => console.error('Dashboard refresh failed:', error));
}, 15000);
setInterval(updateVehicleAnimations, 1000);
