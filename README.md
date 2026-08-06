# Road Crew

Route operations platform for cycling-event road crews: one universal Expo field
app for web, iOS, and Android, plus the shared packages it is built from.

## Repository map

| Path | Purpose |
| --- | --- |
| [`apps/road-crew/`](apps/road-crew/README.md) | Universal Expo app for web, iOS, and Android; the only field-app target |
| [`packages/contracts/`](packages/contracts/) | Canonical shared types for route/geo data and the backend API |
| [`packages/core/`](packages/core/) | Pure route/geo logic: nearest-sequence, path distance, formatting, validation |
| [`packages/data/`](packages/data/) | Cross-platform route-data loader |
| [`packages/data/routes/`](packages/data/routes/) | Baked route catalog, sequences, and path geometry |
| [`packages/config/`](packages/config/README.md) | Unified runtime config plus release/build metadata |
| [`packages/ui/`](packages/ui/) | Shared design tokens and theme |

## Quick start

```bash
npm install
cp apps/road-crew/.env.local.example apps/road-crew/.env.local
npm --workspace apps/road-crew start
```

Maps need your own Mapbox access token in `EXPO_PUBLIC_MAPBOX_TOKEN`. Use a
public (`pk.`) token: Metro inlines it into the client bundle, so it is readable
by anyone with the app. No token is committed to this repository, and the map
surfaces stay inert until one is configured.

Run the main checks:

```bash
npm run lint
npm run test:app
npm run test:packages
npm run test:scripts
```

Build the universal web client:

```bash
npm run build:web
```

The export lands in `apps/road-crew/dist/` and can be served with
`npm run serve:app`. End-to-end tests run against that export:

```bash
npm run test:e2e
```

## Route data

`packages/data/routes/` holds the baked route catalog: five routes with their
full turn-by-turn sequences, coordinates, rider pass times, and path geometry.
The app bundles this data so a fresh install can open routes and sequences
before it ever reaches the network.

Sequence records carry no operational notes. The upstream data had a
per-sequence `remarks` field used for internal crew instructions; it is not part
of this repository's data or its type contracts.

## Backend

The app talks to a backend over the `/api/*` surface described in
[`packages/contracts/src/index.ts`](packages/contracts/src/index.ts) and
[`packages/config/src/index.ts`](packages/config/src/index.ts). That service is
not part of this repository. The hosted web build makes no `/api/*` requests at
all; it runs entirely from bundled route data plus the unauthenticated
`GET /version` check used for updates. Native builds are the only ones that use
the authenticated surface.

Point a native dev build at your own backend with:

```bash
EXPO_PUBLIC_API_BASE_URL=http://localhost:8787 npm --workspace apps/road-crew start
```

## Versions and releases

Release and build metadata live in
[`packages/config/src/version.ts`](packages/config/src/version.ts). The dynamic
Expo config applies that value to the native app config, and shared runtime
consumers import it directly. Human-readable history is in
[`packages/config/VERSION_HISTORY.md`](packages/config/VERSION_HISTORY.md).
For every app release, update `version.ts` and record the build in the version
history; see [`RELEASE.md`](RELEASE.md). The web export generates
`/js/version.js` from the same runtime metadata.
