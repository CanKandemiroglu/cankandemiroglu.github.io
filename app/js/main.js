/**
 * main.js — Marine Map Tool UI wiring. All figure math lives in
 * /core (marine-map-core); this file connects DOM ⇄ state ⇄ map ⇄ exports.
 */
import {
  listColormaps, colormapCSSGradient, sampleColormap,
  metersPerPixel, niceScaleBar, graticuleInterval, graticuleLines,
  formatDegree, formatDepth, colorbarTicks,
  parseDelimited, guessColumns, toStations, stationsToGeoJSON,
  selectJournal, FALLBACK_SPEC,
  buildCitationText, buildBibTeX, attributionLine, DATA_SOURCES,
  suggestProjection, generatePyGMT, generateRScript,
  gbifTaxonMatchURL, gbifOccurrenceURL, obisOccurrenceURL,
  parseGBIF, parseOBIS, occurrencesToStations, dedupeOccurrences,
  ASSISTANT_MODELS, DEFAULT_ASSISTANT_MODEL, ANTHROPIC_MESSAGES_ENDPOINT,
  buildAssistantRequest, anthropicHeaders, extractAssistantText,
} from '../../core/src/index.js';
import { computeTransect, drawProfile, transectCSV } from './transect.js';
import {
  registerCmoceanProtocol, setupContours, buildMapStyle,
  cmoceanTileURL, contourTileURL, stationColorExpression,
} from './mapstyle.js';
import { exportFigure, resolveSpec, computeLayout, downloadBlob } from './exporter.js';

const $ = (id) => document.getElementById(id);
const today = () => new Date().toISOString().slice(0, 10);

/* ------------------------------------------------------------------ state */

const CITE_SOURCES = ['tool', 'terrainTiles', 'etopo2022', 'gebco', 'naturalEarth', 'cmocean'];

const state = {
  region: { west: 27.5, south: 41.0, east: 42.5, north: 47.5 },
  colormap: 'deep',
  reverse: false,
  depthMin: -8000,
  land: 'flat',
  hillshade: true,
  contours: { on: true, interval: 'auto' },
  stations: {
    list: [], raw: null, mapping: null,
    symbolMm: 2.2, color: '#e4572e', colorBy: false, valueRange: null, label: true,
  },
  furniture: { scaleBar: true, northArrow: true, graticule: true, inset: true, title: '' },
  journal: { record: null, columns: 2, format: 'pdf' },
  exportDpi: 'spec',
  attributionLine: '',
  transect: { profile: null },
  assistant: { history: [], key: '', model: DEFAULT_ASSISTANT_MODEL },
  activeSources: new Set(), // data layers in use -> propagated into citations
};

const EEZ_WFS = 'https://geo.vliz.be/geoserver/MarineRegions/wfs';
let drawState = null;   // active transect draw handler
let occAbort = null;
let transectBusy = false;

/** MapLibre bounds can exceed ±180/±90 (world-copies, zoomed-out views); the
 *  occurrence/EEZ query APIs reject that. Clamp to a valid, non-degenerate box. */
function viewportBounds() {
  const b = map.getBounds();
  const clampLon = (v) => Math.max(-180, Math.min(180, v));
  const clampLat = (v) => Math.max(-89.9, Math.min(89.9, v));
  let west = clampLon(b.getWest());
  let east = clampLon(b.getEast());
  if (east <= west) { west = -180; east = 180; } // wrapped/degenerate -> whole world
  return { west, south: clampLat(b.getSouth()), east, north: clampLat(b.getNorth()) };
}

let journals = [];       // loaded records
let map = null;
let demSource = null;
let busy = false;

/* ------------------------------------------------------------------- map */

