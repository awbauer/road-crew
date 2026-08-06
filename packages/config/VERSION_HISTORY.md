# Road Crew Version History

This file is the human-readable archive of app releases and builds. Runtime and
Expo config derive only the current release and build from `src/version.ts`.

## Full history

### v2.2.0 (build 17858692)

- Attached valid foreground GPS fixes to native van-install heartbeats before a
  van is selected, and retained the last accepted device fix across heartbeats
  that do not carry a location.
- Kept unassigned fixes Admin-only, labeled tracked unassigned Admin markers as
  **(van id not set)**, and excluded Tracked-off devices from both the Admin map
  and every driver-facing location response.

### v2.2.0 (build 17858562)

- Changed **Untracked** to stop only native background GPS. Reporting vans now
  continue attaching their current valid coordinates to foreground heartbeats,
  and the Worker accepts only explicitly foreground fixes while still rejecting
  stale or unidentified background callbacks after tracking is disabled.
- Applied the same distinction to the fleet-wide tracking policy and clarified
  the Road Crew, Command, Worker, API, and release-checklist language.

### v2.2.0 (build 17858557)

- Made van install a native-only platform capability: every iOS and Android
  binary has it, while the hosted web app always disables it. Removed the OTA,
  Xcode Cloud, and web-export environment plumbing that could let manifests or
  build configuration drift.

### v2.2.0 (build 17857905)

- Fixed freshly installed binaries shipping with van install off, which is why a
  new install shows no vans on the Map, no Tracked toggle and no van picker
  until an OTA update happens to replace its manifest. `app.config.js` reads
  `VAN_INSTALL` during `expo prebuild`, and the Xcode Cloud clone script never
  set it — so it resolved to false and got baked into the embedded manifest.
  Every OTA publish already sets it true, and the Worker carries
  `VAN_INSTALL=true` in every environment, so the binary was the one place the
  flag was missing. `ios/ci_scripts/ci_post_clone.sh` now defaults it to true
  before prebuild, the same guard it already applies to `EXPO_UPDATE_CHANNEL`
  for the same reason, and an explicit value still overrides it.

### v2.2.0 (build 17857735)

- Preserved an assigned Crew Van's stored van and route when an ordinary
  heartbeat omits `vanId`. The Worker now clears that assignment only when the
  blank heartbeat acknowledges a pending `reset-van` command, while new
  unassigned van installs remain visible in Admin.

### v2.2.0 (build 17857194)

- Added the Worker `DISABLE_VAN_LOCATION_TRACKING` environment flag as a
  fleet-wide location-reporting shutoff, defaulting to enabled in every Worker
  environment. While enabled, the Worker rejects
  fixes and returns a locked-off tracking policy; foreground, scheduled, and
  location-task app paths persist tracking off and stop native reporting.
- Hid the Tracked control while the server policy is disabled and preserved the
  lock through restart, offline launch, and Reset App. Removing the flag
  unlocks the control without automatically resuming location sharing.
- Consolidated route loading into one field-app provider and skipped React and
  Mapbox updates when a forced refresh returns the same generated catalog,
  preventing duplicate full-GeoJSON native prop commits at lifecycle edges.
- Kept the status timestamp ticker running in the background; location and
  heartbeat tasks remain independent and continuously available.

### v2.2.0 (build 17856128)

- Kept relative timestamps live without network responses by measuring the
  latest raw server timestamp against a foreground-aware device clock. Field
  status, notifications, fleet-map labels, Admin messages, Crew Vans table
  state, detail history, and map markers now continue aging while offline.
- Added the Worker's accepted heartbeat time to heartbeat responses so the
  field app's persisted Last ping value is server-authored rather than a local
  request-completion estimate.

### v2.2.0 (build 17857180)

- Moved the sequence pulse, confirmation pulse, and notification-banner
  animations onto the native animation driver on iOS and Android. This avoids
  per-frame JavaScript `setNativeProps` writes racing Fabric/Reanimated shadow
  tree clones, removing the suspected trigger for intermittent
  `folly::dynamic::hash` crashes while backgrounding the Mapbox view.

### v2.2.0 (build 17856032)

- Prevented native route and fleet requests that cross an inactive/background
  boundary from committing new GeoJSON-backed UI state. Foreground refreshes
  now wait briefly for the iOS surface transition to settle, and a queued
  refresh runs after any older in-flight request finishes.
- Paused Mapbox camera, user-location and offline-pack UI callbacks while the
  app is inactive. Backgrounding also aborts the current offline-pack UI cycle
  so Fabric does not clone the map's ShapeSource tree during the transition.
  Suppressed route and fleet commits leave Sentry breadcrumbs for rollout
  verification.

### v2.2.0 (build 17855891)

- Replaced the raster van marker's SDF halo with a slightly larger white van
  silhouette beneath the orange marker. The old halo could render as a block
  around the PNG; the new underlay follows the vehicle contour on both native
  and web maps while leaving its windows clear.

### v2.2.0 (build 17855879)

- The combined tablet Route workspace now polls and renders nearby fleet vans,
  matching the dedicated Map tab. Its Mapbox view previously received no fleet
  data even while those vans were reporting normally and Command showed their
  current locations.
- Fleet van markers now use a shared orange fresh/stale/old palette across web
  and native maps, with bright-orange counted clusters and dark count labels.
  This keeps vans visually distinct from Cumberland Farms without discarding
  the existing location-age signal.

### v2.2.0 (build 17855847)

- Fixed freshly installed binaries shipping with van install off, which is why a
  new install shows no vans on the Map, no Tracked toggle and no van picker
  until an OTA update happens to replace its manifest. `app.config.js` reads
  `VAN_INSTALL` during `expo prebuild`, and the Xcode Cloud clone script never
  set it — so it resolved to false and got baked into the embedded manifest.
  Every OTA publish already sets it true, and the Worker carries
  `VAN_INSTALL=true` in every environment, so the binary was the one place the
  flag was missing. `ios/ci_scripts/ci_post_clone.sh` now defaults it to true
  before prebuild, the same guard it already applies to `EXPO_UPDATE_CHANNEL`
  for the same reason, and an explicit value still overrides it.

### v2.2.0 (build 17855845)

- Narrowed the white outline on field-map van markers from 4px to 2px, on both
  the native and web adapters. At 4px the outline read as a thick white collar
  that competed with the van silhouette itself; 2px still lifts a van off the
  road casings and the red route line without changing how the marker reads.
  The tint buckets, icon size and labels are untouched, and the shared marker
  asset needs no change — its transparent margin was padded for the wider
  outline, so it has more room than 2px asks for.

### v2.2.0 (build 17855840)

- Sequence navigation now always targets the sequence's GPS point, on every
  provider (Apple Maps, Google Maps, Waze) and on both the universal-link and
  native app-scheme paths. Previously each link was built from a text address
  — house number, street, town, "MA" — which asked the maps app to re-geocode
  a description of the cue back into a point, and that could land on the wrong
  end of a long street, a different "Main St", or a house number that does not
  exist on the map. The route data already carries the exact coordinate the cue
  was authored against, so nothing has to be re-derived.
- A sequence with no coordinate now yields a dead link and a disabled nav
  button instead of navigating somewhere plausible but wrong. The address form
  appended "MA" unconditionally, so a sequence missing its street and town
  still produced a non-empty address and sent the driver to the middle of the
  state. All 344 sequences in the shipped route data have coordinates, so no
  sequence loses navigation.
- The sequence address is still built and still shown in the detail modal; it
  is simply no longer what navigation aims at. The web map popup now carries
  lat/lng through its GeoJSON properties so its Navigate button can target the
  point too.

### v2.2.0 (build 17855833)

- Van markers on the field map now carry a 4px white outline, so a van reads
  clearly against a light basemap and against the red route line it usually
  sits on. The bucket tint (fresh/stale/old) is unchanged, and so is the van's
  on-screen size.
- Repadded the shared van marker asset from a 96px canvas rather than 64px to
  make that outline possible. Mapbox draws an SDF halo inside the icon's own
  quad, and the silhouette previously sat 2px from the right edge — a 4px
  outline needs roughly 11 source pixels of margin at this icon size, so it
  would have been clipped. The silhouette itself is the same pixel size, so the
  marker renders identically apart from the outline.

### v2.2.0 (build 17855802)

- Fleet vans on the field map now draw as the same van silhouette Command's
  Crew Vans map uses, instead of a plain colored dot, on both the native and
  web adapters. One white-on-transparent PNG rendered from the Font Awesome
  van-shuttle glyph is shared by both and registered as an SDF, so the existing
  freshness tint (fresh/stale/old) still colors the marker and no second asset
  is needed per state. Clustering, popups and hit targets are unchanged; on web
  a failed image decode falls back to the previous dot rather than dropping the
  fleet.
- Van ID labels are larger (13px), bold and more tightly haloed. At 10px with a
  soft halo they read as muddy on a phone against a light basemap. The marker
  and its label also no longer drop out for collision with basemap labels, and
  each van icon is explicitly anchored on the van's own GPS coordinate.

### v2.2.0 (build 17855800)

- Merged `main` into `beta`, bringing the Command bulk Enable/Disable tracking
  fix (build 17855423) onto the beta line. No functional change beyond the
  build bump this merge requires.

### v2.2.0 (build 17855423)

- Made Command's bulk **Enable/Disable tracking** usable on a mixed selection.
  Each button was gated on the entire selection already sharing one state, so
  selecting ten vans where nine were tracking and one was not greyed out both
  actions and the operator had to sort devices by state before acting — the
  normal case on a running route, not the exception. Each action is now offered
  whenever the selection contains anything it would change, sends commands only
  to those devices, and says how many were already set and left alone.

