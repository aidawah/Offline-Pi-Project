export function initCarTemp(isActive) {
  const tempCEl = document.getElementById("carTempC");
  const tempFEl = document.getElementById("carTempF");
  const humEl = document.getElementById("carHum");
  const metaEl = document.getElementById("carTempMeta");
  const isViewActive = typeof isActive === "function" ? isActive : () => true;

  async function fetchTemp() {
    if (!isViewActive()) return;
    try {
      const res = await fetch("/api/car-temp");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
      if (tempCEl) tempCEl.textContent = data.tempC.toFixed(1) + "°C";
      if (tempFEl) tempFEl.textContent = data.tempF.toFixed(1) + "°F";
      if (humEl) humEl.textContent = data.humidity.toFixed(1) + "%";
      if (metaEl) metaEl.textContent = "GPIO " + data.pin + " · DHT" + data.type;
    } catch (err) {
      if (metaEl) metaEl.textContent = "Sensor error: " + err.message;
    }
  }

  const interval = setInterval(fetchTemp, 4000);
  fetchTemp();

  return {
    refresh: fetchTemp,
    destroy() {
      clearInterval(interval);
    },
  };
}