function initMap() {
  registerCmoceanProtocol(maplibregl);
  demSource = setupContours(maplibregl, mlcontour);

  map = new maplibregl.Map({
    container: 'map',
    style: buildMapStyle(state, { demSource }),
    bounds: [[state.region.west, state.region.south], [state.region.east, state.region.north]],
    fitBoundsOptions: { padding: 24 },
    attributionControl: { compact: false },
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');

  map.on('move', updateOverlays);
  map.on('moveend', updateGraticule);
  map.on('load', () => { updateOverlays(); updateGraticule(); });
  map.on('mousemove', (e) => {
    $('coords').textContent =
      `${formatDegree(Math.abs(e.lngLat.lat) < 0.05 ? 0 : e.lngLat.lat, 'lat')} ${formatDegree(e.lngLat.lng, 'lon')}`;
  });
  map.on('click', 'stations', (e) => {
    const f = e.features[0];
    const val = f.properties.value;
    new maplibregl.Popup({ closeButton: false })
      .setLngLat(f.geometry.coordinates)
      .setHTML(`<strong>${escapeHTML(f.properties.name || 'Station')}</strong>${
        val !== undefined && val !== null && val !== '' ? `<br>value: ${escapeHTML(String(val))}` : ''}`)
      .addTo(map);
  });
  map.on('mouseenter', 'stations', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'stations', () => { map.getCanvas().style.cursor = ''; });
}

function updateOverlays() {
  const zoom = map.getZoom();
  const lat = map.getCenter().lat;
  const mpp = metersPerPixel(lat, zoom);
  const bar = niceScaleBar(mpp, 130);
  $('scalebar-bar').style.width = `${bar.px}px`;
  $('scalebar-label').textContent = bar.label;
}

function updateGraticule() {
  if (!map.getSource('graticule')) return;
  const b = map.getBounds();
  const span = Math.max(b.getEast() - b.getWest(), b.getNorth() - b.getSouth());
  const interval = graticuleInterval(span);
  map.getSource('graticule').setData(graticuleLines(
    { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() },
    interval,
  ));
}

function refreshBathy() {
  map.getSource('bathy')?.setTiles([cmoceanTileURL(state)]);
  drawColorbarOverlay();
}

function drawColorbarOverlay() {
  const cv = $('colorbar');
  const ctx = cv.getContext('2d');
  const W = cv.width;
  const H = cv.height;
  ctx.clearRect(0, 0, W, H);
  const x0 = 10;
  const y0 = 6;
  const barW = W - 20;
  const barH = 12;
  const grad = ctx.createLinearGradient(x0, 0, x0 + barW, 0);
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    // left = deepest, right = surface
    const [r, g, b] = sampleColormap(state.colormap, 1 - t, { reverse: state.reverse });
    grad.addColorStop(t, `rgb(${r},${g},${b})`);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(x0, y0, barW, barH);
  ctx.strokeStyle = '#51636f';
  ctx.lineWidth = 1;
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, barW - 1, barH - 1);
  ctx.fillStyle = '#20303c';
  ctx.font = '10px -apple-system, Helvetica, Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(formatDepth(state.depthMin), x0, y0 + barH + 12);
  ctx.textAlign = 'right';
  ctx.fillText('0 m', x0 + barW, y0 + barH + 12);
  ctx.textAlign = 'center';
  ctx.fillText('Depth', x0 + barW / 2, y0 + barH + 12);
}

/* ------------------------------------------------------------ region UI */

function readRegionInputs() {
  const west = Number($('region-west').value);
  const east = Number($('region-east').value);
  const south = Number($('region-south').value);
  const north = Number($('region-north').value);
  if ([west, east, south, north].some((v) => !Number.isFinite(v))) return null;
  if (east <= west || north <= south) return null;
  return { west, south, east, north };
}

function writeRegionInputs(b) {
  $('region-west').value = b.west.toFixed(2);
  $('region-east').value = b.east.toFixed(2);
  $('region-south').value = b.south.toFixed(2);
  $('region-north').value = b.north.toFixed(2);
}

function applyRegion(fly = true) {
  const b = readRegionInputs();
  if (!b) {
    setStatus('Region invalid: check that east > west and north > south.');
    return;
  }
  state.region = b;
  if (fly) map.fitBounds([[b.west, b.south], [b.east, b.north]], { padding: 24 });
  const proj = suggestProjection(b);
  $('projection-hint').textContent =
    `Suggested projection for print: ${proj.name} — ${proj.rationale}`;
  updateCiteBox();
}

/* ---------------------------------------------------------- stations UI */

const DEMO_CSV = `station,latitude,longitude,depth_m
GeoB7608-1,41.55,30.88,1202
GeoB7609-1,41.75,31.10,1508
Helgoland Mud Area,54.09,7.97,28
Mallorca mats,39.37,3.22,2`;

async function handleStationsFile(file) {
  try {
    let headers;
    let rows;
    if (/\.(xlsx|xls)$/i.test(file.name)) {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false });
      if (!aoa.length) throw new Error('Empty sheet');
      headers = aoa[0].map((h) => String(h ?? ''));
      rows = aoa.slice(1).map((r) => headers.map((_, i) => String(r[i] ?? '')));
    } else {
      const parsed = parseDelimited(await file.text());
      headers = parsed.headers;
      rows = parsed.rows;
    }
    ingestTable(headers, rows);
  } catch (err) {
    $('stations-status').textContent = `Could not read file: ${err.message}`;
  }
}