### v2.2.0 (build 17854684)

- Fixed the app sending about ten heartbeats in the first four seconds of every
  launch. Launch, foreground and reconnect deliberately skip the 25s minimum
  gap so Command sees a check-in the moment a driver opens the app, but the
  in-flight guard only stops heartbeats that overlap — anything re-firing those
  triggers during startup bought another one. Six hours of Worker logs across
  three vans had 47 of 83 heartbeats inside launch bursts. Forced heartbeats now
  coalesce within 3s of the previous one, which leaves the intended check-in and
  drops the repeats.
- Heartbeats now report the trigger that produced them ("launch", "focus",
  "interval", "reconnect", "visibility", "admin-action-ack") alongside the
  existing source, and the Worker logs it against a fixed list. `heartbeatSource`
  said which subsystem sent a heartbeat but not why, so a burst could be seen in
  the logs and not attributed without a device in hand.

### v2.2.0 (build 17854579)

- Added a "Change map" tile to Home. It opens the app settings half of the
  location modal, where Map type lives — previously reachable only by opening
  "Where am I?" and finding the toggle in its header, which is not where anyone
  looks for a map setting.
- Fixed which half of that modal opens. The choice lived in `LocationModal`,
  which stays mounted for the life of the field shell, so it survived a close:
  once anything had shown diagnostics, "Where am I?" and the status chip kept
  reopening on diagnostics for the rest of the session. The provider now owns
  it and every entry point states the half it wants, so "Where am I?" and the
  status chip always land on the location view and Change map always lands on
  settings.
### v2.2.0 (build 17854454)

- Fixed the Cloudflare Access service token being unreadable whenever the phone
  was locked. The Keychain items were written with the default
  `kSecAttrAccessibleWhenUnlocked`, so every read from a locked device threw
  "User interaction is not allowed" — and the throw was swallowed, which meant
  the background heartbeat and location reports went out with no
  `CF-Access-Client-Id`/`Secret` headers for Access to reject. A cradled van
  phone is locked for the whole ride, so this was the normal case, not the edge
  one. The token is now stored after-first-unlock and this-device-only, so it
  stays readable in the background from the first unlock after boot without
  riding along in a backup. Installs that already seeded a token rewrite it
  under the new attribute on their next successful read.
- A locked-device Keychain read is now a breadcrumb rather than a captured
  error; it is expected and self-correcting. Other Keychain faults still report.

### v2.2.0 (build 17854336)

- Collapsed applied commands in the Crew Vans device detail modal behind an
  "Applied (n)" disclosure. Settled commands are the bulk of a busy device's
  log and they were pushing the heartbeat history — the part an operator is
  usually scrolling for — off the bottom of the modal. Commands still in
  flight (pending, superseded, expired) stay expanded, since those are the
  ones that explain what the device is about to do. Numbering still counts
  from the full log, so a command keeps the same label whichever side of the
  disclosure it lands on.

### v2.2.0 (build 17853770)

- Fixed Crew Vans map markers wandering off their vans on zoom. Placement was
  `unproject(project(coord))` against the pixel centroid the clustering pass
  had measured, so the coordinate was re-derived from screen space every time
  the map moved. A pixel mean is not a geographic mean — Mercator compresses
  latitude — and the round trip is only valid at the zoom and centre it was
  taken at. A lone van now anchors on its own fix verbatim, and a cluster on a
  geographic mean, so pins hold still. Screen proximity still decides what
  clusters, which is the one part that should depend on zoom.
- Fixed Crew Vans "Last seen" disagreeing with the heartbeat history beside it.
  The cell mixed two clocks: the tab a row landed in and its status colour came
  from `hbAgeMs`, measured against the Worker's `now`, while the label the
  operator reads came from `formatRelative(row.hbTs)`, measured against the
  browser's. Any skew between the two showed a device as freshly reporting in
  one place and hours stale in the other, and let rows appear to change tabs
  independently of their label. Labels now format the same server-measured age
  that decides the bucket, so the two cannot contradict each other. The device
  detail modal gets the Worker's clock in its response for the same reason.
- `formatAge(null)` reports "never" rather than "just now" — a device with no
  usable heartbeat has an unknown age, not a zero one.
- Fixed Last seen reverting to a much older value minutes after a device
  reported. Every heartbeat wrote its device-history entry to its own key
  immediately, but the device record itself rode the once-a-minute state blob.
  A heartbeat arriving within that window of any other persist — an Admin
  snapshot poll is enough — had its write skipped, so the new timestamp existed
  only in the Durable Object's memory. Admin read it correctly from the warm
  object, the object was evicted, and the next cold start served the previously
  stored value: Last seen jumping backwards while the history beside it still
  listed the heartbeat. Rarely reporting devices were hit hardest, since nothing
  else came along to carry their update into a later write.
- Device records now live under their own `fleet-device:` keys, the same split
  already used for breadcrumb history, push registrations and command logs. A
  heartbeat persists one small record and leaves the shared blob alone, so Last
  seen is durable immediately without the blob being rewritten per report.
  Forcing a whole-blob write per heartbeat would have fixed the symptom but
  scaled badly: measured over 50 vans reporting every 30s for ten minutes, this
  writes the blob 10 times (its normal once-a-minute cadence) instead of 1000,
  and the blob holds 208 bytes rather than growing with the fleet toward the
  128 KiB per-value limit. A pre-split blob is migrated on load, independent of
  the persistence throttle.
- Heartbeats now write straight through to the Durable Object. The 20-second
  routine-heartbeat reservation — an AsyncStorage lock shared by the foreground,
  location-task and scheduled-task paths — dropped every heartbeat but the first
  in its window, so Command saw one report where three devices' worth of state
  had changed. Each path now sends its own. `bypassThrottle` went with it: with
  nothing left to bypass, keeping the parameter would have implied behaviour
  that no longer exists.
- `FEATURE_HIDE_VANS` is now `false` in production, matching beta and preview:
  public fleet locations are served to every caller rather than only the native
  Access service identity.

### v2.2.0 (build 17852077)

- Made the "Tracked" switch authoritative. Turning it off now always disables
  tracking, and it always shows the state actually applied.
- Root cause was two writers of one flag with no shared truth. The background
  location task and the silent-push sync wrote the session directly, bypassing
  the React state that both the switch and the foreground heartbeat read from.
  A background write left the UI stale *and* left the foreground holding a
  superseded value in a ref, which it then re-asserted to Command — undoing
  what had just been applied. Fixing silent push is what made these paths run
  often enough to collide. Session writes now notify, so every reader sees one
  source of truth.
- Tracking joins the command queue the rest of the device actions already use.
  The heartbeat response carries `trackingCommand` — an operator's pending
  change, with an id, like `adminAction` — and clients adopt only that. The
  bare `trackingEnabled` boolean is an echo of the device's own last report, so
  adopting it could only ever undo a newer local change; it stays in the
  response for older builds but is no longer read. This makes the guarantee
  structural rather than dependent on timing.
### v2.2.0 (build 17852058)

- Refreshed route data from the updated 2026 route-database PDF: added
  road-crew police coverage at four stops on Worcester-to-Bourne (day 1,
  route 1) and Wellesley-to-Dighton (day 1, route 2).

### v2.2.0 (build 17852054)

- Fixed silent Command wakes, which had never worked on any device.
  expo-notifications' iOS transformer nests every key except `aps` under
  `data`, so the Worker's `type`/`syncRequestId` arrive at `payload.data.*`;
  the client read `payload.*`, found nothing, and discarded every wake as
  "ignored" before it sent a heartbeat or an acknowledgement. This is why an
  APNs `accepted` never advanced Last seen, why `lastWakeAt` was null on the
  entire fleet, and why remote tracking changes only landed once a driver
  foregrounded the app. Devices with tracking on looked healthy because their
  45-second location-task heartbeat carried commands anyway.
- The payload parser moved to its own dependency-free module and now resolves
  the iOS nested shape, Android's `dataString`, and a flat payload, so a future
  change to the wrapper degrades instead of silently dropping wakes. It has
  direct test coverage against a real transformer payload.
- An unrecognized wake now acknowledges as `ignored` instead of returning
  silently, so a payload-shape change is visible in Command.
- The diagnostics export gained `remoteTrackingEnabled` and the background
  notification task's own event log — the only record of a wake that survives a
  device with no background connectivity.

### v2.2.0 (build 17851940)

- Shortened the silent-wake retry cooldown from 2 minutes to 30 seconds for
  every admin-initiated push — a route/van change, a tracking toggle, and the
  manual "Request update" sync all share the same gate. Apple gives no
  delivery guarantee for a background push, so an operator retry is the only
  recovery when the first one is dropped; 2 minutes made that recovery too
  slow to use in practice. Still counts accepted deliveries only, so a
  rejected or errored send never eats the next attempt.

### v2.2.0 (build 17851938)

- Changing the route from Home now jumps straight to the screen that shows it
  — Route on a tablet, Map on a phone — instead of leaving the driver on Home
  to tap again. Matches the same tablet/phone split the "Jump to sequence"
  field already used.

### v2.2.0 (build 17851845)

- Restored the house number on the "Where am I?" location card. Mapbox only
  puts one in its street field for an `address` feature; on the rural roads
  these routes run it answers with a `street` feature instead, so the card had
  been showing a bare road name ever since build 17851215 dropped the full
  postal address line. The number is now taken from the first segment of the
  formatted address when the street field has none — the number and road only,
  since the town keeps its own row. An ordinal road name such as "1st Avenue"
  is not mistaken for a numbered address, and offline the line stays the
  bundled street name as before.
