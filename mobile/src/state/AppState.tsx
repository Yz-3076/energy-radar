import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { Alert, FlavourAlertKind } from "@/data/alerts";
import { fetchFeaturedStores, fetchLiveStores, fetchPromotions, type Promo } from "@/data/api";
import { STORES, type Store } from "@/data/stores";

const MAX_RECENT_SEARCHES = 8;

/** Tel Aviv — where the seeded dataset lives, used until location resolves. */
export const FALLBACK_COORD = { lat: 32.0765, lng: 34.7742 };

/**
 * One can the user personally drank — a private tally, not a report to
 * anyone else. This is deliberately unrelated to shelf/price data: it never
 * touches `stores`, never claims a store had stock, and isn't shown to
 * other users. See docs on why sighting-style crowd reporting was cut.
 */
export type Drink = {
  id: string;
  variantId: string;
  at: string;
};

export type Persisted = {
  drinks: Drink[];
  savedStoreIds: string[];
  seenOnboarding: boolean;
  handle: string;
  /** Most-recent-first, deduped, capped at MAX_RECENT_SEARCHES. */
  recentSearches: string[];
  /** At most one per flavour, at most one per store — see AppState's
   *  toggleFlavourAlert / toggleStoreAlert. */
  alerts: Alert[];
};

const EMPTY: Persisted = {
  drinks: [],
  savedStoreIds: [],
  seenOnboarding: false,
  handle: "@you",
  recentSearches: [],
  alerts: [],
};

const KEY = "energyradar.state.v3";

type Ctx = {
  ready: boolean;
  /** Base dataset + paid featured pins + everything this user has logged. */
  stores: Store[];
  storeById: (id: string) => Store | undefined;
  coord: { lat: number; lng: number };
  /** True once a real fix has replaced the fallback coordinate. */
  hasFix: boolean;
  /** Reverse-geocoded neighbourhood or city, for the map's "hunting near". */
  placeLabel: string | null;
  locationGranted: boolean;
  requestLocation: () => Promise<boolean>;

  saved: Set<string>;
  toggleSaved: (storeId: string) => void;

  drinks: Drink[];
  logDrink: (variantId: string) => void;
  removeDrink: (id: string) => void;

  seenOnboarding: boolean;
  completeOnboarding: () => void;
  handle: string;

  recentSearches: string[];
  addRecentSearch: (query: string) => void;
  clearRecentSearches: () => void;

  /** Current deals per flavour, nationwide — see israel-poc/promotions.py.
   *  Empty array (not undefined) for a flavour with no live promo. */
  promotionsFor: (variantId: string) => Promo[];

  alerts: Alert[];
  flavourAlertFor: (variantId: string) => Extract<Alert, { type: "flavour" }> | undefined;
  /** Creates the flavour's alert if it doesn't have one, removes it if it
   *  does — at most one per flavour, so there is nothing to configure. */
  toggleFlavourAlert: (variantId: string, kind: FlavourAlertKind, maxPrice: number | null) => void;
  storeAlertFor: (storeId: string) => Extract<Alert, { type: "store" }> | undefined;
  /** Same toggle idea, for "tell me when I'm near this store". */
  toggleStoreAlert: (storeId: string) => void;
  removeAlert: (id: string) => void;
};