function ingestTable(headers, rows, mapping = null) {
  state.stations.raw = { headers, rows };
  const m = mapping || guessColumns(headers);
  state.stations.mapping = m;
  const { stations, errors } = toStations(headers, rows, m);
  state.stations.list = stations;
  const values = stations.map((s) => s.value).filter((v) => Number.isFinite(v));
  state.stations.valueRange = values.length
    ? { min: Math.min(...values), max: Math.max(...values) }
    : null;

  populateMappingUI(headers, m);
  $('stations-mapping').hidden = false;
  $('stations-clear').disabled = false;
  $('stations-status').textContent =
    `${stations.length} station${stations.length === 1 ? '' : 's'} loaded${errors.length ? `, ${errors.length} issue(s)` : ''}.`;
  $('stations-errors').innerHTML = errors.slice(0, 8).map((e) => `<li>${escapeHTML(e)}</li>`).join('');

  syncStationsToMap();
  if (stations.length) {
    const lons = stations.map((s) => s.lon);
    const lats = stations.map((s) => s.lat);
    map.fitBounds(
      [[Math.min(...lons) - 1, Math.min(...lats) - 1], [Math.max(...lons) + 1, Math.max(...lats) + 1]],
      { padding: 40, maxZoom: 9 },
    );
  }
}

function populateMappingUI(headers, m) {
  for (const [key, sel] of [['lat', 'map-lat'], ['lon', 'map-lon'], ['name', 'map-name'], ['value', 'map-value']]) {
    const el = $(sel);
    el.innerHTML = '<option value="-1">—</option>'
      + headers.map((h, i) => `<option value="${i}">${escapeHTML(h || `col ${i + 1}`)}</option>`).join('');
    el.value = String(m[key]);
  }
}

function syncStationsToMap() {
  map.getSource('stations')?.setData(stationsToGeoJSON(state.stations.list));
  map.setPaintProperty('stations', 'circle-color', stationColorExpression(state));
  map.setPaintProperty('stations', 'circle-radius', Math.max(2, state.stations.symbolMm * 2.2));
}

function clearStations() {
  state.stations.list = [];
  state.stations.raw = null;
  state.stations.valueRange = null;
  $('stations-mapping').hidden = true;
  $('stations-clear').disabled = true;
  $('stations-status').textContent = '';
  $('stations-errors').innerHTML = '';
  $('stations-file').value = '';
  syncStationsToMap();
}

/* ----------------------------------------------------------- journal UI */

async function loadJournals() {
  try {
    const index = await (await fetch('../data/journals/index.json')).json();
    const recs = await Promise.all(
      index.journals.map((id) => fetch(`../data/journals/${id}.json`).then((r) => r.json())),
    );
    journals = recs;
    $('journal-select').innerHTML = '<option value="">Generic (no journal)</option>'
      + recs.map((r) => `<option value="${r.id}">${escapeHTML(r.title)}</option>`).join('');
  } catch (err) {
    console.warn('Journal DB failed to load', err);
    $('journal-select').innerHTML = '<option value="">Generic (no journal)</option>';
  }
  updateJournalSummary();
}

function updateJournalSummary() {
  const spec = resolveSpec(state);
  const rec = state.journal.record;
  const box = $('journal-summary');
  box.hidden = false;
  box.innerHTML = `
    <strong>${escapeHTML(spec.journalTitle || 'Generic figure')}</strong><br>
    Width: <strong>${spec.widthMm} mm</strong> (${state.journal.columns}-column) ·
    Raster: <strong>${spec.dpi} dpi</strong> ·
    Colour: <strong>${escapeHTML(spec.colourMode || 'RGB')}</strong> ·
    Min font: <strong>${spec.minFontPt} pt</strong><br>
    Accepted: ${escapeHTML((spec.formatsAccepted || []).join(', ').toUpperCase())}
    ${spec.sourceUrl ? ` · <a href="${spec.sourceUrl}" target="_blank" rel="noopener">author guidelines</a>` : ''}`;
  $('journal-warnings').innerHTML =
    (spec.warnings || []).map((w) => `<li>${escapeHTML(w)}</li>`).join('');
}

/* --------------------------------------------------------------- cite UI */

/** Cited sources = the always-on set plus any data layers currently in use. */
function citeSources() {
  return [...CITE_SOURCES, ...state.activeSources];
}

