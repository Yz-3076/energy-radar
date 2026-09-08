import type { StyleSpecification } from "@maplibre/maplibre-gl-style-spec";
import {
  Camera,
  Map as MapView,
  Marker,
  type CameraRef,
  type ViewStateChangeEvent,
} from "@maplibre/maplibre-react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeSyntheticEvent,
} from "react-native";

import { useSafeAreaInsets } from "react-native-safe-area-context";
import Supercluster from "supercluster";

import { BrandMark } from "@/components/BrandMark";
import { Can } from "@/components/Can";
import { CanGL } from "@/components/CanGL";
import { ClusterBadge, StorePin, UserPuck } from "@/components/MapPins";
import { FadeInView, SlideInView } from "@/components/motion";
import { StoreBubble } from "@/components/StoreBubble";
import { Crosshair, CrosshairSimple, MagnifyingGlass, StackSimple } from "@/components/icons";
import { Chip, Tap } from "@/components/ui";
import { getVariant } from "@/data/catalog";
import { FILTERS, matchesFilter, type FilterId } from "@/data/filters";
import {
  distanceM,
  ils,
  originalRow,
  prettyDistance,
  storeIsFresh,
  type Store,
} from "@/data/stores";
import { DEFAULT_ZOOM, MAP_STYLE, PITCH_3D, PITCH_FLAT } from "@/map/style";
import { useApp } from "@/state/AppState";
import { accentAlpha, color, radius, space, textAlpha } from "@/theme";

type ClusterFeature = {
  properties: { cluster?: boolean; cluster_id?: number; point_count?: number; storeId?: string };
  geometry: { coordinates: [number, number] };
};

/** Widest bbox we ever query, so a fully zoomed-out map cannot flood markers. */
const MAX_MARKERS = 36;

/** Longitude delta that moves the map `px` screen pixels east at this zoom. */
function eastOffset(lat: number, zoom: number, px: number) {
  const metresPerPixel = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
  return (px * metresPerPixel) / (111320 * Math.cos((lat * Math.PI) / 180));
}