- The "Where am I?" closest-intersection card is now hidden when no crossing
  resolves, instead of standing empty as "Intersection unavailable". A blank
  result means no route is selected, the fix is off route, or nothing authored
  sits within the search radius — none of which the driver can act on, and all
  of which read as a fault in a box that is otherwise the answer.

### v2.2.0 (build 17851791)

- Made a silent Command wake report what it did. The background task now
  acknowledges every wake to the Worker via `POST /api/push/wake`, including
  the cases where it deliberately sends no heartbeat, so an APNs `accepted`
  that never advances Last seen can be told apart from a push iOS never
  delivered. The outcome appears in the Crew Vans device detail as
  `lastWakeOutcome`.
- A wake that skips no longer reports success: it returns `NoData` to iOS and
  tags its metric with the skip reason instead of `success`.
- The device sync response now carries the target's van, Last seen age, and
  last wake acknowledgement alongside the APNs status.

### v2.2.0 (build 17851731)

- Restored Crew Vans Admin device history as a bounded raw request log. It now
  retains every heartbeat received by the Worker, keeping only the ten newest
  entries, without sampling or compacting lifecycle bursts.

### v2.2.0 (build 17851729)

- Extended the targeted silent APNs wake from Enable tracking to every Crew
  Vans device command: route changes, tracking on/off, and Change van.
- Added individual and bulk **Request update** actions in Command. They request
  an immediate state heartbeat from the device without creating a pending
  command.

### v2.2.0 (build 17851704)

- Made the Command device-heartbeat history a useful audit trail rather than a
  raw request log. The Admin detail modal now retains at most one unchanged
  snapshot per two minutes, while immediately preserving app/device state and
  lifecycle-source changes. Every heartbeat still updates Last seen and
  resolves Command actions.
- Prevented concurrent iOS background-location callbacks from passing the
  report interval together and flooding Command with duplicate heartbeats.
  Queued callbacks now stop cleanly after tracking is off; the independent
  background heartbeat task continues Command polling in that state.
- Added one durable routine-heartbeat reservation shared by foreground,
  location-task, and scheduled-task paths, so they cannot each send their own
  raw Worker request during the same lifecycle burst. Command acknowledgements
  and APNs-triggered syncs remain immediate.

### v2.2.0 (build 17851690)

- Fixed APNs provider JWT encoding so its header and claims are UTF-8 JSON,
  rather than empty values. Added a regression test that decodes and verifies
  the ES256 token signature before APNs receives it.

### v2.2.0 (build 17851683)

- Preserved APNs' `apns-unique-id` in Worker delivery diagnostics and the
  Admin device-details modal whenever APNs returns it, without exposing the
  device token. This identifier is available only for development APNs sends.
### v2.2.0 (build 17851218)

- Merged the OTA white-flash fix (build 17851198) into the "Where am I?"
  branch; no functional change beyond the build bump this merge requires.

### v2.2.0 (build 17851215)

- Fixed a real bug behind frequent "Intersection unavailable" reports: bundled
  intersection records where the first street name itself contains a comma
  (e.g. "Main St., (Rt. 109) & North St., Medfield") were silently discarded,
  because the parser stripped the trailing town by splitting the whole string
  on its first comma — cutting the crossing off before reaching the second
  street. The town is now read off only the last comma-separated piece of the
  segment after the final "&".
- Reworked the "Where am I?" location card: dropped the "LOCATION" section
  label, dropped the town/state suffix and the full postal address (state,
  zip, country) from what it shows, and made the street line the card's focal
  point (bigger) with the town below it (smaller). On native, the street line
  now includes the house number when the geocoder resolved one, instead of
  just the road name.
- The sequence detail now reads "Between 221 & 222" on route and "Off Route"
  otherwise, replacing "221 / 222" and "Nearest: 221".

### v2.2.0 (build 17851206)

- Removed the "Where am I?" Copy Info button and the expo-clipboard dependency
  it required. Share Location's OS share sheet already offers Copy alongside
  its other targets, so the separate button was redundant and its native
  module was the source of the crash fixed in build 17851203 — the whole
  problem is now gone rather than guarded against.

### v2.2.0 (build 17851203)

- Fixed a fatal crash on app open ("Cannot find native module 'ExpoClipboard'")
  caused by build 17851186: the "Where am I?" Copy Info button imported
  expo-clipboard at module scope, which resolves its native binding
  immediately — a throw there took down the whole field shell on foreground,
  on any binary built before that native module was linked in, which an EAS
  Update can ship JS to without a matching native rebuild. The import is now
  lazy, deferred to the Copy Info tap itself, so an unlinked binary shows
  "Copy unavailable" instead of crashing.

### v2.2.0 (build 17851198)

- Fixed the white flash when an OTA update is applied. `Updates.reloadAsync()`
  tears down and rebuilds the React root view, and React Native paints that view
  white until the reloaded bundle renders its first frame. Added `expo-system-ui`
  and the `backgroundColor` app config so prebuild writes
  `RCTRootViewBackgroundColor` (`#0b0b0d`) into `Info.plist` and the gap matches
  the app background. The launch storyboard is not involved: iOS shows it only on
  a cold process launch, never on an OTA reload, so the existing `splash`
  config could not affect this.

### v2.2.0 (build 17851186)

- Merged `beta` into the "Where am I?" branch; no functional change beyond the
  build bump this merge requires.

### v2.2.0 (build 17851179)

- Kept the hosted web field guide permanently in standard mode: it cannot open
  the van-install flow and fails closed before issuing any `/api/*` request.
  Native van-install behavior and the separate Admin console are unchanged.
- Updated the Admin device-details modal so timestamp fields show their
  relative age as well as the stored value and ISO time.

### v2.2.0 (build 17851177)

- Packaged the "Where am I?" Mapbox geocoding with the native app only. The web
  build ships no geocoder: it reads town and street from the baked route data
  and shows no address row, so a billed request only ever comes from a device
  in a van.

### v2.2.0 (build 17851164)

- Moved the "Where am I?" address, street and town onto Mapbox reverse
  geocoding on every platform, replacing the OS geocoder and making the bundled
  route values the offline fallback: route data is only granular at sequence
  points, so between two cues it named the road the last cue sent you down. The
  lookup runs when the modal opens and reuses a cached result anywhere within
  100 yards of a previous request, with no time-based expiry.

### v2.2.0 (build 17851150)

- Added non-sensitive APNs troubleshooting to the van app diagnostics export:
  iOS notification authorization, physical-device eligibility, APNs token
  acquisition/error state, and the Worker registration response/error. The
  raw APNs token remains excluded; the signed entitlement is explicitly marked
  as needing IPA inspection.

### v2.2.0 (build 17851147)

- Replaced the status sheet with a driver-facing "Where am I?" modal: town,
  closest intersection, street, coordinates, sequence pair, heading and location
  age all resolve offline from the bundled route data, with the postal address
  merged in afterwards from the platform reverse geocoder (Mapbox on web) and
  cached for five minutes / 75 metres. Copy Info and Share Location omit
  unavailable fields. The badge in the modal's top-left corner toggles the
  previous status and diagnostics content.

### v2.2.0 (build 17851062)

- Passed Sentry organization/project metadata through the EAS Update workflow
  and kept OTA reload transitions on the app's dark background. Enabled Sentry
  Logs on web and native, including console forwarding and structured logs for
  monitoring startup, heartbeat failures, and tracking changes.

### v2.2.0 (build 17851017)

- Added Sentry browser and native metrics for app startup, heartbeats, tracking
  changes, session/install actions, route selection, push/background execution,
  location reporting, and update checks.

### v2.2.0 (build 17850886)

- Added sanitized Apple push registration and delivery diagnostics to the
  Command device details modal without exposing the APNs token.

### v2.2.0 (build 17850781)

- Added a direct APNs silent wake to the existing Admin Enable tracking action;
  the van can run its background Command sync and acknowledge the applied
  tracking state without displaying a notification.

### v2.2.0 (build 17850372)

- Fixed Route list sequence cards to use the same navigation request as Home, so the Mapbox map centers and zooms to the sequence and opens its popup.

### v2.2.0 (build 17850348)

- Added the van's ten most recent GPS breadcrumb entries to the Admin device
  details modal and simplified the van status sheet's GPS fix display to the
  relative age only.

### v2.2.0 (build 17850325)

- Background tracking commands now acknowledge the applied state immediately,
  so Admin clears the pending change while the van remains backgrounded.
- Renamed the Admin status to "Tracking off" and simplified the van status
  sheet to show the last heartbeat as "Last ping"; path snapping is always on
  and Command chat is always off.

### v2.2.0 (build 17850320)

- Limited the van app's retained update notifications to the two most recent
  completed updates. Added an Admin Crew Vans device-detail modal with current
  device/location/command data and the ten most recent heartbeat records.

### v2.2.0 (build 17850293)

- Restored popup-only behavior for map markers. Route list sequence cards use the Home-style map jump to center, zoom, and open the selected sequence popup without scrolling the list.

### v2.2.0 (build 17850279)

- Route list cards now use the Home-style sequence jump to center, zoom, and open the corresponding Mapbox popup; all map markers continue to open their normal popups.
- Offline map readiness is reported only after packs are downloaded or updated; returning to the foreground with complete packs no longer repeats the ready message.
- The screen stays awake throughout Route view, independently of the Follow setting.

### v2.2.0 (build 17850266)

- Fixed native headless background tasks incorrectly treating their React
  runtime as foreground, so tracked location callbacks and Command syncs can
  refresh Last seen while the app is suspended; tracked callbacks now also
  apply queued Command actions and pull missed messages. iOS tracking now uses
  unfiltered native location callbacks because `timeInterval` is Android-only,
  while the app-level throttle still limits heartbeats to one per 45 seconds.

