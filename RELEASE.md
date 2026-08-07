# Release process

This repository promotes tested beta changes to production through `main`.
The universal field app lives in `apps/road-crew/`; the web export and the
native binaries are released from the same repository state.

## Prepare the release

1. Start feature work from the latest `origin/beta` on a fresh branch and open
   the feature PR against `beta`.
2. For an app behavior change, align all release metadata:
   `packages/config/src/version.ts` and the next entry in
   `packages/config/VERSION_HISTORY.md`. The build number is the first eight
   digits of the current UTC Unix timestamp. Do not put version keys in
   `apps/road-crew/app.json` — `app.config.js` stamps the release into Expo
   `version` and `runtimeVersion`, the build into iOS `buildNumber`, and its
   numeric form into Android `versionCode`, all from the shared config.
   The release version may stay unchanged while the build advances;
   `npm run check:build-bump` enforces the build, not the release.
3. Run the relevant checks before promotion:

   ```bash
   npm run lint
   npm run test:app
   npm run test:packages
   npm run test:scripts
   npm run build:web
   npm run test:e2e
   git diff --check
   ```

## Promote beta to production

1. Confirm the deployed beta export and its `/version` endpoint report the
   expected release and build.
2. Open a PR from `beta` to `main`. Direct pushes to `main` are blocked by the
   repository rules; merge the promotion PR after required checks pass.
3. Confirm `main` contains the promoted commit and that the release metadata is
   still aligned.

## Tag and build the app

The `tag_app_release` workflow runs after a qualifying push to `main`. It reads
`packages/config/src/version.ts` and `packages/config/VERSION_HISTORY.md`, then
creates the annotated `app-v<release>-<build>` tag when it does not already
exist. The build is part of the tag name because the release version is often
held across several builds; a release-only tag would be created once and then
skipped for every later promotion of the same release.

The `eas-build` workflow listens for `app-v*` tags and starts the iOS EAS build
when the repository has an `EXPO_TOKEN` secret. Native runtime or config
changes require a new binary; JavaScript-only changes may use the appropriate
EAS Update channel.

If the tag already exists but the GitHub Release object is missing, create the
release from the verified tag without retagging:

```bash
gh release create app-v<release>-<build> \
  --verify-tag \
  --title "Road Crew v<release> (build <build>)" \
  --notes-file /tmp/release-notes.md
```

Release notes should come from the matching entry in
`packages/config/VERSION_HISTORY.md`.

## Deploy and verify production

Building the web export is the last step this repository owns:

```bash
npm run build:web
```

Hosting that export, and the backend it talks to, live outside this repository.
After deploying, verify the `/version` endpoint, route data, notifications, and
the released web and native clients.
