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
  const downloadStillBtn = document.getElementById("downloadStillBtn");
  const stillWidthInput = document.getElementById("stillWidthInput");
  const stillHeightInput = document.getElementById("stillHeightInput");
  const stillNote = document.getElementById("cameraStillNote");
  const refreshStatusBtn = document.getElementById("cameraRefreshBtn");
  const stillGrid = document.getElementById("stillGrid");
  const stillEmpty = document.getElementById("stillEmpty");
  const refreshStillsBtn = document.getElementById("refreshStillsBtn");
  const isViewActive = typeof isActive === "function" ? isActive : () => true;

  const cameraCfg = (window.PICO_CONFIG && window.PICO_CONFIG.camera) || {};
  const defaults = cameraCfg.snapshotDefault || {};
  const maxStill = cameraCfg.maxStill || { width: 4656, height: 3496 };
  const lockedWidth = defaults.width || 1600;
  const lockedHeight = defaults.height || 900;
  let streamUrl = cameraCfg.streamUrl || "/camera/stream";
  let lastStill = null;
  let lastStillTs = null;
  let savedStills = [];

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

  function updateDownloadState() {
    if (downloadStillBtn) {
      downloadStillBtn.disabled = !lastStill;
    }
  }

  function describeDevices(devices) {
    if (!devices || !devices.length) return "No /dev/video* nodes detected.";
    if (devices.length === 1) return "Detected " + devices[0];
    return "Detected " + devices.join(", ");
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
      const res = await fetch("/api/camera/stills", { method: "POST", headers: { "Content-Type": "application/json" } });
      const data = await res.json();
      if (!res.ok || !data.url) {
        throw new Error((data && data.error) || "Snapshot failed");
      }
      lastStill = data.url;
      lastStillTs = Date.now();
      setLiveImage(data.url);
      updateDownloadState();
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
        stillNote.textContent = err && err.message ? err.message : "Failed to capture still.";
      }
      setPlaceholder("Snapshot failed. Check cabling and libcamera-still availability.");
    }
  }

  function downloadStill() {
    if (!lastStill) return;
    const a = document.createElement("a");
    const ts = lastStillTs ? new Date(lastStillTs).toISOString().replace(/[:.]/g, "-") : "latest";
    a.href = lastStill;
    a.download = "camera-" + ts + ".jpg";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function setDefaults() {
    if (stillWidthInput) {
      stillWidthInput.value = lockedWidth;
    }
    if (stillHeightInput) {
      stillHeightInput.value = lockedHeight;
    }
    updateDownloadState();
    updateLiveSub();
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
        return;
      }
      stillEmpty.style.display = "none";
      savedStills.forEach((item) => {
        const wrap = document.createElement("div");
        wrap.className = "cam-still";
        const img = document.createElement("img");
        img.src = item.url;
        img.alt = item.id;
        wrap.appendChild(img);

        const actions = document.createElement("div");
        actions.className = "cam-still-actions";
        const view = document.createElement("a");
        view.href = item.url;
        view.target = "_blank";
        view.rel = "noopener";
        view.textContent = "View";
        const del = document.createElement("button");
        del.textContent = "Delete";
        del.addEventListener("click", async () => {
          try {
            await fetch("/api/camera/stills/" + encodeURIComponent(item.id), { method: "DELETE" });
            await loadStills();
          } catch (_) {}
        });
        actions.appendChild(view);
        actions.appendChild(del);
        wrap.appendChild(actions);

        stillGrid.appendChild(wrap);
      });
    } catch (err) {
      stillEmpty.style.display = "block";
      stillEmpty.textContent = err.message || "Failed to load stills.";
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
  if (downloadStillBtn) {
    downloadStillBtn.addEventListener("click", downloadStill);
  }
  if (refreshStatusBtn) {
    refreshStatusBtn.addEventListener("click", () => refreshStatus());
  }
  if (refreshStillsBtn) {
    refreshStillsBtn.addEventListener("click", () => loadStills());
  }

  setDefaults();
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
