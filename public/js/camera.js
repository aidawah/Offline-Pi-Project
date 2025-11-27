const clampDim = (val, min, max, fallback) => {
  const num = Number.parseInt(val, 10);
  if (Number.isFinite(num)) {
    return Math.max(min, Math.min(num, max));
  }
  return fallback;
};

export function initCamera(isActive) {
  const liveImg = document.getElementById("cameraLiveImg");
  const placeholder = document.getElementById("cameraPlaceholder");
  const liveSub = document.getElementById("cameraLiveSub");
  const statusDot = document.getElementById("cameraStatusDot");
  const statusText = document.getElementById("cameraStatusText");
  const statusMeta = document.getElementById("cameraMeta");
  const openStreamBtn = document.getElementById("openStreamBtn");
  const grabStillBtn = document.getElementById("grabStillBtn");
  const captureStillBtn = document.getElementById("captureStillBtn");
  const stillWidthInput = document.getElementById("stillWidthInput");
  const stillHeightInput = document.getElementById("stillHeightInput");
  const stillNameInput = document.getElementById("stillNameInput");
  const stillNote = document.getElementById("cameraStillNote");
  const refreshStatusBtn = document.getElementById("cameraRefreshBtn");
  const stillGrid = document.getElementById("stillGrid");
  const stillEmpty = document.getElementById("stillEmpty");
  const refreshStillsBtn = document.getElementById("refreshStillsBtn");
  const selectedStillImg = document.getElementById("selectedStillImg");
  const selectedStillEmpty = document.getElementById("selectedStillEmpty");
  const selectedStillTitle = document.getElementById("selectedStillTitle");
  const selectedStillMeta = document.getElementById("selectedStillMeta");
  const openStillBtn = document.getElementById("openStillBtn");
  const downloadSelectedBtn = document.getElementById("downloadSelectedBtn");
  const renameSelectedBtn = document.getElementById("renameSelectedBtn");
  const deleteSelectedBtn = document.getElementById("deleteSelectedBtn");
  const isViewActive = typeof isActive === "function" ? isActive : () => true;

  const cameraCfg = (window.PICO_CONFIG && window.PICO_CONFIG.camera) || {};
  const defaults = cameraCfg.snapshotDefault || {};
  const maxStill = cameraCfg.maxStill || { width: 4656, height: 3496 };
  const lockedWidth = defaults.width || 1600;
  const lockedHeight = defaults.height || 900;
  let streamUrl = cameraCfg.streamUrl || "/camera/stream";
  let lastStill = null;
  let savedStills = [];
  let selectedStillId = null;
  let pendingSelectId = null;

  function setPlaceholder(message) {
    if (placeholder) {
      placeholder.textContent = message;
      placeholder.classList.add("visible");
      placeholder.style.display = "flex";
    }
    if (liveImg) {
      liveImg.style.display = "none";
    }
  }

  function hidePlaceholder() {
    if (placeholder) {
      placeholder.classList.remove("visible");
      placeholder.style.display = "none";
    }
  }

  function setLiveImage(src) {
    if (!liveImg || !src) return;
    liveImg.src = src;
    liveImg.style.display = "block";
    hidePlaceholder();
  }

  function updateLiveSub() {
    if (!liveSub) return;
    if (streamUrl) {
      liveSub.textContent = "Streaming from " + streamUrl;
    } else {
      liveSub.textContent = "Set CAMERA_STREAM_URL or grab a still to render here.";
    }
  }

  function describeDevices(devices) {
    if (!devices || !devices.length) return "No /dev/video* nodes detected.";
    if (devices.length === 1) return "Detected " + devices[0];
    return "Detected " + devices.join(", ");
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return "";
    if (bytes < 1024) return bytes + " B";
    const units = ["KB", "MB", "GB"];
    let val = bytes / 1024;
    let idx = 0;
    while (val >= 1024 && idx < units.length - 1) {
      val /= 1024;
      idx += 1;
    }
    const places = val >= 10 ? 0 : 1;
    return val.toFixed(places) + " " + units[idx];
  }

  function formatDate(ts) {
    if (!Number.isFinite(ts)) return "";
    try {
      return new Date(ts).toLocaleString();
    } catch (_) {
      return "";
    }
  }

  function getSelectedStill() {
    return savedStills.find((s) => s.id === selectedStillId) || null;
  }

  function friendlyCameraError(err) {
    const msg = (err && err.message ? String(err.message) : "") || "";
    const lower = msg.toLowerCase();
    if (lower.includes("device or resource busy") || lower.includes("pipeline handler in use")) {
      return "Camera is busy. Stop other camera apps (libcamera-vid/RTSP) and try again.";
    }
    if (lower.includes("not available")) {
      return "Capture tool missing. Install libcamera-still or rpicam-still.";
    }
    if (!msg) return "Snapshot failed.";
    const parts = msg.split("\n").map((p) => p.trim()).filter(Boolean);
    const compact = parts.join(" ");
    return compact.length > 220 ? compact.slice(0, 200).trim() + "…" : compact;
  }

  function updateSelectedState() {
    const still = getSelectedStill();
    const hasStill = !!still;

    if (selectedStillImg) {
      if (hasStill) {
        const cacheBust = still.created ? `${still.url.includes("?") ? "&" : "?"}ts=${Math.round(still.created)}` : "";
        selectedStillImg.src = still.url + cacheBust;
        selectedStillImg.style.display = "block";
      } else {
        selectedStillImg.removeAttribute("src");
        selectedStillImg.style.display = "none";
      }
    }
    if (selectedStillEmpty) {
      selectedStillEmpty.style.display = hasStill ? "none" : "block";
    }
    if (selectedStillTitle) {
      selectedStillTitle.textContent = hasStill ? still.name || still.id : "No still selected";
    }
    if (selectedStillMeta) {
      if (hasStill) {
        const metaParts = [formatDate(still.created), formatBytes(still.size)].filter(Boolean);
        selectedStillMeta.textContent = metaParts.length ? metaParts.join(" · ") : "Saved still";
      } else {
        selectedStillMeta.textContent = "Pick a saved still from the catalog.";
      }
    }

    [openStillBtn, downloadSelectedBtn, renameSelectedBtn, deleteSelectedBtn].forEach((btn) => {
      if (btn) btn.disabled = !hasStill;
    });
  }

  function markSelection() {
    if (!stillGrid) return;
    const cards = stillGrid.querySelectorAll("[data-still-id]");
    cards.forEach((card) => {
      card.classList.toggle("selected", card.dataset.stillId === selectedStillId);
    });
  }

  function setSelectedStill(id) {
    selectedStillId = id || null;
    updateSelectedState();
    markSelection();
  }

  async function refreshStatus() {
    if (statusText) statusText.textContent = "Checking camera...";
    if (statusDot) {
      statusDot.classList.remove("online");
      statusDot.classList.remove("offline");
    }
    try {
      const res = await fetch("/api/camera/status");
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Status call failed");
      }
      const online = data.online !== false && data.devices && data.devices.length > 0;
      if (statusDot) {
        statusDot.classList.add(online ? "online" : "offline");
      }
      if (statusText) {
        statusText.textContent = online ? "Camera detected" : "Camera not detected";
      }

      const bits = [];
      bits.push(describeDevices(data.devices));
      if (data.libcameraInstalled != null) {
        bits.push(data.libcameraInstalled ? "libcamera present" : "libcamera missing");
      }
      if (data.streamUrl) {
        streamUrl = data.streamUrl;
        bits.push("Stream: " + data.streamUrl);
      }
      bits.push("Max still " + (data.maxStill ? data.maxStill.width + "x" + data.maxStill.height : "2592x1944"));
      if (statusMeta) {
        const note = data.notes && data.notes.trim();
        const detail = bits.filter(Boolean).join(" · ");
        statusMeta.textContent = [note, detail].filter(Boolean).join(" · ");
      }
      updateLiveSub();
      if (streamUrl && !lastStill) {
        attachStream(true);
      }
    } catch (err) {
      if (statusText) statusText.textContent = "Status error";
      if (statusDot) statusDot.classList.add("offline");
      if (statusMeta) {
        statusMeta.textContent =
          err && err.message
            ? err.message + ". Check cabling and libcamera-vid."
            : "Unable to read camera status.";
      }
      setPlaceholder("Waiting for camera...");
    }
  }

  function attachStream(forceReload = false) {
    if (!liveImg) return;
    if (!streamUrl) {
      setPlaceholder("No stream URL set. Set CAMERA_STREAM_URL or capture a still.");
      return;
    }
    if (forceReload || !liveImg.src) {
      liveImg.src = streamUrl;
    }
    liveImg.style.display = "block";
    hidePlaceholder();
  }

  if (liveImg) {
    liveImg.addEventListener("load", () => {
      hidePlaceholder();
      updateLiveSub();
    });
    liveImg.addEventListener("error", () => {
      setPlaceholder("Stream not reachable. Start libcamera-vid or verify the URL.");
    });
  }

  async function captureStill() {
    if (stillNote) stillNote.textContent = "Capturing still...";
    try {
      const body = {};
      if (stillNameInput && stillNameInput.value.trim()) {
        body.name = stillNameInput.value.trim();
      }
      const res = await fetch("/api/camera/stills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        throw new Error((data && data.error) || "Snapshot failed");
      }
      lastStill = data.url;
      setLiveImage(data.url);
      pendingSelectId = data.id;
      if (stillNote) {
        stillNote.textContent = "Captured and saved " + (data.width || lockedWidth) + "x" + (data.height || lockedHeight) + " JPEG.";
      }
      if (liveSub) {
        liveSub.textContent =
          "Last still captured (" + (data.width || lockedWidth) + "x" + (data.height || lockedHeight) + ")";
      }
      await loadStills();
    } catch (err) {
      if (stillNote) {
        stillNote.textContent = friendlyCameraError(err);
      }
      setPlaceholder(friendlyCameraError(err));
    }
  }

  function setDefaults() {
    if (stillWidthInput) {
      stillWidthInput.value = lockedWidth;
    }
    if (stillHeightInput) {
      stillHeightInput.value = lockedHeight;
    }
    updateLiveSub();
  }

  async function renameSelected() {
    const still = getSelectedStill();
    if (!still) return;
    const next = prompt("New name", still.name || still.id);
    if (next == null) return;
    try {
      await fetch("/api/camera/stills/" + encodeURIComponent(still.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: next.trim() }),
      });
      pendingSelectId = still.id;
      await loadStills();
    } catch (_) {}
  }

  function openSelected() {
    const still = getSelectedStill();
    if (!still) return;
    window.open(still.url, "_blank", "noopener,noreferrer");
  }

  function downloadSelected() {
    const still = getSelectedStill();
    if (!still) return;
    const ts = still.created ? new Date(still.created).toISOString().replace(/[:.]/g, "-") : "latest";
    const safeName = (still.name || "camera").replace(/[^a-z0-9-_]+/gi, "_") || "camera";
    const a = document.createElement("a");
    a.href = still.url;
    a.download = safeName + "-" + ts + ".jpg";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  async function deleteSelected() {
    const still = getSelectedStill();
    if (!still) return;
    const ok = confirm("Delete " + (still.name || still.id) + "?");
    if (!ok) return;
    try {
      await fetch("/api/camera/stills/" + encodeURIComponent(still.id), { method: "DELETE" });
      selectedStillId = null;
      await loadStills();
    } catch (_) {}
  }

  async function loadStills() {
    if (!stillGrid || !stillEmpty) return;
    stillGrid.innerHTML = "";
    stillEmpty.style.display = "block";
    try {
      const res = await fetch("/api/camera/stills");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load stills");
      savedStills = Array.isArray(data) ? data : [];
      if (!savedStills.length) {
        stillEmpty.textContent = "No stills yet. Capture to save a JPG.";
        setSelectedStill(null);
        return;
      }
      stillEmpty.style.display = "none";
      const currentSelection = selectedStillId;
      savedStills.forEach((item) => {
        const wrap = document.createElement("div");
        wrap.className = "cam-still";
        wrap.dataset.stillId = item.id;
        wrap.tabIndex = 0;
        const img = document.createElement("img");
        img.src = item.url;
        img.alt = item.id;
        wrap.appendChild(img);

        const title = document.createElement("div");
        title.className = "cam-still-title";
        title.textContent = item.name || item.id;
        wrap.appendChild(title);

        const meta = document.createElement("div");
        meta.className = "cam-still-meta";
        const metaParts = [formatDate(item.created), formatBytes(item.size)].filter(Boolean);
        meta.textContent = metaParts.length ? metaParts.join(" · ") : "Saved still";
        wrap.appendChild(meta);

        wrap.addEventListener("click", () => setSelectedStill(item.id));
        wrap.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setSelectedStill(item.id);
          }
        });

        stillGrid.appendChild(wrap);
      });
      let nextSelection = null;
      if (pendingSelectId && savedStills.some((s) => s.id === pendingSelectId)) {
        nextSelection = pendingSelectId;
      } else if (currentSelection && savedStills.some((s) => s.id === currentSelection)) {
        nextSelection = currentSelection;
      } else if (savedStills.length) {
        nextSelection = savedStills[0].id;
      }
      pendingSelectId = null;
      setSelectedStill(nextSelection);
    } catch (err) {
      stillEmpty.style.display = "block";
      stillEmpty.textContent = err.message || "Failed to load stills.";
      setSelectedStill(null);
    }
  }

  if (openStreamBtn) {
    openStreamBtn.addEventListener("click", () => {
      if (!streamUrl) {
        setPlaceholder("Set CAMERA_STREAM_URL to open the live feed in a new tab.");
        return;
      }
      window.open(streamUrl, "_blank", "noopener,noreferrer");
    });
  }

  if (grabStillBtn) {
    grabStillBtn.addEventListener("click", captureStill);
  }
  if (captureStillBtn) {
    captureStillBtn.addEventListener("click", captureStill);
  }
  if (refreshStatusBtn) {
    refreshStatusBtn.addEventListener("click", () => refreshStatus());
  }
  if (refreshStillsBtn) {
    refreshStillsBtn.addEventListener("click", () => loadStills());
  }
  if (openStillBtn) {
    openStillBtn.addEventListener("click", openSelected);
  }
  if (downloadSelectedBtn) {
    downloadSelectedBtn.addEventListener("click", downloadSelected);
  }
  if (renameSelectedBtn) {
    renameSelectedBtn.addEventListener("click", renameSelected);
  }
  if (deleteSelectedBtn) {
    deleteSelectedBtn.addEventListener("click", deleteSelected);
  }

  setDefaults();
  updateSelectedState();
  refreshStatus();
  loadStills();

  return {
    refresh() {
      if (!isViewActive()) return;
      refreshStatus();
      if (streamUrl) {
        attachStream(false);
      }
      loadStills();
    },
  };
}
