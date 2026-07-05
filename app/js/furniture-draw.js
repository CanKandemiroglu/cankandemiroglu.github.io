/**
 * furniture-draw.js — renders cartographic furniture (neatline, graticule
 * labels, scale bar, north arrow, colorbar, stations, inset locator, title,
 * attribution) onto a drawing surface (Canvas or SVG). All geometry/formatting
 * math comes from marine-map-core; this file only places ink.
 *
 * The `layout` object (built by exporter.js):
 *   { dpi, pxPerMm, W, H, map: {x, y, w, h}, bounds, fontPx, smallFontPx,
 *     titleFontPx, metersPerPx }
 */
import {
  niceScaleBar, graticuleLines, graticuleInterval, colorbarTicks,
  formatDegree, formatDepth, lonLatToCanvasXY, sampleColormap,
} from '../../core/src/index.js';
import { measureText } from './surfaces.js';

const INK = '#1c2830';

/** Project lon/lat into full-canvas px via the map rect. */
function project(lon, lat, layout) {
  const [mx, my] = lonLatToCanvasXY(lon, lat, layout.bounds, layout.map.w, layout.map.h);
  return [layout.map.x + mx, layout.map.y + my];
}

export function drawFrame(s, layout) {
  const lw = 0.25 * layout.pxPerMm;
  s.rect(layout.map.x, layout.map.y, layout.map.w, layout.map.h, { stroke: INK, width: lw });
}

/** Edge ticks + coordinate labels for the graticule (labels outside the frame). */
export function drawGraticuleLabels(s, layout) {
  const { bounds, map } = layout;
  const spanLon = bounds.east - bounds.west;
  const spanLat = bounds.north - bounds.south;
  const interval = graticuleInterval(Math.max(spanLon, spanLat));
  const fc = graticuleLines(bounds, interval);
  const tick = 1.1 * layout.pxPerMm;
  const lw = 0.2 * layout.pxPerMm;
  const gap = 0.7 * layout.pxPerMm;

  for (const f of fc.features) {
    const { kind, value } = f.properties;
    if (kind === 'meridian') {
      const [x] = project(value, (bounds.south + bounds.north) / 2, layout);
      if (x < map.x - 1 || x > map.x + map.w + 1) continue;
      s.line(x, map.y + map.h, x, map.y + map.h + tick, { stroke: INK, width: lw });
      s.text(formatDegree(value, 'lon'), x, map.y + map.h + tick + gap, {
        sizePx: layout.fontPx, fill: INK, align: 'center', baseline: 'top',
      });
      s.line(x, map.y, x, map.y - tick, { stroke: INK, width: lw });
    } else {
      const [, y] = project((bounds.west + bounds.east) / 2, value, layout);
      if (y < map.y - 1 || y > map.y + map.h + 1) continue;
      s.line(map.x, y, map.x - tick, y, { stroke: INK, width: lw });
      s.text(formatDegree(value, 'lat'), map.x - tick - gap, y, {
        sizePx: layout.fontPx, fill: INK, align: 'right', baseline: 'middle',
      });
      s.line(map.x + map.w, y, map.x + map.w + tick, y, { stroke: INK, width: lw });
    }
  }
  return interval;
}

/** Publication-style alternating scale bar, bottom-left inside the map. */
export function drawScaleBar(s, layout) {
  const { map } = layout;
  const bar = niceScaleBar(layout.metersPerPx, map.w * 0.33);
  const segments = 4;
  const segPx = bar.px / segments;
  const h = 1.2 * layout.pxPerMm;
  const x0 = map.x + 3.5 * layout.pxPerMm;
  const y0 = map.y + map.h - 4.2 * layout.pxPerMm;
  const lw = 0.2 * layout.pxPerMm;

  const pad = 1 * layout.pxPerMm;
  s.rect(x0 - pad, y0 - layout.fontPx - pad * 1.6, bar.px + pad * 2, h + layout.fontPx + pad * 2.4,
    { fill: 'rgba(255,255,255,0.78)' });
  for (let i = 0; i < segments; i++) {
    s.rect(x0 + i * segPx, y0, segPx, h, {
      fill: i % 2 === 0 ? INK : '#ffffff', stroke: INK, width: lw,
    });
  }
  s.text('0', x0, y0 - 0.8 * layout.pxPerMm, { sizePx: layout.fontPx, fill: INK, align: 'center' });
  s.text(bar.label, x0 + bar.px, y0 - 0.8 * layout.pxPerMm, { sizePx: layout.fontPx, fill: INK, align: 'center' });
  return bar;
}

export function drawNorthArrow(s, layout) {
  const { map } = layout;
  const w = 3.2 * layout.pxPerMm;
  const h = 4.6 * layout.pxPerMm;
  const cx = map.x + map.w - 5 * layout.pxPerMm;
  const cy = map.y + 5.5 * layout.pxPerMm;
  s.polygon(
    [[cx, cy - h / 2], [cx + w / 2, cy + h / 2], [cx, cy + h / 4], [cx - w / 2, cy + h / 2]],
    { fill: INK, stroke: '#ffffff', width: 0.15 * layout.pxPerMm },
  );
  s.text('N', cx, cy - h / 2 - 0.6 * layout.pxPerMm, {
    sizePx: layout.fontPx, fill: INK, align: 'center', baseline: 'bottom', halo: '#ffffff', weight: 'bold',
  });
}

