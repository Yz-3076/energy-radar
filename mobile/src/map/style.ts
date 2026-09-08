import { color } from "@/theme";

/**
 * The Energy Radar basemap.
 *
 * The web prototype recoloured Stadia's `alidade_smooth_dark` at runtime, which
 * needs an API key off localhost. This is a hand-authored OpenMapTiles style
 * over OpenFreeMap's planet tiles instead — free, keyless, commercial use
 * allowed — so the shipped app has no map credential to leak or expire, and
 * every colour is ours rather than a filter over someone else's palette.
 *
 * Attribution (© OpenStreetMap contributors) is required and is rendered by the
 * map's own attribution control.
 */

const TILES = "https://tiles.openfreemap.org/planet";
const GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

/** Halo behind map labels. Must be a spec-legal colour — an 8-digit hex is not
 *  one, and MapLibre renders the halos bright red when it cannot parse it. */
const INK = "rgba(6, 8, 6, 0.85)";

const ground = "#060806";
const water = "#04120b";
const green = "#0a1a0e";
const roadMinor = "#161c16";
const roadMajor = "#20291f";
const roadTrunk = "#2b3628";
const buildingLow = "#0d120d";
const buildingMid = "#141b14";
const buildingTall = "#1c2618";

export const MAP_STYLE = {
  version: 8,
  name: "Energy Radar Nocturne",
  glyphs: GLYPHS,
  // Extrusion side faces are shaded from this light. Stated explicitly rather
  // than left to the renderer's default: the sides are most of what the tilted
  // camera shows, so their tone is a design decision, not an accident.
  light: {
    anchor: "viewport" as const,
    color: "#cfe6d4",
    intensity: 0.26,
    position: [1.4, 200, 40] as [number, number, number],
  },
  sources: {
    ofm: { type: "vector", url: TILES },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": ground } },

    {
      id: "water",
      type: "fill",
      source: "ofm",
      "source-layer": "water",
      paint: { "fill-color": water },
    },
    {
      id: "landcover-green",
      type: "fill",
      source: "ofm",
      "source-layer": "landcover",
      filter: ["in", "class", "wood", "grass", "scrub"],
      paint: { "fill-color": green, "fill-opacity": 0.55 },
    },
    {
      id: "park",
      type: "fill",
      source: "ofm",
      "source-layer": "park",
      paint: { "fill-color": green, "fill-opacity": 0.4 },
    },

    // Roads, thinnest to widest so the casing order reads correctly.
    {
      id: "road-minor",
      type: "line",
      source: "ofm",
      "source-layer": "transportation",
      filter: ["in", "class", "minor", "service", "track", "path"],
      minzoom: 13,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": roadMinor,
        "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 13, 0.6, 18, 6],
      },
    },
    {
      id: "road-secondary",
      type: "line",
      source: "ofm",
      "source-layer": "transportation",
      filter: ["in", "class", "secondary", "tertiary"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": roadMajor,
        "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 8, 0.6, 18, 12],
      },
    },
    {
      id: "road-primary",
      type: "line",
      source: "ofm",
      "source-layer": "transportation",
      filter: ["in", "class", "primary", "trunk", "motorway"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": roadTrunk,
        "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 6, 0.8, 18, 18],
      },
    },
    // A whisper of accent along every street: the canvas draws its map as a
    // green grid on near-black, and this is that grid, on real geometry.
    {
      id: "road-grid-glow",
      type: "line",
      source: "ofm",
      "source-layer": "transportation",
      minzoom: 12,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": color.accent,
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 12, 0.02, 17, 0.06],
        "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 12, 0.4, 18, 2.4],
      },
    },
    {
      id: "road-motorway-glow",
      type: "line",
      source: "ofm",
      "source-layer": "transportation",
      filter: ["==", "class", "motorway"],
      minzoom: 10,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": color.accent,
        "line-opacity": 0.14,
        "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 10, 0.4, 18, 3],
      },
    },

    // Real extruded buildings from the tiles' own render_height, which is what
    // makes the tilted camera read as a city rather than a flat plan.
    {
      id: "building-3d",
      type: "fill-extrusion",
      source: "ofm",
      "source-layer": "building",
      minzoom: 14,
      // Some OSM buildings are tagged as parts that should not be extruded,
      // and a few carry a min height above their own height — extruding those
      // produces inverted geometry that z-fights into coloured speckle.
      filter: ["!=", ["get", "hide_3d"], true],
      paint: {
        // Taller blocks lift toward the accent, so height reads as height
        // even before the camera tilts.
        "fill-extrusion-color": [
          "interpolate",
          ["linear"],
          ["coalesce", ["get", "render_height"], 6],
          0,
          buildingLow,
          25,
          buildingMid,
          90,
          buildingTall,
        ],
        "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6],
        "fill-extrusion-base": [
          "min",
          ["coalesce", ["get", "render_min_height"], 0],
          ["coalesce", ["get", "render_height"], 6],
        ],
        // Kept fully opaque on purpose: a translucent extrusion layer is a
        // documented source of depth-sorting artifacts.
        "fill-extrusion-opacity": 1,
      },
    },

    // The base of every block picks up a thread of accent, which is what
    // gives the tilted city its edges instead of one flat mass.
    {
      id: "building-footprint",
      type: "line",
      source: "ofm",
      "source-layer": "building",
      minzoom: 15,
      paint: {
        "line-color": color.accent,
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 15, 0.03, 18, 0.1],
        "line-width": 0.7,
      },
    },

    {
      id: "boundary",
      type: "line",
      source: "ofm",
      "source-layer": "boundary",
      filter: ["<=", "admin_level", 4],
      paint: { "line-color": "#243024", "line-width": 0.8, "line-dasharray": [3, 2] },
    },

    {
      id: "road-label",
      type: "symbol",
      source: "ofm",
      "source-layer": "transportation_name",
      minzoom: 14,
      layout: {
        "symbol-placement": "line",
        "text-field": ["coalesce", ["get", "name:latin"], ["get", "name"]],
        "text-font": ["Noto Sans Regular"],
        "text-size": 10,
        "text-letter-spacing": 0.06,
      },
      paint: {
        "text-color": "rgba(120,150,125,0.62)",
        "text-halo-color": INK,
        "text-halo-width": 1,
      },
    },
    {
      id: "place-label",
      type: "symbol",
      source: "ofm",
      "source-layer": "place",
      filter: ["in", "class", "city", "town", "village", "suburb", "neighbourhood"],
      layout: {
        "text-field": ["coalesce", ["get", "name:latin"], ["get", "name"]],
        "text-font": ["Noto Sans Bold"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 6, 10, 14, 15],
        "text-letter-spacing": 0.12,
        "text-transform": "uppercase",
        "text-max-width": 8,
      },
      paint: {
        "text-color": "rgba(190,215,195,0.7)",
        "text-halo-color": "rgba(4,6,4,0.9)",
        "text-halo-width": 1.4,
      },
    },
  ],
} as const;

/** Tilted camera the design mocks up with `perspective(1100px) rotateX(52deg)`. */
export const PITCH_3D = 62;
export const PITCH_FLAT = 0;
export const DEFAULT_ZOOM = 15.4;