function updateCiteBox() {
  // The exported figure still carries the compact, licence-required data
  // credits (GEBCO/ETOPO, Natural Earth, cmocean, and any layers in use)
  // baked onto the image — that is what keeps a published figure compliant.
  // The cite box itself leads with how to cite the tool, i.e. your work.
  state.attributionLine = attributionLine(citeSources().filter((s) => s !== 'tool'));
  const toolCitation = DATA_SOURCES.tool.citation.replace('{version}', '0.1.0');
  const layerNames = [...state.activeSources]
    .map((id) => DATA_SOURCES[id]?.name).filter(Boolean);
  const extra = layerNames.length ? `, plus ${layerNames.join(', ')}` : '';
  $('cite-text').value =
    `How to cite the Marine Map Tool\n\n${toolCitation}\n\n` +
    `Data note: figures made here use openly-licensed data (GEBCO/ETOPO ` +
    `bathymetry, Natural Earth, cmocean colours${extra}). Those credits are ` +
    `printed on the exported figure and listed in full in the project README — ` +
    `keep them in your figure caption to stay licence-compliant.`;
}

/* --------------------------------------------------------- data layers */

const emptyFC = () => ({ type: 'FeatureCollection', features: [] });

async function toggleEEZ(on) {
  if (!on) {
    map.getSource('eez')?.setData(emptyFC());
    state.activeSources.delete('marineRegions');
    updateCiteBox();
    $('eez-status').textContent = 'Exclusive Economic Zones from MarineRegions.org (CC-BY). Loaded on demand for the current view.';
    return;
  }
  const b = viewportBounds();
  $('eez-status').textContent = 'Loading EEZ boundaries for the current view…';
  const params = new URLSearchParams({
    service: 'WFS', version: '2.0.0', request: 'GetFeature',
    typeName: 'MarineRegions:eez', outputFormat: 'application/json',
    srsName: 'CRS:84', count: '120',
    bbox: `${b.west},${b.south},${b.east},${b.north},CRS:84`,
  });
  try {
    const resp = await fetch(`${EEZ_WFS}?${params.toString()}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const fc = await resp.json();
    map.getSource('eez').setData(fc);
    const n = fc.features?.length || 0;
    if (n) { state.activeSources.add('marineRegions'); updateCiteBox(); }
    $('eez-status').textContent = n
      ? `${n} EEZ polygon${n === 1 ? '' : 's'} in view · Flanders Marine Institute, MarineRegions.org (CC-BY) — now in your figure's "How to cite".`
      : 'No EEZ polygons in the current view — zoom to a coastline.';
  } catch (err) {
    $('layer-eez').checked = false;
    $('eez-status').textContent = `Could not load the EEZ layer: ${err.message}`;
  }
}

/* ------------------------------------------------------------ transect */

function startTransectDraw() {
  cancelTransectDraw();
  const pts = [];
  const hint = document.createElement('div');
  hint.className = 'map-draw-hint';
  hint.textContent = 'Click the start point of your transect.';
  map.getContainer().appendChild(hint);
  map.getCanvas().style.cursor = 'crosshair';
  $('transect-draw').textContent = 'Drawing…';
  $('transect-draw').disabled = true;

  const onClick = (e) => {
    pts.push([e.lngLat.lng, e.lngLat.lat]);
    if (pts.length === 1) {
      hint.textContent = 'Click the end point.';
      map.getSource('transect').setData({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: pts[0] }, properties: {} }],
      });
    } else {
      map.getSource('transect').setData(transectFC(pts));
      cancelTransectDraw();
      runTransect({ lon: pts[0][0], lat: pts[0][1] }, { lon: pts[1][0], lat: pts[1][1] });
    }
  };
  drawState = { onClick, hint };
  map.on('click', onClick);
}

function transectFC(pts) {
  return {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'LineString', coordinates: pts }, properties: {} },
      ...pts.map((c) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: {} })),
    ],
  };
}

function cancelTransectDraw() {
  if (!drawState) return;
  map.off('click', drawState.onClick);
  drawState.hint.remove();
  map.getCanvas().style.cursor = '';
  $('transect-draw').textContent = 'Draw a line';
  $('transect-draw').disabled = false;
  drawState = null;
}