### v2.2.0 (build 17850254)

- Fixed explicit Follow-on refreshes restoring the previous sequence-list
  offset after the target jump, and aligned the E2E contracts with the current
  GPS heading and Crew Vans tab labels.

### v2.2.0 (build 17850205)

- Restored the native legacy locate handler and control while `NEW_MAP_FOLLOW`
  remains disabled after the beta merge.

### v2.2.0 (build 17850198)

- Limited E2E checks in the Test workflow to application pushes on `main`;
  pull requests retain the faster unit, package, syntax, and type/build checks.

### v2.2.0 (build 17850195)

- Added the opt-in `NEW_MAP_FOLLOW` flag for the new Map and Route map-follow
  interaction. It is currently false, so both views retain the legacy locate
  control while the follow rollout remains dark.

### v2.2.0 (build 17850189)

- Hardened the Command queue rollout with durable delivery timestamps,
  backwards-compatible Admin payload handling, clean-runner dependency setup,
  and cached Test workflow dependencies.

### v2.2.0 (build 17850096)

- Native van installs now register an OS-scheduled background heartbeat that
  keeps Command's device last-seen timestamp and missed messages moving while
  the app is suspended, independently of GPS tracking. The existing background
  location task also sends a heartbeat when tracking is paused or no fix is
  reportable.
- Command-initiated van, route, and tracking changes now use durable per-device
  command logs with audit status, supersession, expiry, and observed-state
  resolution. Crew Vans shows reported values plus additive pending markers, so
  one pending field no longer blocks unrelated commands.

### v2.1.7 (build 17850025)

- Follow now keeps the driver in the centre of the map without ever changing zoom. Both platforms re-centre on each fix and pass no zoom at all, so a zoom level the driver set themselves survives being followed. Native previously handed tracking to the Mapbox SDK's own follow mode, which applies its own zoom when it engages; web asked the geolocate control for a single position, so following stopped updating after the first fix. Panning the map still turns Follow off, but pinching to zoom no longer does — the two are told apart by how far the centre drifts from the driver, not by whether a gesture happened.
- The driver's position dot on web is now drawn from the app's own GPS watch, the same one feeding the GPS panel, rather than from a second watch inside the map.

### v2.1.7 (build 17850016)

- Follow now moves the map, not just the sequence list. The control in the Map and Route headers keeps the map centred on the driver, and the Map view gained that control on phones, where it had none. Centring never changes zoom — the old in-map locate button jumped to zoom 14 on every press, so a driver who had zoomed out to see the road ahead lost it. The locate button inside the map is gone on both platforms, since a second control there disagreed with the header about follow state. The Map screen also now holds the screen-wake lock outright instead of tying it to Follow.
- Command's fleet map reads no longer compete with van heartbeats. All devices share one fleet object that handles calls one at a time, so `GET /api/locations` is now coalesced for 5 seconds — every app polls the same global view, and concurrent readers share a single call — and the read itself no longer writes. Clients also spread their polling by ±20%, and the forced heartbeat after regaining connectivity is spread over a couple of seconds, so one cell site recovering no longer reconnects a whole fleet at the same instant.
- Both Command views refresh every 10 seconds. Crew Vans was on 30, and the main console polled nothing at all — its notification and van lists only updated on load or after a local change, so anything done from another session stayed invisible until a manual reload. The poll leaves an in-progress notification edit alone and pauses while a dialog is open.
- The build number is now enforced rather than remembered: a check fails when a branch changes shipped code without advancing it, wired to both `npm run check:build-bump` and a Claude Code stop hook. Documentation, tests, CI and tooling stay exempt.

### v2.1.7 (build 17849429)

- Van breadcrumb history is now kept for **one hour** instead of six, and is stored under one key per van instead of inside the shared fleet-state record. History was ~97% of that record's bytes, and the record is rewritten on every location heartbeat, so each van's report was rewriting every other van's breadcrumbs. The combined value also crossed Durable Object storage's 128 KiB per-value limit at around a dozen reporting vans — inside the 30-van roster — which would have failed every van's heartbeat at once. A full roster is now ~13 KiB of shared state (was ~326 KiB) plus independently written per-van history. Existing history is migrated automatically on the first heartbeat after deploy.
- A failed state write no longer fails the whole heartbeat. The device keeps its notifications, tracking flag, and pending Command action, and is told only that the location did not durably land; the next heartbeat retries the write.
- Breadcrumb history is now capped by point count as well as by the retention window, so dense or future-dated timestamps from a client cannot inflate a van's stored history.
- The "Untracked" status moved from the Status sheet to the GPS status pill in the map and route headers, where it replaces "Live" with black-on-dashed-outline styling. It reports only when nothing more urgent does — No GPS, GPS lost, Offline, GPS stale, Location issue, and the data warnings all still take priority.
- Background location reports are now sent at most every 45 seconds rather than every 30.
- Fixed the iPad Route workspace settling into the portrait stack while held in landscape. The split direction followed the reported app-window size, which lags a rotation and can briefly report transposed values; it now follows the workspace's measured on-screen frame, so it self-corrects instead of latching.
- iOS is no longer allowed to pause background location updates automatically. Beta and production were both deploying the pause policy as enabled, which let iOS stop delivering updates once it decided a van was stationary — so a parked van stopped heartbeating and never picked up Command's tracking changes until someone opened the app.
- The Status sheet's Build row now shows the Expo release channel alongside the build number on native.
- Fixed the app reporting "Location issue" when tracking was simply switched off. The last reporting status lingered after tracking was paused and read as a current fault.

### v2.1.7 (build 17849428)

- Heartbeats now report the device's hardware form factor, and Command's Crew Vans list shows it. The old Platform column reported only the OS, so a van's iPad and a crew iPhone both read "ios"; the column is now **Device** and names the hardware — "iPad", "iPhone", "Android tablet", "Web". Devices on a build that predates the field keep showing their platform rather than going blank, and a heartbeat that omits the form factor (such as a background policy ping) no longer clears an already-identified device.

### v2.1.7 (build 17849427)

- Fixed the iPad Route workspace rebuilding its map every time the device rotated. The list and map panes were rendered in opposite orders for landscape and portrait, so React tore down and recreated the native Mapbox view on each rotation; that churn restarted the offline tile downloads mid-flight and crashed the app (`RNMBXOfflineModule`, unbalanced `dispatch_group_leave`). Both orientations now render the panes in one order and only flip the split's direction, so the map survives rotation with its tiles and camera intact.
- The street sign in the tablet header now spans the full height of its row instead of floating inset in the middle of it.

### v2.1.7 (build 17849426)

- Fixed van locations going missing or stale in Command. Registering a device forced a durable write, so a van's *first* fix was saved, but every fix after it stayed in memory until the fleet object's next 60-second checkpoint. The object is evicted when idle, which discarded those fixes — the van was told each report succeeded while Command kept showing the registration fix or nothing at all. A recorded fix now forces the checkpoint immediately.
- The fleet object now emits a structured log per heartbeat and per Command snapshot (whether a fix arrived, what became of it, and how many vans are stored) so this class of problem is visible in `wrangler tail` and Cloudflare observability. Coordinates are never logged.

### v2.1.7 (build 17849372)

- Tightened the on-route/off-route corridor and gave it hysteresis. A van on route now stays on route until it is more than 80 m from the route, and has to come back inside 50 m to count as on route again. The old check flipped at a single 100 m line, which was wide enough that a parallel side street still read as "On route".
- The GPS panel now reports "Weak GPS" instead of guessing when a fix is less accurate than 100 yards, since the error is wider than the corridor itself. The last real on/off-route verdict is held through the weak patch rather than being reset, and the 100-yard next-target blink is suppressed until an accurate fix returns.

### v2.1.7 (build 17848049)

- Fixed the native map losing the driver's view: panning/zooming is now preserved when leaving and returning to the Map tab, and is only re-framed to the route bounds when the route first opens or changes (or when the app restarts).
- Restored the "current location" button in the map's top-right, under the compass, so drivers can recenter on themselves even when the location puck is off-screen.
- Worker heartbeats no longer wipe a device's stored `routeId` when a heartbeat omits it (e.g. a background policy ping). routeId is now sticky, keeping the admin Route column and public location route enrichment populated between full syncs.

### v2.1.7 (build 17847772)

- Command's Crew Vans "Remove device" action works again: the Durable Object RPC wrapper (`cloudflare.js`) now forwards `deleteDevice`, which was missing since the cleanup feature shipped and made every delete return a 400. A guard test now fails if any `callFleet` method is left unexposed. Van mutation failures also surface as a toast instead of only inline text, and tracked devices quiet for more than 24 hours automatically move to a new **Inactive** tab.

### v2.1.7 (build 17847739)

- The Worker now releases hidden fleet locations only when Cloudflare Access identifies the configured native service client, rather than trusting the raw client-ID credential header.

### v2.1.7 (build 17847724)

- Native van-roster requests and Command's SSE stream now use the same Cloudflare Access service-token headers as heartbeats, so they no longer bypass the authenticated API path.

### v2.1.7 (build 17847695)

- Worker heartbeats now deliver the `BACKGROUND_LOCATION_PAUSES_UPDATES_AUTOMATICALLY` policy to tracked native installs. A changed value re-registers the iOS background-location task remotely without prompting from a headless callback; all environments currently set it to `false` for continuous reporting.

### v2.1.7 (build 17847690)

- Preview and production OTA publishes now set `VAN_INSTALL=true`, preserving native van configuration after an over-the-air update.

