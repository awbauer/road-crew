# `@road-crew/config`

Shared runtime configuration for the Expo app, Cloudflare Worker, and supporting
tools.

## Versioning

`src/version.ts` is the single maintained source of truth for the current
semantic release and build number. The Road Crew dynamic Expo config imports
`APP_VERSION` and applies it to Expo's release, iOS build, and Android version
fields. The Expo web export generates `/js/version.js` from the same value for
Admin, service-worker caching, and the Worker's `/version` endpoint.

Build numbers use the first eight digits of the current UTC Unix timestamp.
Runtime metadata intentionally contains no changelog or historical map. Record
every release/build and its concise human-readable details in
[`VERSION_HISTORY.md`](./VERSION_HISTORY.md).
