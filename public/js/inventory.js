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

function friendlyCameraError(err) {
  const msg = (err && err.message ? String(err.message) : "") || "";
  if (!msg) return "Operation failed.";
  const parts = msg.split("\n").map((p) => p.trim()).filter(Boolean);
  const compact = parts.join(" ");
  return compact.length > 220 ? compact.slice(0, 200).trim() + "…" : compact;
}

document.addEventListener("DOMContentLoaded", () => {
  const stillGrid = document.getElementById("stillGrid");
  const stillEmpty = document.getElementById("stillEmpty");
  const selectedStillImg = document.getElementById("selectedStillImg");
  const selectedStillEmpty = document.getElementById("selectedStillEmpty");
  const selectedStillTitle = document.getElementById("selectedStillTitle");
  const selectedStillMeta = document.getElementById("selectedStillMeta");
  const openStillBtn = document.getElementById("openStillBtn");
  const downloadSelectedBtn = document.getElementById("downloadSelectedBtn");
  const renameSelectedBtn = document.getElementById("renameSelectedBtn");
  const deleteSelectedBtn = document.getElementById("deleteSelectedBtn");
  const refreshBtn = document.getElementById("refreshStillsBtn");
  const backLink = document.getElementById("backToCamera");

  let savedStills = [];
  let selectedStillId = null;
  let pendingSelectId = null;

  function getSelectedStill() {
    return savedStills.find((s) => s.id === selectedStillId) || null;
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
      selectedStillEmpty.style.display = hasStill ? "none" : "grid";
    }
    if (selectedStillTitle) {
      selectedStillTitle.textContent = hasStill ? still.name || still.id : "No still selected";
    }
    if (selectedStillMeta) {
      const metaParts = hasStill ? [formatDate(still.created), formatBytes(still.size)].filter(Boolean) : [];
      selectedStillMeta.textContent = metaParts.length ? metaParts.join(" · ") : hasStill ? "Saved still" : "Pick a still from the list.";
    }

    [openStillBtn, downloadSelectedBtn, renameSelectedBtn, deleteSelectedBtn].forEach((btn) => {
      if (btn) btn.disabled = !hasStill;
    });

    if (stillGrid) {
      const cards = stillGrid.querySelectorAll("[data-still-id]");
      cards.forEach((card) => {
        card.classList.toggle("selected", card.dataset.stillId === selectedStillId);
      });
    }
  }

  function setSelectedStill(id) {
    selectedStillId = id || null;
    updateSelectedState();
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
        stillEmpty.textContent = "No stills yet. Capture one from the camera view.";
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
      stillEmpty.textContent = friendlyCameraError(err);
      setSelectedStill(null);
    }
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
    } catch (err) {
      alert(friendlyCameraError(err));
    }
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
    } catch (err) {
      alert(friendlyCameraError(err));
    }
  }

  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => loadStills());
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
  if (backLink) {
    backLink.addEventListener("click", (e) => {
      e.preventDefault();
      window.location.href = "/#view-camera";
    });
  }

  loadStills();
});
