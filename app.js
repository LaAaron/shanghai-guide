(function(){
  const { CATEGORIES, SEED_PLACES, METRO_STATIONS, MAP_TILES, SH_DISTRICTS, ROAD_NAMES, ROAD_POLYS, AREAS } = window.SG;
  const ADDED_PLACES = window.SG.ADDED_PLACES || [];      // spots added through the app and approved (data/added.js)
  const SHARED_PHOTOS = window.SG.PHOTOS || {};             // photos shared with everyone (data/photos.js, files in photos/)
  const SHARE_REPO = 'LaAaron/shanghai-guide';
  let userPlaces = [];
  let activeCat = "all";
  let activeDistrict = "all";
  let searchTerm = "";
  let selectedId = null;
  let markers = {};
  let map;

  /* ---------- helpers ---------- */
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const mqMobile = window.matchMedia('(max-width: 860px)');
  const isMobile = () => mqMobile.matches;
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  const ICONS = {
    breakfast: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
    dumplings: '<path d="M3 17c0-5.5 4-9.5 9-9.5s9 4 9 9.5z"/><path d="M8 8l1 2.2M12 7.5v2.4M16 8l-1 2.2"/>',
    noodles:   '<path d="M3.5 11h17a8.5 8.5 0 0 1-17 0z"/><path d="M8 3.5l2.2 5.5M13 3.5l2.2 5.5"/>',
    dessert:   '<path d="M7.5 12.5l4.5 9 4.5-9"/><path d="M7 12.5a5 5 0 1 1 10 0z"/>',
    drinks:    '<path d="M6.5 8h11l-1.4 12.5H7.9z"/><path d="M13 8l1.8-4.5 2.2-.5"/>',
    skewers:   '<path d="M4 20L20 4"/><circle cx="9" cy="15" r="2"/><circle cx="12.5" cy="11.5" r="2"/><circle cx="16" cy="8" r="2"/>',
    shopping:  '<path d="M5.5 8h13l1 12.5h-15z"/><path d="M9 8a3 3 0 0 1 6 0"/>',
    sights:    '<path d="M3.5 9.5L12 4l8.5 5.5z"/><path d="M6 12v6M10 12v6M14 12v6M18 12v6M3.5 20.5h17"/>',
    stay:      '<path d="M3.5 18.5V6.5"/><path d="M3.5 14h17v4.5"/><path d="M20.5 14v-2a3 3 0 0 0-3-3h-6.5v5"/><circle cx="7.2" cy="10.6" r="1.7"/>',
    other:     '<path d="M12 3.5l2.5 5.3 5.8.8-4.2 4.1 1 5.8L12 16.7l-5.1 2.8 1-5.8-4.2-4.1 5.8-.8z"/>'
  };
  const svgIcon = name => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';
  const WARN_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2.2l6.2 11H1.8z"/><path d="M8 6.5v3.2M8 11.6v.1"/></svg>';
  const NAV_SVG = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 4L4 10.5l6.5 2.5 2.5 6.5z"/></svg>';
  const CHEVRON_SVG = '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3.5l3 3 3-3"/></svg>';

  const listPane = $('list-pane');
  const catChipRow = $('category-chips');
  const searchInput = $('search');
  const visibleCount = $('visible-count');
  const header = $('hdr');
  const tabbar = $('tabbar');
  const appEl = $('app');
  let pendingView = null;
  let updateLabelsFn = () => {};
  let hdrH = 132, tabH = 0;

  function syncChrome(){
    hdrH = header.offsetHeight;
    tabH = tabbar.offsetHeight;
    const s = document.documentElement.style;
    s.setProperty('--hdr-h', hdrH + 'px');
    s.setProperty('--tab-h', tabH + 'px');
  }

  const sharedIds = new Set(ADDED_PLACES.map(p => p.id));
  // built-in spots + spots shared by anyone in the group + spots saved only on this phone (until they arrive as shared)
  function allPlaces(){ return SEED_PLACES.concat(ADDED_PLACES, userPlaces.filter(p => !sharedIds.has(p.id))); }
  function districts(){ return Array.from(new Set(allPlaces().map(p => p.district))).sort(); }
  function findPlace(id){ return allPlaces().find(x => x.id === id); }

  function matchesSearch(p){
    if (!searchTerm) return true;
    return (p.name + " " + (p.zh||"") + " " + p.addr + " " + (p.note||"")).toLowerCase().includes(searchTerm);
  }
  function matchesFilters(p){
    if (activeCat !== "all" && p.cat !== activeCat) return false;
    if (activeDistrict !== "all" && p.district !== activeDistrict) return false;
    return matchesSearch(p);
  }
  // How many spots each category chip / district option would show right now, given the OTHER filter and the search.
  function chipCounts(){
    const byCat = {}, byDist = {};
    allPlaces().forEach(p => {
      if (!matchesSearch(p)) return;
      if (activeDistrict === "all" || p.district === activeDistrict) byCat[p.cat] = (byCat[p.cat] || 0) + 1;
      if (activeCat === "all" || p.cat === activeCat) byDist[p.district] = (byDist[p.district] || 0) + 1;
    });
    return { byCat, byDist };
  }

  /* ---------- Filter chips (built once; only state toggles after) ---------- */
  let chipSig = null;
  function buildChips(){
    const ds = districts();
    const sig = ds.join('|');
    if (sig !== chipSig){
      chipSig = sig;
      catChipRow.innerHTML = '';

      const wrap = document.createElement('label');
      wrap.className = 'chip chip-select';
      wrap.id = 'district-chip';
      wrap.innerHTML = '<span class="chip-label"></span>' + CHEVRON_SVG;
      const sel = document.createElement('select');
      sel.id = 'district-select';
      sel.setAttribute('aria-label', 'Filter by district');
      const o0 = document.createElement('option'); o0.value = 'all'; o0.textContent = 'All districts'; sel.appendChild(o0);
      ds.forEach(d => { const o = document.createElement('option'); o.value = d; o.textContent = d; sel.appendChild(o); });
      sel.addEventListener('change', () => {
        activeDistrict = sel.value;
        if (activeCat !== 'all' && !allPlaces().some(p => p.cat === activeCat && (activeDistrict === 'all' || p.district === activeDistrict))) activeCat = 'all';   // nothing of that kind here
        render();
      });
      wrap.appendChild(sel);
      catChipRow.appendChild(wrap);

      const near = document.createElement('button');
      near.type = 'button'; near.className = 'chip chip-near'; near.id = 'near-chip';
      near.innerHTML = NAV_SVG + 'Nearest';
      near.addEventListener('click', toggleNearest);
      catChipRow.appendChild(near);

      const mk = (label, key, color) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip';
        b.dataset.cat = key;
        if (color){ const d = document.createElement('span'); d.className = 'dot'; d.style.background = color; b.appendChild(d); }
        b.appendChild(document.createTextNode(label));
        b.addEventListener('click', () => { activeCat = key; render(); });
        catChipRow.appendChild(b);
      };
      mk('All', 'all', null);
      Object.keys(CATEGORIES).forEach(k => mk(CATEGORIES[k].label, k, CATEGORIES[k].color));
    }
    const { byCat, byDist } = chipCounts();
    const dsel = $('district-select');
    Array.from(dsel.options).forEach(o => {
      if (o.value === 'all') return;
      const n = byDist[o.value] || 0;
      o.textContent = o.value + ' · ' + n;
      o.disabled = n === 0 && o.value !== activeDistrict;                  // no spots of the chosen kind in that district
    });
    dsel.value = activeDistrict;
    const dc = $('district-chip');
    dc.classList.toggle('active', activeDistrict !== 'all');
    dc.querySelector('.chip-label').textContent = activeDistrict === 'all' ? 'All districts' : activeDistrict;
    $('near-chip').classList.toggle('active', sortNearest);
    $('near-chip').setAttribute('aria-pressed', sortNearest ? 'true' : 'false');
    catChipRow.querySelectorAll('button.chip[data-cat]').forEach(b => {
      const key = b.dataset.cat, on = key === activeCat;
      const empty = key !== 'all' && !on && !(byCat[key] > 0);              // greyed out and unselectable: nothing to show
      b.classList.toggle('active', on);
      b.classList.toggle('dim', empty);
      b.disabled = empty;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function resetFilters(){
    activeCat = 'all'; activeDistrict = 'all'; searchTerm = ''; searchInput.value = '';
    render();
  }

  /* ---------- List ---------- */
  function cardHtml(p){
    const c = CATEGORIES[p.cat] || CATEGORIES.other;
    const hasCoords = !!(p.lat && p.lng);
    return '<div class="place-card' + (p.id === selectedId ? ' selected' : '') + '" data-id="' + esc(p.id) + '" tabindex="0" role="group" aria-label="' + esc(p.name) + '">' +
      '<div class="glyph" style="background:' + c.color + ';color:' + c.ink + '">' + svgIcon(ICONS[p.cat] ? p.cat : 'other') + '</div>' +
      '<div class="pc-body">' + coverHtml(p.id, 'pc-cover', 'data-act="photos"') +
        '<div class="row1"><h3>' + esc(p.name) + '</h3><span class="cat-tag" style="background:' + c.color + ';color:' + c.ink + '">' + esc(c.label) + '</span></div>' +
        (p.zh ? '<div class="zh">' + esc(p.zh) + '</div>' : '') +
        (p.note ? '<div class="note">' + esc(p.note) + '</div>' : '') +
        distHtml('dist', p) +
        '<div class="addr">' + esc(p.addr) + (p.approx ? ' · approximate pin' : '') + '</div>' +
        (p.flag ? '<div class="flag">' + WARN_SVG + '<span>' + esc(p.flag) + '</span></div>' : '') +
        (p.userAdded ? localTagHtml(p) : '') +
        '<div class="dir-row"><button type="button" class="dir-btn primary" data-act="dir">Directions</button>' +
          (hasCoords ? '<button type="button" class="dir-btn" data-act="map">Show on map</button>' : '') +
          photoBtnHtml(p.id, 'data-act="photos"') +
        '</div>' +
      '</div></div>';
  }

  function renderList(){
    const filtered = allPlaces().filter(matchesFilters);
    visibleCount.textContent = filtered.length;
    if (visibleCount.nextSibling) visibleCount.nextSibling.textContent = filtered.length === 1 ? ' spot' : ' spots';

    if (filtered.length === 0){
      listPane.innerHTML = '<div class="empty-msg">Nothing matches those filters.<br><button type="button" class="dir-btn primary" data-act="reset">Clear filters</button></div>';
      return;
    }

    if (sortNearest){
      if (!me){
        listPane.innerHTML = '<div class="empty-msg">Finding where you are…<br>GPS works without internet. It can take up to a minute, ideally outdoors.</div>';
        return;
      }
      const ranked = filtered.map(p => ({ p, d: p.lat && p.lng ? distanceM([me.lat, me.lng], [p.lat, p.lng]) : Infinity })).sort((a, b) => a.d - b.d);
      listPane.innerHTML = '<section><div class="district-heading">Nearest to you</div><div class="district-group">' + ranked.map(x => cardHtml(x.p)).join('') + '</div></section>';
      return;
    }
    const byDistrict = {};
    filtered.forEach(p => { (byDistrict[p.district] = byDistrict[p.district] || []).push(p); });
    listPane.innerHTML = Object.keys(byDistrict).sort().map(d =>
      '<section><div class="district-heading">' + esc(d) + '</div><div class="district-group">' +
      byDistrict[d].map(cardHtml).join('') + '</div></section>'
    ).join('');
  }

  listPane.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (btn && btn.dataset.act === 'reset'){ resetFilters(); return; }
    const card = e.target.closest('.place-card');
    if (!card) return;
    const id = card.dataset.id;
    if (btn && btn.dataset.act === 'dir'){ openDirections(id); return; }
    if (btn && btn.dataset.act === 'photos'){ openPhotos(id); return; }
    if (btn && btn.dataset.act === 'share'){ sharePlace(id); return; }
    if (btn && btn.dataset.act === 'retry'){ retryPlace(id); return; }
    if (btn && btn.dataset.act === 'remove'){ removeLocalPlace(id); return; }
    selectPlace(id, true);
  });
  listPane.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('place-card')) selectPlace(e.target.dataset.id, true);
  });

  /* ---------- Map pins ---------- */
  function pinIcon(cat, selected){
    const cc = CATEGORIES[cat] || CATEGORIES.other, c = cc.color, ink = cc.ink;
    return L.divIcon({
      className: '',
      html: '<div class="gpin' + (selected ? ' sel' : '') + '"><svg viewBox="0 0 34 42" aria-hidden="true">' +
        '<path d="M17 40C15 36 4.5 27.5 3.5 16A13.5 13.5 0 1 1 30.5 16C29.5 27.5 19 36 17 40z" fill="#3a2a1a" opacity=".16" transform="translate(0 2.4)"/>' +
        '<path d="M17 40C15 36 4.5 27.5 3.5 16A13.5 13.5 0 1 1 30.5 16C29.5 27.5 19 36 17 40z" fill="' + c + '" stroke="' + ink + '" stroke-opacity=".55" stroke-width="1.6" stroke-linejoin="round"/>' +
        '<g transform="translate(8 7) scale(.75)" fill="none" stroke="' + ink + '" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[cat] || ICONS.other) + '</g></svg></div>',
      iconSize: [34,42],
      iconAnchor: [17,41],
      popupAnchor: [0,-52]
    });
  }

  function mapPad(){
    const m = isMobile();
    return { top: (m ? hdrH + 44 : 0) + 16, bottom: (m ? tabH : 0) + 16 };   // +44 clears the map key / fit button row
  }

  function popupHtml(p){
    const c = CATEGORIES[p.cat] || CATEGORIES.other;
    return '<div class="pp">' + coverHtml(p.id, 'pc-cover pp-cover', 'data-photos="' + esc(p.id) + '"') + '<div class="pp-cat"><i style="background:' + c.color + '"></i>' + esc(c.label) + '</div>' +
      '<div class="pp-title">' + esc(p.name) + '</div>' +
      (p.zh ? '<div class="pp-zh">' + esc(p.zh) + '</div>' : '') +
      (p.note ? '<div class="pp-note">' + esc(p.note) + '</div>' : '') +
      distHtml('pp-dist', p) +
      '<div class="pp-addr">' + esc(p.addr) + (p.approx ? ' · approximate pin' : '') + '</div>' +
      (p.flag ? '<div class="pp-flag">' + esc(p.flag) + '</div>' : '') +
      '<div class="dir-row"><button type="button" class="dir-btn primary" data-dir="' + esc(p.id) + '">Directions</button>' +
        photoBtnHtml(p.id, 'data-photos="' + esc(p.id) + '"') +
        (p.userAdded && !p.issue ? '<button type="button" class="dir-btn" data-share="' + esc(p.id) + '">' + (syncKey() ? 'Send now' : 'Set up sharing') + '</button>' : '') + '</div></div>';
  }

  function renderMap(){
    if (!map) return;
    Object.values(markers).forEach(m => map.removeLayer(m));
    markers = {};
    const pad = mapPad();
    const withCoords = allPlaces().filter(matchesFilters).filter(p => p.lat && p.lng);

    const seen = {};
    withCoords.forEach(p => {
      const k = p.lat.toFixed(4) + ',' + p.lng.toFixed(4);
      const n = seen[k] = (seen[k] || 0) + 1;
      const off = n > 1 ? 0.00025 * n : 0;
      const marker = L.marker([p.lat + off*Math.sin(n*2), p.lng + off*Math.cos(n*2)], { icon: pinIcon(p.cat, p.id === selectedId), keyboard:false });
      marker.bindPopup(() => popupHtml(p), { maxWidth:280, minWidth:220, closeButton:false, autoPanPaddingTopLeft:[16, pad.top], autoPanPaddingBottomRight:[16, pad.bottom] });
      marker.on('click', () => selectPlace(p.id, false));
      marker.addTo(map);
      if (p.id === selectedId) marker.setZIndexOffset(1000);
      markers[p.id] = marker;
    });
    updateLabelsFn();
  }

  // Toggle selection in place — no list/pin rebuild
  function markSelected(id){
    listPane.querySelectorAll('.place-card.selected').forEach(el => el.classList.remove('selected'));
    Object.keys(markers).forEach(k => {
      const m = markers[k], el = m.getElement && m.getElement(), g = el && el.querySelector('.gpin');
      const on = k === id;
      if (g) g.classList.toggle('sel', on);
      m.setZIndexOffset(on ? 1000 : 0);
    });
    if (!id) return;
    const row = Array.from(listPane.querySelectorAll('.place-card')).find(el => el.dataset.id === id);
    if (row){
      row.classList.add('selected');
      if (!isMobile()) row.scrollIntoView({ block:'nearest', behavior:'smooth' });
    }
  }

  function selectPlace(id, fromList){
    selectedId = id;
    markSelected(id);
    updateLabelsFn();
    const p = findPlace(id);
    if (fromList && isMobile()){
      pendingView = 'sel';
      switchTab('map');
      return;
    }
    if (map && p && p.lat && p.lng && !mapHidden()){
      map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 15), { duration: 0.5 });
      if (markers[id]) markers[id].openPopup();
    }
  }

  function mapHidden(){ return $('map-pane').offsetWidth === 0; }
  function fitVisible(){
    if (!map) return;
    if (mapHidden()){ pendingView = 'fit'; return; }
    const pts = allPlaces().filter(matchesFilters).filter(p => p.lat && p.lng && p.district !== 'Multiple' && !p.flag).map(p => [p.lat, p.lng]);
    if (!pts.length) return;
    const pad = mapPad();
    map.fitBounds(pts, { paddingTopLeft:[40, pad.top + 24], paddingBottomRight:[40, pad.bottom + 24], maxZoom:16 });
  }

  function render(){
    buildChips();
    renderList();
    renderMap();
    fitVisible();
  }

  const renderMapSoon = debounce(() => { renderMap(); fitVisible(); }, 180);
  searchInput.addEventListener('input', e => {
    searchTerm = e.target.value.trim().toLowerCase();
    renderList();            // list responds on the keystroke
    renderMapSoon();         // map settles once typing pauses
  });

  function switchTab(which){
    if (typeof dismissQuick === 'function') dismissQuick(true);
    const main = $('main');
    const tabList = $('tab-list'), tabMap = $('tab-map');
    const toMap = which === 'map';
    main.className = toMap ? 'show-map' : 'show-list';
    appEl.classList.toggle('map-view', toMap);
    tabList.classList.toggle('active', !toMap);
    tabMap.classList.toggle('active', toMap);
    if (toMap) tabMap.setAttribute('aria-current', 'page'); else tabMap.removeAttribute('aria-current');
    if (!toMap) tabList.setAttribute('aria-current', 'page'); else tabList.removeAttribute('aria-current');
    if (toMap){
      requestAnimationFrame(() => setTimeout(() => {
        if (!map) return;
        map.invalidateSize();
        const pv = pendingView; pendingView = null;
        if (pv === 'fit') fitVisible();
        else if (pv === 'sel'){
          const sp = findPlace(selectedId);
          if (sp && sp.lat){ map.setView([sp.lat, sp.lng], 15, { animate:false }); if (markers[sp.id]) markers[sp.id].openPopup(); }
        }
      }, 40));
    }
  }
  $('tab-list').addEventListener('click', () => switchTab('list'));
  $('tab-map').addEventListener('click', () => switchTab('map'));

  function initMap(){
    if (typeof L === 'undefined'){
      const mapDiv = $('map');
      if (mapDiv) mapDiv.innerHTML = '<div class="map-fail">The map couldn’t load. This usually means the device is offline or an ad-blocker is blocking the map script. The list still works.</div>';
      return;
    }
    map = L.map('map', { zoomControl: false, attributionControl:false, zoomSnap:0, zoomDelta:1, minZoom:9, maxZoom:17, tap:true, preferCanvas:true, zoomAnimationThreshold:6, scrollWheelZoom:false, fadeAnimation:false, bounceAtZoomLimits:false }).setView([31.2304, 121.4737], 12);
    L.control.zoom({ position:'topright' }).addTo(map);
    map.createPane('basePane'); map.getPane('basePane').style.zIndex = 150;
    const geo = L.geoJSON(SH_DISTRICTS, {
      pane: 'basePane',
      style: () => ({ color:'#c4c7cc', weight:1, fillColor:'#F5F3EF', fillOpacity:1, interactive:false })
    }).addTo(map);
    // one label per (merged) district, placed on its largest polygon
    const best = {};
    geo.eachLayer(l => {
      const en = l.feature.properties.en, b = l.getBounds();
      const area = (b.getNorth()-b.getSouth())*(b.getEast()-b.getWest());
      if (!best[en] || area > best[en].area) best[en] = { area, c: b.getCenter(), zh: l.feature.properties.zh };
    });
    Object.keys(best).forEach(en => {
      L.tooltip({ permanent:true, direction:'center', className:'district-label', interactive:false })
        .setLatLng(best[en].c).setContent(en).addTo(map);
    });
    // ---- Offline street tiles: two plain-<img> layers ----
    // Base   = the embedded z11-z15 tiles (coarse, covers everything, always drawn underneath)
    // Detail = the embedded z16 tiles (crisp), faded out across the edges that touch a missing tile,
    //          so the crisp area melts into the base instead of ending in a visible rectangle.
    const has = (z, x, y) => !!MAP_TILES[z + '/' + x + '/' + y];
    const urlCache = new Map();
    function tileUrl(key){
      let u = urlCache.get(key);
      if (!u){
        const bin = atob(MAP_TILES[key]), arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        u = URL.createObjectURL(new Blob([arr], { type:'image/webp' }));
        urlCache.set(key, u);
      }
      return u;
    }
    // crop the source tile (z/x/y) to the screen tile c, k levels above it
    function fillTile(el, done, z, x, y, c, k){
      const key = z + '/' + x + '/' + y, S = 256 * (1 << k), img = new Image();
      img.alt = ''; img.decoding = 'async'; img.draggable = false;
      img.style.cssText = 'width:' + S + 'px;height:' + S + 'px;left:' + (-(c.x - (x << k)) * 256) + 'px;top:' + (-(c.y - (y << k)) * 256) + 'px';
      let retried = false;
      img.onload = () => done(null, el);
      img.onerror = () => {
        if (retried) { done(null, el); return; }          // give up quietly: the layer below still shows
        retried = true;
        const old = urlCache.get(key); urlCache.delete(key);
        if (old) URL.revokeObjectURL(old);
        img.src = tileUrl(key);
      };
      img.src = tileUrl(key);
      el.appendChild(img);
      return el;
    }
    const emptyTile = (el, done) => { setTimeout(() => done(null, el), 0); return el; };
    // tiles are 1px larger than the grid so neighbours overlap: no hairline seams at fractional zoom
    const seamless = { _initTile: function(tile){
      L.GridLayer.prototype._initTile.call(this, tile);
      const s = this.getTileSize(); tile.style.width = (s.x + 1) + 'px'; tile.style.height = (s.y + 1) + 'px';
    } };
    const Base = L.GridLayer.extend(Object.assign({}, seamless, {
      createTile: function(c, done){
        const el = document.createElement('div'); el.className = 'ofl-tile';
        const k0 = Math.max(0, c.z - 15);                     // never use z16 here: that's the Detail layer's job
        for (let k = k0; k <= k0 + 5 && c.z - k >= 11; k++){
          const z = c.z - k, x = c.x >> k, y = c.y >> k;
          if (has(z, x, y)) return fillTile(el, done, z, x, y, c, k);
        }
        return emptyTile(el, done);
      }
    }));
    const FEATHER = 72;
    const Detail = L.GridLayer.extend(Object.assign({}, seamless, {
      createTile: function(c, done){
        const el = document.createElement('div'); el.className = 'ofl-tile';
        if (c.z < 16) return emptyTile(el, done);
        const k = c.z - 16, sx = c.x >> k, sy = c.y >> k;
        if (!has(16, sx, sy)) return emptyTile(el, done);
        const n = 1 << k, dx = c.x - (sx << k), dy = c.y - (sy << k);
        const eL = dx === 0, eR = dx === n - 1, eT = dy === 0, eB = dy === n - 1;
        const nl = has(16, sx-1, sy), nr = has(16, sx+1, sy), nt = has(16, sx, sy-1), nb = has(16, sx, sy+1);
        const g = [], lin = d => 'linear-gradient(' + d + ', transparent 0, #000 ' + FEATHER + 'px)', rad = p => 'radial-gradient(circle at ' + p + ', transparent 0, #000 ' + FEATHER + 'px)';
        if (eL && !nl) g.push(lin('to right'));
        if (eR && !nr) g.push(lin('to left'));
        if (eT && !nt) g.push(lin('to bottom'));
        if (eB && !nb) g.push(lin('to top'));
        if (eL && eT && nl && nt && !has(16, sx-1, sy-1)) g.push(rad('0 0'));
        if (eR && eT && nr && nt && !has(16, sx+1, sy-1)) g.push(rad('100% 0'));
        if (eL && eB && nl && nb && !has(16, sx-1, sy+1)) g.push(rad('0 100%'));
        if (eR && eB && nr && nb && !has(16, sx+1, sy+1)) g.push(rad('100% 100%'));
        if (g.length){
          const m = g.join(',');
          el.style.webkitMaskImage = m; el.style.maskImage = m;
          el.style.webkitMaskComposite = g.map(() => 'source-in').join(',');
          el.style.maskComposite = g.map(() => 'intersect').join(',');
        }
        return fillTile(el, done, 16, sx, sy, c, k);
      }
    }));
    const tileOpts = { tileSize:256, minZoom:9, maxZoom:17, updateWhenZooming:false, updateWhenIdle:false, updateInterval:60, keepBuffer:2 };
    new Base(Object.assign({ zIndex:1 }, tileOpts)).addTo(map);
    new Detail(Object.assign({ zIndex:2 }, tileOpts)).addTo(map);

    // ---- Smooth zoom: trackpad pinch / wheel zooms continuously toward the cursor ----
    // (Leaflet's own wheel zoom is debounced and moves in animated half-steps, which feels laggy.)
    (function smoothZoom(){
      const el = map.getContainer(), minZ = map.getMinZoom(), maxZ = map.getMaxZoom();
      let target = 0, anchor = null, anchorLL = null, raf = 0, active = false, idleTimer = 0, idle = true;
      function frame(){
        raf = 0;
        const cur = map.getZoom();
        let next = cur + (target - cur) * 0.42;
        if (Math.abs(target - next) < 0.003) next = target;
        if (next !== cur){
          const half = map.getSize().divideBy(2);
          const c = map.unproject(map.project(anchorLL, next).subtract(anchor).add(half), next);
          map._move(map._limitCenter(c, next, map.options.maxBounds), next, { pinch:true, round:false });
        }
        if (next !== target || !idle) raf = requestAnimationFrame(frame);
        else finish();
      }
      function finish(){
        if (!active) return;
        active = false;
        map._moveEnd(true);
      }
      el.addEventListener('wheel', e => {
        e.preventDefault();
        if (!active){
          active = true;
          map.stop();
          anchor = map.mouseEventToContainerPoint(e);
          anchorLL = map.containerPointToLatLng(anchor);
          target = map.getZoom();
          map._moveStart(true, false);
        }
        const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 120 : 1);
        target = Math.min(maxZ, Math.max(minZ, target - dy / (e.ctrlKey ? 75 : 200)));
        idle = false;
        clearTimeout(idleTimer); idleTimer = setTimeout(() => { idle = true; if (!raf) raf = requestAnimationFrame(frame); }, 120);
        if (!raf) raf = requestAnimationFrame(frame);
      }, { passive:false });
    })();

    // ---- Labels: one engine places every name on the map, Google/Apple style ----
    //  * pins and areas (parks, squares, water, landmarks): always horizontal, centred on the thing they name
    //  * roads and rivers: rotated to the road's own angle and centred ON its line, only where the road is
    //    straight and nothing crosses or joins it under the text, repeated periodically along the road
    // Road/area geometry is OpenStreetMap data converted to the basemap's coordinate system (GCJ-02).
    const LAT0 = 31.22, LNG0 = 121.47, KY = 110860, KX = 111320 * Math.cos(LAT0 * Math.PI / 180);
    const POLYS = ROAD_POLYS.map((r, id) => {
      const c = r[2], n = c.length / 2, lat = new Float64Array(n), lng = new Float64Array(n), x = new Float64Array(n), y = new Float64Array(n), cum = new Float64Array(n);
      let a = 0, b = 0, s = 90, w = 180, nn = -90, e = -180;
      for (let i = 0; i < n; i++){
        a += c[2*i]; b += c[2*i+1];                       // first pair absolute, the rest are deltas
        lat[i] = a / 1e5; lng[i] = b / 1e5;
        x[i] = (lng[i] - LNG0) * KX; y[i] = (lat[i] - LAT0) * KY;
        if (i) cum[i] = cum[i-1] + Math.hypot(x[i] - x[i-1], y[i] - y[i-1]);
        s = Math.min(s, lat[i]); nn = Math.max(nn, lat[i]); w = Math.min(w, lng[i]); e = Math.max(e, lng[i]);
      }
      return { id, name:r[0], cls:r[1], n, lat, lng, x, y, cum, len:cum[n-1], junc:r[3], s, w, nn, e };
    }).sort((p, q) => p.cls - q.cls || q.len - p.len);    // motorways first, then trunk, primary, secondary, rivers
    function pointAt(P, s){
      s = Math.max(0, Math.min(P.len, s));
      let lo = 0, hi = P.n - 1;
      while (hi - lo > 1){ const m = (lo + hi) >> 1; if (P.cum[m] <= s) lo = m; else hi = m; }
      const t = (s - P.cum[lo]) / ((P.cum[hi] - P.cum[lo]) || 1);
      return { x:P.x[lo] + (P.x[hi] - P.x[lo]) * t, y:P.y[lo] + (P.y[hi] - P.y[lo]) * t, lat:P.lat[lo] + (P.lat[hi] - P.lat[lo]) * t, lng:P.lng[lo] + (P.lng[hi] - P.lng[lo]) * t, i:hi };
    }
    // is the stretch a..b (metres along P) straight, and free of junctions / crossings?
    function straightWindow(P, a, b, tol, pad){
      for (let k = 0; k < P.junc.length; k++){ const j = P.junc[k]; if (j > a - pad && j < b + pad) return null; }
      const A = pointAt(P, a), B = pointAt(P, b), dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
      if (len < (b - a) * 0.985) return null;
      for (let i = A.i; i < P.n && P.cum[i] < b; i++){
        if (P.cum[i] <= a) continue;
        if (Math.abs((P.x[i] - A.x) * dy - (P.y[i] - A.y) * dx) / len > tol) return null;
      }
      return { dx, dy };
    }
    const mctx = document.createElement('canvas').getContext('2d'), FF = getComputedStyle(document.body).fontFamily, wcache = new Map();
    const tw = (t, wgt, sz) => { const k = wgt + '|' + sz + '|' + t; let w = wcache.get(k); if (w == null){ mctx.font = wgt + ' ' + sz + 'px ' + FF; w = mctx.measureText(t).width; wcache.set(k, w); } return w; };
    function wrap(text, maxW, wgt, sz){
      const lines = []; let cur = '';
      text.split(/\s+/).forEach(w => { const t = cur ? cur + ' ' + w : w; if (cur && tw(t, wgt, sz) > maxW){ lines.push(cur); cur = w; } else cur = t; });
      if (cur) lines.push(cur);
      return lines.slice(0, 3);
    }
    function makeIndex(){                                  // tiny spatial hash for label collisions
      const S = 96, cells = new Map();
      const each = (r, fn) => { for (let cx = Math.floor(r[0] / S); cx <= Math.floor(r[2] / S); cx++) for (let cy = Math.floor(r[1] / S); cy <= Math.floor(r[3] / S); cy++) if (fn(cx + ',' + cy)) return true; return false; };
      return {
        hit: r => each(r, k => (cells.get(k) || []).some(q => !(r[2] + 2 < q[0] || q[2] + 2 < r[0] || r[3] + 1 < q[1] || q[3] + 1 < r[1]))),
        add: r => each(r, k => { (cells.get(k) || cells.set(k, []).get(k)).push(r); return false; })
      };
    }
    const labelPane = map.createPane('labelPane'); labelPane.style.zIndex = 590; labelPane.style.pointerEvents = 'none';
    const labelEls = new Map();
    // every label remembers the map point it hangs from (ll) plus its pixel offset from it, so it can be
    // re-pinned on every frame of a zoom and stays glued to the map instead of floating
    const labelTf = (rec, p, round) => {
      const x = p.x + rec.dx, y = p.y + rec.dy;
      return 'translate3d(' + (round ? Math.round(x) : x.toFixed(2)) + 'px,' + (round ? Math.round(y) : y.toFixed(2)) + 'px,0)' + (rec.center ? ' translate(-50%,-50%)' : '') + (rec.rot ? ' rotate(' + rec.rot.toFixed(1) + 'deg)' : '');
    };
    const livePoint = ll => map.project(L.latLng(ll[0], ll[1])).subtract(map.getPixelOrigin());   // unrounded: smooth while zooming
    function commitLabels(out){
      const seen = new Set();
      out.forEach(o => {
        seen.add(o.key);
        let rec = labelEls.get(o.key);
        if (!rec){
          rec = { el:document.createElement('div'), cls:'', html:'', tf:'' };
          if (map._zoomAnimated) rec.el.classList.add('leaflet-zoom-animated');     // Leaflet's animated-zoom transition
          labelEls.set(o.key, rec); labelPane.appendChild(rec.el);
        }
        rec.ll = o.ll; rec.dx = o.dx; rec.dy = o.dy; rec.center = o.center; rec.rot = o.rot;
        if (rec.cls !== o.cls){ rec.el.className = o.cls + (map._zoomAnimated ? ' leaflet-zoom-animated' : ''); rec.cls = o.cls; }
        if (rec.html !== o.html){ rec.el.innerHTML = o.html; rec.html = o.html; }
        const tf = labelTf(rec, map.latLngToLayerPoint(o.ll), true);
        if (rec.tf !== tf){ rec.el.style.transform = tf; rec.tf = tf; }
      });
      labelEls.forEach((rec, k) => {
        if (seen.has(k)) return;
        labelEls.delete(k);
        rec.el.classList.add('out'); setTimeout(() => rec.el.remove(), 180);            // fade out instead of vanishing
      });
    }
    function followMap(pointOf){
      labelEls.forEach(rec => { const tf = labelTf(rec, pointOf(rec.ll), false); rec.tf = tf; rec.el.style.transform = tf; });
    }
    map.on('zoom', () => followMap(livePoint));                                          // trackpad / wheel / fly-to: every frame
    map.on('zoomanim', e => { if (map._zoomAnimated) followMap(ll => map._latLngToNewLayerPoint(L.latLng(ll[0], ll[1]), e.zoom, e.center)); });   // buttons / double-click
    const ROAD_MINZ = [14, 14, 14, 15, 14.5];              // by class: motorway, trunk, primary, secondary, river
    function updateLabels(){
      const z = map.getZoom(), bounds = map.getBounds().pad(0.25), out = [], idx = makeIndex();
      $('map').classList.remove('zooming');
      const mpp = 156543.03392 * Math.cos(LAT0 * Math.PI / 180) / Math.pow(2, z);   // metres per CSS pixel
      const toLP = (lat, lng) => map.latLngToLayerPoint([lat, lng]);

      // 0. pins are obstacles (and get their own names from z16)
      const pins = [];
      Object.keys(markers).forEach(id => {
        const ll = markers[id].getLatLng();
        if (!bounds.contains(ll)) return;
        const p = toLP(ll.lat, ll.lng), big = id === selectedId ? 1.3 : 1;
        idx.add([p.x - 17 * big, p.y - 42 * big, p.x + 17 * big, p.y + 3]);
        pins.push({ id, p });
      });
      if (z >= 16){
        pins.sort((a, b) => (b.id === selectedId) - (a.id === selectedId)).forEach(({ id, p }) => {
          const pl = findPlace(id); if (!pl) return;
          const text = pl.name.length > 26 ? pl.name.slice(0, 25) + '…' : pl.name, w = tw(text, 600, 11.5) + 4, h = 15, y0 = p.y - 30;
          const big = id === selectedId ? 1.3 : 1, gap = 17 * big + 5;   // clear of the pin's own box
          for (const r of [[p.x + gap, y0, p.x + gap + w, y0 + h], [p.x - gap - w, y0, p.x - gap, y0 + h]]){
            if (idx.hit(r)) continue;
            idx.add(r); out.push({ key:'p' + id, cls:'lb pin' + (id === selectedId ? ' sel' : ''), html:esc(text), ll:[markers[id].getLatLng().lat, markers[id].getLatLng().lng], dx:r[0] - p.x, dy:r[1] - p.y });
            break;
          }
        });
      }

      // 1. parks, squares, water, landmarks: horizontal, centred in the area
      if (z >= 14.5) AREAS.forEach((a, i) => {
        const kind = a[0], pxW = a[5] / mpp, pxH = a[6] / mpp, point = a[5] === 0;
        if (!(pxW >= 64 && pxH >= 30) && !(point && z >= 16) && !(kind === 'a' && z >= 16.5)) return;
        if (!bounds.contains([a[3], a[4]])) return;
        const main = a[1] || a[2], sub = a[1] && a[2] ? a[2] : '', maxW = point ? 130 : Math.max(64, Math.min(150, pxW * 0.9));
        const lines = wrap(main, maxW, 600, 11), w = Math.max(...lines.map(l => tw(l, 600, 11)), sub ? tw(sub, 500, 10) : 0) + 4;
        const h = lines.length * 13 + (sub ? 12 : 0), p = toLP(a[3], a[4]), r = [p.x - w / 2, p.y - h / 2, p.x + w / 2, p.y + h / 2];
        if (idx.hit(r)) return;
        idx.add(r);
        out.push({ key:'a' + i, cls:'lb area ' + kind, center:true, ll:[a[3], a[4]], dx:0, dy:0,
          html:lines.map(l => '<div>' + esc(l) + '</div>').join('') + (sub ? '<div class="zh">' + esc(sub) + '</div>' : '') });
      });

      // 2. roads and rivers: along the road, on the road, on a straight stretch with no junction underneath
      const placed = new Map();
      POLYS.forEach(P => {
        if (z < ROAD_MINZ[P.cls] || P.nn < bounds.getSouth() || P.s > bounds.getNorth() || P.e < bounds.getWest() || P.w > bounds.getEast()) return;
        const nm = ROAD_NAMES[P.name], bilingual = !!(nm[0] && nm[1] && nm[0] !== nm[1]);
        let nLab = Math.max(1, Math.round(P.len / (300 * mpp)));          // one name every ~300px along the road, English and Chinese taking turns
        if (bilingual && nLab < 2 && P.len >= 2 * (Math.max(tw(nm[1], 600, 11), tw(nm[0], 600, 11)) + 24) * mpp) nLab = 2;   // room for one of each language
        for (let k = 0; k < nLab; k++){
          const text = (k % 2 === 1 && nm[1] && nm[0]) ? nm[0] : (nm[1] || nm[0]);   // English and Chinese alternate along the road
          const w = tw(text, 600, 11) + 10, wm = w * mpp, tol = 2.2 * mpp + 0.6, pad = 9 * mpp, target = (k + 0.5) * P.len / nLab;
          if (wm + 2 * pad > P.len) continue;
          let found = null;
          for (let step = 0; step <= 16 && !found; step++){
            for (const sgn of (step ? [1, -1] : [0])){
              const s = target + sgn * step * 6 * mpp, a = s - wm / 2, b = s + wm / 2;
              if (a < 0 || b > P.len) continue;
              const win = straightWindow(P, a, b, tol, pad);
              if (win){ found = { s, win }; break; }
            }
          }
          if (!found) continue;
          const c = pointAt(P, found.s), lp = toLP(c.lat, c.lng);
          if (!bounds.contains([c.lat, c.lng])) continue;
          const prev = placed.get(P.name) || [];
          if (prev.some(q => Math.hypot(q.x - lp.x, q.y - lp.y) < 180)) continue;   // same road already named right here (dual carriageway)
          let ang = Math.atan2(-found.win.dy, found.win.dx) * 180 / Math.PI;
          if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
          const rad = ang * Math.PI / 180, cs = Math.abs(Math.cos(rad)), sn = Math.abs(Math.sin(rad)), bw = w * cs + 14 * sn, bh = w * sn + 14 * cs;
          const r = [lp.x - bw / 2, lp.y - bh / 2, lp.x + bw / 2, lp.y + bh / 2];
          if (idx.hit(r)) continue;
          idx.add(r); prev.push(lp); placed.set(P.name, prev);
          out.push({ key:'r' + P.id + ':' + k, cls:'lb road c' + P.cls, html:esc(text), center:true, ll:[c.lat, c.lng], dx:0, dy:0, rot:ang });
        }
      });
      commitLabels(out);
    }
    const labelsSoon = debounce(updateLabels, 60);
    updateLabelsFn = labelsSoon;
    map.on('moveend zoomend', labelsSoon);

    // ---- Metro stations: only the ones in view are put on the map ----
    const stIcon = L.divIcon({ className:'metro-hit', html:'<div class="metro-dot">M</div>', iconSize:[44,44], iconAnchor:[22,22] });   // 44px hit area around the 18px dot
    const stMarkers = {};
    function stMarker(i){
      if (stMarkers[i]) return stMarkers[i];
      const s = METRO_STATIONS[i];
      const m = L.marker([s[1], s[2]], { icon: stIcon, keyboard:false, zIndexOffset:-500 });
      m.on('click', () => {                                                    // runs before Leaflet opens the popup: keep it clear of the header / tab bar
        const pad = mapPad(), po = m.getPopup().options;
        po.autoPanPaddingTopLeft = [16, pad.top]; po.autoPanPaddingBottomRight = [16, pad.bottom];
      });
      m.bindPopup('<div class="pp"><div class="pp-cat">Metro station</div><div class="pp-title">' + esc(s[0]) + '</div><div class="dir-row"><button type="button" class="dir-btn primary" data-dir="st:' + i + '">Directions</button></div></div>', { closeButton:false });
      const dot = () => { const e = m.getElement(); return e && e.querySelector('.metro-dot'); };
      m.on('popupopen', () => { const d = dot(); if (d) d.classList.add('sel'); });
      m.on('popupclose', () => { const d = dot(); if (d) d.classList.remove('sel'); });
      return stMarkers[i] = m;
    }
    function updateStations(){
      const z = map.getZoom(), b = map.getBounds().pad(0.25), labels = z >= 15;
      METRO_STATIONS.forEach((s, i) => {
        const show = z >= 13 && b.contains([s[1], s[2]]);
        const m = stMarkers[i];
        if (show){
          const mk = stMarker(i);
          if (!map.hasLayer(mk)) mk.addTo(map);
          if (labels && !mk.getTooltip()){
            mk.bindTooltip(s[0], { permanent:true, direction:'right', offset:[12,0], className:'metro-label' }).openTooltip();
            const te = mk.getTooltip().getElement();                          // the station name is tappable too
            if (te){ te.style.pointerEvents = 'auto'; te.style.cursor = 'pointer'; L.DomEvent.on(te, 'click', ev => { L.DomEvent.stopPropagation(ev); mk.fire('click'); mk.openPopup(); }); }
          }
          if (!labels && mk.getTooltip()) mk.unbindTooltip();
        } else if (m && map.hasLayer(m)){
          if (m.getTooltip()) m.unbindTooltip();
          map.removeLayer(m);
        }
      });
    }
    map.on('moveend zoomend', updateStations);
    const zoomStyle = () => {
      const z = map.getZoom();
      updateStations();
      $('map').classList.toggle('hide-districts', z >= 13);
    };
    map.on('zoomend', zoomStyle); zoomStyle();
    map.setMaxBounds(geo.getBounds().pad(0.2));
    $('fit-btn').addEventListener('click', fitVisible);
    map.on('click', e => { if (picking) movePicker(e.latlng); });
    map.createPane('pickPane').style.zIndex = 680;                        // above pins, name labels and district labels
    map.on('contextmenu', e => { if (!picking && Date.now() - quickAt > 1500) startQuick(e.latlng); });
    armLongPress();
    $('map-legend').open = !isMobile();
    new ResizeObserver(() => map.invalidateSize()).observe($('map-pane'));
  }

  /* ---------- Sheets: spring-in, drag down to dismiss ---------- */
  const wideMq = window.matchMedia('(min-width: 600px)');
  function rubber(over, dim){ const c = .55; return (over * dim * c) / (dim + c * Math.abs(over)); }

  function makeSheet(backdrop, sheet, onClosed){
    const head = sheet.querySelector('.sheet-head');
    let lastFocus = null, drag = null;

    function open(){
      lastFocus = document.activeElement;
      backdrop.classList.add('open');
      appEl.inert = true;
      sheet.focus({ preventScroll:true });
    }
    function close(){
      if (!backdrop.classList.contains('open')) return;
      sheet.style.transform = '';
      backdrop.style.removeProperty('--scrim-o');
      backdrop.classList.remove('open');
      appEl.inert = false;
      if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll:true });
      if (onClosed) onClosed();
    }

    backdrop.addEventListener('pointerdown', e => { if (e.target === backdrop) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

    head.addEventListener('pointerdown', e => {
      if (wideMq.matches || e.target.closest('button,a,input,select,textarea')) return;
      drag = { id:e.pointerId, y0:e.clientY, h:sheet.offsetHeight, pts:[{ y:e.clientY, t:e.timeStamp }] };
      head.setPointerCapture(e.pointerId);
      sheet.classList.add('dragging'); backdrop.classList.add('dragging');
    });
    head.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      const dy = e.clientY - drag.y0;
      const y = dy > 0 ? dy : -rubber(-dy, 240);   // resist upward, follow the finger 1:1 downward
      sheet.style.transform = 'translateY(' + y + 'px)';
      backdrop.style.setProperty('--scrim-o', String(1 - Math.min(1, Math.max(0, dy / drag.h))));
      drag.pts.push({ y:e.clientY, t:e.timeStamp });
      if (drag.pts.length > 6) drag.pts.shift();
    });
    function endDrag(e, cancelled){
      if (!drag || e.pointerId !== drag.id) return;
      const a = drag.pts[0], b = drag.pts[drag.pts.length - 1];
      const v = (b.y - a.y) / Math.max(1, b.t - a.t);              // px/ms at release
      const dy = e.clientY - drag.y0;
      const projected = dy + v * 200;                              // where the flick is heading
      const h = drag.h;
      drag = null;
      sheet.classList.remove('dragging'); backdrop.classList.remove('dragging');
      if (!cancelled && (projected > h * 0.4 || v > 0.6)) close();
      else { sheet.style.transform = ''; backdrop.style.removeProperty('--scrim-o'); }
    }
    head.addEventListener('pointerup', e => endDrag(e, false));
    head.addEventListener('pointercancel', e => endDrag(e, true));
    return { open, close };
  }

  /* ---------- Directions ---------- */
  const dirSheet = makeSheet($('dir-backdrop'), $('dir-sheet'));
  const dirFrom = $('dir-from');
  const dirFromText = $('dir-from-text');
  const dirFromWrap = $('dir-from-wrap');
  let dirTarget = null, dirMode = 'walk';
  const FROM_KEY = 'shanghai-eats-last-origin';

  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-dir]');
    if (b) openDirections(b.getAttribute('data-dir'));
  });
  document.querySelectorAll('#dir-mode button').forEach(b => b.addEventListener('click', () => {
    dirMode = b.dataset.m;
    document.querySelectorAll('#dir-mode button').forEach(x => x.classList.toggle('on', x === b));
    updateLinks();
  }));
  dirFrom.addEventListener('change', () => {
    dirFromWrap.hidden = dirFrom.value !== '__text';
    if (!dirFromWrap.hidden) dirFromText.focus();
    try{ localStorage.setItem(FROM_KEY, dirFrom.value); }catch(e){}
    updateLinks();
  });
  dirFromText.addEventListener('input', updateLinks);
  $('dir-close').addEventListener('click', () => dirSheet.close());

  function stationPlace(id){
    const i = +id.slice(3), st = METRO_STATIONS[i];
    return st ? { id, name: st[0] + ' Station', zh: '', addr: 'Shanghai Metro station', lat: st[1], lng: st[2], district: 'Metro', searchName: st[0] + ' 地铁站' } : null;
  }
  function findAny(id){
    return String(id).startsWith('st:') ? stationPlace(id) : findPlace(id);
  }
  function openDirections(id){
    const p = findAny(id);
    if (!p) return;
    dirTarget = p;
    $('dir-name').textContent = p.name;
    $('dir-zh').textContent = p.zh || '';
    $('dir-zh').hidden = !p.zh;
    $('dir-addr').textContent = p.addr || '';
    let saved = null; try{ saved = localStorage.getItem(FROM_KEY); }catch(e){}
    dirFrom.innerHTML = '';
    const opt = (v,t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; dirFrom.appendChild(o); };
    opt('__here', 'My current location');
    opt('__text', 'Type an address…');
    allPlaces().filter(x => x.id !== p.id && x.lat && x.lng && x.district !== 'Multiple')
      .forEach(x => opt(x.id, 'From ' + x.name));
    dirFrom.value = [...dirFrom.options].some(o => o.value === saved) ? saved : '__here';
    dirFromWrap.hidden = dirFrom.value !== '__text';
    const warn = [];
    if (p.district === 'Multiple') warn.push('This place has several branches — use “search by name” to find the nearest one.');
    else if (p.flag) warn.push(p.flag + '. Search by name in AMap to double-check.');
    else if (p.approx) warn.push('This pin is approximate. If the route ends slightly off, use “search by name” in AMap.');
    if (!p.lat || !p.lng) warn.push('No coordinates saved, so directions search by name/address instead.');
    const warnEl = $('dir-warn');
    warnEl.textContent = warn.join(' ');
    warnEl.hidden = !warn.length;
    updateLinks();
    dirSheet.open();
    $('dir-backdrop').querySelector('.sheet-body').scrollTop = 0;
  }

  function updateLinks(){
    const p = dirTarget; if (!p) return;
    const has = !!(p.lat && p.lng);
    const label = p.zh || p.name;
    const q = encodeURIComponent;
    let from = null, fromText = '';
    if (dirFrom.value === '__text') fromText = dirFromText.value.trim();
    else if (dirFrom.value !== '__here') from = findAny(dirFrom.value);

    const amapMode = { walk:'walk', transit:'bus', drive:'car', bike:'ride' }[dirMode];
    const appleMode = { walk:'w', transit:'r', drive:'d', bike:'w' }[dirMode];
    const gMode = { walk:'walking', transit:'transit', drive:'driving', bike:'bicycling' }[dirMode];

    // AMap: needs coordinates for both ends; omitting "from" means current location
    const amap = $('lnk-amap');
    if (has){
      let u = 'https://uri.amap.com/navigation?to=' + p.lng + ',' + p.lat + ',' + q(label) +
              '&mode=' + amapMode + '&policy=0&coordinate=gaode&callnative=1&src=shanghai-guide';
      if (from) u += '&from=' + from.lng + ',' + from.lat + ',' + q(from.zh || from.name);
      amap.href = u; amap.hidden = false;
      amap.querySelector('.lbl').textContent = fromText ? '高德 AMap · directions (uses current location)' : '高德 AMap · directions';
    } else { amap.hidden = true; }
    $('lnk-amap-search').href =
      'https://uri.amap.com/search?keyword=' + q(p.searchName || p.zh || p.name) + '&city=310000&callnative=1&src=shanghai-guide';

    const dest = has ? (p.lat + ',' + p.lng) : (p.addr || p.name) + ', Shanghai';
    let apple = 'https://maps.apple.com/?daddr=' + q(dest) + '&dirflg=' + appleMode;
    let google = 'https://www.google.com/maps/dir/?api=1&destination=' + q(dest) + '&travelmode=' + gMode;
    if (from){ apple += '&saddr=' + from.lat + ',' + from.lng; google += '&origin=' + from.lat + ',' + from.lng; }
    else if (fromText){ apple += '&saddr=' + q(fromText + ', Shanghai'); google += '&origin=' + q(fromText + ', Shanghai'); }
    $('lnk-apple').href = apple;
    $('lnk-google').href = google;
  }

  /* ---------- Add-a-find sheet ---------- */
  let picking = false, pickMarker = null, picker = null;
  function clearPickMarker(){ if (pickMarker && map){ map.removeLayer(pickMarker); } pickMarker = null; }
  const addSheet = makeSheet($('add-sheet-backdrop'), $('add-sheet'), () => { if (!picking) clearPickMarker(); });
  const addForm = $('add-form');
  const catSelect = $('f-cat');

  Object.keys(CATEGORIES).forEach(key => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = CATEGORIES[key].label;
    catSelect.appendChild(opt);
  });

  $('add-btn').addEventListener('click', () => { dismissQuick(true); addSheet.open(); });
  $('cancel-add').addEventListener('click', () => { addSheet.close(); });

  // ---- location: GPS (converted to the map's coordinate system), tap on the map, or typed
  // China's maps are drawn in GCJ-02, a deliberately shifted system. A phone's GPS reports plain WGS-84, so it must be
  // converted or the pin lands ~500 m away from where you stood. (Same formula used to line up the road names.)
  function outOfChina(lat, lng){ return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271; }
  function tLat(x, y){ let r = -100 + 2*x + 3*y + .2*y*y + .1*x*y + .2*Math.sqrt(Math.abs(x)); r += (20*Math.sin(6*x*Math.PI) + 20*Math.sin(2*x*Math.PI))*2/3; r += (20*Math.sin(y*Math.PI) + 40*Math.sin(y/3*Math.PI))*2/3; r += (160*Math.sin(y/12*Math.PI) + 320*Math.sin(y*Math.PI/30))*2/3; return r; }
  function tLng(x, y){ let r = 300 + x + 2*y + .1*x*x + .1*x*y + .1*Math.sqrt(Math.abs(x)); r += (20*Math.sin(6*x*Math.PI) + 20*Math.sin(2*x*Math.PI))*2/3; r += (20*Math.sin(x*Math.PI) + 40*Math.sin(x/3*Math.PI))*2/3; r += (150*Math.sin(x/12*Math.PI) + 300*Math.sin(x*Math.PI/30))*2/3; return r; }
  function wgs2gcj(lat, lng){
    if (outOfChina(lat, lng)) return [lat, lng];
    const a = 6378245.0, ee = 0.00669342162296594323;
    let dLat = tLat(lng - 105, lat - 35), dLng = tLng(lng - 105, lat - 35);
    const rad = lat / 180 * Math.PI; let m = Math.sin(rad); m = 1 - ee * m * m; const sm = Math.sqrt(m);
    dLat = (dLat * 180) / ((a * (1 - ee)) / (m * sm) * Math.PI);
    dLng = (dLng * 180) / (a / sm * Math.cos(rad) * Math.PI);
    return [lat + dLat, lng + dLng];
  }
  const locReadout = $('loc-readout');
  function showLoc(msg, cls){ locReadout.textContent = msg; locReadout.className = 'loc-readout' + (cls ? ' ' + cls : ''); }
  function setLoc(lat, lng, source){
    $('f-lat').value = lat.toFixed(6); $('f-lng').value = lng.toFixed(6);
    showLoc(lat.toFixed(5) + ', ' + lng.toFixed(5) + ' · ' + source, 'ok');
    clearPickMarker();
    if (map) pickMarker = L.marker([lat, lng], { icon: pinIcon(catSelect.value, true), keyboard:false, interactive:false, zIndexOffset:2000 }).addTo(map);
  }
  function resetLoc(){ showLoc('No location yet'); clearPickMarker(); }
  function syncTyped(){
    const lat = parseFloat($('f-lat').value), lng = parseFloat($('f-lng').value);
    if (isFinite(lat) && isFinite(lng)){
      if (!inArea(lat, lng)) showLoc('That’s outside the Shanghai area this guide covers.', 'err');
      else showLoc(lat.toFixed(5) + ', ' + lng.toFixed(5) + ' · typed', 'ok');
    } else showLoc('No location yet');
  }
  $('f-lat').addEventListener('input', syncTyped); $('f-lng').addEventListener('input', syncTyped);

  $('loc-gps').addEventListener('click', () => {
    if (!navigator.geolocation){ showLoc('This device can’t share its location. Pick on the map instead.', 'err'); return; }
    showLoc('Finding you…');
    navigator.geolocation.getCurrentPosition(pos => {
      const g = wgs2gcj(pos.coords.latitude, pos.coords.longitude);
      if (!inArea(g[0], g[1])){ showLoc('You’re not in Shanghai right now, so your location can’t be used for this spot. Use “Pick on map” instead.', 'err'); return; }
      setLoc(g[0], g[1], 'my location (±' + Math.round(pos.coords.accuracy) + ' m)');
      if (map) map.setView(g, Math.max(map.getZoom(), 16), { animate:false });
    }, err => {
      showLoc(err && err.code === 1 ? 'Location is switched off for this app. Turn it on in Settings, or pick on the map.' : 'Couldn’t get your location. Try again, or pick on the map.', 'err');
    }, { enableHighAccuracy:true, timeout:15000, maximumAge:30000 });
  });

  // ---- pick on map: a glowing pin hovers over the target. Tap the map (or hold + drag the pin) to move it; tap the pin to confirm.
  function nearestMetro(ll){
    let best = null;
    METRO_STATIONS.forEach(s => { const d = distanceM([ll.lat, ll.lng], [s[1], s[2]]); if (!best || d < best.d) best = { d, name:s[0] }; });
    return best;
  }
  function pickInfo(){
    if (!picker) return;
    const ll = picker.getLatLng(), nm = nearestMetro(ll);
    $('pk-info').textContent = ll.lat.toFixed(5) + ', ' + ll.lng.toFixed(5) + (nm ? ' · ' + fmtDist(nm.d) + ' from ' + nm.name + ' metro' : '') + (map.getZoom() < 16 ? ' · zoom in to be more precise' : '');
  }
  const PIN_PATH = '<path d="M17 40C15 36 4.5 27.5 3.5 16A13.5 13.5 0 1 1 30.5 16C29.5 27.5 19 36 17 40z"';
  function pickerIcon(quick){
    const c = quick ? { color:'#5B86EE', ink:'#2F5BCB' } : (CATEGORIES[catSelect.value] || CATEGORIES.other);
    return L.divIcon({
      className:'pk-icon', iconSize:[44, 60], iconAnchor:[22, 54],
      html:'<div class="pk"><i class="pk-glow"></i><i class="pk-ground"></i><div class="pk-float">' +
        (quick ? '<div class="pk-callout"><button type="button" class="pk-add" data-quick-add>Add spot</button></div>' : '') +
        '<svg class="pk-pin" viewBox="0 0 34 42" aria-hidden="true">' + PIN_PATH + ' fill="' + c.color + '" stroke="' + c.ink + '" stroke-opacity=".6" stroke-width="1.8" stroke-linejoin="round"/><circle cx="17" cy="16" r="5.5" fill="#fff"/></svg></div></div>'
    });
  }
  const pkEl = () => picker && picker.getElement() && picker.getElement().querySelector('.pk');
  function hop(){ const e = pkEl(); if (!e) return; e.classList.remove('drop'); void e.offsetWidth; e.classList.add('drop'); }
  function startPick(){
    if (!map) { showLoc('The map isn’t available right now.', 'err'); return; }
    dismissQuick(true); picking = true; addSheet.close(); map.closePopup();
    if (isMobile()) switchTab('map');
    const lat = parseFloat($('f-lat').value), lng = parseFloat($('f-lng').value);
    const start = isFinite(lat) && isFinite(lng) && inArea(lat, lng) ? L.latLng(lat, lng) : map.getCenter();
    if (isFinite(lat) && isFinite(lng) && inArea(lat, lng)) map.setView(start, Math.max(map.getZoom(), 16), { animate:false });
    clearPickMarker();
    picker = L.marker(start, { icon:pickerIcon(), pane:'pickPane', draggable:true, autoPan:true, autoPanPadding:[70, 90], keyboard:false }).addTo(map);
    picker.on('dragstart', () => { const e = pkEl(); if (e) e.classList.add('lift'); });
    picker.on('drag', pickInfo);
    picker.on('dragend', () => { const e = pkEl(); if (e) e.classList.remove('lift'); pickInfo(); });
    picker.on('click', confirmPick);                                   // a plain tap on the pin confirms (dragging never fires 'click')
    $('pickbar').hidden = false; $('map').classList.add('picking');
    pickInfo(); hop();
  }
  function endPick(reopen){
    picking = false; $('pickbar').hidden = true; $('map').classList.remove('picking');
    if (picker){ map.removeLayer(picker); picker = null; }
    if (reopen) addSheet.open();
  }
  function confirmPick(){
    if (!picker) return;
    const ll = picker.getLatLng();
    endPick(false);
    setLoc(ll.lat, ll.lng, 'picked on map');
    addSheet.open();
  }
  function movePicker(ll){ if (!picker) return; picker.setLatLng(ll); pickInfo(); hop(); }
  $('loc-pick').addEventListener('click', startPick);
  $('pick-cancel').addEventListener('click', () => endPick(true));
  $('pick-ok').addEventListener('click', confirmPick);
  document.addEventListener('keydown', e => { if (!picking) return; if (e.key === 'Enter'){ e.preventDefault(); confirmPick(); } else if (e.key === 'Escape') endPick(true); });

  // ---- sharing: see the Sync block below (spots and photos are sent automatically once a key is set)
  function sharePlace(){ syncKey() ? syncNow(true) : openSync(); }
  async function retryPlace(id){
    const p = userPlaces.find(x => x.id === id); if (!p) return;
    delete p.rejected; delete p.issue; delete p.closed; await saveUserPlaces(); renderList(); syncNow(true);
  }
  async function removeLocalPlace(id){
    const p = userPlaces.find(x => x.id === id); if (!p) return;
    if (!window.confirm('Delete “' + p.name + '” from this phone?')) return;
    userPlaces = userPlaces.filter(x => x.id !== id);
    if (selectedId === id) selectedId = null;
    await saveUserPlaces(); dropPhotosFor(id); render();
  }
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-share]');
    if (b) sharePlace(b.getAttribute('data-share'));
  });

  addForm.addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('f-name').value.trim();
    if (!name) return;
    const lat = parseFloat($('f-lat').value);
    const lng = parseFloat($('f-lng').value);
    if (isFinite(lat) && isFinite(lng) && !inArea(lat, lng)){ showLoc('That’s outside the Shanghai area this guide covers, so it can’t be pinned. Pick a spot on the map instead.', 'err'); return; }
    const place = {
      id: 'u-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      name: name,
      zh: $('f-zh').value.trim(),
      cat: catSelect.value,
      district: $('f-district').value.trim() || "Unsorted",
      addr: $('f-addr').value.trim(),
      note: $('f-note').value.trim(),
      lat: isFinite(lat) ? lat : null,
      lng: isFinite(lng) ? lng : null,
      approx: false,
      userAdded: true
    };
    userPlaces.push(place);
    await saveUserPlaces();
    addForm.reset(); resetLoc();
    addSheet.close();
    render();
    if (syncKey()){ toast('Saved. Sending it to the guide…'); syncNow(); }
    else toast('Saved on this phone. Add the sync key to share it.', { action:'Add key', ms:9000, onAction: openSync });
  });

  /* ---------- Where am I: a live "you are here" dot. GPS needs no internet, so this works offline in China ---------- */
  const toast = (msg, opts) => { if (window.sgToast) window.sgToast(msg, opts); };
  const AREA = { latMin:30.4, latMax:32.0, lngMin:120.6, lngMax:122.4 };            // the Shanghai area this guide covers
  const inArea = (lat, lng) => lat >= AREA.latMin && lat <= AREA.latMax && lng >= AREA.lngMin && lng <= AREA.lngMax;
  let me = null, watchId = null, meMarker = null, meCircle = null, meDemo = false, sortNearest = false, lastSortPos = null, geoNoteShown = false;

  function distanceM(a, b){
    const dx = (b[1] - a[1]) * Math.cos((a[0] + b[0]) * Math.PI / 360) * 111320, dy = (b[0] - a[0]) * 110860;
    return Math.hypot(dx, dy);
  }
  function fmtDist(m){ return m < 950 ? Math.max(10, Math.round(m / 10) * 10) + ' m' : (m < 9950 ? (m / 1000).toFixed(1) : Math.round(m / 1000)) + ' km'; }
  function distTextFor(p){
    if (!me || !p.lat || !p.lng) return '';
    const d = distanceM([me.lat, me.lng], [p.lat, p.lng]);
    return fmtDist(d) + ' away' + (d <= 2500 ? ' · ' + Math.max(1, Math.round(d / 80)) + ' min walk' : '');
  }
  function distHtml(cls, p){
    const t = distTextFor(p);
    return '<div class="' + cls + '" data-dist="' + esc(p.id) + '"' + (t ? '' : ' hidden') + '>' + esc(t) + '</div>';
  }
  function updateDistances(){
    document.querySelectorAll('[data-dist]').forEach(el => {
      const p = findPlace(el.getAttribute('data-dist')), t = p ? distTextFor(p) : '';
      el.textContent = t; el.hidden = !t;
    });
  }
  function setLocateState(s){
    const b = $('locate-btn');
    b.dataset.state = s; b.setAttribute('aria-pressed', s === 'on' ? 'true' : 'false');
    b.title = s === 'on' ? 'Recentre on me (tap again when centred to switch off)' : s === 'locating' ? 'Finding you…' : 'Show where I am';
  }
  function drawMe(){
    if (!map || !me) return;
    const ll = [me.lat, me.lng], r = Math.min(me.acc || 30, 300);
    if (!meMarker || meDemo !== me.demo){
      if (meMarker) map.removeLayer(meMarker);
      meMarker = L.marker(ll, { icon: L.divIcon({ className:'me-icon', html:'<div class="me-dot"><i></i></div>' + (me.demo ? '<span class="me-tag">Demo</span>' : ''), iconSize:[22,22], iconAnchor:[11,11] }), interactive:false, keyboard:false, zIndexOffset:3000 }).addTo(map);
      meDemo = me.demo;
    } else meMarker.setLatLng(ll);
    if (!meCircle) meCircle = L.circle(ll, { radius:r, stroke:false, fillColor:'#3B82F6', fillOpacity:.13, interactive:false }).addTo(map);
    else meCircle.setLatLng(ll).setRadius(r);
  }
  function stopLocate(clear){
    if (watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
    watchId = null; geoNoteShown = false;
    if (clear){
      me = null;
      if (meMarker){ map.removeLayer(meMarker); meMarker = null; }
      if (meCircle){ map.removeLayer(meCircle); meCircle = null; }
      const wasNearest = sortNearest; sortNearest = false;
      updateDistances();
      if (wasNearest){ buildChips(); renderList(); }
    }
    setLocateState('off');
  }
  function afterFix(first){
    drawMe(); updateDistances();
    if (sortNearest && me && (!lastSortPos || distanceM(lastSortPos, [me.lat, me.lng]) > 60)){ lastSortPos = [me.lat, me.lng]; renderList(); }
    if (first && map) map.setView([me.lat, me.lng], Math.max(map.getZoom(), 16), { animate:false });
  }
  function onFix(pos){
    const g = wgs2gcj(pos.coords.latitude, pos.coords.longitude);          // GPS reports plain WGS-84; the map is GCJ-02
    if (!inArea(g[0], g[1])){ stopLocate(true); notInShanghai(); return; }
    const first = !me;
    me = { lat:g[0], lng:g[1], acc:pos.coords.accuracy || 30, demo:false };
    setLocateState('on');
    afterFix(first);
    if (first) toast('Location on. Tap the arrow again to recentre, and once more when centred to switch off.', { ms:5500 });
  }
  function onGeoError(err){
    if (err && err.code === 1){
      stopLocate(true);
      toast('Location is switched off for this app. On iPhone: Settings → Privacy & Security → Location Services → allow it for Safari Websites, then try again.', { ms:10000 });
      return;
    }
    if (!geoNoteShown){ geoNoteShown = true; toast('Still looking for a GPS signal. It works without internet but can take a minute, ideally outdoors.', { ms:6500 }); }
  }
  function startLocate(){
    if (!navigator.geolocation){ toast('This device can’t share its location.'); if (sortNearest){ sortNearest = false; buildChips(); renderList(); } return; }
    if (watchId != null) return;
    setLocateState('locating');
    watchId = navigator.geolocation.watchPosition(onFix, onGeoError, { enableHighAccuracy:true, maximumAge:5000, timeout:30000 });
  }
  function notInShanghai(){
    toast('You’re not in Shanghai right now, so there’s nothing to show yet. Try a demo to see how it will look.', { action:'Try demo', ms:12000, onAction: startDemo });
  }
  function startDemo(){
    const st = METRO_STATIONS.find(s => s[0] === "People's Square") || METRO_STATIONS[0];
    stopLocate(false);
    me = { lat:st[1], lng:st[2], acc:25, demo:true };
    setLocateState('on');
    afterFix(true);
    toast('Demo location: People’s Square. Tap the arrow twice to switch it off.', { ms:6000 });
  }
  function toggleNearest(){
    if (sortNearest){ sortNearest = false; buildChips(); renderList(); return; }
    sortNearest = true; lastSortPos = null;
    if (!me) startLocate(); else lastSortPos = [me.lat, me.lng];
    buildChips(); renderList();
  }
  $('locate-btn').addEventListener('click', () => {
    if (!me){ if (watchId == null) startLocate(); return; }
    const c = map.latLngToContainerPoint([me.lat, me.lng]), mid = map.getSize().divideBy(2);
    if (c.distanceTo(mid) < 40 && map.getZoom() >= 15){ stopLocate(true); return; }     // already centred: this tap switches it off
    map.setView([me.lat, me.lng], Math.max(map.getZoom(), 16), { animate:true });
  });

  // ---- hold the map (finger or mouse) or right-click: a glowing pin with an "Add spot" bubble floats there and stays until you
  // ---- touch somewhere else. Drag it to fine-tune. Only tapping "Add spot" moves on to the details.
  let quick = null, quickAt = 0, lpTimer = 0, lpStart = null;
  const LP_MS = 520, LP_SLOP = 10;
  function dismissQuick(now){
    if (!quick) return;
    const q = quick; quick = null;
    const e = q.getElement(), pk = e && e.querySelector('.pk');
    if (now || !pk){ map.removeLayer(q); return; }
    pk.classList.add('out');                                             // same path back out: fade + settle, then remove
    setTimeout(() => map.removeLayer(q), 180);
  }
  function startQuick(ll){
    if (!map || picking) return;
    dismissQuick(true); map.closePopup();
    quickAt = Date.now();
    const q = L.marker(ll, { icon:pickerIcon(true), pane:'pickPane', draggable:true, autoPan:true, autoPanPadding:[70, 90], keyboard:false }).addTo(map);
    quick = q;
    q.on('dragstart', () => { const e = q.getElement(), pk = e && e.querySelector('.pk'); if (pk) pk.classList.add('lift'); });
    q.on('dragend', () => { const e = q.getElement(), pk = e && e.querySelector('.pk'); if (pk) pk.classList.remove('lift'); });
    const pk = q.getElement() && q.getElement().querySelector('.pk'); if (pk) pk.classList.add('drop');
  }
  function armLongPress(){
    const el = map.getContainer();
    const cancel = e => { if (lpStart && (!e || e.pointerId === lpStart.id)){ clearTimeout(lpTimer); lpStart = null; } };
    el.addEventListener('pointerdown', e => {
      // touching anywhere that isn't the floating pin dismisses it (so a pan or tap elsewhere starts clean)
      if (quick && !e.target.closest('.pk-icon, .leaflet-control, .map-fab, .map-legend, .pickbar')) dismissQuick();
      if (lpStart) cancel();                                              // a second finger (pinch) is not a hold
      if (picking || (e.pointerType === 'mouse' && e.button !== 0)) return;
      if (e.target.closest('.leaflet-marker-icon, .leaflet-control, .leaflet-popup, .leaflet-tooltip, .map-fab, .map-legend, .pickbar')) return;
      lpStart = { x:e.clientX, y:e.clientY, id:e.pointerId };
      clearTimeout(lpTimer);
      lpTimer = setTimeout(() => {
        if (!lpStart) return;
        const ll = map.mouseEventToLatLng({ clientX:lpStart.x, clientY:lpStart.y }); lpStart = null;
        startQuick(ll);
      }, LP_MS);
    });
    el.addEventListener('pointermove', e => { if (lpStart && Math.hypot(e.clientX - lpStart.x, e.clientY - lpStart.y) > LP_SLOP) cancel(e); });
    el.addEventListener('pointerup', cancel);
    el.addEventListener('pointercancel', cancel);
  }
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-quick-add]');
    if (!b || !quick) return;
    const ll = quick.getLatLng();
    dismissQuick(true);
    setLoc(ll.lat, ll.lng, 'picked on map'); addSheet.open();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && quick) dismissQuick(); });

  const STORAGE_KEY = 'shanghai-eats-user-places';

  async function saveUserPlaces(){
    // Prefer window.storage when this file is opened inside a Claude artifact;
    // fall back to localStorage so the file also works as a plain HTML page
    // opened directly in a browser or saved to a phone.
    try{
      if (window.storage && typeof window.storage.set === 'function'){
        await window.storage.set('user-places', JSON.stringify(userPlaces), false);
        return;
      }
    } catch(err){ /* fall through to localStorage */ }
    try{
      localStorage.setItem(STORAGE_KEY, JSON.stringify(userPlaces));
    } catch(err){
      console.error('Could not save places', err);
    }
  }

  async function loadUserPlaces(){
    try{
      if (window.storage && typeof window.storage.get === 'function'){
        const result = await window.storage.get('user-places', false);
        if (result && result.value){
          userPlaces = JSON.parse(result.value);
          return;
        }
      }
    } catch(err){ /* fall through to localStorage */ }
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      userPlaces = raw ? JSON.parse(raw) : [];
      const before = userPlaces.length;
      userPlaces = userPlaces.filter(p => !sharedIds.has(p.id));          // they have arrived as shared spots: drop the local copy
      if (userPlaces.length !== before) localStorage.setItem(STORAGE_KEY, JSON.stringify(userPlaces));
    } catch(err){
      userPlaces = [];
    }
  }

  /* ---------- Photos: taken or picked on this phone, shrunk, kept in IndexedDB ---------- */
  const photosBySpot = {};                       // spotId -> [{ id, spot, order, at, thumb, full, thumbUrl }] (cover first)
  let photoDb = null;
  let photoSpot = null;                          // the spot whose photo sheet is open
  const CAM_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8.5h3l1.6-2.5h6.8L17 8.5h3a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.4" r="3.6"/></svg>';
  const PLUS_CAM_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8.5h3l1.6-2.5h6.8L17 8.5h3a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1z"/><path d="M12 10.9v5M9.5 13.4h5"/></svg>';

  const localPhotos = id => photosBySpot[id] || [];
  const sharedPhotoIds = new Set(Object.values(SHARED_PHOTOS).flat().map(p => p.id));
  const removedIds = () => new Set(readJson(REMOVALS_KEY, []).map(r => r.id));
  // this phone's own photos first (full quality), then the ones anyone shared with the guide (~800 px)
  function photoList(id){
    const mine = localPhotos(id), gone = removedIds();
    const theirs = (SHARED_PHOTOS[id] || []).filter(s => !gone.has(s.id) && !mine.some(r => r.id === s.id))
      .map(s => ({ id:s.id, spot:id, shared:true, by:s.by, thumbUrl:'photos/' + s.id + '.jpg', fullUrl:'photos/' + s.id + '.jpg' }));
    return mine.concat(theirs);
  }
  function coverHtml(id, cls, attr){
    const l = photoList(id); if (!l.length) return '';
    return '<button type="button" class="' + cls + '" ' + attr + ' aria-label="Photos"><img src="' + l[0].thumbUrl + '" alt="" decoding="async">' +
      (l.length > 1 ? '<span class="pc-n">' + l.length + '</span>' : '') + '</button>';
  }
  function photoBtnHtml(id, attr){
    const n = photoList(id).length;
    return '<button type="button" class="dir-btn ph-btn' + (n ? '' : ' icon') + '" ' + attr + ' aria-label="' + (n ? n + (n > 1 ? ' photos' : ' photo') : 'Add photos') + '">' + CAM_SVG + (n ? n : '') + '</button>';
  }

  function idbDone(tx){ return new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = tx.onabort = () => rej(tx.error || new Error('db')); }); }
  function openPhotoDb(){
    return new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error('IndexedDB missing'));
      const r = indexedDB.open('shanghai-guide-photos', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('photos', { keyPath:'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  function indexPhoto(rec){
    rec.thumbUrl = URL.createObjectURL(rec.thumb);
    (photosBySpot[rec.spot] = photosBySpot[rec.spot] || []).push(rec);
    photosBySpot[rec.spot].sort((x, y) => x.order - y.order);
  }
  async function loadPhotos(){
    try{
      photoDb = await openPhotoDb();
      const all = await new Promise((res, rej) => { const q = photoDb.transaction('photos').objectStore('photos').getAll(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
      all.forEach(indexPhoto);
    } catch(err){ photoDb = null; console.warn('Photos unavailable', err); }
  }
  function dropPhotosFor(spot){
    const l = photosBySpot[spot]; if (!l || !photoDb) return;
    delete photosBySpot[spot];
    const tx = photoDb.transaction('photos', 'readwrite');
    l.forEach(r => { tx.objectStore('photos').delete(r.id); URL.revokeObjectURL(r.thumbUrl); });
  }

  // decode once, then draw a big copy (for the viewer) and a small one (for cards)
  async function shrinkPhoto(file){
    const url = URL.createObjectURL(file);
    try{
      const img = new Image();
      img.src = url;
      await img.decode();
      const draw = (max, q) => {
        const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * s)); c.height = Math.max(1, Math.round(img.naturalHeight * s));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('encode')), 'image/jpeg', q));
      };
      return { full: await draw(1600, .82), thumb: await draw(640, .8) };
    } finally { URL.revokeObjectURL(url); }
  }

  function refreshSpot(id){
    renderList();
    const m = markers[id], pop = m && m.getPopup && m.getPopup();
    if (pop && pop.isOpen()) pop.update();
    if (photoSpot === id) renderPhotoSheet();
  }

  async function addPhotos(spot, files){
    if (!photoDb){ toast('Photos can’t be saved in this browser.'); return; }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    const grid = $('ph-grid'); grid.classList.add('ph-busy');
    let ok = 0, bad = 0;
    for (const file of files){
      try{
        const v = await shrinkPhoto(file);
        const l = localPhotos(spot);
        const rec = { id:'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), spot, order:(l.length ? l[l.length - 1].order : 0) + 1, at:new Date().toISOString(), full:v.full, thumb:v.thumb };
        const tx = photoDb.transaction('photos', 'readwrite'); tx.objectStore('photos').put(rec); await idbDone(tx);
        indexPhoto(rec); ok++;
      } catch(err){ bad++; console.warn('photo failed', err); }
    }
    grid.classList.remove('ph-busy');
    if (bad) toast(bad === 1 && !ok ? 'Couldn’t read that photo.' : bad + ' photo' + (bad > 1 ? 's' : '') + ' couldn’t be read.');
    refreshSpot(spot);
    if (ok) syncNow();
  }
  async function removePhoto(rec){
    if (!rec.shared){
      const tx = photoDb.transaction('photos', 'readwrite'); tx.objectStore('photos').delete(rec.id); await idbDone(tx);
      URL.revokeObjectURL(rec.thumbUrl);
      photosBySpot[rec.spot] = localPhotos(rec.spot).filter(r => r !== rec);
      if (!photosBySpot[rec.spot].length) delete photosBySpot[rec.spot];
    }
    if (rec.shared || rec.sent || sharedPhotoIds.has(rec.id)){        // it is (or is about to be) in the guide: remove it there too
      const l = readJson(REMOVALS_KEY, []); l.push({ id:rec.id }); writeJson(REMOVALS_KEY, l); syncNow();
    }
    refreshSpot(rec.spot);
  }
  async function makeCover(rec){
    const l = localPhotos(rec.spot);
    rec.order = (l.length ? l[0].order : 0) - 1;
    await putRec(rec);
    l.sort((x, y) => x.order - y.order);
    refreshSpot(rec.spot);
  }

  /* action sheet (Take Photo / Choose from Library, Delete) */
  const menuBack = $('ph-menu-backdrop');
  function showMenu(items){
    $('ph-menu-items').innerHTML = items.map((it, i) =>
      '<button type="button" data-i="' + i + '"' + (it.destructive ? ' class="destructive"' : '') + '>' + (it.hint ? '<small>' + esc(it.hint) + '</small>' : '') + esc(it.label) + '</button>').join('');
    menuBack._items = items;
    menuBack.classList.add('open'); menuBack.setAttribute('aria-hidden', 'false');
  }
  function hideMenu(){ menuBack.classList.remove('open'); menuBack.setAttribute('aria-hidden', 'true'); }
  menuBack.addEventListener('pointerdown', e => { if (e.target === menuBack) hideMenu(); });
  $('ph-menu-cancel').addEventListener('click', hideMenu);
  $('ph-menu-items').addEventListener('click', e => {
    const b = e.target.closest('button[data-i]'); if (!b) return;
    const it = menuBack._items[+b.dataset.i];
    hideMenu();
    if (it && it.run) it.run();                 // runs inside the tap, so iOS lets the file picker open
  });

  /* photo sheet: a grid of this spot's photos + "Add Photo" */
  const photoSheet = makeSheet($('photo-backdrop'), $('photo-sheet'), () => { photoSpot = null; });
  $('ph-close').addEventListener('click', () => photoSheet.close());
  function openPhotos(id){
    const p = findPlace(id); if (!p) return;
    photoSpot = id;
    $('ph-name').textContent = p.name; $('ph-zh').textContent = p.zh || ''; $('ph-zh').hidden = !p.zh;
    renderPhotoSheet();
    photoSheet.open();
  }
  function renderPhotoSheet(){
    const l = photoList(photoSpot);
    $('ph-grid').innerHTML = l.map((r, i) =>
      '<button type="button" class="ph-tile" data-i="' + i + '" aria-label="Photo ' + (i + 1) + ' of ' + l.length + '"><img src="' + r.thumbUrl + '" alt="" decoding="async">' + (i === 0 && l.length > 1 ? '<span class="ph-cover-pill">Cover</span>' : '') + '</button>').join('') +
      '<button type="button" class="ph-tile ph-add" data-add>' + PLUS_CAM_SVG + (l.length ? 'Add' : 'Add Photo') + '</button>';
    $('ph-note').textContent = !photoDb ? 'Photos can’t be saved in this browser.'
      : (l.length ? 'Tap a photo to view it. The first photo is the cover shown on the card.' : 'Take a photo now or pick one from your library. It is saved on this phone first, so it works offline too.') + photoSyncNote();
  }
  $('ph-grid').addEventListener('click', e => {
    if (e.target.closest('[data-add]')){ askForPhoto(); return; }
    const t = e.target.closest('.ph-tile[data-i]'); if (t) openViewer(+t.dataset.i);
  });
  function askForPhoto(){
    if (!photoDb){ toast('Photos can’t be saved in this browser.'); return; }
    const spot = photoSpot;
    showMenu([
      { label:'Take Photo', run: () => { $('ph-in-camera')._spot = spot; $('ph-in-camera').click(); } },
      { label:'Choose from Library', run: () => { $('ph-in-library')._spot = spot; $('ph-in-library').click(); } }
    ]);
  }
  ['ph-in-camera', 'ph-in-library'].forEach(id => $(id).addEventListener('change', e => {
    const inp = e.target, files = Array.from(inp.files || []), spot = inp._spot || photoSpot;
    inp.value = '';
    if (files.length && spot) addPhotos(spot, files);
  }));
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-photos]');
    if (b) openPhotos(b.getAttribute('data-photos'));
  });

  /* full-screen viewer: swipe between photos, make cover, delete */
  const viewer = $('ph-viewer'), vTrack = $('ph-v-track');
  let vUrls = [], vIndex = 0;
  function buildViewer(at){
    vUrls.forEach(u => u.startsWith('blob:') && URL.revokeObjectURL(u));
    const l = photoList(photoSpot);
    vUrls = l.map(r => r.full ? URL.createObjectURL(r.full) : r.fullUrl);
    vTrack.innerHTML = vUrls.map(u => '<div class="ph-v-slide"><img src="' + u + '" alt=""></div>').join('');
    vIndex = Math.max(0, Math.min(at, l.length - 1));
    vTrack.style.scrollBehavior = 'auto';
    vTrack.scrollLeft = vIndex * vTrack.clientWidth;
    vTrack.style.scrollBehavior = '';
    syncViewer();
  }
  function syncViewer(){
    const n = photoList(photoSpot).length;
    $('ph-v-count').textContent = n > 1 ? (vIndex + 1) + ' of ' + n : '';
    const rec = photoList(photoSpot)[vIndex];
    $('ph-v-cover').hidden = vIndex === 0 || !rec || !!rec.shared;                      // only this phone's own photos can be reordered
  }
  function openViewer(i){
    viewer.classList.add('open'); viewer.setAttribute('aria-hidden', 'false');
    buildViewer(i);
    $('ph-v-close').focus({ preventScroll:true });
  }
  function closeViewer(){
    viewer.classList.remove('open'); viewer.setAttribute('aria-hidden', 'true');
    vUrls.forEach(u => u.startsWith('blob:') && URL.revokeObjectURL(u)); vUrls = []; vTrack.innerHTML = '';
  }
  const viewerAt = () => Math.max(0, Math.min(photoList(photoSpot).length - 1, Math.round(vTrack.scrollLeft / Math.max(1, vTrack.clientWidth))));
  vTrack.addEventListener('scroll', debounce(() => { const i = viewerAt(); if (i !== vIndex){ vIndex = i; syncViewer(); } }, 60), { passive:true });
  $('ph-v-close').addEventListener('click', closeViewer);
  $('ph-v-cover').addEventListener('click', async () => {
    const rec = photoList(photoSpot)[vIndex = viewerAt()]; if (!rec) return;
    await makeCover(rec); buildViewer(0);
  });
  $('ph-v-delete').addEventListener('click', () => {
    const rec = photoList(photoSpot)[vIndex = viewerAt()]; if (!rec) return;
    const inGuide = rec.shared || rec.sent || sharedPhotoIds.has(rec.id);
    showMenu([{ label:'Delete Photo', destructive:true, hint:inGuide ? 'This photo will be removed for everyone.' : 'This photo will be removed from this phone.', run: async () => {
      const at = vIndex; await removePhoto(rec);
      if (!photoList(photoSpot).length) closeViewer(); else buildViewer(at);
    } }]);
  });
  window.addEventListener('keydown', e => {                       // Esc peels back one layer at a time
    if (e.key !== 'Escape') return;
    if (menuBack.classList.contains('open')){ hideMenu(); e.stopPropagation(); }
    else if (viewer.classList.contains('open')){ closeViewer(); e.stopPropagation(); }
  }, true);

  /* ---------- Sync: spots and photos leave the phone by themselves once a sync key is set ----------
     Each thing is saved on the phone first. With a key and a connection, the app files a GitHub issue for it; a GitHub job
     (tools/inbox.py) checks it and adds it to the guide, and everyone gets it with their next update. */
  const KEY_LS = 'sg-sync-key', NAME_LS = 'sg-sync-name', REMOVALS_KEY = 'sg-photo-removals';
  function readJson(k, d){ try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch(e){ return d; } }
  function writeJson(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); } catch(e){} }
  const lsGet = k => { try{ return (localStorage.getItem(k) || '').trim(); } catch(e){ return ''; } };
  const lsSet = (k, v) => { try{ v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch(e){} };
  const syncKey = () => lsGet(KEY_LS);
  const syncName = () => lsGet(NAME_LS);
  let syncBusy = false, syncErr = null, syncTouched = false;        // syncErr: 'key' | 'perm' | 'net' | null
  const wait = ms => new Promise(r => setTimeout(r, ms));

  class SyncError extends Error { constructor(code, msg){ super(msg); this.code = code; } }
  async function gh(method, path, body){
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 25000);
    let r;
    try{
      r = await fetch('https://api.github.com' + path, { method, signal:ctl.signal, body: body ? JSON.stringify(body) : undefined,
        headers: Object.assign({ 'Authorization':'Bearer ' + syncKey(), 'Accept':'application/vnd.github+json', 'X-GitHub-Api-Version':'2022-11-28' }, body ? { 'Content-Type':'application/json' } : {}) });
    } catch(e){ throw new SyncError('net', 'Can’t reach GitHub right now.'); }
    finally { clearTimeout(t); }
    if (r.status === 401) throw new SyncError('key', 'GitHub doesn’t accept this key. It may be mistyped or expired.');
    if (r.status === 429 || (r.status === 403 && (r.headers.get('x-ratelimit-remaining') === '0' || r.headers.get('retry-after')))) throw new SyncError('net', 'GitHub asked us to slow down. It will retry.');
    if (r.status === 403 || r.status === 404) throw new SyncError('perm', 'This key can’t post to the guide. It needs “Issues: Read and write” on the shanghai-guide repository.');
    if (!r.ok) throw new SyncError('net', 'GitHub answered with an error (' + r.status + '). It will retry.');
    return r.status === 204 ? null : r.json();
  }
  async function postIssue(title, payload){
    const n = syncName();
    const body = 'Sent from the Shanghai Guide app.\n\n```json\n' + JSON.stringify(n ? Object.assign({ who:n }, payload) : payload) + '\n```\n';
    return (await gh('POST', '/repos/' + SHARE_REPO + '/issues', { title, body })).number;
  }
  async function putRec(rec){
    const clean = Object.assign({}, rec); delete clean.thumbUrl;
    const tx = photoDb.transaction('photos', 'readwrite'); tx.objectStore('photos').put(clean); await idbDone(tx);
  }

  // the copy that goes to the guide has to fit inside one GitHub issue (~56 KB of text), so it is smaller than the local one
  const blobToBase64 = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
  async function shareableJpeg(blob){
    const url = URL.createObjectURL(blob);
    try{
      const img = new Image(); img.src = url; await img.decode();
      for (const [side, q] of [[1000, .7], [900, .62], [800, .58], [700, .54], [600, .5], [520, .45], [440, .4]]){
        const s = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.naturalWidth * s)); c.height = Math.max(1, Math.round(img.naturalHeight * s));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const b = await new Promise((res, rej) => c.toBlob(x => x ? res(x) : rej(new Error('encode')), 'image/jpeg', q));
        const data = await blobToBase64(b);
        if (data.length <= 56000) return data;
      }
      throw new Error('too big');
    } finally { URL.revokeObjectURL(url); }
  }

  async function sendSpots(){
    for (const p of userPlaces.slice()){
      if (sharedIds.has(p.id) || p.issue || p.rejected) continue;
      const n = await postIssue('[new-spot] ' + p.name, { id:p.id, name:p.name, zh:p.zh || '', cat:p.cat, district:p.district || '', addr:p.addr || '', note:p.note || '', lat:p.lat, lng:p.lng, approx:!!p.approx });
      p.issue = n; p.sentAt = Date.now(); syncTouched = true; await saveUserPlaces(); await wait(1500);
    }
  }
  async function sendPhotos(){
    for (const spot of Object.keys(photosBySpot)){
      const sp = findPlace(spot); if (!sp) continue;
      const mine = userPlaces.find(x => x.id === spot);
      if (mine && !sharedIds.has(spot) && (!mine.issue || mine.rejected)) continue;      // wait until its spot has been sent
      for (const rec of localPhotos(spot).slice()){
        if (rec.sent || rec.rejected || sharedPhotoIds.has(rec.id)) continue;
        let data;
        try{ data = await shareableJpeg(rec.full); } catch(e){ rec.rejected = 'This photo could not be prepared for sharing.'; syncTouched = true; await putRec(rec); continue; }
        rec.sent = await postIssue('[new-photo] ' + sp.name, { id:rec.id, spot, data });
        rec.sentAt = Date.now(); syncTouched = true; await putRec(rec); await wait(1500);
      }
    }
  }
  async function sendRemovals(){
    const l = readJson(REMOVALS_KEY, []);
    for (const r of l){
      if (r.issue) continue;
      r.issue = await postIssue('[remove-photo] ' + r.id, { id:r.id });
      syncTouched = true; writeJson(REMOVALS_KEY, l); await wait(1500);
    }
  }
  // did the guide accept what we sent? (issues closed as "not planned" were refused, and the reply says why)
  async function checkSent(){
    const items = [];
    userPlaces.forEach(p => { if (p.issue && !sharedIds.has(p.id) && !p.rejected && !p.closed) items.push({ obj:p, n:p.issue, at:p.sentAt, save:saveUserPlaces }); });
    Object.values(photosBySpot).flat().forEach(r => { if (r.sent && !sharedPhotoIds.has(r.id) && !r.rejected && !r.closed) items.push({ obj:r, n:r.sent, at:r.sentAt, save:() => putRec(r) }); });
    for (const it of items){
      if (Date.now() - (it.at || 0) < 90000) continue;
      const iss = await gh('GET', '/repos/' + SHARE_REPO + '/issues/' + it.n);
      if (iss.state !== 'closed') continue;
      if (iss.state_reason === 'not_planned'){
        const cs = await gh('GET', '/repos/' + SHARE_REPO + '/issues/' + it.n + '/comments?per_page=10');
        const ours = cs.filter(c => c.user && c.user.login === 'github-actions[bot]');
        it.obj.rejected = String((ours.length ? ours[ours.length - 1].body : '') || 'The guide did not accept this.').slice(0, 240);
      } else it.obj.closed = true;
      syncTouched = true; await it.save();
    }
  }

  function pendingCounts(){
    const spots = userPlaces.filter(p => !sharedIds.has(p.id) && !p.issue && !p.rejected).length;
    const photos = Object.entries(photosBySpot).reduce((n, [spot, l]) => {
      const mine = userPlaces.find(x => x.id === spot);
      if (mine && mine.rejected) return n;
      return n + l.filter(r => !r.sent && !r.rejected && !sharedPhotoIds.has(r.id)).length;
    }, 0);
    const removals = readJson(REMOVALS_KEY, []).filter(r => !r.issue).length;
    return { spots, photos, removals, total: spots + photos + removals };
  }
  // sent, but the guide has not answered yet: keep checking now and then
  function awaitingAnswer(){
    return userPlaces.some(p => p.issue && !sharedIds.has(p.id) && !p.rejected && !p.closed) ||
      Object.values(photosBySpot).flat().some(r => r.sent && !sharedPhotoIds.has(r.id) && !r.rejected && !r.closed);
  }
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  function pendingText(c){
    return [c.spots && plural(c.spots, 'spot'), c.photos && plural(c.photos, 'photo'), c.removals && plural(c.removals, 'photo removal')].filter(Boolean).join(', ');
  }

  async function syncNow(manual){
    if (syncBusy) return;
    if (!syncKey()){ updateSyncUi(); return; }
    if (!navigator.onLine){ updateSyncUi(); if (manual) toast('No connection. It will send as soon as you’re online.'); return; }
    syncBusy = true; syncErr = null; syncTouched = false; updateSyncUi();
    try{
      await sendSpots(); await sendPhotos(); await sendRemovals(); await checkSent();
      if (manual) toast(pendingCounts().total ? 'Some items are still waiting.' : 'Everything is sent.');
    } catch(e){
      syncErr = e.code || 'net';
      if (e.code === 'key' || e.code === 'perm' || manual) toast(e.message || 'Couldn’t sync just now. It will retry.', { ms:8000 });
      if (!e.code) console.warn(e);
    } finally {
      syncBusy = false; updateSyncUi();
      if (syncTouched || manual){ renderList(); if (photoSpot) renderPhotoSheet(); }
    }
  }

  function localTagHtml(p){
    if (p.rejected) return '<div class="local-tag warn"><b>Not accepted</b><span class="lt-why">' + esc(p.rejected) + '</span><button type="button" data-act="retry">Try again</button><button type="button" class="plain" data-act="remove">Delete</button></div>';
    if (p.issue) return '<div class="local-tag"><b>Sent to the guide</b><span class="lt-why">Everyone gets it with their next update.</span></div>';
    const k = syncKey();
    return '<div class="local-tag"><b>' + (k ? (syncBusy ? 'Sending…' : 'Waiting to send') : 'On this phone only') + '</b>' +
      '<button type="button" data-act="share">' + (k ? 'Send now' : 'Set up sharing') + '</button><button type="button" class="plain" data-act="remove">Delete</button></div>';
  }
  function photoSyncNote(){
    const mine = localPhotos(photoSpot), waiting = mine.filter(r => !r.sent && !r.rejected && !sharedPhotoIds.has(r.id)), bad = mine.filter(r => r.rejected);
    let s = '';
    if (waiting.length) s += syncKey() ? ' ' + waiting.length + ' waiting to send to everyone.' : ' Add the sync key (top right) to share ' + (waiting.length > 1 ? 'these' : 'this') + ' with everyone.';
    if (bad.length) s += ' Not accepted: ' + bad[0].rejected;
    return s;
  }

  /* the Sync sheet: paste the key once */
  const syncSheet = makeSheet($('sync-backdrop'), $('sync-sheet'));
  const maskKey = k => k ? k.slice(0, 11) + '…' + k.slice(-4) : '';
  function updateSyncUi(){
    const b = $('sync-btn'), c = pendingCounts(), has = !!syncKey();
    b.dataset.state = !has ? (c.total ? 'off pending' : 'off') : syncErr === 'key' || syncErr === 'perm' ? 'error' : syncBusy ? 'busy' : c.total ? 'pending' : 'ok';
    b.setAttribute('aria-label', !has ? 'Sync: not set up' : syncErr === 'key' || syncErr === 'perm' ? 'Sync: key problem' : c.total ? 'Sync: ' + pendingText(c) + ' waiting' : 'Sync: all sent');
    if ($('sync-backdrop').classList.contains('open')) renderSyncSheet();
  }
  function renderSyncSheet(){
    const has = !!syncKey(), c = pendingCounts();
    let t, d;
    if (!has){ t = 'Not set up'; d = 'Paste the sync key below and spots and photos you add are shared with everyone automatically. Until then they stay on this phone.'; }
    else if (syncErr === 'key' || syncErr === 'perm'){ t = 'Key problem'; d = syncErr === 'key' ? 'GitHub doesn’t accept the saved key. Paste a new one.' : 'The saved key can’t post to the guide. It needs “Issues: Read and write” on the shanghai-guide repository.'; }
    else if (syncBusy){ t = 'Sending…'; d = pendingText(c) || 'Checking for anything new.'; }
    else if (c.total){ t = 'Waiting to send'; d = pendingText(c) + (navigator.onLine ? '.' : ' — sends by itself when you’re back online.'); }
    else { t = 'All sent'; d = 'Everything from this phone is in the guide or on its way. Other phones get it with their next update.'; }
    $('sync-st-title').textContent = t; $('sync-st-detail').textContent = d;
    $('sync-status').dataset.state = has ? (syncErr === 'key' || syncErr === 'perm' ? 'error' : 'ok') : 'off';
    $('sync-key').placeholder = has ? maskKey(syncKey()) + '  (saved)' : 'github_pat_…';
    $('sync-name').value = syncName();
    $('sync-now').hidden = !has; $('sync-remove').hidden = !has;
  }
  function openSync(){ $('sync-msg').textContent = ''; $('sync-key').value = ''; renderSyncSheet(); syncSheet.open(); }
  $('sync-btn').addEventListener('click', openSync);
  $('sync-close').addEventListener('click', () => syncSheet.close());
  $('sync-save').addEventListener('click', async () => {
    const msg = $('sync-msg'), key = $('sync-key').value.trim();
    lsSet(NAME_LS, $('sync-name').value.replace(/[^A-Za-z0-9 -]/g, '').trim().slice(0, 20));
    if (!key){ msg.textContent = syncKey() ? 'Name saved.' : 'Paste the key first.'; renderSyncSheet(); return; }
    if (!/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(key)){ msg.textContent = 'That doesn’t look like a GitHub key. It starts with github_pat_'; return; }
    lsSet(KEY_LS, key); $('sync-key').value = ''; syncErr = null; msg.textContent = 'Checking…';
    try{
      await gh('GET', '/repos/' + SHARE_REPO);
      msg.textContent = 'Key accepted. Sending anything that’s waiting…'; renderSyncSheet(); syncNow();
    } catch(e){
      msg.textContent = e.code === 'net' ? 'Saved. Couldn’t reach GitHub just now; it will check again when there’s a connection.' : e.message;
      if (e.code === 'key'){ lsSet(KEY_LS, ''); }
      renderSyncSheet();
    }
    updateSyncUi();
  });
  $('sync-now').addEventListener('click', () => { $('sync-msg').textContent = ''; syncNow(true); });
  $('sync-remove').addEventListener('click', () => {
    if (!window.confirm('Remove the sync key from this phone? Things you add will stay on this phone until a key is added again.')) return;
    lsSet(KEY_LS, ''); syncErr = null; $('sync-msg').textContent = 'Key removed.'; updateSyncUi(); renderList();
  });
  function startSync(){
    writeJson(REMOVALS_KEY, readJson(REMOVALS_KEY, []).filter(r => !r.issue || sharedPhotoIds.has(r.id)));     // a removal is done once the photo is gone from the guide
    updateSyncUi();
    setTimeout(() => syncNow(), 2000);
    window.addEventListener('online', () => syncNow());
    const due = () => pendingCounts().total || awaitingAnswer();
    document.addEventListener('visibilitychange', () => { if (!document.hidden && due()) syncNow(); });
    setInterval(() => { if (!document.hidden && due()) syncNow(); }, 45000);
  }

  async function boot(){
    syncChrome();
    new ResizeObserver(syncChrome).observe(header);
    new ResizeObserver(syncChrome).observe(tabbar);
    try{
      initMap();
    } catch(err){
      console.error('Map failed to load', err);
    }
    try{
      await loadUserPlaces();
    } catch(err){
      userPlaces = [];
    }
    await loadPhotos();
    render();
    startSync();
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', startBoot);
  } else {
    startBoot();
  }

  function startBoot(){
    if (typeof L !== 'undefined'){
      boot();
      return;
    }
    let settled = false;
    window.addEventListener('leaflet-ready', function(){
      if (settled) return;
      settled = true;
      boot();
    });
    window.addEventListener('leaflet-load-failed', function(){
      if (settled) return;
      settled = true;
      boot();
    });
    // safety timeout in case neither event fires for some reason
    setTimeout(function(){
      if (settled) return;
      settled = true;
      boot();
    }, 8000);
  }

})();
