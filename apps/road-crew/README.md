# Road Crew App

The universal React Native + Expo field app for Road Crew. The same codebase
ships as an installable web app and as native iOS/Android builds. It is the only
field-app development target.

The backend this app talks to (referred to below as the Worker, and the Admin
console that reads from it) is not part of this repository; the sections below
describe how the client behaves against it.

## Core behavior

- Route selection, sequence search and direct sequence-number jumps, GPS following, and Mapbox/ArcGIS maps. Home places the centered numeric jump box in its own row below the icon tiles and clears it after a successful jump.
- Phone layouts plus the combined tablet/desktop Route workspace, whose GPS
  header stacks heading over whole-number MPH and keeps Previous/street sign/Next adjacent in landscape
- Tracked van selection, fleet location reporting, and Crew Vans health metadata
- Command notifications and optional per-van messaging
- Bundled/cached route data, local settings, diagnostics, and offline web shell

Native binaries include the current validated route catalog and path geometry,
so a newly installed app can open routes and sequences before it has ever
reached the Worker. A valid newer AsyncStorage copy takes precedence. Network
refreshes replace that copy only after structural validation, and reconnect or
foreground events force a fresh fetch without discarding the last usable data
when a response is malformed or interrupted. On native, route and fleet
responses must also start and finish in the same foreground lifecycle epoch;
responses crossing an inactive/background transition cannot mutate the mounted
map. A valid route response may still update the route cache. Foreground
refresh work waits briefly for the iOS surface transition to settle. Native
visual animations run on the platform animation driver instead of writing
Fabric shadow-node props from JavaScript on every frame. The field layout owns
one shared route-data provider, and identical generated catalogs retain their
existing object identity so Mapbox does not receive repeated full-GeoJSON prop
commits at lifecycle boundaries. The shared status clock continues running
while the app is inactive and does not govern location or heartbeat work.

Native GPS maintains one foreground watch for the field workspace. A freshness
watchdog requests a current position if iOS stops emitting stationary updates,
and foregrounding the app forces an immediate refresh. A tracked van also
registers Expo's background-location task after the driver grants background
permission; while the app is not foregrounded it sends only the newest valid
fix, at roughly 30-second intervals. Turning tracking off or clearing the van
assignment stops that task. Sequence Follow pauses for 12 seconds after manual
drag or momentum scrolling ends. Manually toggling Follow off clears that
browsing hold and requests a fresh GPS fix without moving the list. Toggling it
on smoothly scrolls to the highlighted sequence.

The Worker returns `backgroundLocationPolicy` on every heartbeat. Its
`BACKGROUND_LOCATION_PAUSES_UPDATES_AUTOMATICALLY` environment variable controls
the native iOS `pausesUpdatesAutomatically` setting; the app persists a changed
value and re-registers its background task after the next successful heartbeat.
All checked-in environments currently set it to `false` for continuous tracked
van reporting. Re-registration from a background location callback reads the
existing permission state only and never attempts to show an iOS permission
prompt while the app is headless.

Every heartbeat also carries the Worker-wide `locationTrackingPolicy`. When
`DISABLE_VAN_LOCATION_TRACKING=true` on the deployed Worker, the app persists a
locked-off policy, forces its local tracking value off, stops native background
location updates, and hides the Tracked control. Foreground heartbeats still
include the reporting van's current valid fix. This server policy overrides both
the stored device setting and a queued enable command. Removing the flag unlocks
the control without silently resuming background sharing.

Native Mapbox builds cache detailed map tiles in small regions around every
valid sequence marker on the active route. The app keeps the Mapbox cache at
the 750-tile limit, resumes incomplete regions, and replaces Road Crew's stale
offline packs when the selected route or its sequence coordinates change.
Disconnected route changes preserve the previous packs until Mapbox can reach
the network; transient download failures retry with bounded backoff and resume
again on reconnect or foreground. Backgrounding aborts the current offline-pack
UI cycle and suppresses Mapbox camera, user-location, and progress callbacks
until the app is active again.
Tapping a sequence marker opens its route detail popover with the configured
navigation-provider link. Cumberland Farms fuel markers and addresses are
bundled from the official store directory for offline use; nearby stores are
shown as smaller blue markers that cluster dynamically with zoom, and clicking
one opens its address and navigation links. The Cumbys w/gas layer can be
hidden from the shared web/native map-layer picker, and that preference persists
across tabs and route changes without exposing labels from inactive routes.
Both maps provide north/reset, current-location, and imperial scale controls;
native controls are app-rendered so they remain legible and inside the safe map
bounds. The map can also be expanded to full screen. Home
provides a sequence-number jump that changes routes when needed, centers the
map, opens that sequence's details, and consumes the request once the popup is
open so it cannot replay later.
On native tablets, including compact and split-view windows, the jump opens the
dedicated Route workspace so the sequence list and map remain visible together.
Phones keep separate Sequences and Map paths; an accidental phone link to Route
redirects to Sequences.
Selecting a sequence card in the list opens the same centered modal treatment
used by the rest of the field app, with scrollable details and navigation
choices that remain usable on small screens.
Nearby fleet vans also cluster dynamically on the dedicated Map screen and the
combined Route workspace. Orange marker shades preserve fresh/stale/old age
meaning while staying distinct from Cumberland Farms, and each marker uses a
white van-silhouette underlay for a clean contour border. Counted van clusters
use the same bright orange. Selecting an individual van shows its route and
last-seen age. Sequence map popups show the sequence's distance to the next
sequence and first/last rider times.
Interacting with the map dismisses the completed offline-status message.

