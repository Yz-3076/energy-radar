/**
 * Real system notifications, fired the moment an alert's condition becomes
 * true — but only while the app is actually open and checking. There is no
 * background job or push server behind this (see docs/staying-current.md
 * for why): a store alert is checked against your live GPS position while
 * Me is on screen, and a flavour alert is checked against whatever price
 * data is already loaded. That is a real difference from "the app pings a
 * server every 15 minutes even when closed" — be honest with yourself about
 * what this can and can't do before relying on it.
 *
 * `expo-notifications` is a native module: it only exists in a build made
 * after it was added as a dependency. Every call here is guarded so that on
 * whatever's currently installed on a device — built before this module was
 * linked in — this quietly does nothing instead of crashing the app. Once a
 * fresh build includes it, the exact same code starts actually notifying,
 * no further changes needed.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Notifications: any = null;
try {
  // Deferred require, not a static import: a static import gets resolved (and
  // its module-scope side effects run) the moment this file loads, before we
  // get a chance to catch anything.
  Notifications = require("expo-notifications");
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
} catch {
  Notifications = null;
}

let permissionAsked = false;

/** Asks once per app session; silently does nothing if denied — a missed
 *  notification is a much smaller problem than nagging for permission. */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (!Notifications) return false;
  try {
    const existing = await Notifications.getPermissionsAsync();
    if (existing.granted) return true;
    if (permissionAsked) return false;
    permissionAsked = true;
    const asked = await Notifications.requestPermissionsAsync();
    return asked.granted;
  } catch {
    return false;
  }
}

export async function notifyAlert(title: string, body: string) {
  if (!Notifications) return;
  const ok = await ensureNotificationPermission();
  if (!ok) return;
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body },
      trigger: null, // fire immediately
    });
  } catch {
    // A missed notification is not worth taking the app down over.
  }
}