async function runTransect(a, b) {
  if (transectBusy) return;
  transectBusy = true;
  $('transect-draw').disabled = true;
  $('transect-status').textContent = 'Sampling the seafloor along your line…';
  try {
    const { profile } = await computeTransect(a, b);
    state.transect.profile = profile;
    const plot = $('transect-plot');
    plot.style.display = 'block';
    drawProfile(plot, profile);
    $('transect-clear').disabled = false;
    $('transect-csv').disabled = false;
    const withData = profile.points.filter((p) => Number.isFinite(p.elev));
    if (withData.length < 2) {
      $('transect-status').textContent = 'No bathymetry along that line (try a marine area).';
    } else {
      $('transect-status').textContent =
        `${(profile.length / 1000).toFixed(1)} km · deepest ${formatDepth(profile.min)} · shallowest ${formatDepth(profile.max)}.`;
    }
  } catch (err) {
    $('transect-status').textContent = `Transect failed: ${err.message}`;
  } finally {
    transectBusy = false;
    $('transect-draw').disabled = false;
  }
}

function clearTransect() {
  cancelTransectDraw();
  state.transect.profile = null;
  map.getSource('transect')?.setData(emptyFC());
  $('transect-plot').style.display = 'none';
  $('transect-status').textContent = '';
  $('transect-clear').disabled = true;
  $('transect-csv').disabled = true;
}

/* -------------------------------------------------------- occurrences */

/** One or two valid {west,south,east,north} boxes covering the current view,
 *  splitting at the antimeridian so each box has west < east in [-180,180]. */
function occurrenceBoxes() {
  const b = map.getBounds();
  const clampLat = (v) => Math.max(-89.9, Math.min(89.9, v));
  const south = clampLat(b.getSouth());
  const north = clampLat(b.getNorth());
  const rawW = b.getWest();
  const rawE = b.getEast();
  if (rawE - rawW >= 360) return [{ west: -180, south, east: 180, north }]; // whole world
  const wrap = (v) => (((v + 180) % 360) + 360) % 360 - 180;
  const west = wrap(rawW);
  const east = wrap(rawE);
  if (west <= east) return [{ west, south, east, north }];
  // Crosses the antimeridian: two boxes, [west,180] and [-180,east].
  return [{ west, south, east: 180, north }, { west: -180, south, east, north }];
}

