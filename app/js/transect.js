/**
 * transect.js — in-browser bathymetric depth profiles.
 *
 * The user draws a two-point line on the map; we sample the seafloor along it
 * from the same Terrarium DEM tiles the basemap uses, decode elevation with
 * core/transect.js, and plot a profile. All geometry/assembly is in the core
 * module; this file only fetches tiles and draws.
 */
import {
  sampleLine, uniqueTiles, lonLatToTilePixel, buildProfile, profileToCSV,
  terrariumToElevation, formatDepth,
} from '../../core/src/index.js';
import { TERRARIUM_URL } from './mapstyle.js';

const SAMPLES = 200;
const TILE_SIZE = 256;

/** Pick a slippy-tile zoom giving decent resolution for the line's length. */
function pickZoom(a, b) {
  const spanDeg = Math.max(Math.abs(a.lon - b.lon), Math.abs(a.lat - b.lat));
  if (spanDeg > 20) return 5;
  if (spanDeg > 8) return 6;
  if (spanDeg > 3) return 7;
  if (spanDeg > 1) return 8;
  if (spanDeg > 0.4) return 9;
  return 10;
}

const tileCache = new Map();
async function loadTile(tx, ty, z, signal) {
  const key = `${z}/${tx}/${ty}`;
  if (tileCache.has(key)) return tileCache.get(key);
  const url = TERRARIUM_URL.replace('{z}', z).replace('{x}', tx).replace('{y}', ty);
  const resp = await fetch(url, { signal });
  if (!resp.ok) throw new Error(`tile ${key}: ${resp.status}`);
  const bmp = await createImageBitmap(await resp.blob());
  const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, TILE_SIZE, TILE_SIZE);
  const data = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data;
  tileCache.set(key, data);
  return data;
}

/**
 * Sample the DEM along a→b and return a profile object (from core/buildProfile),
 * with any tiles that fail to load contributing null elevations.
 */
export async function computeTransect(a, b, { signal } = {}) {
  const z = pickZoom(a, b);
  const samples = sampleLine(a, b, SAMPLES);
  const needed = uniqueTiles(samples.map((s) => ({ lon: s.lon, lat: s.lat })), z);

  const loaded = new Map();
  await Promise.all(needed.map(async (t) => {
    try {
      loaded.set(`${t.tx}/${t.ty}`, await loadTile(t.tx, t.ty, z, signal));
    } catch {
      loaded.set(`${t.tx}/${t.ty}`, null);
    }
  }));

  const elevations = samples.map((s) => {
    const { tx, ty, px, py } = lonLatToTilePixel(s.lon, s.lat, z);
    const data = loaded.get(`${tx}/${ty}`);
    if (!data) return null;
    const i = (py * TILE_SIZE + px) * 4;
    return terrariumToElevation(data[i], data[i + 1], data[i + 2]);
  });

  return { profile: buildProfile(samples, elevations), zoom: z };
}

/** Draw a profile into a canvas: seafloor filled below, depth axis, distance axis. */
export function drawProfile(canvas, profile, { color = '#0e6e8c' } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 520;
  const cssH = canvas.clientHeight || 200;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);

  const pts = profile.points.filter((p) => Number.isFinite(p.elev));
  if (pts.length < 2) {
    ctx.fillStyle = '#51636f';
    ctx.font = '13px -apple-system, Helvetica, Arial, sans-serif';
    ctx.fillText('No elevation data for this line.', 12, cssH / 2);
    return;
  }

  const padL = 52;
  const padR = 12;
  const padT = 12;
  const padB = 28;
  const w = cssW - padL - padR;
  const h = cssH - padT - padB;
  const maxDist = profile.length || 1;
  // Depth axis: 0 at top (surface), min elevation at bottom. Include land (>0) headroom.
  const top = Math.max(0, profile.max);
  const bottom = Math.min(profile.min, 0);
  const range = top - bottom || 1;
  const x = (d) => padL + (d / maxDist) * w;
  const y = (e) => padT + ((top - e) / range) * h;

  // Water body
  ctx.beginPath();
  ctx.moveTo(x(pts[0].dist), y(pts[0].elev));
  for (const p of pts) ctx.lineTo(x(p.dist), y(p.elev));
  ctx.lineTo(x(pts[pts.length - 1].dist), padT + h);
  ctx.lineTo(x(pts[0].dist), padT + h);
  ctx.closePath();
  ctx.fillStyle = 'rgba(14,110,140,0.16)';
  ctx.fill();

  // Seafloor line
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(x(p.dist), y(p.elev)) : ctx.lineTo(x(p.dist), y(p.elev))));
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // Sea-surface reference at 0 m
  if (top >= 0 && bottom <= 0) {
    ctx.beginPath();
    ctx.moveTo(padL, y(0));
    ctx.lineTo(padL + w, y(0));
    ctx.strokeStyle = 'rgba(60,75,90,0.4)';
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Axes
  ctx.fillStyle = '#51636f';
  ctx.strokeStyle = '#d8d4ca';
  ctx.lineWidth = 1;
  ctx.font = '11px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let k = 0; k <= 4; k++) {
    const e = top - (range * k) / 4;
    const yy = y(e);
    ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + w, yy); ctx.globalAlpha = 0.35; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillText(e >= 0 ? `${Math.round(e)} m` : `−${formatDepth(e)}`, padL - 6, yy);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let k = 0; k <= 4; k++) {
    const d = (maxDist * k) / 4;
    const km = d / 1000;
    ctx.fillText(km >= 1 ? `${km.toFixed(km >= 10 ? 0 : 1)} km` : `${Math.round(d)} m`, x(d), padT + h + 6);
  }
}

export function transectCSV(profile) {
  return profileToCSV(profile);
}
