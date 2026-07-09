/**
 * surfaces.js — a minimal drawing abstraction so the cartographic furniture is
 * drawn exactly once and rendered to either a Canvas 2D context (PNG/PDF
 * exports) or an SVG document (vector export).
 *
 * Coordinates are device pixels at the export dpi. The SVG surface maps those
 * pixels onto a physical mm viewport so text stays true-size in print.
 */

const FONT_FAMILY = 'Helvetica, Arial, sans-serif';

let measureCtx = null;
function getMeasureCtx() {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  return measureCtx;
}

/** Shared text measurement (used by both surfaces so layouts agree). */
export function measureText(str, sizePx, { weight = 'normal' } = {}) {
  const ctx = getMeasureCtx();
  ctx.font = `${weight} ${sizePx}px ${FONT_FAMILY}`;
  return ctx.measureText(str).width;
}

export class CanvasSurface {
  constructor(ctx) { this.ctx = ctx; }

  line(x1, y1, x2, y2, { stroke = '#000', width = 1, dash = null } = {}) {
    const c = this.ctx;
    c.save();
    c.strokeStyle = stroke; c.lineWidth = width;
    if (dash) c.setLineDash(dash);
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
    c.restore();
  }

  polygon(points, { fill = null, stroke = null, width = 1, close = true } = {}) {
    const c = this.ctx;
    c.save();
    c.beginPath();
    points.forEach(([x, y], i) => (i === 0 ? c.moveTo(x, y) : c.lineTo(x, y)));
    if (close) c.closePath();
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = width; c.stroke(); }
    c.restore();
  }

  rect(x, y, w, h, { fill = null, stroke = null, width = 1 } = {}) {
    const c = this.ctx;
    c.save();
    if (fill) { c.fillStyle = fill; c.fillRect(x, y, w, h); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = width; c.strokeRect(x, y, w, h); }
    c.restore();
  }

  circle(cx, cy, r, { fill = null, stroke = null, width = 1 } = {}) {
    const c = this.ctx;
    c.save();
    c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2);
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = width; c.stroke(); }
    c.restore();
  }

  text(str, x, y, { sizePx = 12, fill = '#000', weight = 'normal', align = 'left', baseline = 'alphabetic', rotate = 0, halo = null } = {}) {
    const c = this.ctx;
    c.save();
    c.font = `${weight} ${sizePx}px ${FONT_FAMILY}`;
    c.textAlign = align; c.textBaseline = baseline;
    c.translate(x, y);
    if (rotate) c.rotate((rotate * Math.PI) / 180);
    if (halo) { c.lineJoin = 'round'; c.strokeStyle = halo; c.lineWidth = sizePx / 4; c.strokeText(str, 0, 0); }
    c.fillStyle = fill;
    c.fillText(str, 0, 0);
    c.restore();
  }

  /** Vertical or horizontal multi-stop gradient rectangle (colorbar ramp). */
  gradientRect(x, y, w, h, stops, { vertical = true } = {}) {
    const c = this.ctx;
    const g = vertical ? c.createLinearGradient(0, y, 0, y + h) : c.createLinearGradient(x, 0, x + w, 0);
    for (const [t, color] of stops) g.addColorStop(t, color);
    c.save(); c.fillStyle = g; c.fillRect(x, y, w, h); c.restore();
  }

  image(source, x, y, w, h) { this.ctx.drawImage(source, x, y, w, h); }
}

export class SVGSurface {
  /**
   * @param {number} widthPx  canvas-space width (device px at export dpi)
   * @param {number} heightPx canvas-space height
   * @param {number} pxPerMm  device px per millimetre (dpi / 25.4)
   */
  constructor(widthPx, heightPx, pxPerMm) {
    this.w = widthPx; this.h = heightPx; this.pxPerMm = pxPerMm;
    this.parts = [];
    this.defs = [];
    this._gid = 0;
  }

  line(x1, y1, x2, y2, { stroke = '#000', width = 1, dash = null } = {}) {
    this.parts.push(`<line x1="${r(x1)}" y1="${r(y1)}" x2="${r(x2)}" y2="${r(y2)}" stroke="${stroke}" stroke-width="${r(width)}"${dash ? ` stroke-dasharray="${dash.join(' ')}"` : ''}/>`);
  }

  polygon(points, { fill = null, stroke = null, width = 1, close = true } = {}) {
    const pts = points.map(([x, y]) => `${r(x)},${r(y)}`).join(' ');
    const tag = close ? 'polygon' : 'polyline';
    this.parts.push(`<${tag} points="${pts}" fill="${fill ?? 'none'}"${stroke ? ` stroke="${stroke}" stroke-width="${r(width)}"` : ''}/>`);
  }

  rect(x, y, w, h, { fill = null, stroke = null, width = 1 } = {}) {
    this.parts.push(`<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" fill="${fill ?? 'none'}"${stroke ? ` stroke="${stroke}" stroke-width="${r(width)}"` : ''}/>`);
  }

  circle(cx, cy, rad, { fill = null, stroke = null, width = 1 } = {}) {
    this.parts.push(`<circle cx="${r(cx)}" cy="${r(cy)}" r="${r(rad)}" fill="${fill ?? 'none'}"${stroke ? ` stroke="${stroke}" stroke-width="${r(width)}"` : ''}/>`);
  }

  text(str, x, y, { sizePx = 12, fill = '#000', weight = 'normal', align = 'left', baseline = 'alphabetic', rotate = 0, halo = null } = {}) {
    const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
    const dominant = { top: 'hanging', middle: 'central', alphabetic: 'alphabetic', bottom: 'text-after-edge' }[baseline] || 'alphabetic';
    const transform = rotate ? ` transform="rotate(${rotate} ${r(x)} ${r(y)})"` : '';
    const esc = escapeXML(str);
    const common = `x="${r(x)}" y="${r(y)}" font-family="${FONT_FAMILY}" font-size="${r(sizePx)}" font-weight="${weight}" text-anchor="${anchor}" dominant-baseline="${dominant}"${transform}`;
    if (halo) this.parts.push(`<text ${common} fill="none" stroke="${halo}" stroke-width="${r(sizePx / 4)}" stroke-linejoin="round">${esc}</text>`);
    this.parts.push(`<text ${common} fill="${fill}">${esc}</text>`);
  }

  gradientRect(x, y, w, h, stops, { vertical = true } = {}) {
    const id = `grad${++this._gid}`;
    const coords = vertical ? 'x1="0" y1="0" x2="0" y2="1"' : 'x1="0" y1="0" x2="1" y2="0"';
    this.defs.push(`<linearGradient id="${id}" ${coords}>${stops.map(([t, c]) => `<stop offset="${r(t * 100)}%" stop-color="${c}"/>`).join('')}</linearGradient>`);
    this.parts.push(`<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" fill="url(#${id})"/>`);
  }

  image(source, x, y, w, h) {
    const href = source.toDataURL('image/png');
    this.parts.push(`<image x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" href="${href}" preserveAspectRatio="none"/>`);
  }

  toString() {
    const wMm = this.w / this.pxPerMm;
    const hMm = this.h / this.pxPerMm;
    return `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="${r(wMm)}mm" height="${r(hMm)}mm" viewBox="0 0 ${r(this.w)} ${r(this.h)}">\n` +
      (this.defs.length ? `<defs>${this.defs.join('')}</defs>\n` : '') +
      this.parts.join('\n') +
      `\n</svg>\n`;
  }
}

function r(n) { return Math.round(n * 100) / 100; }

function escapeXML(s) {
  return String(s).replace(/[<>&"']/g, (ch) => (
    { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[ch]
  ));
}