export default function MapScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const { stores, coord, hasFix, placeLabel, locationGranted } = useApp();

  const cameraRef = useRef<CameraRef>(null);
  const now = useMemo(() => new Date(), []);

  const [filter, setFilter] = useState<FilterId>("all");
  const [threeD, setThreeD] = useState(true);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<{
    bounds: [number, number, number, number];
    zoom: number;
    center: [number, number];
  } | null>(null);
  /** Where the camera sat before a pin was focused, so closing restores it. */
  const restore = useRef<{ center: [number, number]; zoom: number } | null>(null);
  /** The first real GPS fix recentres the map once, and only once — after
   *  that the camera belongs to whoever is panning it. */
  const centred = useRef(false);

  const visibleStores = useMemo(
    () => stores.filter((s) => matchesFilter(s, filter, now)),
    [stores, filter, now],
  );

  const storeIndex = useMemo(() => new Map(stores.map((s) => [s.id, s])), [stores]);
  const focus = focusId ? storeIndex.get(focusId) : undefined;

  const cluster = useMemo(() => {
    const index = new Supercluster({ radius: 62, maxZoom: 16, minPoints: 2 });
    index.load(
      visibleStores.map((s) => ({
        type: "Feature" as const,
        properties: { storeId: s.id },
        geometry: { type: "Point" as const, coordinates: [s.lng, s.lat] as [number, number] },
      })),
    );
    return index;
  }, [visibleStores]);

  const features = useMemo(() => {
    if (!view) return [];
    const raw = cluster.getClusters(view.bounds, Math.round(view.zoom)) as unknown as ClusterFeature[];
    if (raw.length <= MAX_MARKERS) return raw;
    // Too many for smooth marker views: keep the ones nearest the viewport centre.
    return [...raw]
      .sort(
        (a, b) =>
          distanceM(
            { lat: view.center[1], lng: view.center[0] },
            { lat: a.geometry.coordinates[1], lng: a.geometry.coordinates[0] },
          ) -
          distanceM(
            { lat: view.center[1], lng: view.center[0] },
            { lat: b.geometry.coordinates[1], lng: b.geometry.coordinates[0] },
          ),
      )
      .slice(0, MAX_MARKERS);
  }, [cluster, view]);

  const onRegionDidChange = useCallback((e: NativeSyntheticEvent<ViewStateChangeEvent>) => {
    const { bounds, zoom, center } = e.nativeEvent;
    setView({
      bounds: [bounds[0], bounds[1], bounds[2], bounds[3]] as [number, number, number, number],
      zoom,
      center: [center[0], center[1]],
    });
    setLoading(false);
  }, []);

  /** Deck of the nearest shelves, shown while nothing is focused. */
  const deck = useMemo(
    () =>
      [...visibleStores]
        .sort((a, b) => distanceM(coord, a) - distanceM(coord, b))
        .slice(0, 8),
    [visibleStores, coord],
  );

  const nearestCity = placeLabel ?? deck[0]?.city ?? "";
  const nearestMetres = deck.length ? distanceM(coord, deck[0]) : Infinity;
  /** Everything Energy Radar knows about is in Israel today. Standing outside
   *  that, the honest answer is to say so rather than show an empty map. */
  const outOfCoverage = nearestMetres > 25_000;

  const openFocus = useCallback(
    (store: Store) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      if (view) restore.current = { center: view.center, zoom: view.zoom };
      setFocusId(store.id);
      const zoom = Math.max(view?.zoom ?? DEFAULT_ZOOM, 16.2);
      cameraRef.current?.setStop({
        // Parks the pin at roughly the left quarter, where the canvas puts it
        // before the card slides in. Done by moving the centre east rather than
        // by asking for viewport padding: padding gives the renderer an
        // off-centre frustum, and the platforms disagree about what it means.
        center: [store.lng + eastOffset(store.lat, zoom, W * 0.25), store.lat],
        zoom,
        pitch: threeD ? PITCH_3D : PITCH_FLAT,
        duration: 820,
        easing: "fly",
      });
    },
    [view, threeD, W],
  );

  const closeFocus = useCallback(() => {
    setFocusId(null);
    const back = restore.current;
    cameraRef.current?.setStop({
      ...(back ? { center: back.center, zoom: back.zoom } : {}),
      pitch: threeD ? PITCH_3D : PITCH_FLAT,
      duration: 620,
      easing: "ease",
    });
  }, [threeD]);

  const recentre = useCallback(() => {
    cameraRef.current?.setStop({
      center: [coord.lng, coord.lat],
      zoom: DEFAULT_ZOOM,
      pitch: threeD ? PITCH_3D : PITCH_FLAT,
      duration: 700,
      easing: "fly",
    });
  }, [coord, threeD]);

  useEffect(() => {
    cameraRef.current?.setStop({
      pitch: threeD ? PITCH_3D : PITCH_FLAT,
      duration: 500,
      easing: "ease",
    });
  }, [threeD]);

  useEffect(() => {
    if (!hasFix || centred.current || focusId) return;
    centred.current = true;
    cameraRef.current?.setStop({
      center: [coord.lng, coord.lat],
      zoom: DEFAULT_ZOOM,
      pitch: threeD ? PITCH_3D : PITCH_FLAT,
      duration: 900,
      easing: "fly",
    });
  }, [hasFix, coord, focusId, threeD]);

  const focusVariant = focus ? getVariant(originalRow(focus).variantId) : null;
  const bubbleLeft = Math.round(W * 0.37);

  return (
    <View style={styles.root}>
      <MapView
        style={StyleSheet.absoluteFill}
        mapStyle={MAP_STYLE as unknown as StyleSpecification}
        onRegionDidChange={onRegionDidChange}
        onPress={() => focusId && closeFocus()}
        logo={false}
        attribution
        attributionPosition={{ bottom: insets.bottom + 96, left: 12 }}
        compass={false}
        scaleBar={false}
        touchRotate={false}
      >
        <Camera
          ref={cameraRef}
          initialViewState={{
            center: [coord.lng, coord.lat],
            zoom: DEFAULT_ZOOM,
            pitch: PITCH_3D,
          }}
          minZoom={4}
          maxZoom={19}
        />

        {hasFix ? (
          <Marker id="me" lngLat={[coord.lng, coord.lat]} anchor="center">
            <UserPuck />
          </Marker>
        ) : null}

        {features.map((f) => {
          const [lng, lat] = f.geometry.coordinates;
          if (f.properties.cluster) {
            const id = f.properties.cluster_id as number;
            return (
              <Marker
                key={`cluster-${id}`}
                id={`cluster-${id}`}
                lngLat={[lng, lat]}
                anchor="center"
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  const zoom = Math.min(19, cluster.getClusterExpansionZoom(id));
                  cameraRef.current?.setStop({ center: [lng, lat], zoom, duration: 620, easing: "fly" });
                }}
              >
                <ClusterBadge
                  count={f.properties.point_count ?? 0}
                  fresh={anyFresh(cluster, id, storeIndex, now)}
                />
              </Marker>
            );
          }

          const store = storeIndex.get(f.properties.storeId as string);
          if (!store) return null;
          return (
            <Marker
              key={store.id}
              id={store.id}
              lngLat={[store.lng, store.lat]}
              anchor="bottom"
              onPress={() => openFocus(store)}
            >
              <StorePin
                store={store}
                now={now}
                focused={focusId === store.id}
                dimmed={focusId !== null && focusId !== store.id}
                showPrice={(view?.zoom ?? 0) >= 14 && focusId === null}
              />
            </Marker>
          );
        })}
      </MapView>

      {/* top scrim + brand row + search + chips */}
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(7,8,7,0.96)", "rgba(7,8,7,0.55)", "rgba(7,8,7,0)"]}
        locations={[0, 0.58, 1]}
        style={[styles.topScrim, { height: insets.top + 150 }]}
      />

      <View style={[styles.topBar, { top: insets.top + 6 }]} pointerEvents="box-none">
        <View style={styles.brandRow}>
          <View style={styles.brandLeft}>
            <BrandMark size={38} />
            <View style={styles.brandText}>
              <Text style={styles.kicker}>Hunting near</Text>
              <Text style={styles.place} numberOfLines={1}>
                {nearestCity || "Locating…"}
              </Text>
            </View>
          </View>
          <Tap
            style={[styles.avatar, locationGranted && { borderColor: accentAlpha(45) }]}
            onPress={() => router.push("/(tabs)/me")}
            accessibilityLabel="Profile"
          >
            <Crosshair
              size={17}
              color={locationGranted ? color.accent : textAlpha(40)}
              weight={locationGranted ? "fill" : "regular"}
            />
          </Tap>
        </View>

        <Tap style={styles.search} onPress={() => router.push("/search")}>
          <MagnifyingGlass size={15} color={textAlpha(45)} />
          <Text style={styles.searchPlaceholder}>Flavour, store or price…</Text>
        </Tap>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {FILTERS.map((f) => (
            <Chip key={f.id} label={f.label} active={filter === f.id} onPress={() => setFilter(f.id)} />
          ))}
        </ScrollView>
      </View>

      {/* right-hand map controls */}
      <View style={[styles.controls, { top: insets.top + 168 }]}>
        <Tap
          style={[
            styles.control,
            threeD && { backgroundColor: color.accent900, borderColor: color.accent },
          ]}
          onPress={() => setThreeD((v) => !v)}
        >
          <Text style={[styles.controlLabel, { color: threeD ? color.accent : color.text }]}>3D</Text>
        </Tap>
        <Tap style={styles.control} onPress={recentre}>
          <CrosshairSimple size={17} color={color.text} />
        </Tap>
        <Tap style={styles.control} onPress={() => router.push("/search")}>
          <StackSimple size={17} color={color.text} />
        </Tap>
      </View>

      {loading ? (
        <FadeInView style={[styles.loading, { bottom: insets.bottom + 180 }]}>
          <ActivityIndicator size="small" color={color.accent} />
          <Text style={styles.loadingText}>loading shelves in view…</Text>
        </FadeInView>
      ) : null}

      {!focus && outOfCoverage ? (
        <FadeInView style={[styles.coverage, { bottom: insets.bottom + 92 }]}>
          <Text style={styles.coverageTitle}>No shelves within 25 km</Text>
          <Text style={styles.coverageBody}>
            Energy Radar reads Israel's published price files, so that is where the shelves are today. The
            nearest one it knows about is {prettyDistance(nearestMetres)} away — or log the shelf in
            front of you and put it on the map yourself.
          </Text>
        </FadeInView>
      ) : null}

      {/* nearest-shelf deck */}
      {!focus && !outOfCoverage ? (
        <FadeInView style={[styles.deck, { bottom: insets.bottom + 92 }]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.deckRow}
            snapToInterval={214}
            decelerationRate="fast"
          >
            {deck.map((s) => {
              const row = originalRow(s);
              const variant = getVariant(row.variantId);
              return (
                <Tap key={s.id} style={styles.deckCard} onPress={() => openFocus(s)}>
                  <Can variant={variant} size={59} />
                  <View style={styles.deckText}>
                    <Text style={styles.deckStore} numberOfLines={1}>
                      {s.name}
                    </Text>
                    <Text style={styles.deckMeta} numberOfLines={1}>
                      {prettyDistance(distanceM(coord, s))} · {variant.name}
                    </Text>
                    <View style={styles.deckPriceRow}>
                      <Text style={styles.deckPrice}>{ils(row.price)}</Text>
                      <Text style={styles.deckStock}>
                        {storeIsFresh(s, now) ? "sold today" : `${s.shelf.length} variants`}
                      </Text>
                    </View>
                  </View>
                </Tap>
              );
            })}
          </ScrollView>
        </FadeInView>
      ) : null}

      {/* focused state */}
      {focus && focusVariant ? (
        <>
          <FadeInView style={styles.scrimWrap}>
            <Pressable style={StyleSheet.absoluteFill} onPress={closeFocus} />
          </FadeInView>

          <FadeInView
            pointerEvents="box-none"
            duration={300}
            style={[styles.heroWrap, { top: H * 0.24 }]}
          >
            <View style={styles.heroGlow} />
            <CanGL variant={focusVariant} style={styles.hero} fallbackSize={210} />
            <Text style={styles.heroHint}>Drag to spin</Text>
          </FadeInView>

          <SlideInView
            duration={320}
            style={[styles.bubble, { left: bubbleLeft, right: 14, top: H * 0.3 }]}
          >
            <StoreBubble
              store={focus}
              stores={stores}
              coord={coord}
              now={now}
              onClose={closeFocus}
              onDetails={() => router.push({ pathname: "/store/[id]", params: { id: focus.id } })}
            />
          </SlideInView>
        </>
      ) : null}
    </View>
  );
}

