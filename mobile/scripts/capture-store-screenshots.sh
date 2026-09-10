#!/usr/bin/env bash
#
# Capture Play Store listing screenshots from a connected phone.
#
# Runs the app through the screens worth showing, deep-linking straight to
# each one, and writes them to store-assets/screenshots/.
#
# Puts the status bar into Android's demo mode first: without it every shot
# carries the owner's real notification icons, battery level and clock
# straight into a public store listing.
#
# Usage:  ./capture-store-screenshots.sh
# Env:    ADB, SERIAL, OUT_DIR, METRO

set -euo pipefail

ADB="${ADB:-$(command -v adb || echo "/c/Android/sdk/platform-tools/adb.exe")}"
[ -x "$ADB" ] || { echo "adb not found — set ADB=/path/to/adb" >&2; exit 1; }

if [ -z "${SERIAL:-}" ]; then
  SERIAL=$("$ADB" devices | awk 'NR>1 && $2=="device" && $1 !~ /^emulator-/ {print $1; exit}')
fi
[ -n "$SERIAL" ] || { echo "no phone attached" >&2; exit 1; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="${OUT_DIR:-$HERE/../../store-assets/screenshots}"
METRO="${METRO:-http://localhost:8081}"
PKG="com.prowl.energyfinder"

# MSYS_NO_PATHCONV stops Git Bash rewriting the /sdcard/... remote paths
# into Windows ones, but that leaves adb receiving a /c/... local path it
# cannot resolve — so the destination is converted explicitly instead.
export MSYS_NO_PATHCONV=1
mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"
if command -v cygpath >/dev/null 2>&1; then
  DEST="$(cygpath -m "$OUT_DIR")"
else
  DEST="$OUT_DIR"
fi

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

demo_on() {
  "$ADB" -s "$SERIAL" shell settings put global sysui_demo_allowed 1 || true
  local b="am broadcast -a com.android.systemui.demo"
  "$ADB" -s "$SERIAL" shell $b -e command enter >/dev/null || true
  "$ADB" -s "$SERIAL" shell $b -e command clock -e hhmm 0930 >/dev/null || true
  "$ADB" -s "$SERIAL" shell $b -e command notifications -e visible false >/dev/null || true
  "$ADB" -s "$SERIAL" shell $b -e command battery -e level 100 -e plugged false >/dev/null || true
  "$ADB" -s "$SERIAL" shell $b -e command network -e wifi show -e level 4 >/dev/null || true
  "$ADB" -s "$SERIAL" shell $b -e command network -e mobile show -e datatype none -e level 4 >/dev/null || true
}

demo_off() {
  "$ADB" -s "$SERIAL" shell am broadcast -a com.android.systemui.demo -e command exit >/dev/null || true
}
# Leaving the phone stuck in demo mode would be a rude thing to do to
# someone's actual handset, so restore it however this exits.
trap demo_off EXIT

# The dev-client sheet reappears whenever the activity is brought forward.
# Swiping it down is the only dismissal that is harmless when no sheet is
# open — BACK exits the app, and there is no safe fixed point to tap.
dismiss_sheets() {
  for _ in 1 2 3; do
    "$ADB" -s "$SERIAL" shell input swipe 500 1500 500 2150 250
    sleep 1
  done
}

shot() { # shot <name> <route|-> <settle-seconds>
  local name="$1" route="$2" settle="${3:-4}"
  if [ "$route" != "-" ]; then
    "$ADB" -s "$SERIAL" shell am start -a android.intent.action.VIEW -d "prowl://$route" >/dev/null 2>&1
  fi
  sleep "$settle"
  dismiss_sheets
  demo_on            # re-assert: navigation can bring the real bar back
  sleep 1
  local dest="$DEST/$name.png"
  "$ADB" -s "$SERIAL" shell screencap -p /sdcard/_shot.png
  "$ADB" -s "$SERIAL" pull /sdcard/_shot.png "$dest" >/dev/null
  "$ADB" -s "$SERIAL" shell rm -f /sdcard/_shot.png
  [ -s "$OUT_DIR/$name.png" ] || { echo "  FAILED to save $name.png" >&2; return 1; }
  echo "  saved $name.png"
}

say "phone: $SERIAL  ->  $DEST"

say "launching against $METRO"
"$ADB" -s "$SERIAL" reverse tcp:8081 tcp:8081 >/dev/null
"$ADB" -s "$SERIAL" shell am force-stop "$PKG"
encoded=$(printf '%s' "$METRO" | sed 's|:|%3A|g; s|/|%2F|g')
"$ADB" -s "$SERIAL" shell am start -a android.intent.action.VIEW \
  -d "prowl://expo-development-client/?url=$encoded" >/dev/null

say "waiting for the bundle"
sleep 25
dismiss_sheets
demo_on

say "capturing"
# Map goes last, on purpose. The dev-menu sheet has to be swiped away, and
# that swipe pans the map off the pins every time — three separate
# attempts at recentring afterwards all produced empty terrain. Doing the
# deep-linked screens first gets the sheet dismissed on a scroll view
# where a stray swipe costs nothing, then the map is reached by tapping
# its own tab, which never pans it.
# Search autofocuses its field, so the keyboard covers half the screen.
# BACK is safe here specifically because the IME is up: Android gives the
# keypress to the keyboard first, closing it without navigating.
"$ADB" -s "$SERIAL" shell am start -a android.intent.action.VIEW -d "prowl://search" >/dev/null 2>&1
sleep 4
"$ADB" -s "$SERIAL" shell input keyevent KEYCODE_BACK
sleep 2
shot "05-search"         "-"                      3
# Onboarding is deep-linked rather than triggered for real: showing it
# properly would mean clearing seenOnboarding from app storage, which on a
# real handset also wipes the owner's saved shelves, drinks and alerts.
shot "06-onboarding"     "onboarding"             5
shot "02-store-deals"    "store/dor_alon-401"     6
shot "03-flavour"        "variant/ultra"          6
shot "04-store-local"    "store/rami_levy-25"     6
# The Me tab is deliberately not captured: on a fresh install it is all
# empty states ("0 monsters logged", "radar is quiet"), which sells the
# app short, and the alternative — logging cans into the owner's real
# account to dress it up — is not ours to do.

say "map (via tab, no swipe)"
# Deep-link to the root route rather than tapping where the MAP tab
# appears to be. Tapping was wrong twice for the same underlying reason:
# the tab bar is not present on every screen. From search it hit a result
# row, and from a store page — a pushed route with no tab bar at all — it
# hit a "closest shelves" row. Both landed on a variant page that then got
# saved as the map screenshot.
"$ADB" -s "$SERIAL" shell am start -a android.intent.action.VIEW -d "prowl://" >/dev/null 2>&1
sleep 6
dismiss_sheets
"$ADB" -s "$SERIAL" shell input tap 930 639    # recentre on the user
sleep 5
demo_on
sleep 1
"$ADB" -s "$SERIAL" shell screencap -p /sdcard/_shot.png
"$ADB" -s "$SERIAL" pull /sdcard/_shot.png "$DEST/01-map.png" >/dev/null
"$ADB" -s "$SERIAL" shell rm -f /sdcard/_shot.png
echo "  saved 01-map.png"

say "done — $(ls -1 "$OUT_DIR"/*.png 2>/dev/null | wc -l) file(s) in $DEST"
