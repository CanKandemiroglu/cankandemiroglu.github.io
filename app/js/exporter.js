/**
 * exporter.js — turns the current app state into a publication figure.
 *
 * Pipeline: journal spec → physical layout (mm → px at target dpi) → hidden
 * MapLibre render of the exact region at that resolution → cartographic
 * furniture composited on top (canvas or SVG surface) → PNG (with correct
 * pHYs dpi metadata) / PDF (exact mm page via pdf-lib) / SVG (vector
 * furniture + embedded raster map).
 */
import {
  selectJournal, FALLBACK_SPEC, sampleColormap,
  graticuleInterval, graticuleLines,
} from '../../core/src/index.js';
import { buildMapStyle } from './mapstyle.js';
import { CanvasSurface, SVGSurface } from './surfaces.js';
import {
  drawFrame, drawGraticuleLabels, drawScaleBar, drawNorthArrow,
  drawColorbar, drawStations, drawInset, drawTitle, drawAttribution,
} from './furniture-draw.js';

const MERC = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const INV_MERC = (y) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * (180 / Math.PI);

let landFCPromise = null;
function getLandFC() {
  landFCPromise ??= fetch('data/ne_110m_land.geojson').then((r) => r.json());
  return landFCPromise;
}

/** Resolve the export spec from the app state (journal record or fallback). */
export function resolveSpec(state) {
  if (!state.journal.record) {
    return { ...FALLBACK_SPEC, widthMm: state.journal.columns === 1 ? 90 : FALLBACK_SPEC.widthMm };
  }
  return selectJournal(state.journal.record, {
    columns: state.journal.columns,
    format: state.journal.format,
  });
}

/**
 * Compute the physical layout: full-canvas size and the map rectangle, all in
 * device px at `dpi`. Width is the journal's column width — exactly.
 */
export function computeLayout(state, spec, dpi) {
  const pxPerMm = dpi / 25.4;
  const b = state.region;
  const f = state.furniture;

  const labelPt = Math.max(spec.minFontPt || 7, 7);
  const fontPx = (labelPt * dpi) / 72;
  const smallFontPx = (Math.max(labelPt - 1, 6) * dpi) / 72;
  const titleFontPx = ((labelPt + 2) * dpi) / 72;

  const mLeft = f.graticule ? 12 : 3;
  const mBottom = (f.graticule ? 8.5 : 3) + 4.5; // + attribution line
  const mTop = state.furniture.title ? 9 : 3;
  const mRight = 17; // colorbar strip

  const wMm = spec.widthMm;
  let mapWMm = wMm - mLeft - mRight;
  const aspect = (MERC(b.north) - MERC(b.south)) / (((b.east - b.west) * Math.PI) / 180);
  let mapHMm = mapWMm * aspect;

  const warnings = [];
  const maxH = spec.maxHeightMm || 240;
  if (mTop + mapHMm + mBottom > maxH) {
    const scale = (maxH - mTop - mBottom) / mapHMm;
    mapWMm *= scale;
    mapHMm *= scale;
    warnings.push(`Region is tall: map scaled to ${Math.round(scale * 100)}% of column width to respect the journal's ${maxH} mm height limit.`);
  }

  const W = Math.round(wMm * pxPerMm);
  const H = Math.round((mTop + mapHMm + mBottom) * pxPerMm);
  const mapX = Math.round((mLeft + (wMm - mLeft - mRight - mapWMm) / 2) * pxPerMm);

  const layout = {
    dpi, pxPerMm, W, H,
    map: {
      x: mapX,
      y: Math.round(mTop * pxPerMm),
      w: Math.round(mapWMm * pxPerMm),
      h: Math.round(mapHMm * pxPerMm),
    },
    bounds: b,
    fontPx, smallFontPx, titleFontPx,
    metersPerPx: ((b.east - b.west) * 111319.49 *
      Math.cos((((b.north + b.south) / 2) * Math.PI) / 180)) / Math.round(mapWMm * pxPerMm),
    heightMm: mTop + mapHMm + mBottom,
    warnings,
  };
  return layout;
}

