#!/bin/zsh
set -euo pipefail

export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_INSTALL_CLEANUP=1

ROOT="${CI_PRIMARY_REPOSITORY_PATH:?CI_PRIMARY_REPOSITORY_PATH is missing}"
BREW="$(command -v brew || true)"

if [[ -z "$BREW" ]]; then
  echo "error: Homebrew is unavailable in the Xcode Cloud environment." >&2
  exit 1
fi

retry_command() {
  local max_attempts="$1"
  local description="$2"
  shift 2

  local attempt=1
  local delay_seconds=5
  until "$@"; do
    if (( attempt >= max_attempts )); then
      echo "error: $description failed after $attempt attempts." >&2
      return 1
    fi

    echo "warning: $description failed (attempt $attempt/$max_attempts); retrying in ${delay_seconds}s." >&2
    sleep "$delay_seconds"
    attempt=$((attempt + 1))
    delay_seconds=$((delay_seconds * 2))
  done
}

install_formula() {
  local formula="$1"
  if ! "$BREW" list "$formula" >/dev/null 2>&1; then
    retry_command 3 "brew install $formula" "$BREW" install "$formula"
  fi
}

install_formula node@22
install_formula cocoapods

NODE_PREFIX="$("$BREW" --prefix node@22)"
POD="$("$BREW" --prefix cocoapods)/bin/pod"
export NODE_BINARY="$NODE_PREFIX/bin/node"
export PATH="$NODE_PREFIX/bin:$PATH"

echo "Using Node: $NODE_BINARY"
node --version
npm --version
echo "Using CocoaPods: $POD"
"$POD" --version

EXPECTED_NODE_MAJOR="$(sed -E 's/^v?([0-9]+).*/\1/' "$ROOT/.nvmrc")"
ACTUAL_NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [[ -z "$EXPECTED_NODE_MAJOR" || "$ACTUAL_NODE_MAJOR" != "$EXPECTED_NODE_MAJOR" ]]; then
  echo "error: Node $ACTUAL_NODE_MAJOR does not match the .nvmrc major version $EXPECTED_NODE_MAJOR." >&2
  exit 1
fi

cd "$ROOT"
retry_command 2 "npm ci" npm ci

APP_ROOT="$ROOT/apps/road-crew"
IOS_ROOT="$ROOT/apps/road-crew/ios"
GEMFILE_SOURCE="$APP_ROOT/Gemfile"
if [[ ! -f "$GEMFILE_SOURCE" ]]; then
  echo "error: required dependency file is missing at $GEMFILE_SOURCE" >&2
  exit 1
fi

