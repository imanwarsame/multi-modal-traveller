# 🧭 Waypoint — multi-modal travel planner

Plan door-to-door trips across every mode — walking, cycling, driving, bus,
tube/metro, and train are all considered by default, and you tap to exclude any
you don't want to use. Waypoint works out options like:

- 🚲 **Cycle → 🚆 Train → 🚶 Walk** — ride to the best boarding station, take
  the train, walk the last stretch
- 🚗 **Drive & ride** — for long trips (say Southampton → central London),
  drive most of the way, park at a station on the approach side of the
  destination (a west-London tube stop), and ride transit into the centre
- 🚗 **Drive → 🅿️ Park → 🚶 Walk** — where to drive and park to reach a busy
  destination
- 🚗 **Park & ride** — drive to a nearby suburban station, park there, ride in
- Direct cycling, driving, or walking when that wins

Address search uses Mapbox's interactive Search Box API, so fuzzy queries,
city names, landmarks, and POIs all resolve — you don't need an exact address.

Each option shows total time, estimated cost, and a leg-by-leg breakdown, ranked
by **fastest** or **cheapest** — your choice. Routes are drawn on a Mapbox map
colour-coded by mode (green = cycle, purple = drive, orange = transit, grey =
walk; dashed lines are estimated transit legs).

The layout is responsive: a sidebar on desktop, a draggable bottom sheet over
the map on mobile. Light and dark themes follow your system preference.

## Getting started

```bash
npm install
npm run dev
```

You need a free **Mapbox public token** (`pk.…`) from
[account.mapbox.com/access-tokens](https://account.mapbox.com/access-tokens/).
Either:

- put it in a `.env` file (`cp .env.example .env` and fill in
  `VITE_MAPBOX_TOKEN`), or
- just start the app — it asks for the token on first run and keeps it in
  `localStorage`.

Other scripts: `npm test` (vitest unit tests), `npm run build` (typecheck +
production build), `npm run preview`.

## How it works

Everything runs client-side against Mapbox APIs:

| Concern | API |
| --- | --- |
| Address search / autocomplete | Mapbox Search Box suggest + retrieve |
| Walking / cycling / driving legs | Mapbox Directions v5 |
| Finding stations, metro stops, bus stations, car parks | Mapbox Search Box category search |
| Map rendering | Mapbox GL JS v3 |

The planner (`src/lib/planner.ts`) builds candidate itineraries in parallel,
restricted to the modes you've left enabled (short connecting walks are always
allowed):

1. **Direct options** per enabled mode (walking only offered under 3 km,
   cycling under 30 km).
2. **Transit combinations** — it finds hubs of the enabled transit kinds
   within ~6 km of both the origin and destination, then picks the same-kind
   hub pair that covers the largest share of the trip with the least access
   distance (`pickHubPair`). Access is by bike if enabled (with a walk-based
   variant too, since bikes aren't always allowed aboard).
3. **Car combinations** — drive to the car park closest to the destination and
   walk in, or drive to an origin-side rail/metro station (park & ride).
4. **Drive & ride** (trips over 15 km) — probe for rail/metro stations at a
   standoff point on the approach side of the destination, then pick the
   board/alight pair minimising rough drive + ride + walk time
   (`pickApproachPair`). This is what suggests "park at a west-London tube
   station and take the tube in" for Southampton → London.

Failed candidates (no hub nearby, no route) are dropped silently; whatever
remains is deduplicated and ranked.

### Honest limitation: transit legs are estimates

Mapbox has no public-transport routing, so transit legs
(`src/lib/transit.ts`) are estimated from straight-line distance × a route
factor, an average speed per mode (rail 45 km/h, metro 30, bus 16), plus a
typical wait. Fares and driving/parking costs use the constants in
`src/config.ts` — tune them for your city. Every transit itinerary carries a
visible "check the live timetable" note in the UI.

To get real schedules, replace `estimateTransitLeg` with a client for a GTFS
feed or an [OpenTripPlanner](https://www.opentripplanner.org/) instance — the
rest of the planner only depends on the returned `Leg` shape.

## Project layout

```
src/
  config.ts            speeds, fares, cost constants, distance limits
  types.ts             Place, Leg, Itinerary, PlanOptions
  lib/
    geo.ts             haversine + formatters
    mapboxApi.ts       geocoding, directions, category search, token storage
    transit.ts         transit leg estimator (swap for GTFS/OTP)
    planner.ts         itinerary generation, hub-pair selection, ranking
    __tests__/         vitest unit tests for the pure logic
  components/
    PlaceInput.tsx     autocomplete input with "use my location"
    ItineraryCard.tsx  result card with leg chips and step details
    MapView.tsx        Mapbox GL map, colour-coded legs, markers
    TokenGate.tsx      first-run Mapbox token screen
  App.tsx              state + responsive layout (sidebar / bottom sheet)
```
