const coloradoBounds = [
  [36.992, -109.06],
  [41.003, -102.041],
];

const coloradoPlaces = [
  { name: "Denver", coords: [39.7392, -104.9903], zoom: 11, blurb: "State capital" },
  { name: "Colorado Springs", coords: [38.8339, -104.8214], zoom: 11, blurb: "Front Range hub" },
  { name: "Boulder", coords: [40.01499, -105.2705], zoom: 12, blurb: "Flatirons + CU" },
  { name: "Fort Collins", coords: [40.5853, -105.0844], zoom: 12, blurb: "Horsetooth & breweries" },
  { name: "Durango", coords: [37.2753, -107.8801], zoom: 12, blurb: "San Juans gateway" },
  { name: "Aspen", coords: [39.1911, -106.8175], zoom: 12, blurb: "Ski town" },
  { name: "Vail", coords: [39.6403, -106.3742], zoom: 13, blurb: "I-70 alpine stop" },
  { name: "Telluride", coords: [37.9375, -107.8123], zoom: 13, blurb: "Box canyon" },
  { name: "Rocky Mountain NP", coords: [40.3428, -105.6836], zoom: 11, blurb: "Trail Ridge Road" },
  { name: "Great Sand Dunes NP", coords: [37.7326, -105.5134], zoom: 12, blurb: "Dune field + Crestones" },
  { name: "Black Canyon of the Gunnison", coords: [38.5754, -107.7416], zoom: 12, blurb: "North & South Rim drives" },
  { name: "Pikes Peak", coords: [38.8409, -105.0423], zoom: 12, blurb: "14er with road + cog" },
  { name: "Mesa Verde NP", coords: [37.2309, -108.4618], zoom: 12, blurb: "Cliff dwellings" },
  { name: "Steamboat Springs", coords: [40.485, -106.8317], zoom: 12, blurb: "Yampa valley" },
  { name: "Crested Butte", coords: [38.8697, -106.9878], zoom: 13, blurb: "Gothic & flowers" },
];

