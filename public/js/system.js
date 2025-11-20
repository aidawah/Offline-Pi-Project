function clampPercent(value) {
  return Math.max(0, Math.min(100, value));
}

export function initSystem(isActive) {
  const gaugeRings = {
    cpuMain: document.querySelector('[data-gauge="cpu-main"]'),
    cpuLoad: document.querySelector('[data-gauge="cpu-load"]'),
    mem: document.querySelector('[data-gauge="mem"]'),
    fan: document.querySelector('[data-gauge="fan"]'),
  };

  const centerValueEl = document.getElementById("center-value");
  const centerSubEl = document.getElementById("center-sub");
  const miniCpuVal = document.getElementById("mini-cpu");
  const miniCpuSub = document.getElementById("mini-cpu-sub");
  const miniRamVal = document.getElementById("mini-ram");
  const miniRamSub = document.getElementById("mini-ram-sub");
  const miniFanVal = document.getElementById("mini-fan");
  const miniFanSub = document.getElementById("mini-fan-sub");
  const statusEl = document.getElementById("status");

  function setGauge(name, percent, accent) {
    const ring = gaugeRings[name];
    if (!ring) return;
    const p = clampPercent(percent);
    ring.style.setProperty("--value", p);
    if (accent) {
      ring.style.setProperty("--accent-color", accent);
    }
  }

  function formatBytes(bytes) {
    const gb = bytes / (1024 * 1024 * 1024);
    return gb.toFixed(2) + " GB";
  }

  function formatUptime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const parts = [];
    if (h) parts.push(h + "h");
    if (m || h) parts.push(m + "m");
    parts.push(s + "s");
    return parts.join(" ");
  }

  async function updateStats() {
    if (!isActive()) return;
    try {
      const res = await fetch("/api/system-stats");
      if (!res.ok) throw new Error("HTTP " + res.status);
      const d = await res.json();

      const { cpuTempC, load, totalMem, usedMem, uptime, fanRpm } = d;

      if (cpuTempC != null) {
        const temp = cpuTempC;
        centerValueEl.textContent = temp.toFixed(0);
        centerSubEl.textContent = "CPU: " + temp.toFixed(1) + " C · Uptime: " + formatUptime(uptime || 0);

        let color = "var(--accent)";
        if (temp >= 70) color = "var(--accent-hot)";
        else if (temp >= 60) color = "var(--accent-warn)";

        const pct = Math.min((temp / 85) * 100, 100);
        setGauge("cpuMain", pct, color);
      } else {
        centerValueEl.textContent = "N/A";
        centerSubEl.textContent = "CPU temperature not available.";
        setGauge("cpuMain", 0, "var(--muted)");
      }

      if (typeof load === "number") {
        const pctRaw = load * 100;
        const pct = Math.max(0, Math.min(100, pctRaw));
        const display = pct > 0 && pct < 1 ? 1 : Math.round(pct);

        miniCpuVal.textContent = display + "%";
        miniCpuSub.textContent = load.toFixed(2) + " load (1 min)";

        let color = "var(--accent2)";
        if (pct >= 80) color = "var(--accent-hot)";
        else if (pct >= 60) color = "var(--accent-warn)";
        setGauge("cpuLoad", pct, color);
      } else {
        miniCpuVal.textContent = "N/A";
        miniCpuSub.textContent = "No load data.";
        setGauge("cpuLoad", 0, "var(--muted)");
      }

      if (totalMem != null && usedMem != null) {
        const pct = (usedMem / totalMem) * 100;
        miniRamVal.textContent = Math.round(pct) + "%";
        miniRamSub.textContent = formatBytes(usedMem) + " / " + formatBytes(totalMem);

        let color = "var(--accent2)";
        if (pct >= 80) color = "var(--accent-hot)";
        else if (pct >= 60) color = "var(--accent-warn)";
        setGauge("mem", pct, color);
      } else {
        miniRamVal.textContent = "N/A";
        miniRamSub.textContent = "Memory info not available.";
        setGauge("mem", 0, "var(--muted)");
      }

      if (fanRpm != null) {
        const rpm = fanRpm;
        miniFanVal.textContent = rpm + " RPM";
        miniFanSub.textContent = "Approx. speed";

        miniFanVal.style.fontSize = rpm >= 1000 ? "0.85rem" : "1.1rem";
        const pct = Math.min((rpm / 5000) * 100, 100);
        setGauge("fan", pct, "var(--accent)");
      } else {
        miniFanVal.textContent = "N/A";
        miniFanSub.textContent = "No RPM sensor detected - this is normal on many fans.";
        miniFanVal.style.fontSize = "1.1rem";
        setGauge("fan", 0, "var(--muted)");
      }

      statusEl.textContent = "";
    } catch (err) {
      statusEl.textContent = "Stats error: " + err.message;
    }
  }

  const interval = setInterval(() => {
    if (isActive()) {
      updateStats();
    }
  }, 2000);

  updateStats();

  const rebootBtn = document.getElementById("rebootBtn");
  if (rebootBtn) {
    rebootBtn.addEventListener("click", async () => {
      if (!confirm("Are you sure you want to reboot the Pi?")) return;

      rebootBtn.disabled = true;
      statusEl.textContent = "Sending reboot command...";

      try {
        const res = await fetch("/api/reboot", { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          statusEl.textContent = "Rebooting... hotspot will drop for a bit then come back.";
        } else {
          statusEl.textContent = "Reboot failed: " + (data.error || "Unknown error");
        }
      } catch (err) {
        statusEl.textContent = "Error talking to server: " + err.message;
      } finally {
        setTimeout(() => {
          rebootBtn.disabled = false;
        }, 5000);
      }
    });
  }

  return {
    refresh: updateStats,
    destroy() {
      clearInterval(interval);
    },
  };
}
