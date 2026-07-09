/**
 * mapstyle.js — MapLibre style construction and the cmocean:// tile protocol.
 *
 * Bathymetry rendering happens client-side: Terrarium-encoded elevation tiles
 * (AWS Open Data Terrain Tiles — ETOPO1/GEBCO-derived in the ocean) are
 * fetched, decoded, and recoloured through an exact cmocean LUT by
 * core/terrain.js. Land pixels (elevation > 0) are flattened to a neutral
 * grey, which gives a pixel-accurate coastline from the DEM itself.
 */
import { getLUT, applyColormapToTerrarium, sampleColormap } from '../../core/src/index.js';

export const TERRARIUM_URL =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

export const BASEMAP_ATTRIBUTION =
  'Bathymetry: <a href="https://registry.opendata.aws/terrain-tiles/">Terrain Tiles (Mapzen/AWS)</a> — ETOPO1/GEBCO · Colours: cmocean';

const LAND_COLOR = [232, 229, 224];

/** Register the cmocean:// protocol on a maplibregl namespace. Idempotent. */
export function registerCmoceanProtocol(maplibregl) {
  maplibregl.addProtocol('cmocean', async (params, abortController) => {
    // cmocean://z/x/y.png?cmap=deep&rev=0&min=-8000&max=0&land=flat
    const m = params.url.match(/^cmocean:\/\/(\d+)\/(\d+)\/(\d+)\.png\?(.*)$/);
    if (!m) throw new Error(`Bad cmocean tile URL: ${params.url}`);
    const [, z, x, y, qs] = m;
    const q = new URLSearchParams(qs);
    const src = TERRARIUM_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    const resp = await fetch(src, { signal: abortController?.signal });
    if (!resp.ok) throw new Error(`Terrain tile ${resp.status}`);
    const bitmap = await createImageBitmap(await resp.blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    const img = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    const lut = getLUT(q.get('cmap') || 'deep', { reverse: q.get('rev') === '1' });
    applyColormapToTerrarium(img.data, lut, {
      min: Number(q.get('min') ?? -8000),
      max: Number(q.get('max') ?? 0),
      land: q.get('land') === 'transparent' ? 'transparent' : 'flat',
      landColor: LAND_COLOR,
    });
    ctx.putImageData(img, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return { data: await blob.arrayBuffer() };
  });
}

/** Tile URL template for the current bathymetry settings. */
export function cmoceanTileURL(state) {
  const p = new URLSearchParams({
    cmap: state.colormap,
    rev: state.reverse ? '1' : '0',
    min: String(state.depthMin),
    max: '0',
    land: state.land,
  });
  return `cmocean://{z}/{x}/{y}.png?${p.toString()}`;
}

/**
 * Set up the shared maplibre-contour DEM source (isobaths computed in a web
 * worker from the same Terrarium tiles). Returns the mlcontour DemSource.
 */
export function setupContours(maplibregl, mlcontour) {
  const demSource = new mlcontour.DemSource({
    url: TERRARIUM_URL,
    encoding: 'terrarium',
    maxzoom: 12,
    worker: true,
  });
  demSource.setupMaplibre(maplibregl);
  return demSource;
}

/** Contour tile URL for a given interval ('auto' or meters). */
export function contourTileURL(demSource, interval) {
  const thresholds = interval === 'auto'
    ? { 0: [2000, 4000], 4: [1000, 2000], 6: [500, 1000], 8: [250, 1000], 10: [100, 500], 12: [50, 200] }
    : { 0: [Number(interval), Number(interval) * 2] };
  return demSource.contourProtocolUrl({
    multiplier: 1,
    thresholds,
    elevationKey: 'ele',
    levelKey: 'level',
    contourLayer: 'contours',
  });
}

/** Build the full MapLibre style for the current app state. */
export function buildMapStyle(state, { demSource = null, forExport = false } = {}) {
  const sources = {
    bathy: {
      type: 'raster',
      tiles: [cmoceanTileURL(state)],
      tileSize: 256,
      maxzoom: 12,
      attribution: forExport ? '' : BASEMAP_ATTRIBUTION,
    },
    dem: {
      type: 'raster-dem',
      tiles: [TERRARIUM_URL],
      tileSize: 256,
      encoding: 'terrarium',
      maxzoom: 12,
    },
    graticule: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    eez: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    transect: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    stations: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
  };
  if (demSource) {
    sources.contours = {
      type: 'vector',
      tiles: [contourTileURL(demSource, state.contours.interval)],
      maxzoom: 15,
    };
  }

  const vis = (on) => ({ visibility: on ? 'visible' : 'none' });
  const layers = [
    { id: 'bg', type: 'background', paint: { 'background-color': '#eceae4' } },
    { id: 'bathy', type: 'raster', source: 'bathy', paint: { 'raster-resampling': 'linear' } },
    {
      id: 'hillshade',
      type: 'hillshade',
      source: 'dem',
      layout: vis(state.hillshade),
      paint: {
        'hillshade-exaggeration': 0.4,
        'hillshade-shadow-color': 'rgba(30, 40, 50, 0.9)',
        'hillshade-highlight-color': 'rgba(255, 255, 255, 0.55)',
        'hillshade-illumination-direction': 315,
      },
    },
  ];
  if (demSource) {
    layers.push({
      id: 'contours',
      type: 'line',
      source: 'contours',
      'source-layer': 'contours',
      layout: vis(state.contours.on),
      filter: ['<', ['get', 'ele'], 0], // isobaths only — no land contours
      paint: {
        'line-color': 'rgba(35, 55, 75, 0.55)',
        'line-width': ['case', ['>', ['get', 'level'], 0], 1.1, 0.5],
      },
    });
  }
  layers.push(
    {
      id: 'graticule',
      type: 'line',
      source: 'graticule',
      layout: vis(state.furniture.graticule),
      paint: { 'line-color': 'rgba(60, 75, 90, 0.35)', 'line-width': 0.7, 'line-dasharray': [2, 2] },
    },
    {
      id: 'eez',
      type: 'line',
      source: 'eez',
      paint: { 'line-color': 'rgba(180, 60, 40, 0.75)', 'line-width': 1.1, 'line-dasharray': [4, 2] },
    },
    {
      id: 'transect-line',
      type: 'line',
      source: 'transect',
      paint: { 'line-color': '#e4572e', 'line-width': 2.2 },
    },
    {
      id: 'transect-pts',
      type: 'circle',
      source: 'transect',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-radius': 4, 'circle-color': '#e4572e', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 },
    },
    {
      id: 'stations',
      type: 'circle',
      source: 'stations',
      paint: {
        'circle-radius': Math.max(2, state.stations.symbolMm * 2.2),
        'circle-color': stationColorExpression(state),
        'circle-stroke-color': '#1c2830',
        'circle-stroke-width': 1.1,
        'circle-opacity': 0.92,
      },
    },
  );

  return { version: 8, sources, layers };
}

/** Circle colour: fixed, or a cmocean-thermal ramp over the value column. */
export function stationColorExpression(state) {
  const s = state.stations;
  if (!s.colorBy || !s.valueRange || s.valueRange.min === s.valueRange.max) return s.color;
  const stops = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const v = s.valueRange.min + t * (s.valueRange.max - s.valueRange.min);
    stops.push(v, sampleThermal(t));
  }
  return [
    'case', ['==', ['typeof', ['get', 'value']], 'number'],
    ['interpolate', ['linear'], ['get', 'value'], ...stops],
    s.color,
  ];
}

function sampleThermal(t) {
  const [r, g, b] = sampleColormap('thermal', t);
  return `rgb(${r},${g},${b})`;
}
