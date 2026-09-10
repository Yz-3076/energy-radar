#!/usr/bin/env bash
#
# On-device smoke check. Launches the dev client, dismisses the dev-menu
# overlays that pop up on every launch, optionally deep-links straight to a
# route, screenshots the result, and prints any JS errors.
#
# Verifying a change by hand meant: launch, dismiss two dev-menu sheets,
# find the map pin, tap the store card, tap the pin, tap Details -- each
# step needing a screenshot to locate the next tap target. Deep-linking
# skips all of it, so checking a screen is one command instead of a dozen
# round-trips.
#
# Usage:
#   ./check-device.sh                        # launch, screenshot home
#   ./check-device.sh store/dor_alon-401     # jump straight to a store page
#   ./check-device.sh variant/ultra          # or a flavour page
#
# Env:
#   ADB     path to adb            (default: tries PATH, then common SDK spot)
#   SERIAL  device serial          (default: first attached device)
#   OUT     screenshot output path (default: ./device-check.png)

set -euo pipefail

ADB="${ADB:-$(command -v adb || echo "/c/Android/sdk/platform-tools/adb.exe")}"
[ -x "$ADB" ] || { echo "adb not found — set ADB=/path/to/adb" >&2; exit 1; }

# Prefer a real handset over a running emulator. Picking whichever device
# happened to be listed first silently ran a check against an idle
# emulator once, and the screenshot looked like a broken app rather than
# the wrong target -- which is a slow and confusing thing to debug.
if [ -z "${SERIAL:-}" ]; then
  SERIAL=$("$ADB" devices | awk 'NR>1 && $2=="device" && $1 !~ /^emulator-/ {print $1; exit}')
  [ -n "$SERIAL" ] || SERIAL=$("$ADB" devices | awk 'NR>1 && $2=="device" {print $1; exit}')
fi
[ -n "$SERIAL" ] || { echo "no device attached — plug the phone in, or start an emulator" >&2; exit 1; }
case "$SERIAL" in
  emulator-*) echo "note: no physical device found, using emulator $SERIAL" >&2 ;;
esac

OUT="${OUT:-./device-check.png}"
ROUTE="${1:-}"
PKG="com.prowl.energyfinder"
METRO="${METRO:-http://localhost:8081}"

# adb shell paths must not be rewritten to Windows paths by Git Bash.
export MSYS_NO_PATHCONV=1

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

say "device: $SERIAL"
"$ADB" -s "$SERIAL" reverse tcp:8081 tcp:8081 >/dev/null

say "launching $PKG against $METRO"
"$ADB" -s "$SERIAL" shell am force-stop "$PKG"
encoded=$(printf '%s' "$METRO" | sed 's|:|%3A|g; s|/|%2F|g')
"$ADB" -s "$SERIAL" shell am start -a android.intent.action.VIEW \
  -d "prowl://expo-development-client/?url=$encoded" >/dev/null

# The bundle has to build and the JS has to mount before anything is
# tappable; a cold start after `--clear` is the slow case worth waiting on.
say "waiting for bundle"
for _ in $(seq 1 40); do
  sleep 2
  if "$ADB" -s "$SERIAL" shell dumpsys window 2>/dev/null | grep -q "$PKG/.*MainActivity"; then
    break
  fi
done
sleep 6

# The dev-client shows a "this is the developer menu" sheet on launch and a
# second Reload/Go-home sheet behind it. Both swallow taps meant for the
# app, so clear them before doing anything else.
#
# Swiping the sheet down, rather than BACK or a backdrop tap. Both of
# those misfire when no menu is actually open: BACK walks back out of the
# app to the launcher, and there is no fixed "empty" coordinate to tap --
# the one tried here hit the map's search field and toggled a filter. A
# downward swipe is the sheet's own dismiss gesture, and costs at most a
# little scrolling on whatever screen is underneath.
say "dismissing dev-menu overlays"
for _ in 1 2 3; do
  "$ADB" -s "$SERIAL" shell input swipe 500 1500 500 2150 250
  sleep 1
done

if [ -n "$ROUTE" ]; then
  say "deep-linking to $ROUTE"
  "$ADB" -s "$SERIAL" shell am start -a android.intent.action.VIEW -d "prowl://$ROUTE" >/dev/null
  sleep 4
  # Bringing the activity forward pops the dev-menu sheet back up over
  # whatever we just navigated to, so dismiss it again the same way.
  "$ADB" -s "$SERIAL" shell input swipe 500 1500 500 2150 250
  sleep 2
fi

say "screenshot -> $OUT"
"$ADB" -s "$SERIAL" shell screencap -p /sdcard/_check.png
"$ADB" -s "$SERIAL" pull /sdcard/_check.png "$OUT" >/dev/null
"$ADB" -s "$SERIAL" shell rm -f /sdcard/_check.png

say "JS errors this session"
pid=$("$ADB" -s "$SERIAL" shell pidof "$PKG" | tr -d '\r')
if [ -n "$pid" ]; then
  errors=$("$ADB" -s "$SERIAL" logcat -d --pid="$pid" 2>/dev/null \
    | grep -E "ReactNativeJS.*(Error|Warning|error|same key)" | tail -20 || true)
  if [ -n "$errors" ]; then echo "$errors"; else echo "  none"; fi
else
  echo "  app not running — it may have crashed on launch"
fi