Web installs precache the generated app shell, hashed Expo assets, icons, route
catalog, and path geometry. Deep links therefore cold-reload offline after the
service worker is installed. Mapbox web assets use a separate stale-while-
revalidate cache capped at 750 entries; dynamic `/api/*` requests are never
cached. ArcGIS is fetched only if the driver selects the ArcGIS map.

Native builds send one foreground sync on launch,
reconnect, foreground, and approximately every 30 seconds. Native installs also
register an OS-scheduled background heartbeat that refreshes Command's device
last-seen timestamp and pulls missed Command messages independently of GPS
tracking. The native scheduler is best-effort and inexact while the app is
suspended; a tracked van additionally reports while backgrounded through the
native background-location task after the driver allows it, without queueing
stale fixes during an offline period. Android requests location callbacks on a
45-second interval; iOS accepts unfiltered native callbacks because its Expo
`timeInterval` option is Android-only, then the shared app throttle limits
network heartbeats to at most one every 45 seconds.
These syncs carry current release/build/platform metadata plus the selected
route and receive Command notifications. Foreground syncs from a native van
install always attach its newest valid GPS fix, including before it selects a
van and while **Untracked**. The Worker retains that fix on the Admin device
heartbeat. Fleet map reads remain a separate `GET /api/locations` while the map
is active, and return only assigned vans whose observed Tracked state is on.
When a background heartbeat applies a Command tracking change, it immediately
sends a follow-up heartbeat with the applied value so Admin clears the pending
state without waiting for the app to return to the foreground. App Info shows
the age of the latest successful heartbeat as **Last ping**. That value is
anchored to the Worker's accepted-at timestamp and continues aging against the
device clock while offline; path snapping is always on and Command chat is
always off.
The hosted web app makes no `/api/*` requests: heartbeat, fleet, van-roster API,
Command SSE, and Command polling are disabled by platform. Both platforms retain
the top-level `GET /version` check for automatic updates.
Fleet, Command, and outbox polling stop while disconnected. Last-known state
stays visible, recoverable send failures remain queued, and synchronization
resumes immediately when connectivity returns instead of waiting for the next
poll interval.

The sync can also carry a pending Command device action. **Untrack**
stops the native background location task; foreground heartbeats still send the
current GPS fix. **Change van** clears the assignment and reopens the picker.
The app acknowledges an action only after persisting it, and an explicit
standard choice remains in effect across reloads
and Reset App.
The **Tracked** toggle, **Change van** action, and van-install picker are exposed
only in native builds. The hosted web field guide always uses standard mode and
blocks all `/api/*` calls, regardless of Worker configuration.

When a device turns off **Tracked** in App Info, it remains in the live Crew Vans
registry and keeps checking in. Its last location is refreshed whenever the app
is foregrounded, but it is excluded from the Admin map and driver-facing fleet
location APIs, and native GPS does not continue running after the app moves to
the background. Turning tracking back on re-registers the background location
task after the device applies the change.

## Updates

Updates are discovered, downloaded, and activated automatically:

- At launch and every 15 minutes while open, web compares the deployed Worker
  `/version` build and native checks `expo-updates` against the EAS channel
  embedded in the binary. When an update is available, web clears this app's
  service-worker caches and reloads; native runs `fetchUpdateAsync` then
  `reloadAsync` for the compatible EAS update.
- After restart, the existing toast appears and a separate **App updated**
  notification is retained in the Notification Center. Availability prompts do
  not appear in the bell; the history retains at most the two most recent
  completed update notices. Runtime bundles contain no changelog history.

The App Info **Update App** control uses the same path manually. **Reset App** is
separate: it clears user state, preserves install-level tracking and Device ID,
and routes a tracked device through `/` so van selection can reopen.

