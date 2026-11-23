#!/bin/sh
# Capacitor feasibility: wrap dist/ in iOS + Android projects inside a TEMP dir (nothing is installed globally, nothing is added to the repo).
# Usage: tools/capacitor-try.sh   (run `npx vite build` first). Android is generated but only built when ANDROID_HOME is set.
set -e
SPIKE="$(cd "$(dirname "$0")/.." && pwd)"
T="${TN2D_CAP_DIR:-$(mktemp -d /tmp/tn2d-cap.XXXXXX)}"
cd "$T"
npm init -y >/dev/null
npm i @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios >/dev/null
cp -R "$SPIKE/dist" www
npx cap init "TN2D Spike" com.example.tn2dspike --web-dir www
npx cap add ios
npx cap add android
# lock landscape in the native shells
PL=ios/App/App/Info.plist
/usr/libexec/PlistBuddy -c "Delete :UISupportedInterfaceOrientations" -c "Add :UISupportedInterfaceOrientations array" \
  -c "Add :UISupportedInterfaceOrientations:0 string UIInterfaceOrientationLandscapeLeft" \
  -c "Add :UISupportedInterfaceOrientations:1 string UIInterfaceOrientationLandscapeRight" \
  -c "Delete :UISupportedInterfaceOrientations~ipad" -c "Add :UISupportedInterfaceOrientations~ipad array" \
  -c "Add :UISupportedInterfaceOrientations~ipad:0 string UIInterfaceOrientationLandscapeLeft" \
  -c "Add :UISupportedInterfaceOrientations~ipad:1 string UIInterfaceOrientationLandscapeRight" "$PL"
AM=android/app/src/main/AndroidManifest.xml
sed -i '' 's#<activity#<activity android:screenOrientation="sensorLandscape"#' "$AM"
npx cap sync
(cd ios/App && xcodebuild -project App.xcodeproj -scheme App -sdk iphonesimulator -configuration Debug \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath "$T/dd" CODE_SIGNING_ALLOWED=NO build | tail -3)
if [ -n "$ANDROID_HOME" ]; then (cd android && ./gradlew assembleDebug); else echo "ANDROID_HOME not set: Android project generated, NOT built"; fi
echo "built in $T"
