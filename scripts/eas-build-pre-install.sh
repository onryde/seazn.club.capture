#!/bin/bash
# EAS Build's eas-build-pre-install hook (package.json), run before EAS
# installs the project's packages. Two jobs.
#
# 1. The engine's registry credential (plan S2-1 Task 1), on every platform.
# @seazn/engine is on GitHub Packages, and pnpm 10.34.5 ignores an
# `${NODE_AUTH_TOKEN}` credential in the project's .npmrc (.npmrc says why).
# So the line goes, literally, into the user config the worker's pnpm reads,
# which expands it from the EAS secret NODE_AUTH_TOKEN (docs/release.md,
# Once 8). Without the secret the install would fail on a 401 later; it stops
# here instead, saying why. The token itself is never written or printed.
#
# 2. The Android platform. The app compiles against Android 37 (app.json's
# expo-build-properties: StreamPack 3.2.1 and srtdroid 1.10.1 declare
# minCompileSdk 37), and EAS's image does not ship platforms;android-37.0.
# Left to Gradle, AGP downloads it mid-build and then fails to find
# "android-37" in the same run (v1.0.0, EAS build 39c9d2f7). So it is
# installed first, as .github/workflows/android-compile.yml does.
set -eu

if [[ -z "${NODE_AUTH_TOKEN:-}" ]]; then
  echo "NODE_AUTH_TOKEN is not set: add it as an EAS secret that can read @onryde/seazn-engine on GitHub Packages (docs/release.md, Once 8)." >&2
  exit 1
fi
credential='//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}'
userconfig="${NPM_CONFIG_USERCONFIG:-$HOME/.npmrc}"
if ! { [[ -f "$userconfig" ]] && grep -qxF "$credential" "$userconfig"; }; then
  # A file that does not end in a newline would join the line onto its last one.
  if [[ -s "$userconfig" && -n "$(tail -c 1 "$userconfig")" ]]; then
    echo >> "$userconfig"
  fi
  echo "$credential" >> "$userconfig"
  echo "Wrote the GitHub Packages credential line to $userconfig"
fi

if [[ "${EAS_BUILD_PLATFORM:-}" != "android" ]]; then
  exit 0
fi
sdkmanager="${ANDROID_HOME}/cmdline-tools/latest/bin/sdkmanager"
if [[ ! -x "$sdkmanager" ]]; then
  sdkmanager="$(command -v sdkmanager)"
fi
# `yes` accepts the licences; it ends on SIGPIPE, so no pipefail here.
yes | "$sdkmanager" 'platforms;android-37.0' > /dev/null
echo "Installed platforms;android-37.0"