/**
 * Render the map region into an offscreen canvas at the layout's resolution
 * using a second, non-interactive MapLibre instance.
 */
export async function renderMapImage(state, layout, { demSource, timeoutMs = 60000 } = {}) {
  const maplibregl = window.maplibregl;
  const pixelRatio = layout.dpi / 96;
  const cssW = Math.max(Math.round(layout.map.w / pixelRatio), 50);
  const cssH = Math.max(Math.round(layout.map.h / pixelRatio), 50);

  const container = document.createElement('div');
  container.style.cssText =
    `position:fixed;left:-${cssW + 100}px;top:0;width:${cssW}px;height:${cssH}px;`;
  document.body.appendChild(container);

  const b = state.region;
  const zoom = Math.log2((cssW * 360) / ((b.east - b.west) * 512));
  const center = [
    (b.west + b.east) / 2,
    INV_MERC((MERC(b.north) + MERC(b.south)) / 2),
  ];

  const map = new maplibregl.Map({
    container,
    style: buildMapStyle(state, { demSource, forExport: true }),
    center,
    zoom,
    pixelRatio,
    interactive: false,
    attributionControl: false,
    preserveDrawingBuffer: true,
    fadeDuration: 0,
    renderWorldCopies: false,
  });
  map.on('load', () => {
    // Push live data into the export style before waiting for idle.
    map.getSource('stations')?.setData(stationsFC(state));
    if (state.furniture.graticule) {
      const interval = graticuleInterval(
        Math.max(b.east - b.west, b.north - b.south));
      map.getSource('graticule')?.setData(graticuleLines(b, interval));
    }
  });
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    map.once('idle', () => { clearTimeout(timer); resolve(); });
  });

  const out = document.createElement('canvas');
  out.width = layout.map.w;
  out.height = layout.map.h;
  out.getContext('2d').drawImage(
    map.getCanvas(), 0, 0, map.getCanvas().width, map.getCanvas().height,
    0, 0, layout.map.w, layout.map.h,
  );
  map.remove();
  container.remove();
  return out;
}

function stationsFC(state) {
  return {
    type: 'FeatureCollection',
    features: state.stations.list.map((st) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [st.lon, st.lat] },
      properties: { name: st.name, value: st.value },
    })),
  };
}

function stationColorFor(state) {
  const s = state.stations;
  if (s.colorBy && s.valueRange && s.valueRange.max > s.valueRange.min) {
    return (v) => {
      if (typeof v !== 'number' || !Number.isFinite(v)) return s.color;
      const t = (v - s.valueRange.min) / (s.valueRange.max - s.valueRange.min);
      const [r, g, b] = sampleColormap('thermal', Math.max(0, Math.min(1, t)));
      return `rgb(${r},${g},${b})`;
    };
  }
  return () => s.color;
}

async function drawFurniture(surface, layout, state) {
  drawFrame(surface, layout);
  if (state.furniture.graticule) drawGraticuleLabels(surface, layout);
  if (state.furniture.scaleBar) drawScaleBar(surface, layout);
  if (state.furniture.northArrow) drawNorthArrow(surface, layout);
  drawColorbar(surface, layout, {
    colormap: state.colormap, reverse: state.reverse, depthMin: state.depthMin,
  });
  if (state.stations.list.length) {
    drawStations(surface, layout, state.stations.list, {
      symbolMm: state.stations.symbolMm,
      colorFor: stationColorFor(state),
      labels: state.stations.label,
    });
  }
  if (state.furniture.inset) drawInset(surface, layout, await getLandFC());
  if (state.furniture.title) drawTitle(surface, layout, state.furniture.title);
  drawAttribution(surface, layout, state.attributionLine);
}

/**
 * Produce the composed figure. kind: 'png' | 'pdf' | 'svg' | 'preview'.
 * Returns {blob, filename, layout} ('preview' returns a dataURL instead of a blob).
 */