export function initMap() {
  const mapMetaEl = document.getElementById("mapMeta");
  const mapTileNoteEl = document.getElementById("mapTileNote");
  const mapQuickLinks = document.getElementById("mapQuickLinks");
  const mapSearchInput = document.getElementById("mapSearchInput");
  const mapSearchResults = document.getElementById("mapSearchResults");
  const mapSearchClear = document.getElementById("mapSearchClear");
  const mapLocateBtn = document.getElementById("mapLocateBtn");
  const mapUseCampBtn = document.getElementById("mapUseCampBtn");
  const mapResetBtn = document.getElementById("mapResetBtn");
  const mapLayerBtn = document.getElementById("mapLayerBtn");
  const campNameInput = document.getElementById("mapNameInput");
  const campLatInput = document.getElementById("mapLatInput");
  const campLonInput = document.getElementById("mapLonInput");
  const campSaveBtn = document.getElementById("mapSaveCampBtn");
  const campClearBtn = document.getElementById("mapClearCampBtn");
  const campSetCenterBtn = document.getElementById("mapSetCenterBtn");
  const campStatusEl = document.getElementById("mapCampStatus");
  const zoomInBtn = document.getElementById("zoomInBtn");
  const zoomOutBtn = document.getElementById("zoomOutBtn");

  const tileConfig = (window.PICO_CONFIG && window.PICO_CONFIG.tiles) || {};
  const defaultMax = Number.isFinite(tileConfig.maxZoom) ? tileConfig.maxZoom : 17;

  // MapTiler configuration for online mode
  const MAPTILER_KEY = 'B7FdQPvzKbl0tlzK7dq7';
  const mapTilerSource = {
    url: `https://api.maptiler.com/maps/outdoor-v4/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`,
    attribution: '<a href="https://www.maptiler.com/copyright/" target="_blank">&copy; MapTiler</a> <a href="https://www.openstreetmap.org/copyright" target="_blank">&copy; OpenStreetMap contributors</a>',
    maxZoom: 17,
    tileSize: 512,
    zoomOffset: -1,
    minZoom: 1,
  };

  const normalizeTileUrl = (url) => {
    if (!url) return url;
    let out = url;
    // force known working raster style
    out = out.replace("styles/bright/", "styles/basic-preview/");
    // swap localhost to current host for hotspot clients
    if (typeof window !== "undefined" && out.includes("127.0.0.1")) {
      out = out.replace("127.0.0.1", window.location.hostname);
    }
    return out;
  };

  const offlineUrl = normalizeTileUrl(
    tileConfig.url || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
  );
  console.log("[map] tileConfig url", tileConfig.url, "normalized", offlineUrl);

  const offlineSource = {
    url: offlineUrl,
    attribution: tileConfig.attribution || "(c) OpenStreetMap contributors",
    maxZoom: defaultMax,
    maxNativeZoom: Number.isFinite(tileConfig.maxNativeZoom) ? tileConfig.maxNativeZoom : defaultMax,
  };

  let coMap = null;
  let tileLayers = null;
  let activeLayer = "online";
  let locationMarker = null;
  let mapSizeTimer = null;
  let isOnline = navigator.onLine;
  const CAMP_STORAGE_KEY = "picoCampLocation";
  let savedCamp = loadCampLocation();
  let geoTimeout = null;

  function updateCampStatus(msg) {
    if (campStatusEl) campStatusEl.textContent = msg;
  }

  function loadCampLocation() {
    try {
      const raw = localStorage.getItem(CAMP_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        Array.isArray(parsed.coords) &&
        parsed.coords.length === 2 &&
        Number.isFinite(parsed.coords[0]) &&
        Number.isFinite(parsed.coords[1])
      ) {
        return {
          coords: [Number(parsed.coords[0]), Number(parsed.coords[1])],
          name: parsed.name || "Saved camp",
        };
      }
    } catch (_) {}
    return null;
  }

  function saveCampLocation(lat, lon, name) {
    savedCamp = { coords: [lat, lon], name: name || "Saved camp" };
    localStorage.setItem(CAMP_STORAGE_KEY, JSON.stringify(savedCamp));
    updateCampStatus(
      `${savedCamp.name} saved at ` + lat.toFixed(5) + ", " + lon.toFixed(5)
    );
    refreshQuickLinks();
  }

  function clearCampLocation() {
    savedCamp = null;
    localStorage.removeItem(CAMP_STORAGE_KEY);
    updateCampStatus("No saved camp location.");
    refreshQuickLinks();
  }

  function placeMarker(coords, label) {
    if (!coMap) return;
    if (locationMarker) {
      locationMarker.setLatLng(coords);
    } else {
      locationMarker = L.circleMarker(coords, {
        radius: 7,
        color: "#22d3ee",
        fillColor: "#22d3ee",
        fillOpacity: 0.7,
      }).addTo(coMap);
    }
    coMap.flyTo(coords, 12, { duration: 1 });
    updateMapMeta(label ? label : "Pinned location");
  }

  function useSavedCamp(center = true) {
    if (!savedCamp) {
      updateCampStatus("No saved camp location.");
      return false;
    }
    if (campLatInput && campLonInput && campNameInput) {
      campLatInput.value = savedCamp.coords[0];
      campLonInput.value = savedCamp.coords[1];
      campNameInput.value = savedCamp.name || "Saved camp";
    }
    if (center) {
      placeMarker(savedCamp.coords, savedCamp.name || "Pinned saved camp");
    }
    updateCampStatus(
      (savedCamp.name ? savedCamp.name + " · " : "Saved camp: ") +
        savedCamp.coords[0].toFixed(5) +
        ", " +
        savedCamp.coords[1].toFixed(5)
    );
    return true;
  }

  function hydrateCampInputs() {
    if (!savedCamp || !campLatInput || !campLonInput || !campNameInput) return;
    campLatInput.value = savedCamp.coords[0];
    campLonInput.value = savedCamp.coords[1];
    campNameInput.value = savedCamp.name || "Saved camp";
  }

  function syncInputsToCenter() {
    if (!coMap || !campLatInput || !campLonInput) return;
    const center = coMap.getCenter();
    campLatInput.value = center.lat.toFixed(6);
    campLonInput.value = center.lng.toFixed(6);
  }

  function refreshQuickLinks() {
    if (!mapQuickLinks) return;
    mapQuickLinks.innerHTML = "";
    if (savedCamp) {
      const savedBtn = document.createElement("button");
      savedBtn.className = "map-chip-btn";
      savedBtn.textContent = savedCamp.name || "Saved camp";
      savedBtn.addEventListener("click", () => {
        ensureColoradoMap();
        useSavedCamp();
      });
      mapQuickLinks.appendChild(savedBtn);
    }
    coloradoPlaces.slice(0, 10).forEach((place) => {
      const btn = document.createElement("button");
      btn.className = "map-chip-btn";
      btn.textContent = place.name;
      btn.addEventListener("click", () => focusPlace(place));
      mapQuickLinks.appendChild(btn);
    });
  }

  function refreshMapSize() {
    if (!coMap) return;
    if (mapSizeTimer) clearTimeout(mapSizeTimer);
    mapSizeTimer = setTimeout(() => {
      coMap.invalidateSize();
    }, 80);
  }

  function updateMapMeta(message) {
    if (!coMap || !mapMetaEl) return;
    const center = coMap.getCenter();
    const zoom = coMap.getZoom();
    const prefix = message ? message + " - " : "";
    const layerStatus = activeLayer === "online" ? "🌐 Online" : "📴 Offline";
    mapMetaEl.textContent =
      prefix +
      "Center " +
      center.lat.toFixed(3) +
      ", " +
      center.lng.toFixed(3) +
      " | Zoom " +
      zoom +
      " | " +
      layerStatus;
  }

  function buildQuickLinks() {
    refreshQuickLinks();
  }

  function ensureColoradoMap() {
    if (coMap) return coMap;
    if (typeof L === "undefined") {
      if (mapMetaEl) {
        mapMetaEl.textContent =
          "Map library failed to load - ensure Leaflet CDN is reachable or add it locally.";
      }
      return null;
    }

    // Create tile layers for both online and offline modes
    tileLayers = {
      online: L.tileLayer(mapTilerSource.url, {
        maxZoom: mapTilerSource.maxZoom,
        tileSize: mapTilerSource.tileSize,
        zoomOffset: mapTilerSource.zoomOffset,
        attribution: mapTilerSource.attribution,
        crossOrigin: true,
      }),
      offline: L.tileLayer(offlineSource.url, {
        maxZoom: offlineSource.maxZoom,
        maxNativeZoom: offlineSource.maxNativeZoom,
        attribution: offlineSource.attribution,
      }),
    };

    coMap = L.map("coloradoMap", {
      zoomControl: false,
      minZoom: 5,
      maxZoom: 17,
      worldCopyJump: true,
    });

    // Function to switch between online and offline tile layers
    function switchToOffline() {
      if (!coMap || !tileLayers) return;
      console.log("[map] Switching to offline tiles");
      if (tileLayers.online && coMap.hasLayer(tileLayers.online)) {
        coMap.removeLayer(tileLayers.online);
      }
      if (tileLayers.offline && !coMap.hasLayer(tileLayers.offline)) {
        coMap.addLayer(tileLayers.offline);
      }
      activeLayer = "offline";
      updateMapMeta("Using offline tiles");
      if (mapTileNoteEl) {
        mapTileNoteEl.textContent = "📴 Offline mode - Using local tiles (MAP_TILE_URL)";
      }
      if (mapLayerBtn) {
        mapLayerBtn.textContent = "Switch to Online";
      }
    }

    function switchToOnline() {
      if (!coMap || !tileLayers) return;
      console.log("[map] Switching to online tiles");
      if (tileLayers.offline && coMap.hasLayer(tileLayers.offline)) {
        coMap.removeLayer(tileLayers.offline);
      }
      if (tileLayers.online && !coMap.hasLayer(tileLayers.online)) {
        coMap.addLayer(tileLayers.online);
      }
      activeLayer = "online";
      updateMapMeta("Using online MapTiler tiles");
      if (mapTileNoteEl) {
        mapTileNoteEl.textContent = "🌐 Online mode - Using MapTiler outdoor maps";
      }
      if (mapLayerBtn) {
        mapLayerBtn.textContent = "Switch to Offline";
      }
    }

    // Watch for tile errors and fall back to offline
    tileLayers.online.on("tileerror", (ev) => {
      console.error("[map] Online tile load error, falling back to offline", {
        url: ev?.tile?.src,
        message: ev?.error?.message,
      });
      switchToOffline();
    });

    // Start with appropriate layer based on network status
    if (isOnline) {
      tileLayers.online.addTo(coMap);
      if (mapTileNoteEl) {
        mapTileNoteEl.textContent = "🌐 Online mode - Using MapTiler outdoor maps";
      }
    } else {
      tileLayers.offline.addTo(coMap);
      if (mapTileNoteEl) {
        mapTileNoteEl.textContent = "📴 Offline mode - Using local tiles";
      }
    }

    // Listen for online/offline events
    window.addEventListener("online", () => {
      console.log("[map] Network came online");
      isOnline = true;
      switchToOnline();
    });

    window.addEventListener("offline", () => {
      console.log("[map] Network went offline");
      isOnline = false;
      switchToOffline();
    });
    L.control.zoom({ position: "topright" }).addTo(coMap);
    L.control.scale({ position: "bottomleft", imperial: true, metric: true }).addTo(coMap);

    const boundary = L.rectangle(coloradoBounds, {
      color: "#22d3ee",
      weight: 1,
      opacity: 0.8,
      fillOpacity: 0.02,
    });
    boundary.addTo(coMap);
    coMap.fitBounds(coloradoBounds, { padding: [12, 12] });

    coloradoPlaces.forEach((place) => {
      const marker = L.marker(place.coords, { title: place.name });
      marker.bindPopup(
        "<strong>" + place.name + "</strong><br>" + (place.blurb || "Colorado spot")
      );
      marker.addTo(coMap);
      place.marker = marker;
    });

    buildQuickLinks();
    coMap.on("moveend zoomend", () => {
      updateMapMeta();
      syncInputsToCenter();
    });
    refreshMapSize();
    updateMapMeta("Centered on Colorado");
    syncInputsToCenter();
    if (mapTileNoteEl) {
      mapTileNoteEl.textContent =
        "Local tiles first (MAP_TILE_URL). Auto-fallback to online tiles only if local fails. Topo uses OpenTopoMap (needs internet).";
    }
    useSavedCamp(false);
    return coMap;
  }

  function focusPlace(place, opts = {}) {
    const map = ensureColoradoMap();
    if (!map || !place) return;
    const zoom = opts.zoom || place.zoom || map.getZoom() || 11;
    map.flyTo(place.coords, zoom, { duration: 1.1 });
    if (place.marker) {
      place.marker.openPopup();
    }
    updateMapMeta("Jumped to " + place.name);
    hideSearchResults();
  }

  function toggleLayer() {
    if (!coMap || !tileLayers) return;

    if (activeLayer === "online") {
      // Switch to offline
      if (tileLayers.online && coMap.hasLayer(tileLayers.online)) {
        coMap.removeLayer(tileLayers.online);
      }
      if (tileLayers.offline && !coMap.hasLayer(tileLayers.offline)) {
        coMap.addLayer(tileLayers.offline);
      }
      activeLayer = "offline";
      if (mapLayerBtn) mapLayerBtn.textContent = "Switch to Online";
      if (mapTileNoteEl) {
        mapTileNoteEl.textContent = "📴 Offline mode - Using local tiles (MAP_TILE_URL)";
      }
      updateMapMeta("Switched to offline tiles");
    } else {
      // Switch to online
      if (tileLayers.offline && coMap.hasLayer(tileLayers.offline)) {
        coMap.removeLayer(tileLayers.offline);
      }
      if (tileLayers.online && !coMap.hasLayer(tileLayers.online)) {
        coMap.addLayer(tileLayers.online);
      }
      activeLayer = "online";
      if (mapLayerBtn) mapLayerBtn.textContent = "Switch to Offline";
      if (mapTileNoteEl) {
        mapTileNoteEl.textContent = "🌐 Online mode - Using MapTiler outdoor maps";
      }
      updateMapMeta("Switched to online tiles");
    }
  }

  function resetMapView() {
    const map = ensureColoradoMap();
    if (!map) return;
    map.fitBounds(coloradoBounds, { padding: [12, 12] });
    updateMapMeta("Reset to statewide view");
  }

  function handleSearch(term) {
    const t = term.trim().toLowerCase();
    if (!mapSearchResults) return;
    if (!t) {
      hideSearchResults();
      return;
    }
    const matches = coloradoPlaces.filter((p) => p.name.toLowerCase().includes(t));
    renderSearchResults(matches.slice(0, 6));
  }

  function renderSearchResults(list) {
    if (!mapSearchResults) return;
    mapSearchResults.innerHTML = "";
    if (!list.length) {
      hideSearchResults();
      return;
    }
    list.forEach((place) => {
      const div = document.createElement("div");
      div.className = "map-suggestion";
      div.textContent = place.name;
      div.addEventListener("click", () => focusPlace(place));
      mapSearchResults.appendChild(div);
    });
    mapSearchResults.classList.add("active");
  }

  function hideSearchResults() {
    if (mapSearchResults) {
      mapSearchResults.classList.remove("active");
    }
  }

  if (mapSearchInput) {
    mapSearchInput.addEventListener("input", (e) => handleSearch(e.target.value));
    mapSearchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const firstMatch = coloradoPlaces.find((p) =>
          p.name.toLowerCase().includes(mapSearchInput.value.trim().toLowerCase())
        );
        if (firstMatch) {
          focusPlace(firstMatch);
          e.preventDefault();
        }
      }
    });
  }

  if (mapSearchClear) {
    mapSearchClear.addEventListener("click", () => {
      if (mapSearchInput) {
        mapSearchInput.value = "";
        mapSearchInput.focus();
      }
      hideSearchResults();
    });
  }

  hydrateCampInputs();
  if (savedCamp) {
    updateCampStatus(
      "Saved camp: " + savedCamp.coords[0].toFixed(5) + ", " + savedCamp.coords[1].toFixed(5)
    );
  } else {
    updateCampStatus("No saved camp location.");
  }
  syncInputsToCenter();

  if (mapLayerBtn) {
    mapLayerBtn.textContent = isOnline ? "Switch to Offline" : "Switch to Online";
    mapLayerBtn.disabled = false;
    mapLayerBtn.classList.remove("disabled");
    mapLayerBtn.addEventListener("click", toggleLayer);
  }
  if (mapResetBtn) {
    mapResetBtn.addEventListener("click", resetMapView);
  }
  if (mapUseCampBtn) {
    mapUseCampBtn.addEventListener("click", () => {
      ensureColoradoMap();
      useSavedCamp();
    });
  }
  if (mapLocateBtn) {
    mapLocateBtn.addEventListener("click", () => {
      const map = ensureColoradoMap();
      if (!map) return;
      const allowGeo = window.isSecureContext || location.hostname === "localhost";

      async function locateByIP() {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 3500);
          const res = await fetch("https://ipapi.co/json/", { signal: controller.signal });
          clearTimeout(timer);
          if (!res.ok) throw new Error("HTTP " + res.status);
          const data = await res.json();
          if (!data || data.latitude == null || data.longitude == null) {
            throw new Error("No coordinates returned");
          }
          return {
            coords: [Number(data.latitude), Number(data.longitude)],
            label: [data.city, data.region, data.country_name].filter(Boolean).join(", "),
          };
        } catch (err) {
          return null;
        }
      }

      const handleFailure = (msg) => {
        if (mapMetaEl) {
          mapMetaEl.textContent = msg;
        }
      };

      if (mapMetaEl) {
        mapMetaEl.textContent = "Locating...";
      }
      if (geoTimeout) clearTimeout(geoTimeout);
      geoTimeout = setTimeout(() => {
        handleFailure("Location timed out. Try saved spot or enter lat/lon.");
      }, 8000);

      const useBrowserGeo = navigator.geolocation && allowGeo;

      if (useBrowserGeo) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            if (geoTimeout) clearTimeout(geoTimeout);
            const accuracy = pos.coords.accuracy;

            // Log detailed position info for debugging
            console.log("[map] Geolocation position:", {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: accuracy,
              altitude: pos.coords.altitude,
              altitudeAccuracy: pos.coords.altitudeAccuracy,
              heading: pos.coords.heading,
              speed: pos.coords.speed,
              timestamp: new Date(pos.timestamp).toISOString()
            });

            let accuracyLabel = "";
            let method = "";

            // Determine likely positioning method based on accuracy
            if (pos.coords.altitude != null && accuracy < 50) {
              method = "GPS";
              accuracyLabel = " (±" + Math.round(accuracy) + "m - GPS)";
            } else if (accuracy < 100) {
              method = "WiFi/GPS";
              accuracyLabel = " (±" + Math.round(accuracy) + "m - WiFi/GPS)";
            } else if (accuracy < 1000) {
              method = "WiFi/Cell";
              accuracyLabel = " (±" + Math.round(accuracy) + "m - WiFi/Cell tower)";
            } else {
              method = "IP/WiFi";
              accuracyLabel = " (±" + Math.round(accuracy) + "m - IP/WiFi, very low accuracy)";
            }

            if (mapMetaEl) {
              mapMetaEl.textContent = "Location via " + method + " - Accuracy: ±" + Math.round(accuracy) + "m";
            }

            placeMarker([pos.coords.latitude, pos.coords.longitude], "Your location" + accuracyLabel);
          },
          async (err) => {
            if (geoTimeout) clearTimeout(geoTimeout);
            if (useSavedCamp()) return;
            const ipResult = await locateByIP();
            if (ipResult) {
              placeMarker(ipResult.coords, ipResult.label + " (IP-based, low accuracy)");
            } else {
              handleFailure("Location failed: " + err.message);
            }
          },
          {
            enableHighAccuracy: true,
            timeout: 7000,
            maximumAge: 0
          }
        );
      } else {
        locateByIP().then((ipResult) => {
          if (useSavedCamp()) {
            if (geoTimeout) clearTimeout(geoTimeout);
            return;
          }
          if (ipResult) {
            if (geoTimeout) clearTimeout(geoTimeout);
            placeMarker(ipResult.coords, ipResult.label + " (IP-based, low accuracy)");
          } else {
            handleFailure(
              "Location blocked (browser needs HTTPS/localhost) and IP lookup failed."
            );
          }
        });
      }
    });
  }

  if (campSetCenterBtn) {
    campSetCenterBtn.addEventListener("click", () => {
      const map = ensureColoradoMap();
      if (!map) {
        updateCampStatus("Map not initialized yet. Please wait.");
        return;
      }
      const center = map.getCenter();
      if (campLatInput) campLatInput.value = center.lat.toFixed(6);
      if (campLonInput) campLonInput.value = center.lng.toFixed(6);
      console.log("[map] Set inputs to map center:", center.lat.toFixed(6), center.lng.toFixed(6));
      updateCampStatus(
        "Coordinates set to map center: " +
        center.lat.toFixed(6) + ", " + center.lng.toFixed(6) +
        " - Now click 'Save camp location' to save."
      );
    });
  }

  if (campSaveBtn) {
    campSaveBtn.addEventListener("click", () => {
      const lat = campLatInput ? parseFloat(campLatInput.value) : null;
      const lon = campLonInput ? parseFloat(campLonInput.value) : null;
      const name = campNameInput ? campNameInput.value.trim() : "";
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        updateCampStatus("Enter a valid latitude and longitude.");
        return;
      }
      saveCampLocation(lat, lon, name);
      ensureColoradoMap();
      useSavedCamp();
    });
  }

  if (campClearBtn) {
    campClearBtn.addEventListener("click", () => {
      clearCampLocation();
    });
  }

  document.addEventListener("click", (e) => {
    if (
      mapSearchResults &&
      !mapSearchResults.contains(e.target) &&
      mapSearchInput &&
      !mapSearchInput.contains(e.target)
    ) {
      hideSearchResults();
    }
  });
  window.addEventListener("resize", refreshMapSize);

  function onShow() {
    ensureColoradoMap();
    refreshMapSize();
    setTimeout(refreshMapSize, 75);
    updateMapMeta("Centered on Colorado");
  }

  if (zoomInBtn) {
    zoomInBtn.addEventListener("click", () => {
      const map = ensureColoradoMap();
      if (map) map.zoomIn();
    });
  }
  if (zoomOutBtn) {
    zoomOutBtn.addEventListener("click", () => {
      const map = ensureColoradoMap();
      if (map) map.zoomOut();
    });
  }

  return {
    onShow,
  };
}