/**
 * Vertical colorbar to the right of the map. Top = 0 m (surface),
 * bottom = depthMin. Returns its width in px (for layout bookkeeping).
 */
export function drawColorbar(s, layout, { colormap, reverse, depthMin }) {
  const { map } = layout;
  const barW = 3 * layout.pxPerMm;
  const barX = map.x + map.w + 2.2 * layout.pxPerMm;
  const barY = map.y + 0.1 * map.h;
  const barH = map.h * 0.8;
  const lw = 0.2 * layout.pxPerMm;

  const stops = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const [r, g, b] = sampleColormap(colormap, t, { reverse });
    stops.push([t, `rgb(${r},${g},${b})`]);
  }
  s.gradientRect(barX, barY, barW, barH, stops, { vertical: true });
  s.rect(barX, barY, barW, barH, { stroke: INK, width: lw });

  const ticks = colorbarTicks(depthMin, 0, 6);
  for (const v of ticks) {
    // elevation v (≤0): top of bar = 0 m → t = -v / -depthMin
    const t = (0 - v) / (0 - depthMin);
    const y = barY + t * barH;
    s.line(barX + barW, y, barX + barW + 0.9 * layout.pxPerMm, y, { stroke: INK, width: lw });
    s.text(formatDepth(v), barX + barW + 1.5 * layout.pxPerMm, y, {
      sizePx: layout.fontPx, fill: INK, align: 'left', baseline: 'middle',
    });
  }
  s.text('Depth', barX + barW / 2, barY - 1.6 * layout.pxPerMm, {
    sizePx: layout.fontPx, fill: INK, align: 'center', baseline: 'bottom',
  });
  return barW;
}

/** Station symbols + optional labels. colorFor(value) -> css colour. */
export function drawStations(s, layout, stations, { symbolMm, colorFor, labels }) {
  const { bounds } = layout;
  const r = (symbolMm / 2) * layout.pxPerMm;
  for (const st of stations) {
    if (st.lon < bounds.west || st.lon > bounds.east || st.lat < bounds.south || st.lat > bounds.north) continue;
    const [x, y] = project(st.lon, st.lat, layout);
    s.circle(x, y, r, { fill: colorFor(st.value), stroke: INK, width: 0.2 * layout.pxPerMm });
    if (labels && st.name) {
      s.text(st.name, x + r + 0.8 * layout.pxPerMm, y, {
        sizePx: layout.fontPx, fill: INK, align: 'left', baseline: 'middle', halo: 'rgba(255,255,255,0.85)',
      });
    }
  }
}

/**
 * Inset locator: a small equirectangular world window with a red box around
 * the mapped region. landFC = Natural Earth 110m land FeatureCollection.
 */
export function drawInset(s, layout, landFC) {
  const { map, bounds } = layout;
  const w = 22 * layout.pxPerMm;
  const h = w / 2;
  const x0 = map.x + 2.2 * layout.pxPerMm;
  const y0 = map.y + 2.2 * layout.pxPerMm;
  const lw = 0.18 * layout.pxPerMm;

  s.rect(x0, y0, w, h, { fill: '#eef3f6', stroke: INK, width: lw });
  const px = (lon, lat) => [x0 + ((lon + 180) / 360) * w, y0 + ((90 - lat) / 180) * h];

  for (const f of landFC.features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) {
      const ring = poly[0];
      if (!ring || ring.length < 8) continue; // skip tiny islands at this size
      s.polygon(ring.filter((_, i) => i % 2 === 0).map(([lon, lat]) => px(lon, lat)),
        { fill: '#cfc9bd' });
    }
  }
  const [rx1, ry1] = px(bounds.west, bounds.north);
  const [rx2, ry2] = px(bounds.east, bounds.south);
  s.rect(rx1, ry1, Math.max(rx2 - rx1, 1.5), Math.max(ry2 - ry1, 1.5),
    { stroke: '#c62d1f', width: Math.max(0.35 * layout.pxPerMm, 1) });
  s.rect(x0, y0, w, h, { stroke: INK, width: lw });
}

export function drawTitle(s, layout, title) {
  s.text(title, layout.map.x + layout.map.w / 2, layout.map.y - 2 * layout.pxPerMm, {
    sizePx: layout.titleFontPx, fill: INK, align: 'center', baseline: 'bottom', weight: 'bold',
  });
}

/** Attribution/citation line under the figure — always drawn. */
export function drawAttribution(s, layout, line) {
  let text = line;
  const maxW = layout.W - 2 * layout.pxPerMm;
  while (measureText(text, layout.smallFontPx) > maxW && text.length > 10) {
    text = `${text.slice(0, -2).trimEnd()}…`;
  }
  s.text(text, layout.W / 2, layout.H - 1.2 * layout.pxPerMm, {
    sizePx: layout.smallFontPx, fill: '#51636f', align: 'center', baseline: 'bottom',
  });
}