### v2.1.7 (build 17847685)

- App updates now download and activate automatically on launch and during scheduled checks. The bell retains only the post-update confirmation and no longer shows actionable update prompts.

### v2.1.7 (build 17847679)

- The Mapbox-native location puck now recenters the map when tapped, replacing the custom locate control.

### v2.1.7 (build 17847675)

- `FEATURE_HIDE_VANS` now hides only public live map locations, not the van roster. The production Worker permits the configured native Cloudflare Access service client to read live map locations while the flag remains enabled.
- Removed the Freetown, both Bellingham, Attleboro store 006771, and West Yarmouth Cumberland Farms entries from both maps. Native standalone gas markers now have a crisp 3px white outline.
- Replaced custom native compass and scale controls with the Mapbox-provided controls so their orientation and measurements come directly from the map SDK.

### v2.1.7 (build 17847615)

- Both maps now render every sequence label with black text and a white outline. The next active sequence keeps its green circle, now with a white outline.

### v2.1.7 (build 17847613)

- The next active sequence label now uses a fully black fill and outline on both maps; the green highlight is limited to its marker.

### v2.1.7 (build 17847610)

- Web Mapbox now matches native: the next active sequence label uses black text with a white halo while its marker remains green.

### v2.1.7 (build 17847609)

- The next active sequence label on the native map now uses black text with a white halo; its green marker remains the active-route indicator.

### v2.1.7 (build 17847602)

- Native Mapbox now matches web fuel markers with gas-pump icons for individual Cumberland Farms locations, while nearby locations retain counted clusters. GPS headings now show only their cardinal direction, and Map-only no longer exposes Follow.
- Turning Follow on smoothly scrolls the sequence list to the current target. Airplane-mode recovery requests a fresh fix before its reconnect heartbeat and keeps a prior good fix visible instead of showing a generic location issue.
- Tracked van installs now use Expo Task Manager background location updates to report current valid fixes while the app is not foregrounded. This requires a new native binary and background-location permission.

### v2.1.7 (build 17847587)

- Road Crew now checks the native Expo channel on launch and every 15 minutes, and presents available updates through the persistent notification UI instead of applying them automatically. Home's bell now opens that notification center with its unread badge, and completed updates remain listed after the app restarts.

### v2.1.7 (build 17846725)

- Native map controls now sit closer to the top of the map in normal mode while fullscreen mode preserves safe-area spacing.

### v2.1.7 (build 17846724)

- Native Mapbox now matches the web map's layer picker, including independent route visibility, persisted Cumbys w/gas visibility, and sequence-number labels limited to the active route.
- Native north/reset, location, and imperial scale controls now use consistent app-owned styling and safe-area placement; the scale no longer clips against the bottom-right map edge.
- Xcode Cloud now aligns native-gem compilation with Homebrew Ruby's architecture, retries transient dependency installs, preserves custom CI scripts through Expo prebuild, reports native-extension and Pod lock diagnostics, persists the Homebrew Node path into Xcode build phases, disables only unconfigured Sentry uploads, and fails Release builds that omit the embedded JavaScript bundle.

### v2.1.7 (build 17846549)

- Road Crew now uses the new cycling-van artwork for Expo package and iOS app icons.

### v2.1.7 (build 17844870)

- Web and native maps now share one tested route/sequence model for geometry validation, active-route selection, bounds, popup metadata, flags, and address ranges. Invalid route paths consistently fall back to valid sequence coordinates.
- Native sequence and Cumberland Farms navigation now share one launcher that falls back from unavailable app schemes to universal links.
- Field settings, route selection, status, and notification providers now expose stable memoized context values and fail clearly when used outside their providers, avoiding unrelated consumer rerenders and silent no-op behavior.
- The Cumbys w/gas layer defaults to hidden on web and native while remaining available from the map-layer toggle.
- Web Mapbox popups use a balanced compact width with narrow label columns, long-value wrapping, and viewport-capped sizing and controls for small screens.
- The GPS panel stacks unlabeled heading and whole-number MPH values beside its vertical GPS label, and tablet landscape places Previous immediately left of the street sign while keeping Next immediately right.
- Native GPS now refreshes a silent iOS location watch before fixes become stale, ignores older cached callbacks, reports asynchronous watch errors, and recalculates status age on a deterministic clock.
- Sequence Follow now tracks touch, drag, and every momentum scroll frame, blocks delayed index retries during manual browsing, and starts its 12-second grace period only after the list has actually stopped moving. Manually toggling Follow off clears every scroll hold and requests a fresh GPS fix without moving the list; toggling it on also jumps to the highlighted sequence.
- Cumbys w/gas visibility is now one persisted web/native preference that survives tab and route changes, and changing it no longer exposes sequence labels from inactive routes.
- Home-to-map sequence jumps are consumed after the map opens the requested popup, preventing the same jump from replaying after navigation or route changes.
- Tablets now use a dedicated Route path for the combined sequence-list/map workspace. Native tablets keep that workspace in compact and split-view windows, tablet Home jumps open it with both panes intact, and phones retain separate Sequences and Map paths while redirecting accidental Route links to Sequences.
- Sequence-list details now use the shared centered modal instead of the retired swipeable slide-over, with scrollable small-screen content and accessible navigation actions.
- Nearby fleet vans cluster on web and native maps, and their popovers show route context and last-seen age. Sequence map popovers show rider times and distance to the next sequence.

### v2.1.7 (build 17844857)

- Map controls now include a north/reset control and scale indicator on web and native Mapbox maps; iPad landscape sequence navigation places Previous and Next on either side of the street sign, with Next consistently on the right.
- `packages/config/src/version.ts` is the only maintained release/build source; Expo native metadata, shared runtime metadata, and browser version assets derive from it automatically.

### v2.1.7 (build 17843127)

- Home places the centered numeric sequence jump box in its own row below the icon tiles, opens a phone keypad with the `Seq #` field, clears the field after a successful jump, and keeps the larger label inside the card.
- Standard builds without `VAN_INSTALL=true` now make no `/api/*` requests for heartbeat, fleet, van-roster, or Command sync; they continue using the top-level `/version` endpoint for update checks.

### v2.1.6 (build 17842589)

- Native installs now include validated route and path data so route selection, sequences, and route geometry work on a first launch with no connection.
- Route data, fleet locations, Command streams, polling, and queued messages pause cleanly while offline and reconcile immediately after reconnect or foregrounding; malformed refreshes preserve the last valid route catalog.
- Native Mapbox keeps the prior route's offline packs during disconnected route changes and automatically resumes transient downloads with bounded backoff, while web installs precache the complete app shell and route data and retain a bounded 750-entry Mapbox runtime cache.
- The default web path no longer loads ArcGIS until it is selected, and production-export performance checks now enforce load, layout-shift, transfer-size, and third-party-request budgets.
- Crew Vans restores the Pending changes review tab while preserving route/van changes in Active and untracking actions in Deactivated until acknowledgement.

- The Mapbox maps bundle official Cumberland Farms fuel locations, show smaller blue markers that cluster dynamically with zoom, and open store address/navigation popovers when clicked. The map includes a Cumbys w/gas visibility checkbox and full-screen control, while Home can jump directly to a sequence, switch routes when needed, and open it on the map.

### v2.1.5 (build 17842535)

- Standard builds without `VAN_INSTALL` enabled no longer show the Tracked toggle, Change van action, or van-install picker, including when stale tracked-install state is still persisted.

### v2.1.4 (build 17842314)

- Native Mapbox offline coverage now downloads small regions around the active route's sequence markers instead of one oversized route rectangle.
- Road Crew enforces Mapbox's 750-tile ceiling, resumes incomplete sequence packs, and rebuilds its offline plan when the selected route or route coordinates change.
- Offline progress and failures now reflect actual pack completion without interrupting the visible route map.
- Native Mapbox sequence markers now open detail popovers, and the offline-ready message dismisses after the first map gesture.
- The iOS bundle identifier is now `dev.awbauer.roadcrew` for App Store distribution.

### v2.1.3 (build 17841655)

- Crew Vans keeps pending route and van changes in Active, while untracking commands appear in Deactivated until the device acknowledges them. Actions also clear when the device reports the requested setting, even if an explicit acknowledgement is missed.
- Crew Vans map markers now use the dedicated van-shuttle icon.
- Crew Vans now shows one consistent route-name column and labels live device/location ownership mismatches explicitly; deactivated rows are excluded from that analysis.
- Crew Vans map markers cluster nearby vans into a counted marker instead of visually separating overlapping locations.
- Crew Vans map popups now use a readable high-contrast theme, and device rows can permanently remove junk registry entries.
- Crew Vans device controls now open in an Actions modal instead of filling the table inline.
- Crew Vans cluster popups now stay readable until explicitly closed and show relative update times instead of device IDs.

### v2.1.2 (build 17841587)

- Command can now queue a validated route change for a tracked van, and the Road Crew app applies and acknowledges it on the next heartbeat.
- The active 2026 vehicle-pass roster is now seeded in Cloudflare KV, with numeric IDs displayed using the `VAN-` prefix.
### v2.1.1 (build 17841488)

- Foreground Sync now reports the selected route with tracked device health, and Crew Vans shows the current route name for active, pending, and deactivated devices.

### v2.1.0 (build 17841375)

- Browser release metadata is generated only during the Expo export instead of being committed as a duplicate Admin source file.
- Removed browser messaging/notification modules left behind by the retired field PWA, plus their unused storage/config branches and stale test/deploy artifacts.
- Removed the permanently disabled bottom-sheet compatibility branch from shared modal chrome while preserving sequence-detail sheets and the current centered dialogs.
- Removed app-local contract and theme re-exports so consumers use the canonical shared packages directly.