/** Does any store inside this cluster count as freshly sold? */
function anyFresh(
  index: Supercluster,
  clusterId: number,
  stores: Map<string, Store>,
  now: Date,
): boolean {
  try {
    return index
      .getLeaves(clusterId, 24)
      .some((leaf) => {
        const store = stores.get((leaf.properties as { storeId?: string }).storeId ?? "");
        return store ? storeIsFresh(store, now) : false;
      });
  } catch {
    return false;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  topScrim: { position: "absolute", left: 0, right: 0, top: 0 },
  topBar: { position: "absolute", left: 0, right: 0, paddingHorizontal: 16, gap: space[4] },
  brandRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brandLeft: { flexDirection: "row", alignItems: "center", gap: space[3], flex: 1, minWidth: 0 },
  brandText: { flex: 1, minWidth: 0 },
  kicker: {
    fontSize: 9.5,
    fontWeight: "500",
    letterSpacing: 1.9,
    color: color.accent,
    textTransform: "uppercase",
  },
  place: {
    fontSize: 19,
    fontWeight: "800",
    letterSpacing: -0.6,
    color: color.text,
    textTransform: "uppercase",
    marginTop: 4,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.neutral800,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 10, fontWeight: "700", color: color.accent },
  search: {
    height: 42,
    borderRadius: radius.md,
    backgroundColor: "rgba(20,22,20,0.86)",
    borderWidth: 1,
    borderColor: color.neutral800,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[4],
  },
  searchPlaceholder: { fontSize: 13, color: textAlpha(45) },
  chipRow: { gap: space[2], paddingRight: 16 },
  controls: { position: "absolute", right: 14, gap: space[2] },
  control: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: "rgba(20,22,20,0.85)",
    borderWidth: 1,
    borderColor: color.neutral800,
    alignItems: "center",
    justifyContent: "center",
  },
  controlLabel: { fontSize: 10.5, fontWeight: "700" },
  loading: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(12,14,12,0.86)",
    borderWidth: 1,
    borderColor: color.neutral800,
  },
  loadingText: { fontSize: 10.5, color: textAlpha(60) },
  deck: { position: "absolute", left: 0, right: 0 },
  coverage: {
    position: "absolute",
    left: 16,
    right: 16,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.neutral800,
    backgroundColor: "rgba(20,22,20,0.94)",
    padding: space[6],
    gap: space[2],
  },
  coverageTitle: { fontSize: 14, fontWeight: "700", color: color.text },
  coverageBody: { fontSize: 11.5, lineHeight: 17, color: textAlpha(55) },
  deckRow: { gap: space[3], paddingHorizontal: 16 },
  deckCard: {
    width: 206,
    borderRadius: radius.lg,
    backgroundColor: "rgba(20,22,20,0.92)",
    borderWidth: 1,
    borderColor: color.neutral800,
    padding: space[4],
    flexDirection: "row",
    gap: space[4],
  },
  deckText: { flex: 1, minWidth: 0 },
  deckStore: { fontSize: 12.5, fontWeight: "600", color: color.text },
  deckMeta: { fontSize: 10.5, color: textAlpha(50), marginTop: 3 },
  deckPriceRow: { flexDirection: "row", alignItems: "baseline", gap: space[2], marginTop: space[2] },
  deckPrice: { fontSize: 16, fontWeight: "700", color: color.accent },
  deckStock: { fontSize: 9.5, color: textAlpha(45) },
  scrimWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(4,5,4,0.72)",
  },
  heroWrap: { position: "absolute", left: 8, width: 152, height: 278, alignItems: "center", justifyContent: "center" },
  heroGlow: {
    position: "absolute",
    width: 210,
    height: 210,
    borderRadius: 105,
    backgroundColor: "rgba(0,255,65,0.10)",
  },
  hero: { width: 148, height: 262 },
  heroHint: {
    position: "absolute",
    bottom: 2,
    fontSize: 9,
    fontWeight: "500",
    letterSpacing: 1.5,
    textTransform: "uppercase",
    color: textAlpha(40),
  },
  bubble: { position: "absolute" },
});