Native-code or runtime-version changes require a new EAS binary before later OTA
updates can reach that runtime. JavaScript/assets-only updates can be published
to an existing compatible runtime.

### Publishing OTA updates

`.github/workflows/eas-update.yml` publishes an over-the-air update on push to a
dev branch (or via manual `workflow_dispatch`). OTA delivery is driven by the dev
branches. A binary embeds an EAS *channel*; each channel points at an EAS
*branch*; the workflow publishes to that branch:

| Push to git branch | Publishes to EAS branch | Channel pointing at it | Reaches |
| --- | --- | --- | --- |
| `beta` | `beta` | `preview` | TestFlight/internal installs |
| `main` | `main` | `production` | App Store installs |

Native binaries are cut separately, by **Xcode Cloud**, which builds automatically
on pushes to the `beta-testflight` and `production` branches. Expo/EAS is used
only for OTA — it never builds a binary. So `beta`/`main` ship JS-only OTA updates
fast, while `beta-testflight`/`production` cut fresh native binaries in Xcode
Cloud. The OTA workflow is gated by the `EXPO_TOKEN` repo secret and no-ops
cleanly when it is absent. Van install is a native platform capability: every
native binary and OTA has it, while the hosted web app hard-disables it. No
build or publishing environment variable controls that distinction.

One-time setup: a binary's embedded channel only receives updates once that
channel exists and points at the EAS branch the workflow publishes to. Create the
mapping once (channel → branch): `preview` → `beta`, `production` → `main`:

```bash
eas channel:create preview            # creates the channel
eas channel:edit preview --branch beta
eas channel:edit production --branch main
```

Or set it in the Expo dashboard. Without this mapping, `eas update --branch <name>`
publishes but no install resolves it.

Because binaries are produced by `expo prebuild` + Xcode Cloud (not `eas
build`), the EAS Update channel is **not** injected automatically. Each build
must set `EXPO_UPDATE_CHANNEL` so `app.config.js` bakes the `expo-channel-name`
update request header into the binary — set it as a custom environment variable
in the Xcode Cloud workflow (`preview` on the TestFlight/internal workflow,
`production` on the App Store workflow), and `export EXPO_UPDATE_CHANNEL=<channel>`
before running `expo prebuild` for a local release build. A binary built without
it embeds no channel and cannot receive OTA updates; `ci_post_clone.sh` warns
when the variable is unset.

## Stack

- Expo SDK 57, Expo Router, React Native, and TypeScript
- `expo-updates` for native OTA delivery
- AsyncStorage and Expo SQLite for persisted app/message state
- NetInfo for connectivity-aware sync plus Expo Location and Task Manager for shared foreground/background GPS
- Mapbox GL plus ArcGIS web components/WebView
- A Cloudflare Worker backend (not in this repository) for shared state

## Development

From the repository root:

```bash
npm install
npm --workspace apps/road-crew start
```

For an internal build that uses the protected Cloudflare data APIs, copy
`.env.local.example` to `.env.local` and fill in the two Access service-token
values before starting or building the app:

```bash
cp apps/road-crew/.env.local.example apps/road-crew/.env.local
npm --workspace apps/road-crew run ios
```