async function fetchOccurrences() {
  const taxon = $('occ-taxon').value.trim();
  const source = $('occ-source').value;
  const limit = Number($('occ-limit').value);
  const boxes = occurrenceBoxes();
  occAbort?.abort();
  occAbort = new AbortController();
  $('occ-status').textContent = `Querying ${source.toUpperCase()}…`;
  try {
    const results = await Promise.all(boxes.map(async (bounds) => {
      const url = source === 'gbif'
        ? gbifOccurrenceURL({ scientificName: taxon || null, bounds, limit })
        : obisOccurrenceURL({ scientificName: taxon || null, bounds, size: limit });
      const resp = await fetch(url, { signal: occAbort.signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return (source === 'gbif' ? parseGBIF : parseOBIS)(await resp.json());
    }));
    const list = dedupeOccurrences(results.flat());
    if (!list.length) {
      $('occ-status').textContent = `No georeferenced ${source.toUpperCase()} records${taxon ? ` for "${taxon}"` : ''} in this view.`;
      return;
    }
    state.activeSources.add(source); // 'gbif' | 'obis' -> into citations
    ingestStations(occurrencesToStations(list),
      `${list.length} ${source.toUpperCase()} occurrence${list.length === 1 ? '' : 's'}${taxon ? ` of "${taxon}"` : ''}.`);
    updateCiteBox();
    $('occ-status').textContent =
      `Plotted ${list.length} ${source.toUpperCase()} occurrence${list.length === 1 ? '' : 's'} as stations, now credited in "How to cite". Data: ${source === 'gbif' ? 'GBIF.org' : 'OBIS (obis.org)'}.`;
  } catch (err) {
    if (err.name !== 'AbortError') $('occ-status').textContent = `Query failed: ${err.message}`;
  }
}

/** Load a plain [{lon,lat,name,value}] list as the station set. */
function ingestStations(stations, statusText) {
  state.stations.list = stations;
  const values = stations.map((s) => s.value).filter((v) => Number.isFinite(v));
  state.stations.valueRange = values.length ? { min: Math.min(...values), max: Math.max(...values) } : null;
  state.stations.raw = null;
  $('stations-mapping').hidden = true;
  $('stations-clear').disabled = false;
  $('stations-status').textContent = statusText;
  $('stations-errors').innerHTML = '';
  syncStationsToMap();
}

/* ------------------------------------------------------------ assistant */

function pushAssistantMsg(role, text) {
  const el = document.createElement('div');
  el.className = `assistant-msg assistant-msg--${role === 'user' ? 'user' : 'bot'}`;
  el.textContent = text;
  $('assistant-log').appendChild(el);
  $('assistant-log').scrollTop = $('assistant-log').scrollHeight;
}

async function askAssistant() {
  const question = $('assistant-input').value.trim();
  if (!question) return;
  const key = $('assistant-key').value.trim();
  if (!key) {
    $('assistant-status').textContent = 'Add your Anthropic API key above to use the assistant (it stays in your browser).';
    $('assistant-setup').open = true;
    return;
  }
  state.assistant.model = $('assistant-model').value;
  if ($('assistant-remember').checked) {
    try { localStorage.setItem('mmt_anthropic_key', key); } catch { /* ignore */ }
  }
  pushAssistantMsg('user', question);
  $('assistant-input').value = '';
  $('assistant-status').textContent = 'Thinking…';
  $('assistant-send').disabled = true;
  try {
    const body = buildAssistantRequest({
      record: state.journal.record,
      question,
      history: state.assistant.history,
      model: state.assistant.model,
    });
    const resp = await fetch(ANTHROPIC_MESSAGES_ENDPOINT, {
      method: 'POST',
      headers: anthropicHeaders(key),
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error?.message || `HTTP ${resp.status}`);
    const answer = extractAssistantText(data) || '(no answer)';
    pushAssistantMsg('bot', answer);
    state.assistant.history.push({ role: 'user', text: question }, { role: 'assistant', text: answer });
    $('assistant-status').textContent = '';
  } catch (err) {
    $('assistant-status').textContent = `Assistant error: ${err.message}`;
  } finally {
    $('assistant-send').disabled = false;
  }
}

/* ------------------------------------------------------------ script gen */

function buildFigureState() {
  const spec = resolveSpec(state);
  const span = Math.max(state.region.east - state.region.west, state.region.north - state.region.south);
  let contourInterval = state.contours.interval === 'auto'
    ? (span >= 20 ? 1000 : span >= 5 ? 500 : 250)
    : Number(state.contours.interval);
  return {
    title: state.furniture.title || null,
    region: { ...state.region },
    projection: suggestProjection(state.region),
    colormap: state.colormap,
    reverse: state.reverse,
    depthRange: { min: state.depthMin, max: 0 },
    contours: state.contours.on
      ? { interval: contourInterval, annotInterval: contourInterval * 2 }
      : null,
    hillshade: state.hillshade,
    stations: state.stations.list.length
      ? {
        rows: state.stations.list,
        symbolMm: state.stations.symbolMm,
        color: state.stations.color,
        label: state.stations.label,
      }
      : null,
    furniture: {
      scaleBar: state.furniture.scaleBar,
      northArrow: state.furniture.northArrow,
      graticuleDeg: graticuleInterval(span),
      inset: state.furniture.inset,
    },
    journal: {
      title: spec.journalTitle,
      widthMm: spec.widthMm,
      dpi: spec.dpi,
      format: ['pdf', 'png', 'tiff', 'eps'].includes(spec.format) ? spec.format : 'pdf',
      minFontPt: spec.minFontPt,
    },
    citations: buildCitationText({
      sources: [...citeSources(), 'gmt', 'pygmt'],
      accessedDate: today(),
    }).split('\n'),
    accessedDate: today(),
  };
}

/* -------------------------------------------------------------- exports */

async function runExport(kind) {
  if (busy) return;
  busy = true;
  const status = (t) => { $('export-status').textContent = t; };
  try {
    applyRegion(false);
    const eezData = $('layer-eez').checked ? (map.getSource('eez')?._data || null) : null;
    const result = await exportFigure(state, kind, { demSource, eezData, onStatus: status });
    if (kind === 'preview') {
      $('preview-img').src = result.dataURL;
      $('preview-meta').textContent =
        `${result.spec.journalTitle || 'Generic'} — ${result.spec.widthMm} mm wide, preview at 150 dpi (downloads use ${result.spec.dpi} dpi)`;
      $('preview-dialog').showModal();
      status('');
    } else {
      downloadBlob(result.blob, result.filename);
      const extra = (result.layout.warnings || []).join(' ');
      status(`Saved ${result.filename} (${(result.layout.W)}×${result.layout.H} px, ${Math.round(result.layout.heightMm)} mm tall). ${extra}`);
    }
  } catch (err) {
    console.error(err);
    status(`Export failed: ${err.message}`);
  } finally {
    busy = false;
  }
}

function exportScript(kind) {
  applyRegion(false);
  const fs = buildFigureState();
  const text = kind === 'py' ? generatePyGMT(fs) : generateRScript(fs);
  downloadBlob(
    new Blob([text], { type: 'text/plain' }),
    kind === 'py' ? 'marine_map_figure.py' : 'marine_map_figure.R',
  );
  $('export-status').textContent = kind === 'py'
    ? 'PyGMT script saved — run it locally (pip install pygmt) for a fully vector publication file.'
    : 'R script saved — see its header for the required packages.';
}

/* ------------------------------------------------------------------ UI */

function wireUI() {
  // mode toggle
  const setMode = (m) => {
    document.body.classList.toggle('mode-quick', m === 'quick');
    $('mode-quick').setAttribute('aria-pressed', String(m === 'quick'));
    $('mode-pub').setAttribute('aria-pressed', String(m === 'pub'));
  };
  $('mode-quick').addEventListener('click', () => setMode('quick'));
  $('mode-pub').addEventListener('click', () => setMode('pub'));
  setMode('quick');

  // region
  $('region-apply').addEventListener('click', () => applyRegion(true));
  $('region-from-view').addEventListener('click', () => {
    const b = map.getBounds();
    writeRegionInputs({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() });
    applyRegion(false);
  });
  $('region-preset').addEventListener('change', (e) => {
    if (!e.target.value) return;
    const [w, s, ee, n] = e.target.value.split(',').map(Number);
    writeRegionInputs({ west: w, south: s, east: ee, north: n });
    applyRegion(true);
  });

  // bathymetry
  const cmaps = listColormaps();
  const preferred = ['deep', 'ice', 'dense', 'haline', 'matter', 'tempo', 'turbid', 'topo', 'gray'];
  const ordered = [
    ...preferred.filter((p) => cmaps.some((c) => c.id === p)),
    ...cmaps.map((c) => c.id).filter((id) => !preferred.includes(id)),
  ];
  $('cmap-select').innerHTML = ordered
    .map((id) => `<option value="${id}"${id === state.colormap ? ' selected' : ''}>${id}</option>`)
    .join('');
  const refreshSwatch = () => {
    $('cmap-swatch').style.background =
      colormapCSSGradient(state.colormap, { reverse: state.reverse });
  };
  refreshSwatch();
  $('cmap-select').addEventListener('change', (e) => {
    state.colormap = e.target.value;
    refreshSwatch();
    refreshBathy();
  });
  $('cmap-reverse').addEventListener('change', (e) => {
    state.reverse = e.target.checked;
    refreshSwatch();
    refreshBathy();
  });
  $('depth-min').addEventListener('input', (e) => {
    state.depthMin = Number(e.target.value);
    $('depth-min-out').textContent = `−${Math.abs(state.depthMin).toLocaleString('en-US')} m`;
  });
  $('depth-min').addEventListener('change', refreshBathy);
  $('hillshade-on').addEventListener('change', (e) => {
    state.hillshade = e.target.checked;
    map.setLayoutProperty('hillshade', 'visibility', state.hillshade ? 'visible' : 'none');
  });
  $('contours-on').addEventListener('change', (e) => {
    state.contours.on = e.target.checked;
    if (map.getLayer('contours')) {
      map.setLayoutProperty('contours', 'visibility', state.contours.on ? 'visible' : 'none');
    }
  });
  $('contour-interval').addEventListener('change', (e) => {
    state.contours.interval = e.target.value;
    map.getSource('contours')?.setTiles([contourTileURL(demSource, state.contours.interval)]);
  });
  $('land-style').addEventListener('change', (e) => {
    state.land = e.target.value;
    refreshBathy();
  });

  // stations
  $('stations-file').addEventListener('change', (e) => {
    if (e.target.files?.[0]) handleStationsFile(e.target.files[0]);
  });
  $('stations-demo').addEventListener('click', () => {
    const parsed = parseDelimited(DEMO_CSV);
    ingestTable(parsed.headers, parsed.rows);
  });
  $('stations-clear').addEventListener('click', clearStations);
  $('stations-remap').addEventListener('click', () => {
    if (!state.stations.raw) return;
    ingestTable(state.stations.raw.headers, state.stations.raw.rows, {
      lat: Number($('map-lat').value),
      lon: Number($('map-lon').value),
      name: Number($('map-name').value),
      value: Number($('map-value').value),
    });
  });
  $('station-size').addEventListener('change', (e) => {
    state.stations.symbolMm = Math.max(0.5, Number(e.target.value) || 2.2);
    syncStationsToMap();
  });
  $('station-color').addEventListener('change', (e) => {
    state.stations.color = e.target.value;
    syncStationsToMap();
  });
  $('station-by-value').addEventListener('change', (e) => {
    state.stations.colorBy = e.target.checked;
    syncStationsToMap();
  });
  $('station-labels').addEventListener('change', (e) => {
    state.stations.label = e.target.checked;
  });

  // cartographic furniture
  $('fig-title').addEventListener('change', (e) => {
    state.furniture.title = e.target.value.trim();
  });
  $('furn-scalebar').addEventListener('change', (e) => {
    state.furniture.scaleBar = e.target.checked;
    $('scalebar').style.display = e.target.checked ? '' : 'none';
  });
  $('furn-north').addEventListener('change', (e) => {
    state.furniture.northArrow = e.target.checked;
    $('north-arrow').style.display = e.target.checked ? '' : 'none';
  });
  $('furn-graticule').addEventListener('change', (e) => {
    state.furniture.graticule = e.target.checked;
    map.setLayoutProperty('graticule', 'visibility', e.target.checked ? 'visible' : 'none');
  });
  $('furn-inset').addEventListener('change', (e) => {
    state.furniture.inset = e.target.checked;
  });

  // data layers
  $('layer-eez').addEventListener('change', (e) => toggleEEZ(e.target.checked));

  // transect
  $('transect-draw').addEventListener('click', startTransectDraw);
  $('transect-clear').addEventListener('click', clearTransect);
  $('transect-csv').addEventListener('click', () => {
    if (!state.transect.profile) return;
    downloadBlob(new Blob([transectCSV(state.transect.profile)], { type: 'text/csv' }), 'transect_profile.csv');
  });

  // occurrences
  $('occ-fetch').addEventListener('click', fetchOccurrences);
  $('occ-taxon').addEventListener('keydown', (e) => { if (e.key === 'Enter') fetchOccurrences(); });

  // assistant
  $('assistant-model').innerHTML = ASSISTANT_MODELS
    .map((m) => `<option value="${m.id}"${m.id === DEFAULT_ASSISTANT_MODEL ? ' selected' : ''}>${escapeHTML(m.label)}</option>`)
    .join('');
  try {
    const saved = localStorage.getItem('mmt_anthropic_key');
    if (saved) { $('assistant-key').value = saved; $('assistant-remember').checked = true; }
  } catch { /* ignore */ }
  $('assistant-send').addEventListener('click', askAssistant);
  $('assistant-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') askAssistant(); });
  $('assistant-remember').addEventListener('change', (e) => {
    if (!e.target.checked) { try { localStorage.removeItem('mmt_anthropic_key'); } catch { /* ignore */ } }
  });

  // journal + export
  $('journal-select').addEventListener('change', (e) => {
    state.journal.record = journals.find((j) => j.id === e.target.value) || null;
    updateJournalSummary();
  });
  $('journal-columns').addEventListener('change', (e) => {
    state.journal.columns = Number(e.target.value);
    updateJournalSummary();
  });
  $('export-dpi').addEventListener('change', (e) => { state.exportDpi = e.target.value; });
  $('export-preview').addEventListener('click', () => runExport('preview'));
  $('export-png').addEventListener('click', () => runExport('png'));
  $('export-pdf').addEventListener('click', () => runExport('pdf'));
  $('export-svg').addEventListener('click', () => runExport('svg'));
  $('export-pygmt').addEventListener('click', () => exportScript('py'));
  $('export-r').addEventListener('click', () => exportScript('R'));
  $('preview-close').addEventListener('click', () => $('preview-dialog').close());

  // cite
  $('cite-copy').addEventListener('click', async () => {
    await navigator.clipboard.writeText($('cite-text').value);
    setStatus('Citation text copied.');
  });
  $('cite-bibtex').addEventListener('click', async () => {
    await navigator.clipboard.writeText(buildBibTeX({ sources: citeSources() }));
    setStatus('BibTeX copied.');
  });
}

function setStatus(t) { $('export-status').textContent = t; }

function escapeHTML(s) {
  return String(s).replace(/[<>&"]/g, (ch) => (
    { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]
  ));
}

/* ----------------------------------------------------------------- boot */

initMap();
wireUI();
drawColorbarOverlay();
applyRegion(false);
loadJournals();
updateCiteBox();

// Debug/testing handle (used by the smoke test; harmless in production).
window.__mmt = { map, state, buildFigureState };