EXPECTED_POD_VERSION="$(sed -n -E 's/^gem "cocoapods", "([^"]+)"/\1/p' "$GEMFILE_SOURCE")"
ACTUAL_POD_VERSION="$("$POD" --version)"
if [[ -z "$EXPECTED_POD_VERSION" ]]; then
  echo "warning: could not parse the expected CocoaPods version out of $GEMFILE_SOURCE." >&2
elif [[ "$ACTUAL_POD_VERSION" != "$EXPECTED_POD_VERSION" ]]; then
  echo "warning: Homebrew installed CocoaPods $ACTUAL_POD_VERSION but $GEMFILE_SOURCE pins $EXPECTED_POD_VERSION; the Homebrew formula has moved. Review the Podfile.lock drift warning below before merging." >&2
else
  echo "CocoaPods version matches the Gemfile pin: $ACTUAL_POD_VERSION"
fi

PRESERVED_FILES="$(mktemp -d)"
cleanup() {
  rm -rf "$PRESERVED_FILES"
}
trap cleanup EXIT

if [[ -f "$IOS_ROOT/Podfile.lock" ]]; then
  cp "$IOS_ROOT/Podfile.lock" "$PRESERVED_FILES/Podfile.lock"
fi
if [[ -d "$IOS_ROOT/ci_scripts" ]]; then
  cp -R "$IOS_ROOT/ci_scripts" "$PRESERVED_FILES/ci_scripts"
fi

cd "$APP_ROOT"
rm -rf "$IOS_ROOT"

# EXPO_UPDATE_CHANNEL is baked into the binary by app.config.js during prebuild
# (as the expo-channel-name update request header) so EAS Update can route OTA
# updates to this install. We build via prebuild + Xcode rather than `eas build`,
# so nothing injects this automatically — a release binary built without it can
# never receive OTA updates. Warn loudly instead of failing, since Debug/dev
# builds legitimately omit it.
if [[ -n "${EXPO_UPDATE_CHANNEL:-}" ]]; then
  echo "Embedding EAS Update channel: $EXPO_UPDATE_CHANNEL"
else
  echo "warning: EXPO_UPDATE_CHANNEL is not set; this binary will embed no EAS Update channel and cannot receive OTA updates. Set it as a custom environment variable in the Xcode Cloud workflow." >&2
fi

# VAN_INSTALL has the same problem EXPO_UPDATE_CHANNEL does, and for the same
# reason: app.config.js reads it during prebuild, and nothing injects it here.
# Left unset it resolves to false, which silently ships a binary whose embedded
# manifest has van-install off — no fleet polling, no Tracked toggle, no van
# picker — until an OTA update happens to replace the manifest. Every published
# OTA sets it true, and the Worker has VAN_INSTALL=true in every environment, so
# true is the value every binary this pipeline cuts is meant to carry.
#
# Defaulted rather than warned because there is no correct alternative to fall
# back to, and an override is still possible by setting it in the Xcode Cloud
# workflow when a deliberately standard binary is wanted.
export VAN_INSTALL="${VAN_INSTALL:-true}"
echo "Embedding van-install capability: VAN_INSTALL=$VAN_INSTALL"

npx expo prebuild --platform ios --no-install

if [[ -f "$PRESERVED_FILES/Podfile.lock" ]]; then
  cp "$PRESERVED_FILES/Podfile.lock" "$IOS_ROOT/Podfile.lock"
fi
if [[ -d "$PRESERVED_FILES/ci_scripts" ]]; then
  mkdir -p "$IOS_ROOT/ci_scripts"
  cp -R "$PRESERVED_FILES/ci_scripts/." "$IOS_ROOT/ci_scripts/"
fi

for required_output in \
  "$IOS_ROOT/Podfile" \
  "$IOS_ROOT/RoadCrew.xcodeproj/project.pbxproj"; do
  if [[ ! -f "$required_output" ]]; then
    echo "error: Expo prebuild did not generate $required_output" >&2
    exit 1
  fi
done

# Xcode build phases run in fresh shells. Persist the exact keg-only Node path
# selected above so React Native and Sentry do not fall back to a missing node.
{
  print -r -- "export NODE_BINARY=\"$NODE_BINARY\""
  print -r -- 'if [ -z "${SENTRY_AUTH_TOKEN:-}" ] || [ -z "${SENTRY_ORG:-}" ] || [ -z "${SENTRY_PROJECT:-}" ]; then'
  print -r -- '  export SENTRY_DISABLE_AUTO_UPLOAD=true'
  print -r -- '  export SENTRY_DISABLE_XCODE_DEBUG_UPLOAD=true'
  print -r -- 'fi'
} > "$IOS_ROOT/.xcode.env.local"

cd "$IOS_ROOT"

"$POD" install

if [[ -f "$PRESERVED_FILES/Podfile.lock" ]] && \
   ! cmp -s "$PRESERVED_FILES/Podfile.lock" "$IOS_ROOT/Podfile.lock"; then
  echo "warning: pod install changed the committed Podfile.lock; review and commit this dependency drift." >&2
  diff -u "$PRESERVED_FILES/Podfile.lock" "$IOS_ROOT/Podfile.lock" >&2 || true
fi

if [[ ! -f "$IOS_ROOT/Pods/Manifest.lock" ]]; then
  echo "error: CocoaPods did not generate Pods/Manifest.lock" >&2
  exit 1
fi

if [[ ! -f "$IOS_ROOT/RoadCrew.xcworkspace/contents.xcworkspacedata" ]]; then
  echo "error: CocoaPods did not generate the RoadCrew workspace" >&2
  exit 1
fi

if ! cmp -s "$IOS_ROOT/Podfile.lock" "$IOS_ROOT/Pods/Manifest.lock"; then
  echo "error: Podfile.lock and Pods/Manifest.lock are out of sync" >&2
  exit 1
fi
