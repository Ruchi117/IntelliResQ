
/*
  IntelliResQ — Map and Ambulance Simulation

  Uses:
  - Leaflet for the interactive map
  - Flask /api/map-data for project data
  - OSRM public routing service for road routes

  Important: Ambulance movement is simulated, not live GPS tracking.
*/

(() => {
    "use strict";

    const mapElement = document.getElementById("map");
    const routeStatus = document.getElementById("route-status");

    if (!mapElement || typeof L === "undefined") {
        if (routeStatus) {
            routeStatus.textContent =
                "Map library did not load. Check your internet connection and refresh.";
        }
        return;
    }

    // Initial map centred on Tirupati.
    const map = L.map("map").setView([13.638, 79.425], 13);

    L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
            maxZoom: 19,
            attribution: "&copy; OpenStreetMap contributors"
        }
    ).addTo(map);

    // Separate layers make map updates easier.
    const emergencyLayer = L.layerGroup().addTo(map);
    const ambulanceLayer = L.layerGroup().addTo(map);
    const hospitalLayer = L.layerGroup().addTo(map);
    const routeLayer = L.layerGroup().addTo(map);

    let currentData = {
        emergencies: [],
        ambulances: [],
        hospitals: []
    };

    let allMarkers = [];
    let activeAnimation = null;
    let routeRequestNumber = 0;

    // Safely escape text before inserting it into a popup.
    function safe(value) {
        return String(value ?? "").replace(/[&<>"']/g, character => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[character]);
    }

    function validPoint(latitude, longitude) {
        const lat = Number(latitude);
        const lon = Number(longitude);

        if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lon) ||
            Math.abs(lat) > 90 ||
            Math.abs(lon) > 180
        ) {
            return null;
        }

        return [lat, lon];
    }

    // Emoji icons make the three categories easy to identify.
    function makeIcon(emoji) {
        return L.divIcon({
            className: "intelliresq-marker",
            html: `
                <div style="
                    width:36px;
                    height:36px;
                    display:flex;
                    align-items:center;
                    justify-content:center;
                    background:white;
                    border:2px solid #d5e1ee;
                    border-radius:50%;
                    font-size:21px;
                    box-shadow:0 2px 8px #1234;
                ">${emoji}</div>
            `,
            iconSize: [36, 36],
            iconAnchor: [18, 18],
            popupAnchor: [0, -16]
        });
    }

    const emergencyIcon = makeIcon("🚨");
    const ambulanceIcon = makeIcon("🚑");
    const hospitalIcon = makeIcon("🏥");

    // Fetch current project data from Flask.
    async function refreshMap() {
        if (routeStatus && !activeAnimation) {
            routeStatus.textContent = "Refreshing map data...";
        }

        try {
            const response = await fetch("/api/map-data", {
                cache: "no-store"
            });

            if (!response.ok) {
                throw new Error("Server returned " + response.status);
            }

            currentData = await response.json();

            drawMarkers();

            if (routeStatus && !activeAnimation) {
                routeStatus.textContent =
                    "Map updated. Locations shown use sample demonstration coordinates.";
            }
        } catch (error) {
            console.error("Map data error:", error);

            if (routeStatus) {
                routeStatus.textContent =
                    "Could not load map data. Make sure the Flask server is running.";
            }
        }
    }

    // Draw hospitals, emergency locations, and ambulance base locations.
    function drawMarkers() {
        emergencyLayer.clearLayers();
        ambulanceLayer.clearLayers();
        hospitalLayer.clearLayers();

        allMarkers = [];

        currentData.hospitals.forEach(hospital => {
            const position = validPoint(
                hospital.latitude,
                hospital.longitude
            );

            if (!position) return;

            const marker = L.marker(position, {
                icon: hospitalIcon
            }).bindPopup(`
                <b>🏥 ${safe(hospital.hospital_name)}</b><br>
                Location: ${safe(hospital.location)}<br>
                Demo beds: ${safe(hospital.available_beds)}<br>
                Facilities: ${safe(hospital.facilities)}<br>
                <small>Capacity information is illustrative.</small>
            `).addTo(hospitalLayer);

            allMarkers.push(marker);
        });

        currentData.emergencies.forEach(emergency => {
            const position = validPoint(
                emergency.latitude,
                emergency.longitude
            );

            if (!position) return;

            const marker = L.marker(position, {
                icon: emergencyIcon
            }).bindPopup(`
                <b>🚨 Emergency #${safe(emergency.id)}</b><br>
                Patient: ${safe(emergency.patient_name)}<br>
                Location: ${safe(emergency.location)}<br>
                Type: ${safe(emergency.emergency_type)}<br>
                Severity: ${safe(emergency.severity)}<br>
                Status: ${safe(emergency.status)}<br>
                Ambulance: ${safe(emergency.ambulance_name || "Not assigned")}<br>
                Hospital: ${safe(emergency.hospital_name || "Not selected")}<br>
                <small>Patient coordinates are simulated.</small>
            `).addTo(emergencyLayer);

            allMarkers.push(marker);
        });

        currentData.ambulances.forEach(ambulance => {
            const position = validPoint(
                ambulance.latitude,
                ambulance.longitude
            );

            if (!position) return;

            const marker = L.marker(position, {
                icon: ambulanceIcon
            }).bindPopup(`
                <b>🚑 ${safe(ambulance.ambulance_name)}</b><br>
                Base: ${safe(ambulance.location)}<br>
                Status: ${safe(ambulance.status)}<br>
                <small>This is not a live GPS position.</small>
            `).addTo(ambulanceLayer);

            allMarkers.push(marker);
        });
    }

    function showAllMarkers() {
        if (allMarkers.length === 0) {
            map.setView([13.638, 79.425], 13);
            return;
        }

        const group = L.featureGroup(allMarkers);

        map.fitBounds(group.getBounds().pad(0.15), {
            maxZoom: 15
        });
    }

    function findEmergency(id) {
        return currentData.emergencies.find(
            emergency => Number(emergency.id) === Number(id)
        );
    }

    function findAmbulance(emergency) {
        return currentData.ambulances.find(
            ambulance =>
                Number(ambulance.id) === Number(emergency.ambulance_id)
        );
    }

    function findHospital(emergency) {
        return currentData.hospitals.find(
            hospital =>
                Number(hospital.id) === Number(emergency.hospital_id)
        );
    }

    function stopAnimation() {
        if (activeAnimation) {
            clearInterval(activeAnimation.timer);
            activeAnimation = null;
        }
    }

    // Get a road route and animate a demo ambulance along it.
    async function startRoute(emergencyId) {
        const requestNumber = ++routeRequestNumber;

        stopAnimation();
        routeLayer.clearLayers();

        const emergency = findEmergency(emergencyId);

        if (!emergency) {
            routeStatus.textContent =
                "Emergency not found. Refresh the map and try again.";
            return;
        }

        if (emergency.status !== "Ambulance Assigned") {
            routeStatus.textContent =
                "Please assign an ambulance before starting the route.";
            return;
        }

        const ambulance = findAmbulance(emergency);
        const hospital = findHospital(emergency);

        if (!ambulance) {
            routeStatus.textContent =
                "The assigned ambulance was not found. Refresh the page.";
            return;
        }

        if (!hospital) {
            routeStatus.textContent =
                "Choose and save a hospital for this emergency first.";
            return;
        }

        const ambulancePosition = validPoint(
            ambulance.latitude,
            ambulance.longitude
        );

        const patientPosition = validPoint(
            emergency.latitude,
            emergency.longitude
        );

        const hospitalPosition = validPoint(
            hospital.latitude,
            hospital.longitude
        );

        if (!ambulancePosition || !patientPosition || !hospitalPosition) {
            routeStatus.textContent =
                "A location is missing valid demonstration coordinates.";
            return;
        }

        routeStatus.textContent =
            "Requesting a road route. Please wait...";

        /*
          Route order:
          ambulance base -> patient -> selected hospital.

          OSRM uses longitude,latitude order in its URL.
          This public demo service does not provide live traffic.
        */
        const coordinates = [
            ambulancePosition,
            patientPosition,
            hospitalPosition
        ].map(point => `${point[1]},${point[0]}`).join(";");

        const routeUrl =
            "https://router.project-osrm.org/route/v1/driving/" +
            coordinates +
            "?overview=full&geometries=geojson&steps=false";

        try {
            const response = await fetch(routeUrl);

            if (!response.ok) {
                throw new Error("Routing service returned " + response.status);
            }

            const result = await response.json();

            // Ignore an older request if the user started another route.
            if (requestNumber !== routeRequestNumber) return;

            if (
                result.code !== "Ok" ||
                !result.routes ||
                !result.routes[0]
            ) {
                throw new Error("No route was returned.");
            }

            const route = result.routes[0];

            const routePoints = route.geometry.coordinates.map(
                coordinate => [coordinate[1], coordinate[0]]
            );

            const road = L.polyline(routePoints, {
                color: "#1769aa",
                weight: 5,
                opacity: 0.85
            }).addTo(routeLayer);

            // Pickup marker.
            L.circleMarker(patientPosition, {
                radius: 8,
                color: "#b4232c",
                fillColor: "#ff646b",
                fillOpacity: 1
            }).bindPopup(`
                <b>Patient pickup</b><br>
                Emergency #${safe(emergency.id)}<br>
                ${safe(emergency.location)}
            `).addTo(routeLayer);

            // Destination hospital marker.
            L.marker(hospitalPosition, {
                icon: hospitalIcon
            }).bindPopup(`
                <b>Destination hospital</b><br>
                ${safe(hospital.hospital_name)}
            `).addTo(routeLayer);

            map.fitBounds(road.getBounds().pad(0.12));

            // Compute distance from the route geometry.
            const routeLatLngs = road.getLatLngs();

            let totalMetres = 0;

            for (let i = 1; i < routeLatLngs.length; i++) {
                totalMetres += routeLatLngs[i - 1].distanceTo(
                    routeLatLngs[i]
                );
            }

            const kilometres = (totalMetres / 1000).toFixed(1);
            const etaMinutes = Math.max(
                1,
                Math.round(route.duration / 60)
            );

            routeStatus.textContent =
                `${ambulance.ambulance_name} → patient → ` +
                `${hospital.hospital_name}. Approximate route: ` +
                `${kilometres} km; routing estimate: ${etaMinutes} min. ` +
                "Starting accelerated demo animation...";

            // Create a movable ambulance marker.
            const movingAmbulance = L.marker(
                ambulancePosition,
                { icon: ambulanceIcon }
            ).bindPopup(`
                <b>${safe(ambulance.ambulance_name)}</b><br>
                Simulated movement
            `).addTo(routeLayer);

            if (routeLatLngs.length < 2 || totalMetres <= 0) {
                routeStatus.textContent =
                    "Route displayed, but there are not enough points to animate.";
                return;
            }

            /*
              Accelerated presentation animation.
              It does not represent real driving speed or actual GPS movement.
            */
            const animationDuration = Math.min(
                25000,
                Math.max(7000, routeLatLngs.length * 35)
            );

            const segmentLengths = [];
            let measuredLength = 0;

            for (let i = 1; i < routeLatLngs.length; i++) {
                const length = routeLatLngs[i - 1].distanceTo(
                    routeLatLngs[i]
                );

                segmentLengths.push(length);
                measuredLength += length;
            }

            const startTime = Date.now();

            activeAnimation = { timer: null };

            activeAnimation.timer = setInterval(() => {
                const progress = Math.min(
                    1,
                    (Date.now() - startTime) / animationDuration
                );

                let distanceRemaining = progress * measuredLength;
                let position = routeLatLngs[0];

                for (let i = 0; i < segmentLengths.length; i++) {
                    const segmentLength = segmentLengths[i];

                    if (distanceRemaining <= segmentLength) {
                        const fraction = segmentLength > 0
                            ? distanceRemaining / segmentLength
                            : 0;

                        position = L.latLng(
                            routeLatLngs[i].lat +
                                (routeLatLngs[i + 1].lat -
                                 routeLatLngs[i].lat) * fraction,

                            routeLatLngs[i].lng +
                                (routeLatLngs[i + 1].lng -
                                 routeLatLngs[i].lng) * fraction
                        );

                        break;
                    }

                    distanceRemaining -= segmentLength;
                    position = routeLatLngs[i + 1];
                }

                movingAmbulance.setLatLng(position);

                if (progress >= 1) {
                    stopAnimation();

                    routeStatus.textContent =
                        `Demo route finished for emergency #${emergency.id}. ` +
                        "No real ambulance was dispatched.";
                }
            }, 60);

        } catch (error) {
            console.error("Route error:", error);

            if (requestNumber === routeRequestNumber) {
                routeStatus.textContent =
                    "Road routing is unavailable. Check your internet connection " +
                    "and try again. Emergency registration still works.";
            }
        }
    }

    // Wire up the controls in templates/index.html.
    document.getElementById("refresh-map")
        ?.addEventListener("click", refreshMap);

    document.getElementById("fit-map")
        ?.addEventListener("click", showAllMarkers);

    document.querySelectorAll(".start-route").forEach(button => {
        button.addEventListener("click", () => {
            startRoute(button.dataset.emergencyId);
        });
    });

    // Initial load.
    refreshMap().then(() => {
        setTimeout(() => map.invalidateSize(), 150);
    });

})();
