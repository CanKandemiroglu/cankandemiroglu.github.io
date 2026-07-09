/* =========================================================
   Field map — Osman Can Kandemiroglu
   Interactive marine sampling-site map.
   Depends on (loaded via <script> in map.html):
     - Leaflet 1.9.4
     - Leaflet.markercluster 1.5.3
     - Leaflet.fullscreen
     - leaflet-mouseposition
     - Leaflet.Graticule
     - leaflet-minimap
   Modified : 2026-05-15
   ========================================================= */

(function () {
  "use strict";

  // -------------------------------------------------------
  // Constants
  // -------------------------------------------------------
  const DATA_URL = "data/sites.json";

  const GEBCO_WMS = "https://wms.gebco.net/2024/mapserv?";
  const GEBCO_ATTR =
    '<a href="https://www.gebco.net/" target="_blank" rel="noopener">© GEBCO Compilation Group (2024)</a>';

  const EMODNET_WMS = "https://ows.emodnet-bathymetry.eu/wms";
  const EMODNET_ATTR =
    '<a href="https://emodnet.ec.europa.eu/en/bathymetry" target="_blank" rel="noopener">© EMODnet Bathymetry</a>';

  const ESRI_OCEAN =
    "https://services.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}";
  const ESRI_ATTR =
    'Tiles &copy; Esri — Sources: GEBCO, NOAA, National Geographic, DeLorme, NAVTEQ, and others';

  const OSM_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const OSM_ATTR =
    '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>';

  const CARTO_DARK =
    "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
  const CARTO_ATTR =
    '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

  const SEAMARKS_URL =
    "https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png";
  const SEAMARKS_ATTR =
    '<a href="https://www.openseamap.org/" target="_blank" rel="noopener">© OpenSeaMap</a>';

  const SAMPLE_TYPES = {
    sediment_core: { label: "Sediment core", color: "var(--sample-core)" },
    microbial_mat: { label: "Microbial mat", color: "var(--sample-mat)" },
    water_sample:  { label: "Water sample",  color: "var(--sample-water)" },
    other:         { label: "Other",         color: "var(--sample-other)" },
  };

  const DEPTH_BUCKETS = [
    { max: 50,    color: "var(--depth-1)", label: "≤ 50 m" },
    { max: 200,   color: "var(--depth-2)", label: "50–200 m" },
    { max: 1000,  color: "var(--depth-3)", label: "200–1000 m" },
    { max: 3000,  color: "var(--depth-4)", label: "1000–3000 m" },
    { max: Infinity, color: "var(--depth-5)", label: "> 3000 m" },
  ];

  // -------------------------------------------------------
  // State
  // -------------------------------------------------------
  const state = {
    map: null,
    cluster: null,
    layers: { base: {}, overlay: {} },
    sites: [],
    markers: new Map(),     // id -> { marker, site }
    activeId: null,
    activeFilter: "all",
    search: "",
    visibleIds: new Set(),
    initialBounds: null,
    depthEnabled: true,
    depthFailures: 0,
    config: {},
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  };

  // -------------------------------------------------------
  // Tiny utilities
  // -------------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === "class") node.className = v;
      else if (k === "html") node.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function")
        node.addEventListener(k.slice(2), v);
      else if (k === "data" && typeof v === "object")
        Object.entries(v).forEach(([dk, dv]) => (node.dataset[dk] = dv));
      else if (v !== false && v !== null && v !== undefined)
        node.setAttribute(k, v);
    });
    (Array.isArray(children) ? children : [children]).forEach((c) => {
      if (c == null || c === false) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function debounce(fn, ms) {
    let t;
    return function (...a) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, a), ms);
    };
  }

  function throttle(fn, ms) {
    let last = 0, timer = null, lastArgs;
    return function (...a) {
      const now = Date.now();
      lastArgs = a;
      if (now - last >= ms) {
        last = now;
        fn.apply(this, a);
      } else if (!timer) {
        timer = setTimeout(() => {
          last = Date.now();
          timer = null;
          fn.apply(this, lastArgs);
        }, ms - (now - last));
      }
    };
  }

  function fmtCoord(value, axis) {
    const hemi = axis === "lat"
      ? (value >= 0 ? "N" : "S")
      : (value >= 0 ? "E" : "W");
    return `${Math.abs(value).toFixed(4)}°${hemi}`;
  }

  function fmtCoordDMM(value, axis) {
    const hemi = axis === "lat"
      ? (value >= 0 ? "N" : "S")
      : (value >= 0 ? "E" : "W");
    const abs = Math.abs(value);
    const deg = Math.floor(abs);
    const min = ((abs - deg) * 60).toFixed(2);
    return `${deg}°${min}'${hemi}`;
  }

  function depthBucket(d) {
    if (d == null || isNaN(d)) return DEPTH_BUCKETS[0];
    return DEPTH_BUCKETS.find((b) => d <= b.max) || DEPTH_BUCKETS[0];
  }

  function safeText(s) {
    if (s == null) return "—";
    const t = String(s).trim();
    return t.length ? t : "—";
  }

  function announce(msg) {
    const live = $("#map-live");
    if (live) {
      live.textContent = "";
      requestAnimationFrame(() => (live.textContent = msg));
    }
  }

  // -------------------------------------------------------
  // Marker SVG (inline so fill follows currentColor)
  // -------------------------------------------------------
  function svgShape(type) {
    // Sediment core: filled circle with inner core line
    if (type === "sediment_core") {
      return `
        <svg viewBox="0 0 30 30" aria-hidden="true">
          <circle class="site-marker__shape" cx="15" cy="15" r="9"/>
          <circle cx="15" cy="15" r="3.5" fill="rgba(255,255,255,0.55)"/>
        </svg>`;
    }
    // Microbial mat: rounded square with horizontal lamination lines
    if (type === "microbial_mat") {
      return `
        <svg viewBox="0 0 30 30" aria-hidden="true">
          <rect class="site-marker__shape" x="6" y="6" width="18" height="18" rx="4"/>
          <line x1="9.5" y1="12" x2="20.5" y2="12" stroke="rgba(255,255,255,0.55)" stroke-width="1.4" stroke-linecap="round"/>
          <line x1="9.5" y1="15.5" x2="20.5" y2="15.5" stroke="rgba(255,255,255,0.55)" stroke-width="1.4" stroke-linecap="round"/>
          <line x1="9.5" y1="19" x2="20.5" y2="19" stroke="rgba(255,255,255,0.55)" stroke-width="1.4" stroke-linecap="round"/>
        </svg>`;
    }
    // Water sample: teardrop
    if (type === "water_sample") {
      return `
        <svg viewBox="0 0 30 30" aria-hidden="true">
          <path class="site-marker__shape" d="M15 5 C 9 13, 9 17, 9 20 a 6 6 0 0 0 12 0 c 0 -3, 0 -7, -6 -15 z"/>
        </svg>`;
    }
    return `
      <svg viewBox="0 0 30 30" aria-hidden="true">
        <circle class="site-marker__shape" cx="15" cy="15" r="8"/>
      </svg>`;
  }

  function buildIcon(site) {
    const html = `
      <div class="site-marker__inner">
        ${svgShape(site.sampleType)}
        <span class="site-marker__ring"></span>
      </div>`;
    return L.divIcon({
      html,
      className: `site-marker`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });
  }

  // -------------------------------------------------------
  // Data load and validation
  // -------------------------------------------------------
  function validateSites(raw) {
    const seen = new Set();
    const out = [];
    raw.forEach((s, i) => {
      if (typeof s.lat !== "number" || typeof s.lon !== "number") {
        console.warn("Field map: skipping site with bad coords", s);
        return;
      }
      if (s.lat < -90 || s.lat > 90 || s.lon < -180 || s.lon > 180) {
        console.warn("Field map: out-of-range coords", s);
        return;
      }
      let id = s.id || `S${String(i + 1).padStart(2, "0")}`;
      while (seen.has(id)) {
        console.warn(`Field map: duplicate id ${id} → appending _dup`);
        id = `${id}_dup`;
      }
      seen.add(id);
      const type = SAMPLE_TYPES[s.sampleType] ? s.sampleType : "other";
      out.push({ ...s, id, sampleType: type });
    });
    return out;
  }

  async function loadData() {
    const r = await fetch(DATA_URL, { cache: "no-cache" });
    if (!r.ok) throw new Error(`Failed to load sites.json (${r.status})`);
    const data = await r.json();
    state.config = data.mapConfig || {};
    state.sites = validateSites(data.sites || []);
  }

  // -------------------------------------------------------
  // Map init
  // -------------------------------------------------------
  function buildBaseLayers() {
    const gebco = L.tileLayer.wms(GEBCO_WMS, {
      layers: "GEBCO_LATEST",
      format: "image/png",
      transparent: false,
      version: "1.1.1",
      attribution: GEBCO_ATTR,
      maxZoom: 8,
      noWrap: false,
    });

    const esri = L.tileLayer(ESRI_OCEAN, {
      attribution: ESRI_ATTR,
      maxZoom: 13,
    });

    const osm = L.tileLayer(OSM_URL, {
      attribution: OSM_ATTR,
      maxZoom: 19,
    });

    const dark = L.tileLayer(CARTO_DARK, {
      attribution: CARTO_ATTR,
      maxZoom: 19,
      subdomains: "abcd",
    });

    return {
      "GEBCO bathymetry": gebco,
      "Esri Ocean": esri,
      "OpenStreetMap": osm,
      "Carto · Dark": dark,
    };
  }

  function buildOverlayLayers() {
    const emodnet = L.tileLayer.wms(EMODNET_WMS, {
      layers: "emodnet:mean_atlas_land",
      format: "image/png",
      transparent: true,
      opacity: 0.85,
      version: "1.3.0",
      attribution: EMODNET_ATTR,
    });

    const seamarks = L.tileLayer(SEAMARKS_URL, {
      attribution: SEAMARKS_ATTR,
      maxZoom: 18,
      opacity: 0.9,
    });

    const graticule = L.latlngGraticule
      ? L.latlngGraticule({
          showLabel: true,
          opacity: 0.35,
          color: "#888",
          fontColor: "#666",
          zoomInterval: [
            { start: 2, end: 4, interval: 10 },
            { start: 5, end: 7, interval: 5 },
            { start: 8, end: 12, interval: 1 },
          ],
        })
      : null;

    return {
      "EMODnet · high-res (EU)": emodnet,
      "Seamarks (OpenSeaMap)": seamarks,
      ...(graticule ? { "Graticule": graticule } : {}),
    };
  }

  function initMap() {
    const mapEl = $("#map");
    state.map = L.map(mapEl, {
      center: [40, 10],
      zoom: 2,
      worldCopyJump: true,
      zoomControl: true,
      attributionControl: true,
      fullscreenControl: true,
      fullscreenControlOptions: { position: "topleft" },
      preferCanvas: false,
      tap: true,
      scrollWheelZoom: true,
    });

    // Make the keyboard map container accessible
    mapEl.setAttribute("role", "application");
    mapEl.setAttribute(
      "aria-label",
      "Map of marine sampling sites. Use Tab to navigate markers, Enter to open details."
    );

    // Base & overlay layers
    state.layers.base = buildBaseLayers();
    state.layers.overlay = buildOverlayLayers();

    const defaultBase = state.config.defaultBasemap === "osm"
      ? "OpenStreetMap"
      : state.config.defaultBasemap === "satellite" || state.config.defaultBasemap === "esri"
      ? "Esri Ocean"
      : state.config.defaultBasemap === "dark"
      ? "Carto · Dark"
      : "GEBCO bathymetry";

    state.layers.base[defaultBase].addTo(state.map);

    if (state.config.showBathymetryOverlay) {
      state.layers.overlay["EMODnet · high-res (EU)"].addTo(state.map);
    }
    if (state.config.showSeamarks) {
      state.layers.overlay["Seamarks (OpenSeaMap)"].addTo(state.map);
    }
    if (state.config.showGraticule && state.layers.overlay["Graticule"]) {
      state.layers.overlay["Graticule"].addTo(state.map);
    }

    L.control
      .layers(state.layers.base, state.layers.overlay, {
        collapsed: true,
        position: "topright",
      })
      .addTo(state.map);

    L.control.scale({ metric: true, imperial: false, position: "bottomleft" }).addTo(state.map);

    if (L.control.mousePosition) {
      L.control.mousePosition({
        position: "bottomleft",
        emptyString: "—",
        separator: "  ·  ",
        lngFirst: false,
        numDigits: 4,
        prefix: "",
        latFormatter: (l) => fmtCoord(l, "lat"),
        lngFormatter: (l) => fmtCoord(l, "lon"),
      }).addTo(state.map);
    }

    if (L.Control.MiniMap && state.config.showMiniMap !== false) {
      const miniLayer = L.tileLayer(ESRI_OCEAN, { maxZoom: 6 });
      new L.Control.MiniMap(miniLayer, {
        toggleDisplay: true,
        minimized: false,
        position: "bottomright",
        width: 160,
        height: 110,
      }).addTo(state.map);
    }
  }

  // -------------------------------------------------------
  // Markers
  // -------------------------------------------------------
  function createMarkerForSite(site) {
    const icon = buildIcon(site);
    const marker = L.marker([site.lat, site.lon], {
      icon,
      title: `${site.id}: ${site.name}`,
      alt: `${site.name}, ${SAMPLE_TYPES[site.sampleType].label}, ${fmtCoord(site.lat, "lat")}, ${fmtCoord(site.lon, "lon")}, depth ${site.waterDepth_m} m`,
      riseOnHover: true,
      keyboard: true,
    });

    // Decorate icon element with data attributes for CSS styling
    marker.on("add", () => {
      const elNode = marker.getElement();
      if (!elNode) return;
      elNode.classList.add("site-marker");
      elNode.dataset.type = site.sampleType;
      elNode.dataset.id = site.id;
    });

    marker.bindTooltip(
      `<span class="site-tooltip__id">${site.id}</span>${site.shortName || site.name}`,
      { direction: "top", offset: [0, -14], className: "site-tooltip" }
    );

    marker.on("click", () => openPanel(site.id));
    marker.on("keydown", (ev) => {
      if (ev.originalEvent.key === "Enter" || ev.originalEvent.key === " ") {
        ev.originalEvent.preventDefault();
        openPanel(site.id);
      }
    });

    return marker;
  }

  function addAllMarkers() {
    const useCluster = state.sites.length > 20;
    if (useCluster) {
      state.cluster = L.markerClusterGroup({
        chunkedLoading: true,
        maxClusterRadius: 50,
        disableClusteringAtZoom: 6,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
      });
      state.map.addLayer(state.cluster);
    }

    const latlngs = [];
    state.sites.forEach((site) => {
      const marker = createMarkerForSite(site);
      state.markers.set(site.id, { marker, site });
      state.visibleIds.add(site.id);
      latlngs.push([site.lat, site.lon]);
      (state.cluster || state.map).addLayer(marker);
    });

    if (latlngs.length) {
      const bounds = L.latLngBounds(latlngs);
      const pad = state.config.padding || 0.18;
      state.initialBounds = bounds.pad(pad);
      // Cinematic intro
      const fly = () => state.map.flyToBounds(state.initialBounds, {
        duration: state.reducedMotion ? 0 : 1.6,
        easeLinearity: 0.25,
      });
      // wait one paint so tiles begin to load on the wide view first
      setTimeout(fly, state.reducedMotion ? 0 : 480);
    }

    updateCount();
  }

  // -------------------------------------------------------
  // Side panel
  // -------------------------------------------------------
  function openPanel(siteId, opts = {}) {
    const entry = state.markers.get(siteId);
    if (!entry) return;
    const { marker, site } = entry;

    state.activeId = siteId;
    state.markers.forEach(({ marker: m }, id) => {
      const node = m.getElement();
      if (node) node.dataset.active = id === siteId ? "true" : "false";
    });

    const panel = $("#map-panel");
    panel.dataset.open = "true";
    panel.setAttribute("aria-hidden", "false");

    renderPanel(site);

    if (opts.fly !== false) {
      state.map.flyTo([site.lat, site.lon], Math.max(state.map.getZoom(), 7), {
        duration: state.reducedMotion ? 0 : 0.9,
      });
    }
    if (state.cluster) {
      state.cluster.zoomToShowLayer(marker, () => marker.openTooltip());
    } else {
      marker.openTooltip();
    }

    // Update permalink (replace, don't push history)
    if (window.history && window.history.replaceState) {
      window.history.replaceState({}, "", `#id=${encodeURIComponent(siteId)}`);
    }

    // Move focus inside the panel for keyboard users
    setTimeout(() => $("#panel-close")?.focus(), 380);

    announce(`Opened details for ${site.name}.`);
  }

  function closePanel() {
    const panel = $("#map-panel");
    if (!panel) return;
    panel.dataset.open = "false";
    panel.setAttribute("aria-hidden", "true");

    if (state.activeId) {
      const node = state.markers.get(state.activeId)?.marker.getElement();
      if (node) node.dataset.active = "false";
      // Return focus to triggering marker
      node?.focus();
    }
    state.activeId = null;
    if (window.history && window.history.replaceState) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }

  function renderPanel(site) {
    const body = $("#panel-body");
    body.innerHTML = "";

    const typeInfo = SAMPLE_TYPES[site.sampleType];

    // Head
    const head = $("#panel-head-text");
    head.innerHTML = `
      <p class="map-panel__eyebrow">
        <span class="swatch" style="background:${typeInfo.color}"></span>
        ${site.id} · ${typeInfo.label}
      </p>
      <h2 class="map-panel__title" id="panel-title">${escapeHTML(site.name)}</h2>
      ${site.isPlaceholder ? `
        <span class="map-panel__placeholder" title="These coordinates are approximate. Replace with exact field-recorded values before publication.">
          Approximate location · replace with field GPS
        </span>` : ""}
    `;

    // Photo
    const photoWrap = el("figure", { class: "map-panel__photo" });
    if (site.photo && site.photo.trim().length) {
      const img = el("img", {
        src: site.photo,
        alt: site.photoCaption || `Sample from ${site.name}`,
        loading: "lazy",
      });
      img.addEventListener("click", () => openLightbox(site.photo, site.photoCaption));
      photoWrap.appendChild(img);
    } else {
      photoWrap.appendChild(
        el("div", { class: "map-panel__photo-placeholder" }, [
          "Sample photo coming soon — drop a JPEG into assets/samples/ and reference it in data/sites.json.",
        ])
      );
    }
    body.appendChild(photoWrap);

    if (site.photo && site.photoCaption) {
      body.appendChild(el("p", { class: "map-panel__photo-caption" }, site.photoCaption));
    }

    // Summary
    if (site.summary) {
      body.appendChild(el("p", { class: "map-panel__summary" }, site.summary));
    }

    // Meta
    const meta = el("dl", { class: "map-panel__meta" });
    const rows = [
      ["Coordinates", coordWithCopy(site)],
      ["Water depth", site.waterDepth_m != null ? `${site.waterDepth_m} m` : "—"],
      site.coreLength_m != null ? ["Core length", `${site.coreLength_m} m`] : null,
      ["Collected", safeText(site.dateCollected)],
      ["Gear", safeText(site.gear)],
      ["Expedition", safeText(site.expedition)],
      ["Region", safeText(site.region)],
    ].filter(Boolean);

    rows.forEach(([label, value]) => {
      meta.appendChild(el("dt", {}, label));
      const dd = el("dd");
      if (typeof value === "string") dd.textContent = value;
      else dd.appendChild(value);
      meta.appendChild(dd);
    });
    body.appendChild(meta);

    // Tags
    if (Array.isArray(site.tags) && site.tags.length) {
      const tags = el("div", { class: "map-panel__tags" });
      site.tags.forEach((t) => tags.appendChild(el("span", { class: "map-panel__tag" }, t)));
      body.appendChild(tags);
    }

    // Actions
    const actions = el("div", { class: "map-panel__actions" });
    if (site.projectPage) {
      actions.appendChild(
        el(
          "a",
          {
            class: "map-panel__btn map-panel__btn--primary",
            href: site.projectPage,
            "aria-label": `Open the ${site.name} project page`,
          },
          [
            iconSVG(
              "M5 12h14M13 5l7 7-7 7",
              "1.6"
            ),
            "View project →",
          ]
        )
      );
    }
    actions.appendChild(
      el(
        "button",
        {
          type: "button",
          class: "map-panel__btn map-panel__btn--ghost",
          onclick: () => {
            state.map.flyTo([site.lat, site.lon], 10, { duration: state.reducedMotion ? 0 : 1.4 });
          },
        },
        [iconSVG("M3 12l18-9-9 18-2-7-7-2z", "1.6"), "Fly to site"]
      )
    );
    body.appendChild(actions);

    // Publications
    if (Array.isArray(site.publications) && site.publications.length) {
      const pubH = el("h3", {
        class: "map-panel__eyebrow",
        style: "margin-top:18px",
      }, "Publications");
      body.appendChild(pubH);
      const list = el("ul");
      site.publications.forEach((p) => {
        const link = el("a", {
          href: p.doi ? `https://doi.org/${p.doi}` : (p.url || "#"),
          target: "_blank",
          rel: "noopener",
        }, p.label || p.doi || "Publication");
        const li = el("li", { style: "padding:6px 0;font-size:14px" });
        li.appendChild(link);
        list.appendChild(li);
      });
      body.appendChild(list);
    }
  }

  function coordWithCopy(site) {
    const wrap = el("span");
    const span = el("span", {}, `${fmtCoord(site.lat, "lat")}, ${fmtCoord(site.lon, "lon")}`);
    wrap.appendChild(span);
    const btn = el("button", {
      type: "button",
      class: "copy-btn",
      "aria-label": "Copy coordinates to clipboard",
    }, "Copy");
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(`${site.lat}, ${site.lon}`);
        btn.dataset.ok = "true";
        btn.textContent = "Copied";
        setTimeout(() => {
          btn.dataset.ok = "false";
          btn.textContent = "Copy";
        }, 1400);
      } catch (e) {
        console.warn("Clipboard write failed", e);
      }
    });
    wrap.appendChild(btn);
    const dmm = el("div", {
      style: "font-size:11px;color:var(--ink-mute);font-weight:400;margin-top:2px",
    }, `${fmtCoordDMM(site.lat, "lat")} ${fmtCoordDMM(site.lon, "lon")}`);
    wrap.appendChild(dmm);
    return wrap;
  }

  function iconSVG(d, sw = "1.5") {
    const span = el("span", { "aria-hidden": "true" });
    span.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">
        <path d="${d}"/>
      </svg>`;
    return span;
  }

  function escapeHTML(s) {
    return String(s || "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  // -------------------------------------------------------
  // Lightbox
  // -------------------------------------------------------
  function openLightbox(src, caption) {
    const lb = $("#lightbox");
    $("#lightbox-img").src = src;
    $("#lightbox-img").alt = caption || "";
    $("#lightbox-caption").textContent = caption || "";
    lb.dataset.open = "true";
    lb.removeAttribute("aria-hidden");
    $("#lightbox-close").focus();
  }
  function closeLightbox() {
    const lb = $("#lightbox");
    lb.dataset.open = "false";
    lb.setAttribute("aria-hidden", "true");
    $("#lightbox-img").src = "";
  }

  // -------------------------------------------------------
  // Search & filter
  // -------------------------------------------------------
  function applyFilters() {
    const q = state.search.trim().toLowerCase();
    const filter = state.activeFilter;
    state.visibleIds.clear();

    state.markers.forEach(({ marker, site }, id) => {
      const matchesText = !q ||
        site.id.toLowerCase().includes(q) ||
        site.name.toLowerCase().includes(q) ||
        (site.shortName || "").toLowerCase().includes(q) ||
        (site.expedition || "").toLowerCase().includes(q) ||
        (site.region || "").toLowerCase().includes(q) ||
        (site.tags || []).some((t) => t.toLowerCase().includes(q));
      const matchesFilter = filter === "all" || site.sampleType === filter;
      const visible = matchesText && matchesFilter;
      if (visible) {
        state.visibleIds.add(id);
        if (!(state.cluster || state.map).hasLayer(marker)) {
          (state.cluster || state.map).addLayer(marker);
        }
      } else if ((state.cluster || state.map).hasLayer(marker)) {
        (state.cluster || state.map).removeLayer(marker);
      }
    });

    updateCount();
  }

  function updateCount() {
    const node = $("#count");
    if (node) {
      node.textContent = `${state.visibleIds.size}/${state.sites.length} sites`;
    }
  }

  // -------------------------------------------------------
  // Export
  // -------------------------------------------------------
  function visibleSites() {
    return state.sites.filter((s) => state.visibleIds.has(s.id));
  }

  function downloadBlob(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportGeoJSON() {
    const features = visibleSites().map((s) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [s.lon, s.lat] },
      properties: { ...s, lat: undefined, lon: undefined },
    }));
    const fc = { type: "FeatureCollection", features };
    downloadBlob("sites.geojson", JSON.stringify(fc, null, 2), "application/geo+json");
  }

  function exportCSV() {
    const cols = [
      "id","name","shortName","lat","lon","sampleType","waterDepth_m",
      "coreLength_m","dateCollected","gear","expedition","campaign","region",
      "summary","tags","projectPage",
    ];
    const rows = [cols.join(",")];
    visibleSites().forEach((s) => {
      const row = cols.map((c) => {
        let v = s[c];
        if (Array.isArray(v)) v = v.join("; ");
        if (v == null) v = "";
        v = String(v).replace(/"/g, '""');
        return `"${v}"`;
      });
      rows.push(row.join(","));
    });
    downloadBlob("sites.csv", rows.join("\n"), "text/csv");
  }

  // -------------------------------------------------------
  // Live GEBCO depth-at-cursor (GetFeatureInfo)
  // -------------------------------------------------------
  const fetchDepthAt = throttle(async (latlng) => {
    if (!state.depthEnabled) return;
    const m = state.map;
    const point = m.latLngToContainerPoint(latlng);
    const sizeX = m.getSize().x, sizeY = m.getSize().y;
    const b = m.getBounds();
    const params = new URLSearchParams({
      SERVICE: "WMS",
      VERSION: "1.1.1",
      REQUEST: "GetFeatureInfo",
      LAYERS: "GEBCO_LATEST",
      QUERY_LAYERS: "GEBCO_LATEST",
      INFO_FORMAT: "text/plain",
      SRS: "EPSG:4326",
      WIDTH: sizeX,
      HEIGHT: sizeY,
      BBOX: `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`,
      X: Math.round(point.x),
      Y: Math.round(point.y),
      FORMAT: "image/png",
    });
    try {
      const r = await fetch(`${GEBCO_WMS}${params.toString()}`);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const txt = await r.text();
      const match = txt.match(/-?\d+\.?\d*/);
      if (!match) return;
      const v = parseFloat(match[0]);
      if (isNaN(v) || v === -9999) return;
      const dEl = $("#depth-readout");
      if (dEl) {
        const label = v < 0
          ? `<strong>${Math.round(-v).toLocaleString()} m</strong> below sea level`
          : `<strong>${Math.round(v).toLocaleString()} m</strong> above sea level`;
        dEl.innerHTML = `Elev: ${label}`;
      }
      state.depthFailures = 0;
    } catch (e) {
      state.depthFailures++;
      if (state.depthFailures > 3) {
        state.depthEnabled = false;
        const dEl = $("#depth-readout");
        if (dEl) dEl.style.display = "none";
        console.info("Depth lookup disabled after repeated failures.");
      }
    }
  }, 350);

  // -------------------------------------------------------
  // Permalink
  // -------------------------------------------------------
  function consumePermalink() {
    const hash = window.location.hash;
    const match = hash.match(/^#id=([^&]+)/);
    if (!match) return;
    const id = decodeURIComponent(match[1]);
    setTimeout(() => {
      if (state.markers.has(id)) openPanel(id);
    }, state.reducedMotion ? 50 : 2200); // wait for intro flyTo
  }

  // -------------------------------------------------------
  // Keyboard & UI wiring
  // -------------------------------------------------------
  function bindUI() {
    // Search
    const searchInput = $("#search");
    if (searchInput) {
      searchInput.addEventListener(
        "input",
        debounce((e) => {
          state.search = e.target.value;
          applyFilters();
        }, 300)
      );
    }

    // Filter buttons
    $$(".map-filter__btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        $$(".map-filter__btn").forEach((b) => b.setAttribute("aria-pressed", "false"));
        btn.setAttribute("aria-pressed", "true");
        state.activeFilter = btn.dataset.filter;
        applyFilters();
      });
    });

    // Actions menu
    const actionsBtn = $("#actions-toggle");
    const actionsMenu = $("#actions-menu");
    actionsBtn.addEventListener("click", () => {
      const open = actionsMenu.dataset.open === "true";
      actionsMenu.dataset.open = open ? "false" : "true";
      actionsBtn.setAttribute("aria-expanded", open ? "false" : "true");
    });
    document.addEventListener("click", (e) => {
      if (!actionsBtn.contains(e.target) && !actionsMenu.contains(e.target)) {
        actionsMenu.dataset.open = "false";
        actionsBtn.setAttribute("aria-expanded", "false");
      }
    });
    $("#export-geojson").addEventListener("click", () => {
      exportGeoJSON();
      actionsMenu.dataset.open = "false";
    });
    $("#export-csv").addEventListener("click", () => {
      exportCSV();
      actionsMenu.dataset.open = "false";
    });
    $("#reset-view").addEventListener("click", () => {
      if (state.initialBounds) {
        state.map.flyToBounds(state.initialBounds, {
          duration: state.reducedMotion ? 0 : 1.2,
        });
      }
      actionsMenu.dataset.open = "false";
    });

    // Panel close
    $("#panel-close").addEventListener("click", closePanel);

    // Lightbox close
    $("#lightbox-close").addEventListener("click", closeLightbox);
    $("#lightbox").addEventListener("click", (e) => {
      if (e.target === $("#lightbox")) closeLightbox();
    });

    // Help
    const helpBtn = $("#help-toggle");
    const help = $("#map-help");
    helpBtn.addEventListener("click", () => {
      help.dataset.open = help.dataset.open === "true" ? "false" : "true";
    });
    help.addEventListener("click", (e) => {
      if (e.target === help) help.dataset.open = "false";
    });

    // Keyboard
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if ($("#lightbox").dataset.open === "true") closeLightbox();
        else if ($("#map-help").dataset.open === "true") help.dataset.open = "false";
        else if ($("#map-panel").dataset.open === "true") closePanel();
      } else if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        if (!isTypingInField()) {
          e.preventDefault();
          help.dataset.open = help.dataset.open === "true" ? "false" : "true";
        }
      } else if (e.key === "h" || e.key === "H") {
        if (!isTypingInField() && state.initialBounds) {
          state.map.flyToBounds(state.initialBounds, { duration: 0.8 });
        }
      } else if (e.key === "/" && !isTypingInField()) {
        e.preventDefault();
        searchInput?.focus();
      }
    });

    // Map cursor depth
    state.map.on("mousemove", (e) => fetchDepthAt(e.latlng));
    state.map.on("mouseout", () => {
      const dEl = $("#depth-readout");
      if (dEl && state.depthEnabled) dEl.textContent = "";
    });
  }

  function isTypingInField() {
    const t = document.activeElement;
    if (!t) return false;
    return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
  }

  // -------------------------------------------------------
  // Init
  // -------------------------------------------------------
  async function init() {
    try {
      await loadData();
      initMap();
      addAllMarkers();
      bindUI();
      consumePermalink();
      $("#map-loading").hidden = true;
      announce(`Map loaded. ${state.sites.length} sampling sites.`);
    } catch (err) {
      console.error("Field map failed to initialise:", err);
      $("#map-loading").innerHTML =
        '<div class="map-loading__inner" style="color:#c0392b">Could not load map data. See console for details.</div>';
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