### v2.1.0 (build 17841347)

- The universal Expo app is now the only field web client in production, beta, and preview Worker configurations; the retired vanilla route shell and build path have been removed.
- Cloudflare Worker, storage, migration, and environment files now live under `worker/`, while canonical baked route data now lives under `packages/data/routes/`.
- Worker API contracts and route loading are shared through `@road-crew/contracts` and `@road-crew/data`, and CI now validates the Expo export, deep-link refresh, and the current Crew Vans Active, Pending changes, and Deactivated views.
- Worker, app, and static fallback rosters are aligned to VAN-1 through VAN-30.
- Beta and preview Worker builds enable the tracked-install default through their checked-in `VAN_INSTALL` build flag; production remains standard by default.

### v2.0.7 (build 17841328)

- The post-update confirmation toast now appears above the bottom navigation bar and device safe area instead of under iOS top controls.
- Van roster, conversation, and Crew Vans device lists now cap at 400px and scroll internally in Admin.

### v2.0.6 (build 17841566)

- Route data now reflects the complete 2026 route-database PDF, including updated rider guidance and police coverage for the Worcester-to-Massachusetts route.

### v2.0.6 (build 17841273)

- Crew Vans now removes a live device and its matching location when that device explicitly turns off Tracked mode, while retaining a 30-day deactivation record.
- The Crew Vans table now separates active tracked devices, pending Command changes, and recently deactivated devices into dedicated tabs.

### v2.0.5 (build 17841176)

- User-facing Road Crew and Crew Vans labels now call van-install mode "Tracked" and heartbeat state "Sync" while keeping the underlying app flag and API contract unchanged.

### v2.0.5 (build 17840830)

- Crew Vans admin can remotely make a van-install device standard and untracked, or ask it to choose another van.
- Pending admin actions are delivered and acknowledged through the existing heartbeat, then the old device claim and matching fleet location are removed.
- Explicit standard mode now survives reloads and app resets even when the build-time `VAN_INSTALL` default is enabled.
- Crew Vans rows now show install/action status plus the latest fix age and accuracy, and diagnostics identify whether install mode was explicitly configured.

### v2.0.4 (build 17840743)

- Road Crew devices now apply available updates automatically and show only a short post-update toast.
- Native release builds use EAS Update, while web installs refresh the deployed Cloudflare bundle and service-worker caches.
- Crew Vans admin now shows the latest published release/build beside installed device versions.
- Runtime version metadata no longer embeds structured changelog history; release detail lives only in this file.

### v2.0.3 (build 17840666)

- Command admin now shows one Last seen device-health column based on the latest van heartbeat instead of separate Last heartbeat and Last fix columns.
- Van-install heartbeats now send and persist release/build aliases plus platform metadata so Crew Vans device rows can populate app version and platform reliably.
- Reset App now sends van-install devices back through the app root after clearing state, so the preserved install mode reopens van selection.

### v2.0.3 (build 17840524)

- The Road Crew app now uses one 30-second heartbeat for update checks, Command notifications, and this van's optional location report instead of sending three separate requests.
- Fleet positions remain a separate Map-only GET request, and a rejected location report no longer blocks version or notification updates.
- Export diagnostics now identifies the heartbeat endpoint separately from the fleet-location endpoint.

### v2.0.3 (build 17840466)

- Tablet and desktop viewports now keep the wide Route workspace when a desktop window is short or wider than the previous tablet cap, while phone portrait and landscape viewports keep the phone layout.

### v2.0.2 (build 17840384)

- Cloudflare beta and preview web apps now send API requests to the Worker that served the app, so van location reports stay in the correct environment instead of being sent to production.
- Export diagnostics now includes the runtime API endpoint, device and van-install state, network and GPS errors, and the last location upload attempt, success, and error details.

### v2.0.2 (build 17839972)

- The beta Worker now serves the Expo Road Crew web export instead of the legacy PWA shell, so beta includes the Status/App Info modal controls and the always-visible Van install mode checkbox.

### v2.0.2 (build 17839948)

- The unused Settings tab has been removed; its van install, change-van, push setup, connection, and about controls now live in the Status/App Info modal.
- The Status/App Info modal now always shows the Van install mode checkbox, so any install can be switched between standard and van-install mode from the route app.
- Cloudflare preview and beta builds now read the checked-in Wrangler `VAN_INSTALL` value during the web export, so the static Expo bundle starts in van-install mode when those build configs are flagged.

### v2.0.2 (build 17839847)

- Van-install setup is now controlled by the build-time `VAN_INSTALL` feature flag instead of the `?vaninstall` URL parameter, while preserving the same van picker, reset persistence, settings display, and location-reporting behavior.
- Skipping van selection now suppresses the van picker on later launches until Reset App clears the skip marker.
- Beta and preview web exports now bridge `VAN_INSTALL` into Expo's public build environment so the static bundle starts in van-install mode.
- Settings now includes a Van install mode checkbox so a standard install can be manually switched into van-install mode, opening the picker when no van is selected and enabling reporting for an already selected van.

### v2.0.1 (build 17839782)
- The Expo app now persists the `vaninstall` app attribute once the install link is received, so a van-install device keeps reopening the van picker until a van is chosen, even after skips or App Reset.
- App Reset now preserves both the install-level `vaninstall` attribute and the stable Device ID instead of regenerating them.
- The van picker now falls back to the static/default VAN-1 through VAN-32 roster if the live /api/vans request fails, and the picker refuses direct /van-install access unless the install link was received on this device.
- Fixed the Expo web van-install launch gate so opening the beta or production worker with ?vaninstall or ?vaninstall=1 on a fresh install reliably shows the one-time van picker instead of falling through to Home.

### v2.0.0 (build 17839084)
- App versions now use a standard release label such as v2.0.0, while background update checks and cache-busting continue to use the internal build number.
- The Expo app now ships as v2.0.0, and earlier app builds are grouped under the 1.0.x release line.

### v1.0.82 (build 17839054)
- Location reporting now feeds the shared Live status pill: upload failures show an amber Location issue state instead of adding a separate Offline chip on the Map.

### v1.0.81 (build 17838917)
- Live fleet map: vans that are set up with the install link now share their location every 30 seconds, and everyone viewing the Map can see the other vans as little van icons labelled with their van id. Vans are colored by how recent their GPS fix is - green (under 10 min), amber (under 30 min), and grey (older).
- A device is only asked to pick its van (and only shares location) when the app is opened with the van-install link; otherwise it opens with no van and never reports. During cell dead-zones the app shows a small "Offline" indicator and keeps only the most recent location, so nothing stacks up to resend.
- The default van roster now lists VAN-1 through VAN-32 until Command customizes it in the admin console.

### v1.0.80 (build 17838853)
- Removed retired placeholder sequences from the Wellesley-to-Dighton route data, and added pipeline validation so future route sources fail when they include delete-marked rows or unintentionally omit existing sequences.

### v1.0.79 (build 17838683)
- Buttons and app controls now show clearer pressed/active feedback while your finger is down, so taps register visibly across Home, Route, Map, App Info, notifications, and update dialogs.
- Hardened Follow's screen wake-lock so it reasserts when the app returns to the foreground, the browser reports the wake lock was released, or the first user tap is needed to grant wake-lock access.

### v1.0.78 (build 17838668)
- The Mapbox map now uses Mapbox's richer Standard basemap (roads, parks, water, and place labels) instead of the flat light style.

### v1.0.77 (build 17838634)
- Added notification banners: new Command notices now appear as dismissible cards at the top of the screen (with a one-tap action when relevant), and urgent notices now interrupt with a Command dialog you must acknowledge - instead of only being reachable through the bell.
- The App Info, Route picker, and Notifications popovers are now true centered dialogs, matching the "what changed" style, instead of a bottom sheet.

### v1.0.76 (build 17838618)
- Added a Notification Center: the bell now shows an unread badge and opens a popover listing Command's notifications (pinned first, with an Expired label for old ones), with a one-tap action to jump straight to a flagged sequence or open Update App.
- The search box now sits directly above the sequence list it filters, instead of higher up the screen separated by the route progress bar.
- Update App and Reset App show a pulsing amber highlight while armed for a second confirming tap, similar to the next-sequence highlight elsewhere in the app.
- The "what changed" notice after Update or Reset is now a styled in-app dialog matching the rest of the app, instead of a plain browser alert.
- Fixed the tablet Route header: the logo and route name had collapsed to zero width and disappeared. Removed the extra route-switch icon from that header now that tapping the route name/logo already opens the route picker.

### v1.0.75 (build 17838257)
- The App Info status pill now shows a real live status (No GPS, GPS lost, GPS stale, Offline, Data issue, or Live) based on your actual GPS fix and connection, matching the legacy app; the GPS fix age, accuracy, and coordinates rows now show real values instead of placeholders, and a new "App last reset" row shows when you last used Update or Reset.
- Update App and Reset App now require a second tap within 3 seconds to confirm (mirroring the legacy app) and refuse to run while offline instead of silently doing nothing; Update App also fully unregisters the service worker so a stale cached version can never keep loading after a deploy. A short summary of what changed appears once after either action completes.
- The Export Diagnostics button now actually works, downloading a JSON file (or opening the share sheet) with your GPS fix, nearest sequences, route, and settings for troubleshooting.
- The off-route distance threshold now matches the legacy app (100 m instead of 60 m), so vans just off the route centerline aren't incorrectly flagged Off Route.
- GPS is now a single shared watch across Sequences, Map, and App Info instead of three independent ones, so switching tabs no longer flashes "Acquiring GPS..." and the last known fix is remembered across app restarts.
- The Add to Home Screen install tip now only appears on iPhone/iPad Safari, matching the legacy app, instead of on every browser.
- The Mapbox map's required attribution control is back on (it was accidentally suppressed), and the cross-route search suggestion now only appears for sequence-number searches or when there are no matches on your current route, instead of on every search.

