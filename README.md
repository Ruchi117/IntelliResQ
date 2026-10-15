# RapidResQ

RapidResQ is a browser-based emergency coordination MVP with a driver/dispatch view, patient monitor, fictional hospital comparison, interactive map, trip-status workflow, and persistent incident history.

## Run locally

```sh
npm install
npm run dev
```

## Verify

```sh
npm test
npm run lint
npm run build
```

## Data and routing limitations

- The included patients, vital signs, ambulance positions, response times, and facility capabilities are simulated. All three hospitals are fictional. The UI does not claim live GPS, traffic, medical sensor data, or hospital availability.
- Incident history is stored in the current browser's `localStorage`. This static MVP does not synchronize data between browsers, operators, or devices. Clearing browser site data removes that history.
- Road routes and duration estimates are requested from the public OSRM demo routing service. It may be unavailable or rate-limited; the UI then labels straight-line-derived distance and duration as a fallback estimate, not a road route.
- OpenStreetMap tiles are used for the map. Routing and map tiles require internet access.
- This demo is not for clinical use or real emergency dispatch.

## Deploy to Vercel

Import the GitHub repository in Vercel. The included `vercel.json` configures the Vite build (`npm run build`) and static output (`dist`). No secrets or environment variables are required. A backend and shared production database are not included; a separately secured backend and database are required before coordinating multiple users or handling real patient data.