const AppContext = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<Persisted>(EMPTY);
  const [ready, setReady] = useState(false);
  const [featured, setFeatured] = useState<Store[]>([]);
  const [liveStores, setLiveStores] = useState<Store[] | null>(null);
  const [promotions, setPromotions] = useState<Record<string, Promo[]>>({});
  const [coord, setCoord] = useState(FALLBACK_COORD);
  const [hasFix, setHasFix] = useState(false);
  const [placeLabel, setPlaceLabel] = useState<string | null>(null);
  const [locationGranted, setLocationGranted] = useState(false);
  const watcher = useRef<Location.LocationSubscription | null>(null);
  const hydrated = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw) setState({ ...EMPTY, ...(JSON.parse(raw) as Partial<Persisted>) });
      } catch {
        // A corrupt blob should not brick the app — start clean.
      } finally {
        hydrated.current = true;
        setReady(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    AsyncStorage.setItem(KEY, JSON.stringify(state)).catch(() => {});
  }, [state]);

  // Paid featured pins are additive and optional; failure is silent.
  useEffect(() => {
    let alive = true;
    fetchFeaturedStores()
      .then((s) => alive && setFeatured(s))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // The real, live price data — or nothing, if it hasn't loaded (offline,
  // first run before the very first scheduled fetch, etc). `stores` below
  // falls back to the bundled seed data whenever this is null, so the app
  // is never actually empty.
  useEffect(() => {
    let alive = true;
    fetchLiveStores()
      .then((s) => alive && setLiveStores(s))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Current deals, nationwide per flavour — additive on top of the prices
  // above, never blocking: an empty {} (no token configured, offline, first
  // run) just means no promo badges show anywhere, nothing else changes.
  useEffect(() => {
    let alive = true;
    fetchPromotions()
      .then((p) => alive && setPromotions(p))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  /** Name the spot the user is standing in. Purely cosmetic, so it fails
   *  soft and the map falls back to the nearest store's city. */
  const nameCoord = useCallback(async (lat: number, lng: number) => {
    try {
      const [place] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
      const label = place?.district ?? place?.subregion ?? place?.city ?? place?.region ?? null;
      if (label) setPlaceLabel(label);
    } catch {
      // no geocoder on this device, or offline
    }
  }, []);

  /**
   * The app answers "what is around me right now", so once permission
   * exists it keeps a live watch rather than reading position once:
   * distances, sorting, and the map camera all key off coord.
   */
  const startWatching = useCallback(async () => {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== "granted") return false;
    setLocationGranted(true);

    const last = await Location.getLastKnownPositionAsync().catch(() => null);
    if (last) {
      setCoord({ lat: last.coords.latitude, lng: last.coords.longitude });
      setHasFix(true);
      nameCoord(last.coords.latitude, last.coords.longitude);
    }

    if (!watcher.current) {
      watcher.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 15, timeInterval: 10000 },
        (pos) => {
          setCoord({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setHasFix(true);
        },
      ).catch(() => null);
    }

    const now = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    }).catch(() => null);
    if (now) {
      setCoord({ lat: now.coords.latitude, lng: now.coords.longitude });
      setHasFix(true);
      nameCoord(now.coords.latitude, now.coords.longitude);
    }
    return true;
  }, [nameCoord]);

  useEffect(() => {
    startWatching().catch(() => {});
    return () => {
      watcher.current?.remove();
      watcher.current = null;
    };
  }, [startWatching]);

  const requestLocation = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return false;
    await startWatching();
    return true;
  }, [startWatching]);

  const stores = useMemo(() => {
    const byId = new Map<string, Store>();
    // Real data replaces the bundled seed set outright rather than merging
    // with it: the two datasets describe overlapping real branches under
    // different ids, so merging would risk showing the same physical store
    // twice. Live coverage starts narrower (Shufersal only, for now — see
    // israel-poc/pipeline.py) and grows chain by chain; until then, or
    // whenever the fetch hasn't succeeded, the curated seed set is what
    // keeps the app from looking empty.
    const base = liveStores ?? STORES;
    for (const s of base) byId.set(s.id, { ...s, shelf: [...s.shelf] });
    for (const s of featured) byId.set(s.id, s);
    return [...byId.values()];
  }, [liveStores, featured]);

  const index = useMemo(() => new Map(stores.map((s) => [s.id, s])), [stores]);

  const value: Ctx = {
    ready,
    stores,
    storeById: (id) => index.get(id),
    coord,
    hasFix,
    placeLabel,
    locationGranted,
    requestLocation,

    saved: useMemo(() => new Set(state.savedStoreIds), [state.savedStoreIds]),
    toggleSaved: useCallback((storeId: string) => {
      setState((p) => ({
        ...p,
        savedStoreIds: p.savedStoreIds.includes(storeId)
          ? p.savedStoreIds.filter((x) => x !== storeId)
          : [...p.savedStoreIds, storeId],
      }));
    }, []),

    drinks: state.drinks,
    logDrink: useCallback((variantId: string) => {
      const drink: Drink = { id: `drink-${Date.now()}`, variantId, at: new Date().toISOString() };
      // Capped so years of daily use don't grow this without bound — the streak
      // and totals only ever need recent history anyway.
      setState((p) => ({ ...p, drinks: [drink, ...p.drinks].slice(0, 500) }));
    }, []),
    removeDrink: useCallback((id: string) => {
      setState((p) => ({ ...p, drinks: p.drinks.filter((d) => d.id !== id) }));
    }, []),

    seenOnboarding: state.seenOnboarding,
    completeOnboarding: useCallback(() => setState((p) => ({ ...p, seenOnboarding: true })), []),
    handle: state.handle,

    recentSearches: state.recentSearches,
    addRecentSearch: useCallback((query: string) => {
      const q = query.trim();
      if (!q) return;
      setState((p) => ({
        ...p,
        recentSearches: [q, ...p.recentSearches.filter((s) => s.toLowerCase() !== q.toLowerCase())].slice(
          0,
          MAX_RECENT_SEARCHES,
        ),
      }));
    }, []),
    clearRecentSearches: useCallback(() => setState((p) => ({ ...p, recentSearches: [] })), []),

    promotionsFor: useCallback((variantId: string) => promotions[variantId] ?? [], [promotions]),

    alerts: state.alerts,
    flavourAlertFor: useCallback(
      (variantId: string) =>
        state.alerts.find(
          (a): a is Extract<Alert, { type: "flavour" }> => a.type === "flavour" && a.variantId === variantId,
        ),
      [state.alerts],
    ),
    toggleFlavourAlert: useCallback((variantId: string, kind: FlavourAlertKind, maxPrice: number | null) => {
      setState((p) => {
        const exists = p.alerts.some((a) => a.type === "flavour" && a.variantId === variantId);
        if (exists) {
          return { ...p, alerts: p.alerts.filter((a) => !(a.type === "flavour" && a.variantId === variantId)) };
        }
        const alert: Alert = {
          id: `alert-${Date.now()}`,
          type: "flavour",
          variantId,
          kind,
          maxPrice,
          createdAt: new Date().toISOString(),
        };
        return { ...p, alerts: [alert, ...p.alerts] };
      });
    }, []),
    storeAlertFor: useCallback(
      (storeId: string) =>
        state.alerts.find(
          (a): a is Extract<Alert, { type: "store" }> => a.type === "store" && a.storeId === storeId,
        ),
      [state.alerts],
    ),
    toggleStoreAlert: useCallback((storeId: string) => {
      setState((p) => {
        const exists = p.alerts.some((a) => a.type === "store" && a.storeId === storeId);
        if (exists) {
          return { ...p, alerts: p.alerts.filter((a) => !(a.type === "store" && a.storeId === storeId)) };
        }
        const alert: Alert = { id: `alert-${Date.now()}`, type: "store", storeId, createdAt: new Date().toISOString() };
        return { ...p, alerts: [alert, ...p.alerts] };
      });
    }, []),
    removeAlert: useCallback((id: string) => {
      setState((p) => ({ ...p, alerts: p.alerts.filter((a) => a.id !== id) }));
    }, []),
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): Ctx {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside <AppProvider>");
  return ctx;
}