export async function exportFigure(state, kind, { demSource, onStatus = () => {} } = {}) {
  const spec = resolveSpec(state);
  const dpi = kind === 'preview' ? 150
    : (state.exportDpi === 'spec' ? spec.dpi : Number(state.exportDpi));
  const layout = computeLayout(state, spec, dpi);

  onStatus(`Rendering map at ${dpi} dpi (${layout.W}×${layout.H} px)…`);
  const mapCanvas = await renderMapImage(state, layout, { demSource });

  const stem = `marine-map_${spec.journalId || 'generic'}_${state.journal.columns}col`;

  if (kind === 'svg') {
    onStatus('Composing SVG…');
    const svg = new SVGSurface(layout.W, layout.H, layout.pxPerMm);
    svg.rect(0, 0, layout.W, layout.H, { fill: '#ffffff' });
    svg.image(mapCanvas, layout.map.x, layout.map.y, layout.map.w, layout.map.h);
    await drawFurniture(svg, layout, state);
    const blob = new Blob([svg.toString()], { type: 'image/svg+xml' });
    return { blob, filename: `${stem}.svg`, layout };
  }

  onStatus('Composing figure…');
  const canvas = document.createElement('canvas');
  canvas.width = layout.W;
  canvas.height = layout.H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, layout.W, layout.H);
  ctx.drawImage(mapCanvas, layout.map.x, layout.map.y);
  await drawFurniture(new CanvasSurface(ctx), layout, state);

  if (kind === 'preview') {
    return { dataURL: canvas.toDataURL('image/png'), layout, spec };
  }

  const pngBlob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  const pngBytes = setPngDpi(new Uint8Array(await pngBlob.arrayBuffer()), dpi);

  if (kind === 'png') {
    return {
      blob: new Blob([pngBytes], { type: 'image/png' }),
      filename: `${stem}_${dpi}dpi.png`,
      layout,
    };
  }

  // PDF: exact physical page size, embedded high-dpi raster.
  onStatus('Writing PDF…');
  const { PDFDocument } = window.PDFLib;
  const doc = await PDFDocument.create();
  const wPt = (layout.W / layout.pxPerMm) * (72 / 25.4);
  const hPt = (layout.H / layout.pxPerMm) * (72 / 25.4);
  const page = doc.addPage([wPt, hPt]);
  const img = await doc.embedPng(pngBytes);
  page.drawImage(img, { x: 0, y: 0, width: wPt, height: hPt });
  doc.setTitle(state.furniture.title || 'Marine map figure');
  doc.setProducer('Marine Map Tool — https://osmancankandemiroglu.com/app/');
  doc.setCreator('Marine Map Tool (marine-map-core)');
  const pdfBytes = await doc.save();
  return {
    blob: new Blob([pdfBytes], { type: 'application/pdf' }),
    filename: `${stem}_${dpi}dpi.pdf`,
    layout,
  };
}

/** Insert/replace a pHYs chunk so the PNG carries its real print resolution. */
export function setPngDpi(bytes, dpi) {
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // 'pHYs'
  dv.setUint32(8, ppm);
  dv.setUint32(12, ppm);
  chunk[16] = 1; // unit: metre
  dv.setUint32(17, crc32(chunk.subarray(4, 17)));

  // find first IDAT; skip an existing pHYs if present
  let pos = 8;
  const out = [bytes.subarray(0, 8)];
  while (pos < bytes.length) {
    const len = new DataView(bytes.buffer, bytes.byteOffset + pos).getUint32(0);
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
    if (type === 'IDAT') {
      out.push(chunk, bytes.subarray(pos));
      break;
    }
    if (type !== 'pHYs') out.push(bytes.subarray(pos, pos + 12 + len));
    pos += 12 + len;
  }
  const total = out.reduce((n, a) => n + a.length, 0);
  const merged = new Uint8Array(total);
  let off = 0;
  for (const a of out) { merged.set(a, off); off += a.length; }
  return merged;
}

let crcTable = null;
function crc32(data) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
