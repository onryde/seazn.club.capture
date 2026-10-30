#!/bin/bash
# EAS Build's eas-build-pre-install hook (package.json). The app compiles
# against Android 37 (app.json's expo-build-properties: StreamPack 3.2.1 and
# srtdroid 1.10.1 declare minCompileSdk 37), and EAS's image does not ship
# platforms;android-37.0. Left to Gradle, AGP downloads it mid-build and then
# fails to find "android-37" in the same run (v1.0.0, EAS build 39c9d2f7). So
# it is installed first, as .github/workflows/android-compile.yml does.
set -eu
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
