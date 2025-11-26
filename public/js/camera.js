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
  const isViewActive = typeof isActive === "function" ? isActive : () => true;

  const cameraCfg = (window.PICO_CONFIG && window.PICO_CONFIG.camera) || {};
  const defaults = cameraCfg.snapshotDefault || {};
  const maxStill = cameraCfg.maxStill || { width: 2592, height: 1944 };
  let streamUrl = cameraCfg.streamUrl || "/camera/stream";
  let lastStill = null;
  let lastStillTs = null;

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

  function setLiveImage(src) {
    if (!liveImg || !src) return;
    liveImg.src = src;
    liveImg.style.display = "block";
    if (placeholder) {
      placeholder.classList.remove("visible");
      placeholder.style.display = "none";
    }
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
    if (placeholder) placeholder.classList.remove("visible");
  }

  if (liveImg) {
    liveImg.addEventListener("error", () => {
      setPlaceholder("Stream not reachable. Start libcamera-vid or verify the URL.");
    });
  }

  async function captureStill() {
    if (stillNote) stillNote.textContent = "Capturing still...";
    const w = clampDim(
      stillWidthInput ? stillWidthInput.value : null,
      320,
      maxStill.width || 2592,
      defaults.width || 1600
    );
    const h = clampDim(
      stillHeightInput ? stillHeightInput.value : null,
      240,
      maxStill.height || 1944,
      defaults.height || 900
    );

    try {
      const res = await fetch("/api/camera/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ width: w, height: h }),
      });
      const data = await res.json();
      if (!res.ok || !data.image) {
        throw new Error((data && data.error) || "Snapshot failed");
      }
      lastStill = data.image;
      lastStillTs = Date.now();
      setLiveImage(lastStill);
      updateDownloadState();
      if (stillNote) {
        stillNote.textContent = "Captured " + (data.width || w) + "x" + (data.height || h) + " JPEG.";
      }
      if (liveSub) {
        liveSub.textContent = "Last still captured (" + (data.width || w) + "x" + (data.height || h) + ")";
      }
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
    if (stillWidthInput && !stillWidthInput.value) {
      stillWidthInput.value = defaults.width || 1600;
    }
    if (stillHeightInput && !stillHeightInput.value) {
      stillHeightInput.value = defaults.height || 900;
    }
    updateDownloadState();
    updateLiveSub();
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

  setDefaults();
  refreshStatus();

  return {
    refresh() {
      if (!isViewActive()) return;
      refreshStatus();
      if (streamUrl) {
        attachStream(false);
      }
    },
  };
}
