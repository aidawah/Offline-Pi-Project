export function initWeather(isActive) {
  const DEFAULT_WEATHER = {
    lat: 39.7392,
    lon: -104.9903,
    name: "Denver, CO",
  };

  const weatherGrid = document.getElementById("weatherGrid");
  const weatherStatus = document.getElementById("weatherStatus");
  const weatherLocation = document.getElementById("weatherLocation");
  const weatherDetail = document.getElementById("weatherDetail");
  const detailClose = document.getElementById("detailClose");
  const detailDate = document.getElementById("detailDate");
  const detailTemp = document.getElementById("detailTemp");
  const detailSummary = document.getElementById("detailSummary");
  const detailPrecip = document.getElementById("detailPrecip");
  const detailGrid = document.getElementById("detailGrid");
  const weatherNameInput = document.getElementById("weatherNameInput");
  const weatherLatInput = document.getElementById("weatherLatInput");
  const weatherLonInput = document.getElementById("weatherLonInput");
  const weatherSaveBtn = document.getElementById("weatherSaveBtn");
  const weatherRefreshBtn = document.getElementById("weatherRefreshBtn");
  const weatherDefaultBtn = document.getElementById("weatherDefaultBtn");

  let lastWeatherFetch = 0;
  let lastWeatherDays = [];
  const WEATHER_STORAGE_KEY = "picoWeatherLocation";
  let savedWeatherCoords = loadSavedWeatherCoords();

  function loadSavedWeatherCoords() {
    try {
      const raw = localStorage.getItem(WEATHER_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        Number.isFinite(Number(parsed.lat)) &&
        Number.isFinite(Number(parsed.lon))
      ) {
        return { lat: Number(parsed.lat), lon: Number(parsed.lon), name: parsed.name || "" };
      }
    } catch (_) {}
    return null;
  }

  function saveWeatherCoords(lat, lon, name) {
    savedWeatherCoords = { lat, lon, name: name || "" };
    localStorage.setItem(WEATHER_STORAGE_KEY, JSON.stringify(savedWeatherCoords));
    updateWeatherInputs(lat, lon);
    if (weatherNameInput) weatherNameInput.value = name || "";
  }

  function updateWeatherInputs(lat, lon, name) {
    if (weatherLatInput && Number.isFinite(lat)) weatherLatInput.value = lat;
    if (weatherLonInput && Number.isFinite(lon)) weatherLonInput.value = lon;
    if (weatherNameInput && typeof name === "string") weatherNameInput.value = name;
  }

  function weatherCodeMeta(code) {
    const numeric = Number(code);
    const mappedCode = Number.isFinite(numeric) ? numeric : null;
    const buckets = [
      { codes: [0], meta: { icon: "SUN", label: "Clear sky" } },
      { codes: [1, 2], meta: { icon: "PART", label: "Partly cloudy" } },
      { codes: [3], meta: { icon: "CLOUD", label: "Overcast" } },
      { codes: [45, 48], meta: { icon: "FOG", label: "Foggy" } },
      { codes: [51, 53, 55, 56, 57], meta: { icon: "DRIZ", label: "Drizzle" } },
      { codes: [61, 63, 65, 80, 81, 82], meta: { icon: "RAIN", label: "Rain showers" } },
      { codes: [66, 67], meta: { icon: "ICE", label: "Freezing rain" } },
      { codes: [71, 73, 75, 77, 85, 86], meta: { icon: "SNOW", label: "Snow" } },
      { codes: [95, 96, 99], meta: { icon: "STORM", label: "Thunder" } },
    ];

    for (const bucket of buckets) {
      if (bucket.codes.includes(mappedCode)) return bucket.meta;
    }
    return { icon: "VAR", label: "Variable sky" };
  }

  function formatDateLabel(dateStr) {
    if (!dateStr) return "Unknown date";
    const date = new Date(dateStr + "T12:00:00");
    if (isNaN(date.getTime())) return dateStr;
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return days[date.getDay()] + " " + month + "/" + day;
  }

  function formatTime(str) {
    if (!str) return "--";
    const d = new Date(str);
    if (isNaN(d.getTime())) return "--";
    const h = d.getHours();
    const m = d.getMinutes();
    const hr = h % 12 || 12;
    const mm = m < 10 ? "0" + m : m;
    const suffix = h >= 12 ? "PM" : "AM";
    return hr + ":" + mm + " " + suffix;
  }

  function closeWeatherDetail() {
    weatherDetail.classList.remove("active");
  }

  function showWeatherDetail(day) {
    if (!day) return;
    const meta = weatherCodeMeta(day.weatherCode);

    detailDate.textContent = formatDateLabel(day.date);
    const hi = Number.isFinite(Number(day.tempMax)) ? Math.round(Number(day.tempMax)) + "F" : "--";
    const lo = Number.isFinite(Number(day.tempMin)) ? Math.round(Number(day.tempMin)) + "F" : "--";
    detailTemp.textContent = hi + " / " + lo;
    detailSummary.textContent = meta.label;

    const precipParts = [];
    if (Number.isFinite(Number(day.precipProb))) {
      precipParts.push(Number(day.precipProb) + "% chance");
    }
    if (Number.isFinite(Number(day.precipSum))) {
      precipParts.push(Number(day.precipSum).toFixed(2) + " in total");
    }
    if (Number.isFinite(Number(day.precipHours))) {
      precipParts.push(Number(day.precipHours).toFixed(1) + " hrs");
    }
    detailPrecip.textContent = precipParts.join(" | ") || "Precip data n/a";

    const detailItems = [
      { label: "Sunrise", value: formatTime(day.sunrise) },
      { label: "Sunset", value: formatTime(day.sunset) },
      {
        label: "Wind Max",
        value: Number.isFinite(Number(day.windSpeedMax))
          ? Number(day.windSpeedMax).toFixed(1) + " mph"
          : "--",
      },
      {
        label: "Wind Dir",
        value: Number.isFinite(Number(day.windDir)) ? Number(day.windDir).toFixed(0) + " deg" : "--",
      },
      {
        label: "UV Index",
        value: Number.isFinite(Number(day.uvIndex)) ? Number(day.uvIndex).toFixed(1) : "--",
      },
    ];

    detailGrid.innerHTML = "";
    detailItems.forEach((item) => {
      const div = document.createElement("div");
      div.className = "detail-item";
      div.innerHTML = `
        <div class="detail-label">${item.label}</div>
        <div class="detail-value">${item.value}</div>
      `;
      detailGrid.appendChild(div);
    });

    weatherDetail.classList.add("active");
  }

  function renderWeather(days) {
    weatherGrid.innerHTML = "";
    days.slice(0, 7).forEach((day, idx) => {
      const meta = weatherCodeMeta(day.weatherCode);
      const hi = Number.isFinite(Number(day.tempMax)) ? Math.round(Number(day.tempMax)) + "F" : "--";
      const lo = Number.isFinite(Number(day.tempMin)) ? Math.round(Number(day.tempMin)) + "F" : "--";

      const precipParts = [];
      if (Number.isFinite(Number(day.precipProb))) {
        precipParts.push(Number(day.precipProb) + "% chance");
      }
      if (Number.isFinite(Number(day.precipHours))) {
        precipParts.push(Number(day.precipHours).toFixed(1) + "h precip");
      }
      const precipText = precipParts.join(" | ") || "Precip data n/a";

      const card = document.createElement("div");
      card.className = "weather-day";
      card.innerHTML = `
        <div class="weather-top">
          <div class="weather-label">${formatDateLabel(day.date)}</div>
          <div class="weather-icon">${meta.icon}</div>
        </div>
        <div class="weather-temp">${hi} / ${lo}</div>
        <div class="weather-sub">${meta.label}</div>
        <div class="weather-prob">${precipText}</div>
      `;
      card.addEventListener("click", () => showWeatherDetail(days[idx]));
      weatherGrid.appendChild(card);
    });
  }

  async function updateWeather(force = false) {
    if (!isActive()) return;
    const now = Date.now();
    const lat = weatherLatInput ? parseFloat(weatherLatInput.value) : null;
    const lon = weatherLonInput ? parseFloat(weatherLonInput.value) : null;
    const validLat = Number.isFinite(lat)
      ? lat
      : savedWeatherCoords?.lat ?? DEFAULT_WEATHER.lat;
    const validLon = Number.isFinite(lon)
      ? lon
      : savedWeatherCoords?.lon ?? DEFAULT_WEATHER.lon;

    if (!force && now - lastWeatherFetch < 60000 && weatherGrid.children.length) {
      return;
    }
    weatherStatus.textContent = "Loading forecast...";
    try {
      const qs =
        Number.isFinite(validLat) && Number.isFinite(validLon)
          ? `?lat=${validLat}&lon=${validLon}`
          : "";
      const res = await fetch("/api/weather" + qs);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (!data || !Array.isArray(data.days)) {
        throw new Error("No forecast data");
      }

      lastWeatherDays = data.days;
      renderWeather(data.days);

      const locBits = [];
      const latLabel =
        data.latitude != null ? "Lat " + Number(data.latitude).toFixed(2) : null;
      const lonLabel =
        data.longitude != null ? "Lon " + Number(data.longitude).toFixed(2) : null;

      if (data.latitude != null || data.longitude != null) {
        updateWeatherInputs(
          Number(data.latitude),
          Number(data.longitude),
          savedWeatherCoords?.name || weatherNameInput?.value || ""
        );
      }

      if (latLabel) locBits.push(latLabel);
      if (lonLabel) locBits.push(lonLabel);

      const inputName = weatherNameInput ? weatherNameInput.value.trim() : "";
      const namePart = inputName || (savedWeatherCoords && savedWeatherCoords.name) || "";

      if (namePart) locBits.push(namePart);

      weatherLocation.textContent = locBits.filter(Boolean).join(" | ") || "Forecast location";

      weatherStatus.textContent = "Updated " + new Date().toLocaleTimeString();
      lastWeatherFetch = now;
    } catch (err) {
      weatherStatus.textContent = "Could not load weather: " + err.message;
    }
  }

  if (detailClose) {
    detailClose.addEventListener("click", closeWeatherDetail);
  }
  if (weatherDetail) {
    weatherDetail.addEventListener("click", (e) => {
      if (e.target === weatherDetail) closeWeatherDetail();
    });
  }

  const interval = setInterval(() => {
    if (isActive()) {
      updateWeather();
    }
  }, 15 * 60 * 1000);

  if (weatherSaveBtn) {
    weatherSaveBtn.addEventListener("click", () => {
      const lat = weatherLatInput ? parseFloat(weatherLatInput.value) : null;
      const lon = weatherLonInput ? parseFloat(weatherLonInput.value) : null;
      const name = weatherNameInput ? weatherNameInput.value.trim() : "";
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        weatherStatus.textContent = "Enter a valid latitude and longitude.";
        return;
      }
      saveWeatherCoords(lat, lon, name);
      updateWeather(true);
    });
  }

  if (weatherRefreshBtn) {
    weatherRefreshBtn.addEventListener("click", () => {
      updateWeather(true);
    });
  }

  if (savedWeatherCoords) {
    updateWeatherInputs(
      savedWeatherCoords.lat,
      savedWeatherCoords.lon,
      savedWeatherCoords.name || ""
    );
  } else {
    updateWeatherInputs(DEFAULT_WEATHER.lat, DEFAULT_WEATHER.lon, DEFAULT_WEATHER.name);
  }

  if (weatherDefaultBtn) {
    weatherDefaultBtn.addEventListener("click", () => {
      updateWeatherInputs(DEFAULT_WEATHER.lat, DEFAULT_WEATHER.lon, "");
      updateWeather(true);
    });
  }

  if (document.getElementById("weatherSavedBtn")) {
    const weatherSavedBtn = document.getElementById("weatherSavedBtn");
    weatherSavedBtn.addEventListener("click", () => {
      if (!savedWeatherCoords) {
        weatherStatus.textContent = "No saved location yet.";
        return;
      }
      updateWeatherInputs(
        savedWeatherCoords.lat,
        savedWeatherCoords.lon,
        savedWeatherCoords.name || ""
      );
      updateWeather(true);
    });
  }

  return {
    refresh: updateWeather,
    destroy() {
      clearInterval(interval);
    },
    lastWeatherDays,
  };
}