On native, the first launch seeds those build-local values into Expo
SecureStore; later API requests read the values from SecureStore and attach
the `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers. The filled
`.env.local` file is ignored by git.

This includes native van-roster requests and Command's SSE stream. The roster
uses the same Access-aware fetch path as heartbeats, then falls back to the
public/static roster only if the live roster is unavailable.

Point native development at another Worker with:

```bash
EXPO_PUBLIC_API_BASE_URL=http://localhost:8787 npm --workspace apps/road-crew start
```

Useful checks:

```bash
npm --workspace apps/road-crew run lint
npm --workspace apps/road-crew test
npm --workspace apps/road-crew run export:web
```

Most `expo-updates` APIs work only in release builds. Test automatic native
updates with a `beta-testflight`/`production` Xcode Cloud build, not Expo Go.

### Xcode Cloud

The tracked post-clone script regenerates iOS with Expo prebuild, then installs
the pinned native toolchain: Node 22 and CocoaPods, both via Homebrew. It
assumes the Xcode Cloud image provides Homebrew.

CocoaPods is installed as a prebuilt Homebrew bottle rather than through
`Gemfile`/Bundler. An earlier version of this script built CocoaPods' Ruby
gem dependencies from source via Bundler, which broke when Xcode Cloud
supplied an Intel Homebrew Ruby on an Apple Silicon host: Ruby's `mkmf`
native-extension probes launched Clang targeting the wrong architecture, so
checks failed incorrectly and gems like `json` compiled fallback code that
conflicted with the real Ruby headers. Homebrew's CocoaPods bottle ships
fully compiled, so no native-extension build ever runs in CI, which removes
that failure class entirely (for `json` and for any other native gem
CocoaPods might pick up later). The `Gemfile` at the app root still pins the
CocoaPods version for local development (`bundle exec pod install`); the CI
script parses that same pin and prints a warning (not a hard failure) if the
Homebrew formula has drifted ahead of it, so version skew is visible instead
of silent.

In the Xcode Cloud workflow's Environment settings, select explicit supported
Xcode and macOS versions instead of `Latest`. Review those pins deliberately
when updating Expo or Xcode; automatic image upgrades can change Homebrew and
compiler behavior without a repository change — this is what caused the
native-extension failure above.

Keep `Gemfile` and `ios/Podfile.lock` in sync; do not hand-edit generated
Xcode build phases because the Expo config plugins recreate them during
prebuild. The script preserves `ios/ci_scripts` across prebuild and logs any
Podfile lock drift without failing a legitimate dependency update.

Set `SENTRY_AUTH_TOKEN` as a secret Xcode Cloud environment variable and set
`SENTRY_ORG` and `SENTRY_PROJECT` when source maps and debug symbols should be
uploaded. When any value is absent, only Sentry upload is disabled; the Release
build still must produce a non-empty embedded `main.jsbundle` or the generated
verification phase fails the build.

The GitHub EAS Update workflow passes `SENTRY_ORG` and `SENTRY_PROJECT` from
repository Actions variables to the Expo config plugin. Configure those two
non-secret variables in the repository settings so EAS updates generate Sentry
properties without the missing-configuration warning.

The universal app initializes Sentry with the configured production DSN on both
native and production web builds. The browser uses `@sentry/browser` 10.25.0+
and native uses the Sentry React Native adapter; both expose the same metrics
adapter. Metrics are enabled in `Sentry.init()` and use the `road_crew.*`
namespace for startup, heartbeat latency/outcomes, tracking toggles,
session/install actions, route selection, push registration/background wakes,
location tasks, and update checks. Sentry Logs are enabled on web and native;
the console logging integration forwards `console.log`, `console.warn`, and
`console.error`, and the app emits structured logs for monitoring startup,
heartbeat failures, and tracking changes. Localhost and non-production web
hosts keep Sentry disabled when no DSN is configured.

To reproduce Xcode Cloud dependency setup locally, use a clean disposable Mac
checkout or worktree because the script replaces the generated `ios/` tree:

```bash
CI_PRIMARY_REPOSITORY_PATH="$PWD" zsh apps/road-crew/ios/ci_scripts/ci_post_clone.sh
```

## Structure

| Path | Purpose |
| --- | --- |
| `app/` | Expo Router screens and layouts |
| `src/api/` | Worker client and contracts |
| `src/auth/` | Session and tracking state |
| `src/field/` | Route, sequence, GPS, map, status, and settings UI; shared map modeling and navigation live in `mapModel.ts` and `navigationLauncher.ts` |
| `src/notifications/` | Banners, urgent notices, and notification center |
| `src/sync/` | Connectivity and Command message synchronization |
| `src/update/` | Sync, automatic update, reset, and update toast flow |
| `public/` | Web manifest, service worker, icons, and export assets |
| `app.json` / `app.config.js` / `eas.json` | Static Expo settings, shared version/build federation, updates URL, and channels; `app.config.js` embeds the OTA channel from `EXPO_UPDATE_CHANNEL` |
| `Gemfile` / `Gemfile.lock` / `ios/Podfile.lock` | Pinned CocoaPods version (local dev via Bundler) and native dependency graph |
| `ios/ci_scripts/ci_post_clone.sh` | Reproducible Xcode Cloud Expo prebuild and Homebrew CocoaPods setup |
| `.github/workflows/eas-update.yml` | Publishes OTA updates: git `beta` → EAS branch `beta` (`preview` channel), git `main` → EAS branch `main` (`production` channel) |

Current metadata is maintained in `packages/config/src/version.ts`.
`app.config.js` applies it to Expo's release, iOS build, and Android version
fields; release/build history is in `packages/config/VERSION_HISTORY.md`.

Keep platform map adapters focused on rendering and native SDK lifecycle:
`RouteMap.web.tsx` and `RouteMap.native.tsx` consume the same validated route
model and canonical props from `src/field/` so geometry, popup metadata, bounds,
and active-route behavior do not drift between platforms.