### v1.0.74 (build 17838225)
- The Mapbox map now uses a light street basemap (instead of the dark one), while the sequence detail popups stay dark for contrast. Sequence labels on the active route were retuned to dark text with a white halo so they stay readable on the lighter map.
- The Mapbox map now keeps its size in sync with its container (and resizes once its style loads), so it no longer occasionally shows a blank pane until you rotate or resize - including right after an App Reset reload.

### v1.0.73 (build 17838144)
- Sequence search in the universal app now checks all routes and offers one-tap route switching when a match is on a different route.
- The app's version check is now a heartbeat: it sends the anonymous Device ID to the Worker and receives an ok status plus the latest available app version.
- The tablet Route header now keeps an explicit route-switch button visible in the top-right controls.

### v1.0.72 (build 17838120)
- The tablet Route workspace now uses a 30/70 split in landscape (sequence list left, map right) and a 70/30 vertical split in portrait (map above, sequence list below), while still collapsing the bottom navigation to a single Route entry.
- On the Mapbox map, only the active route now shows sequence text labels; inactive routes keep their dots without label clutter.

### v1.0.71 (build 17838117)
- Bottom-sheet modals in the universal app now close with a downward swipe on the handle, including App Info, route selection, and sequence details.
- The Route and Map screens no longer auto-pick the first route for a van with no saved route selection. They now stop and require an explicit route choice first.

### v1.0.70 (build 17838109)
- Expanded universal app diagnostics across route loading, session/settings persistence, push setup, messaging sync, and map initialization, so more field failures are caught, tagged, and reported to Sentry instead of failing silently.

### v1.0.69 (build 17838104)
- Improved universal app performance while GPS updates are flowing: route maps now keep their stable route data cached, next-sequence highlighting updates without rebuilding the whole map, and the sequence list does less repeated work while Follow is active.

### v1.0.68 (build 17838073)
- Fixed the Mapbox map showing a blank/dark pane: it now loads a public Mapbox dark street map instead of a restricted custom style, so the route lines and sequence points render again.
- Tapping a sequence point on the Mapbox map now opens a details popup (sequence number, street, town, route, direction, house numbers, cumulative miles, intersection, notes, flags) with a one-tap navigation button - matching the legacy app.
- On tablets and other wide screens, Sequences and Map now condense into a single "Route" view (both the bottom navigation and the Home screen), the GPS status bar moves up beside the logo and top-right controls, and the sequence list and map share the screen side by side.
- Fixed the on-route green street sign showing the wrong road when patrolling a route in reverse; it now names the road you're actually on in either direction.
- The route overview progress marker now points backward when you're patrolling the route in reverse.
- The universal app now creates a short anonymous Device ID on first install or launch, shows it in App Info, and sends it with Cloudflare requests and Sentry reports until Reset App generates a fresh ID.

### v1.0.67 (build 17837962)
- In-app notifications now check on launch and when the app returns to the foreground, then every 30 seconds while the app stays open instead of every 10 seconds.

### v1.0.66 (build 17837945)
- The Cumby's fuel tile now sends web users straight to the App Store page in the browser instead of opening it through the blank embedded handoff.

### v1.0.65 (build 17837935)
- The ArcGIS map setting now loads an Expo-owned ArcGIS Maps SDK for JavaScript map on web and native builds instead of leaving the universal app on the Mapbox renderer.

### v1.0.64 (build 17837871)
- In-progress: the Road Crew field guide now runs from one universal Expo codebase for web (PWA) and iOS - Home, Sequences, Search, Map (all routes), the App Info popover with working settings (default navigation, map type, driver mode, path snapping), route picker, live GPS (green street-sign, Follow, next-target highlight, next/prev), offline support, and Add-to-Home-Screen. Notifications, Command messaging, and the admin console remain the existing (legacy) implementations.

### v1.0.63 (build 17835414)
- ArcGIS now uses the 5.1 CDN map component with Calcite dark mode instead of the older programmatic MapView path, keeping map popups readable without a separate ArcGIS theme stylesheet.

### v1.0.62 (build 17835407)
- ArcGIS now loads its dark map theme with the app shell, applies Calcite dark mode, and uses the 5.1 CDN, keeping map popups readable instead of sometimes mixing light and dark styling.

### v1.0.61 (build 17834673)
- Refreshed route sequence GPS coordinates from the latest surveyed GeoJSON updates, so map pins and route-following positions reflect the newest route data.

### v1.0.60 (build 17834372)
- Refreshed the route data from the updated 2026 route database, including corrected town names, route notes, street text, and police-detail flags.

### v1.0.59 (build 17833728)
- Refreshed the GPS coordinates for route sequences from an updated overrides dataset, so map pin positions match the latest surveyed locations.
- Removed two retired placeholder sequences (the Cleveland St. detour points) from the Wellesley 50 route, so Day 2 Route 2 now lists 63 sequences.

### v1.0.58 (build 17833543)
- Follow now highlights only the next sequence row with the red rail; the distance gap between sequences stays neutral while still showing the source-data mileage.

### v1.0.57 (build 17830071)
- Rebuilt the route data pipeline (now the route_pipeline package with a single `python -m route_pipeline` command) and added spreadsheet/database-friendly routes.csv and sequences.csv exports. Geocoding results are cached so rebuilds are faster and cheaper. There is no change to how the app looks or works.

### v1.0.56 (build 17827009)
- Command can now delete an individual van conversation from the admin console. The van remains active, and the driver app clears stale local messages when that conversation is reset.

### v1.0.55 (build 17827001)
- Made sequence street names larger in the sequence list for easier scanning while driving.

### v1.0.54 (build 17826957)
- Route miles, cumulative miles, and official route totals now come from the June 24 official 2026 route database, alongside the first- and last-rider pass times.

### v1.0.53 (build 17826759)
- Polished the route-following screen: the logo stays anchored in the tighter top-left header beside the route name, Follow moved into the header action cluster with notifications and Live/status, the route progress marker now points forward or reverse with the van's traversal direction, Follow auto-scrolls to the semantic next sequence while the red left rail marks that next sequence, sequence numbers stack cleanly under their direction icons, and every adjacent sequence pair now has a compact gray gap row using the source-data distance to the next sequence. The active gap uses a red outline with red diamond-and-distance text, the left-side arrow is gone, the diamond has extra spacing before the distance, no gap row shows a route icon, and sequence cards no longer repeat the distance. Weather is still intentionally held for a later update.

### v1.0.52 (build 17823876)
- Updated first- and last-rider pass times from the June 24 official 2026 route database, including the Worcester-to-Bourne and Wellesley 25 routes.

### v1.0.51 (build 17820715)
- The sequence list now shows the first and last rider pass times on each sequence, on a clock line when route data includes those times.
- Follow now shows the two adjacent sequence points you are between, uses route direction to label previous and next with their GPS distances, and highlights the gap row between them with the source-data distance to the next sequence inline. The top header now stays compact by showing only two medium lines: Next sequence plus distance, then Prev sequence plus distance. Restored sessions now scroll to that gap row on initial load and when entering Sequences from Home.

### v1.0.50 (build 17820712)
- Reduced the selected route line opacity to 70% so map details remain visible beneath the route.

### v1.0.49 (build 17819966)
- Follow now shows the two adjacent sequence points you are between, uses route direction to label previous and next with their distances, lightly highlights both rows, and marks their gap with a full-width red divider and transparent left-edge caret. The top header now stays compact by showing only two medium lines: Next sequence plus distance, then Prev sequence plus distance. Restored sessions now scroll to that marker on initial load and when entering Sequences from Home.

### v1.0.48 (build 17817830)
- Replaced the Wellesley 25 route line with the full official GPX track for more accurate map curves and off-route distance.

### v1.0.47 (build 17817527)
- Hardened GPS sequence tracking so sparse location updates, stale heading data, or incomplete sequence coordinates do not keep Follow stuck on an old sequence after you have reached the next one.

### v1.0.46 (build 17817521)
- Added route path lines for the Wellesley 25 and Wellesley 50 routes so the map and off-route status follow their official GPX routes.

### v1.0.45 (build 17817510)
- Updated the Wellesley 50 and Wellesley-to-Dighton routes from the June 17 official sequence sheets, including revised turns, distances, rider times, and water stops.

### v1.0.44 (build 17811308)
- Fixed GPS sequence snapping so Follow holds the current sequence until you are within 100 m of, or have passed, the next sequence point in either travel direction.

### v1.0.43 (build 17808884)
- Added the Wellesley 25-50 route, and filled in first-rider and last-rider pass times for the Wellesley→Dighton and Bourne→Provincetown routes from the 2025 route database.

### v1.0.42 (build 17808874)
- The Wellesley 25 route now appears in the app. App route data is built automatically from every route the pipeline produces, so newly added routes show up without a code change.

### v1.0.41 (build 17808868)
- Route data now carries first-rider and last-rider pass times per sequence, parsed from the official route sheets. These fields are available in the data for upcoming schedule features; the app's screens are unchanged for now.

### v1.0.40 (build 17808742)
- Command chat is now an opt-in setting. A new "Command chat" toggle in App Info turns the Command tab, the Command home tile, the Admin link, and the Van number selector on or off; it ships off by default, so messaging stays hidden until you enable it.
- Fixed the keep-screen-awake feature not engaging on a fresh launch: because Follow is on by default, the screen now stays awake from first load (after your first tap, where the device requires one) instead of only after toggling Follow off and back on.
- The GPS panel's travel direction now appears as a larger Forward/Reverse line inside the Route status box, with the "On route" label shown smaller above it.

### v1.0.39 (build 17806268)
- Groundwork for a companion native Road Crew app (React Native + Expo) focused on the driver/van field experience and chat with Command. This web app is unchanged; the native app will add reliable push notifications and offline-first chat on iPhone and Android.

### v1.0.38 (build 17804621)
- Deleted notifications are now removed from the Notification Center - if Command removes a notice from the admin console, it disappears from your bell on the next sync.
- Expired notifications stay in the Notification Center with an "Expired" label so you can still review them.
- Compose box in the Command conversation is now always visible even with a long message history.
- Message send timeout increased to 15 seconds so slow connections no longer cause false failures. Retrying the same unsent message now reuses the same send ID, so a delayed server response can never create a duplicate.
- The admin Command view now times out slow reads, keeps the selected thread marked read while live messages arrive, and ignores stale conversation loads when switching vans quickly.
- Command messaging now lives in its own bottom tab with an unread badge for new Command replies.
- Admin replies that time out now check whether the server accepted the same send id before showing any failure, so a slow confirmation does not look like a lost message.

### v1.0.37 (build 17804620)
- More reliable Command replies from the admin console: the Send button now locks while a reply is in flight, and each reply carries a unique id so a double-click, a retry, or a slow network can no longer send the same message twice or appear to fail and need resending.
- Fixed an "Unable to load route data" error when creating or editing a notification from the admin console.
- Removed the Broadcast (message all active vans) feature from the admin console.
- Added background diagnostics around messaging (and on the admin console) so intermittent send problems are easier to detect and fix.

### v1.0.36 (build 17804600)
- New notification bell - in the top bar and as a Home screen tile - opens a Notification Center listing every alert Command has sent you, so you can re-read anything you missed while driving.
- Active pinned notices stay at the top of the list, and a badge on the bell shows how many new alerts you haven't reviewed yet.
- Existing alert banners and pop-ups are unchanged; the bell is an extra place to review them.
- The van picker now shows just the van id in its selection list, without a "Van" prefix.

### v1.0.35 (build 17804548)
- Messages from Command now appear instantly - the app subscribes to a live server stream instead of checking every 10 seconds.

### v1.0.34 (build 17804224)
- Fixed: queued messages (sent while offline or mid-sync) now appear at the bottom of the conversation thread, not the top.
- Fixed: the command admin message panel no longer briefly flashes a stale unread badge when the auto-refresh timer fires.

### v1.0.33 (build 17803468)
- Fixed an infinite redirect loop when navigating to the admin panel.

### v1.0.32 (build 17803400)
- The deployed app now exposes a live version endpoint again, so in-app update notices can reliably detect newer builds after Cloudflare deploys.

### v1.0.31 (build 17802848)
- On launch, the app now checks api/version and shows an in-app update notice when a newer build is available.
- The update notice's button runs the same app refresh flow as the existing Update App control.

### v1.0.30 (build 17802837)
- Fixed an intermittent "Safari can't open the page" error on launch caused by the offline cache serving a redirected response. The app now opens reliably from the Home Screen.

### v1.0.29 (build 17802816)
- Moved app tests and docs into app/. There is no change to how the app looks or works.

### v1.0.28 (build 17802810)
- Reorganized the repository so the data-pipeline tooling lives in a pipeline/ folder and app helper scripts live in app/scripts/. There is no change to how the app looks or works.

### v1.0.27 (build 17802690)
- New in-app notifications: while the app is open it now checks for alerts from Command and shows them as a banner (general info) or a pop-up (time-sensitive). Some alerts include a "Go to sequence" button that jumps you straight to that sequence.
- New "Van number" setting in the Status panel. Pick your van on first launch (or skip) so Command can send alerts to just your van or your route. You can change it anytime.

### v1.0.26 (build 17802616)
- Added a Cloudflare configuration file so the app can also be deployed from the command line as a static site. There is no change to how the app looks or works.

### v1.0.25 (build 17801955)
- The app is now hosted on Cloudflare Pages instead of GitHub Pages. The address (rc.awbauer.dev) and behavior are unchanged; pushes to the main branch deploy to production and each pull request still gets its own preview link.

### v1.0.24 (build 17801950)
- Fixed turning Follow off not always letting the screen sleep: the tap that turned Follow off could momentarily re-enable the screen lock. The display now reliably sleeps again as soon as Follow is off.

### v1.0.23 (build 17801932)
- Keeping the screen awake is now part of Follow: while Follow is on, the display stays awake; turning Follow off lets it sleep again. The separate "Keep screen awake" setting has been removed.
- The app now ships from GitHub Pages instead of Netlify, served at its custom domain. Every change merged to the main branch deploys to production automatically, and each pull request gets its own live preview link. The ArcGIS map continues to load from the ArcGIS CDN.

### v1.0.22 (build 17801882)
- New "Keep screen awake" setting in the status dialog keeps your display from sleeping while the app is open - now reliable on iPhone, not just Android.
- Screen wake is controlled entirely by this setting instead of being tied to GPS, so you can keep it on or off independently. It defaults to on.

### v1.0.21 (build 17801097)
- The GPS panel's Route status is now a large, full-height indicator: a green "On route" panel when you're on course, and a grey panel showing your distance back to the route when you're off it.
- Removed the Heading readout from the GPS panel; Speed and travel direction remain alongside the Route status.
- App preferences are now scoped per hostname, so deploy previews and other environments start with a clean slate.

### v1.0.20 (build 17801014)
- Map sequence popups now include a navigation link that opens your preferred map app directly.

### v1.0.19 (build 17800228)
- The app now guards against bad GPS readings and malformed route data so a single bad value can't freeze the nearest-sequence indicator or blank the route list.
- Data problems are flagged with a subtle "Data issue" status; details appear under Data integrity in the status dialog and in exported diagnostics.
- The map view now shows a clear message when it can't load (for example, when you're offline) instead of staying blank.

### v1.0.18 (build 17799385)
- Drive-along behavior is now covered by an automated end-to-end test suite running in CI.

### v1.0.17 (build 17799298)
- Route path line now renders on the Mapbox map for Day 1 Route 1.
- Off-route detection shows your distance from the actual cycling route in the GPS panel.
- Traversal direction now uses the road path curvature for improved accuracy when path data is available.

### v1.0.16 (build 17798482)
- Forward/reverse route traversal indicators show your direction of travel in the GPS panel and on the current sequence row.

### v1.0.15 (build 17798191)
- Detour sequences (901-906) now appear inline in the route list at their correct positions.

### v1.0.14 (build 17798182)
- Updated route start/end towns and mileage for all three routes.

### v1.0.13 (build 17798054)
- Version numbers now use the first 8 digits of the UTC Unix timestamp.

### v1.0.12 (build 17798048)
- New Call HQ tile dials 1-800-WECYCLE straight from the home screen.
- On iPhone Safari, first-time visitors see a tip for adding Road Crew to the home screen.

### v1.0.11 (build 17797656)
- Sequence list navigation buttons now use an outline style with a red border and icon instead of a solid red background.

### v1.0.10 (build 17797636)
- App icon updated to the new van illustration with white space and drop shadow removed.

### v1.0.9 (build 17797625)
- The ArcGIS map now uses the ArcGIS JavaScript SDK instead of an iframe, providing a native interactive map experience.

### v1.0.8 (build 17797602)
- Sequence detail popup now shows Num first and Num last address fields.

### v1.0.7 (build 17797587)
- The ArcGIS iframe now uses explicit portrait dimensions to prevent letterboxing on mobile.

### v1.0.6 (build 17797584)
- Map controls (zoom, attribution) are pushed above the fixed tab bar so they stay tappable.
- The tab bar now includes horizontal safe-area insets for landscape on notched iPhones.

### v1.0.5 (build 17797573)
- The GPS panel and search bar now share a single row on the Sequences screen, with Speed and Heading stacked in a compact GPS box and the search icon sitting to its right.

### v1.0.4 (build 17797547)
- The tab bar is now fixed to the viewport bottom so it always reaches the screen edge on installed iPhone PWAs.
- Font Awesome icons and Mapbox tiles are now cached for offline use.

### v1.0.3 (build 17797528)
- The app shell now uses Font Awesome icons, with Sequences replacing Route on the Home screen.
- Choosing a route from the Home Sequences tile now opens the Sequences view immediately.
- The ArcGIS map iframe is forced to fill the full map pane.
- Installed iPhone PWAs place the bottom safe-area inset inside the tab buttons instead of leaving a blank strip under the tab bar.

### v1.0.2 (build 17797443)
- The app now uses the Road Crew dark theme with red accents and logo branding.

### v1.0.1 (build 17797442)
- Sequence number searches can point you to matching sequences on other routes.
- Turning Follow back on jumps to the nearest sequence again.
- Direction badges stay square on routes with larger sequence numbers.
- The sequence list fills mobile and installed iPhone app height more cleanly with a small end spacer.
- A bottom toolbar adds Home, Sequences, and Map tabs.
- Home tiles give quick access to route picking, search, follow, status, Update App, and Cumby's fuel.
- The Home screen focuses on launch tiles without the route header.
- Search now sits beside the GPS metrics on the Sequences screen.
- Update App now explains when a new version has landed.

### v1.0.0 (build 0.6.0)
- Base release before the latest search, follow, and layout updates.
