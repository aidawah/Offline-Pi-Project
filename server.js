const express = require("express");
const { exec } = require("child_process");
const https = require("https");
const http = require("http");
const path = require("path");
const os = require("os");
const fs = require("fs");

const app = express();
const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const HTTPS_PORT = Number.parseInt(process.env.HTTPS_PORT || "3443", 10);
const TLS_KEY_PATH = process.env.PICO_TLS_KEY_PATH || process.env.TLS_KEY_PATH;
const TLS_CERT_PATH = process.env.PICO_TLS_CERT_PATH || process.env.TLS_CERT_PATH;
const WEATHER_LAT = Number.isFinite(parseFloat(process.env.WEATHER_LAT))
  ? parseFloat(process.env.WEATHER_LAT)
  : 39.7392;
const WEATHER_LON = Number.isFinite(parseFloat(process.env.WEATHER_LON))
  ? parseFloat(process.env.WEATHER_LON)
  : -104.9903;
const WEATHER_CACHE_MS = 15 * 60 * 1000;
const MAP_TILE_URL =
  process.env.MAP_TILE_URL ||
  "http://127.0.0.1:8090/styles/bright/{z}/{x}/{y}.png"; // prefer local tileserver
const MAP_TILE_ATTRIB =
  process.env.MAP_TILE_ATTRIB || "(local tiles - set MAP_TILE_ATTRIB)";
const MAP_TILE_MAX_ZOOM = Number.isFinite(parseInt(process.env.MAP_TILE_MAX_ZOOM, 10))
  ? parseInt(process.env.MAP_TILE_MAX_ZOOM, 10)
  : 17;
const MAP_TILE_MAX_NATIVE_ZOOM = Number.isFinite(
  parseInt(process.env.MAP_TILE_MAX_NATIVE_ZOOM, 10)
)
  ? parseInt(process.env.MAP_TILE_MAX_NATIVE_ZOOM, 10)
  : MAP_TILE_MAX_ZOOM;
const MAP_TILE_FALLBACK_URL =
  process.env.MAP_TILE_FALLBACK_URL ||
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"; // only used if local tiles fail
const MAP_TILE_FALLBACK_ATTRIB =
  process.env.MAP_TILE_FALLBACK_ATTRIB || "(c) OpenStreetMap contributors";

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

let weatherCache = {
  ts: 0,
  lat: WEATHER_LAT,
  lon: WEATHER_LON,
  data: null,
};

// Expose minimal frontend config (tile source)
app.get("/config.js", (req, res) => {
  const config = {
    tiles: {
      url: MAP_TILE_URL,
      attribution: MAP_TILE_ATTRIB,
      maxZoom: MAP_TILE_MAX_ZOOM,
      maxNativeZoom: MAP_TILE_MAX_NATIVE_ZOOM,
      fallbackUrl: MAP_TILE_FALLBACK_URL,
      fallbackAttribution: MAP_TILE_FALLBACK_ATTRIB,
    },
  };
  res
    .type("application/javascript")
    .send("window.PICO_CONFIG=" + JSON.stringify(config) + ";");
});

// ---------- Helpers ----------
function readCpuTemp() {
  try {
    const raw = fs.readFileSync("/sys/class/thermal/thermal_zone0/temp", "utf8");
    const milli = parseInt(raw.trim(), 10);
    if (!Number.isNaN(milli)) return milli / 1000;
  } catch (err) {
    console.error("CPU temp read error:", err.message);
  }
  return null;
}

function readFanRpm() {
  // Scan /sys/class/hwmon/*/fan1_input for RPM
  try {
    const hwmonRoot = "/sys/class/hwmon";
    const entries = fs.readdirSync(hwmonRoot);
    for (const entry of entries) {
      const fanPath = path.join(hwmonRoot, entry, "fan1_input");
      try {
        const raw = fs.readFileSync(fanPath, "utf8");
        const rpm = parseInt(raw.trim(), 10);
        if (!Number.isNaN(rpm)) return rpm;
      } catch (_) {}
    }
  } catch (_) {}

  // Fallback: a couple of common platform paths
  const candidates = [
    "/sys/devices/platform/cooling_fan/hwmon/hwmon0/fan1_input",
    "/sys/devices/platform/rpi_fan/hwmon/hwmon0/fan1_input",
  ];
  for (const p of candidates) {
    try {
      const raw = fs.readFileSync(p, "utf8");
      const rpm = parseInt(raw.trim(), 10);
      if (!Number.isNaN(rpm)) return rpm;
    } catch (_) {}
  }
  return null;
}

function runCmd(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { encoding: "utf8" }, (err, stdout) => {
      if (err || !stdout) return resolve("");
      resolve(stdout);
    });
  });
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (resp) => {
        let data = "";
        resp.on("data", (chunk) => {
          data += chunk;
        });
        resp.on("end", () => {
          try {
            const json = JSON.parse(data);
            resolve(json);
          } catch (err) {
            reject(err);
          }
        });
      })
      .on("error", (err) => reject(err));
  });
}

function summarizeInterfaces(ipRouteText) {
  const ifacesRaw = os.networkInterfaces();

  function summarizeOne(name, type) {
    const info = {
      name,
    type,
      ipv4: null,
      ipv6: null,
      mac: null,
      gateway: null,
      up: false,
    };
    const entries = ifacesRaw[name] || [];
    for (const e of entries) {
      if (e.family === "IPv4") {
        info.ipv4 = e.address;
        info.up = true;
      } else if (e.family === "IPv6" && !e.internal) {
        info.ipv6 = e.address;
      }
      if (e.mac && e.mac !== "00:00:00:00:00:00") {
        info.mac = e.mac;
      }
    }

    const lines = ipRouteText.split("\n");
    for (const line of lines) {
      if (line.startsWith("default ") && line.includes(" dev " + name + " ")) {
        const parts = line.trim().split(/\s+/);
        const viaIndex = parts.indexOf("via");
        if (viaIndex >= 0 && parts[viaIndex + 1]) {
          info.gateway = parts[viaIndex + 1];
        }
      }
    }

    return info;
  }

  return {
    eth0: summarizeOne("eth0", "ethernet"),
    wlan0: summarizeOne("wlan0", "wifi"),
  };
}

function readHotspotClients() {
  // Try a few likely lease file locations first
  const candidates = [
    "/run/NetworkManager/dnsmasq-Hotspot.leases",
    "/run/nm-dnsmasq-Hotspot.leases",
    "/var/lib/NetworkManager/dnsmasq-Hotspot.leases",
  ];

  let clients = [];

  function parseLeaseText(text) {
    const out = [];
    const lines = text.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+/);
      let ip = null;
      let mac = null;
      let host = null;
      for (const p of parts) {
        if (!ip && /^\d+\.\d+\.\d+\.\d+$/.test(p)) ip = p;
        else if (!mac && /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(p)) mac = p;
      }
      if (parts.length >= 4) {
        const candidateHost = parts[3];
        if (candidateHost && candidateHost !== "*") host = candidateHost;
      }
      if (ip && mac) {
        out.push({ ip, mac, host });
      }
    }
    return out;
  }

  for (const file of candidates) {
    if (fs.existsSync(file)) {
      try {
        const text = fs.readFileSync(file, "utf8");
        clients = parseLeaseText(text);
        if (clients.length > 0) return clients;
      } catch (_) {}
    }
  }

  // Fallback: ARP table on wlan0 (10.42.x.x clients)
  try {
    const arpText = fs.readFileSync("/proc/net/arp", "utf8");
    const lines = arpText.split("\n").slice(1);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 6) {
        const ip = parts[0];
        const mac = parts[3];
        const dev = parts[5];
        if (dev === "wlan0" && /^10\.42\./.test(ip)) {
          clients.push({ ip, mac, host: null });
        }
      }
    }
  } catch (_) {}

  return clients;
}

// ---------- System stats API ----------
app.get("/api/system-stats", (req, res) => {
  const cpuTempC = readCpuTemp();
  const load = os.loadavg()[0];
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const uptime = os.uptime();
  const fanRpm = readFanRpm();
  const cores = os.cpus() ? os.cpus().length : null;

  res.json({
    cpuTempC,
    load,
    totalMem,
    usedMem,
    uptime,
    fanRpm,
    cores,
  });
});

// ---------- Network info API ----------
app.get("/api/network-info", async (req, res) => {
  try {
    const ipRoute = await runCmd("ip route");
    const nmActive = await runCmd(
      "nmcli -t -f NAME,DEVICE,TYPE,STATE connection show --active"
    );

    const interfaces = summarizeInterfaces(ipRoute);
    const clients = readHotspotClients();

    res.json({
      interfaces,
      nmActive,
      clients,
    });
  } catch (err) {
    console.error("Network info error:", err);
    res.status(500).json({ error: "Failed to get network info" });
  }
});

// ---------- Reboot API ----------
app.post("/api/reboot", (req, res) => {
  exec("sudo /sbin/reboot", (error) => {
    if (error) {
      console.error("Reboot error:", error.message);
      return res.status(500).json({ error: error.message });
    }
    res.json({ message: "Rebooting..." });
  });
});

// ---------- Weather API ----------
app.get("/api/weather", async (req, res) => {
  const lat = Number.isFinite(parseFloat(req.query.lat))
    ? parseFloat(req.query.lat)
    : parseFloat(WEATHER_LAT);
  const lon = Number.isFinite(parseFloat(req.query.lon))
    ? parseFloat(req.query.lon)
    : parseFloat(WEATHER_LON);

  const now = Date.now();
  const cacheValid =
    weatherCache.data &&
    weatherCache.lat === lat &&
    weatherCache.lon === lon &&
    now - weatherCache.ts < WEATHER_CACHE_MS;

  if (cacheValid) {
    return res.json(weatherCache.data);
  }

  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${lat}&longitude=${lon}` +
    "&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_mean,precipitation_hours,precipitation_sum,sunrise,sunset,windspeed_10m_max,winddirection_10m_dominant,uv_index_max" +
    "&timezone=auto&forecast_days=7&temperature_unit=fahrenheit&windspeed_unit=mph&precipitation_unit=inch";

  try {
    const json = await fetchJson(url);
    if (!json || !json.daily || !Array.isArray(json.daily.time)) {
      throw new Error("Malformed response from weather provider");
    }

    const days = json.daily.time.map((date, idx) => ({
      date,
      weatherCode:
        json.daily.weathercode && json.daily.weathercode[idx] != null
          ? json.daily.weathercode[idx]
          : null,
      tempMax:
        json.daily.temperature_2m_max &&
        json.daily.temperature_2m_max[idx] != null
          ? json.daily.temperature_2m_max[idx]
          : null,
      tempMin:
        json.daily.temperature_2m_min &&
        json.daily.temperature_2m_min[idx] != null
          ? json.daily.temperature_2m_min[idx]
          : null,
      precipProb:
        json.daily.precipitation_probability_mean &&
        json.daily.precipitation_probability_mean[idx] != null
          ? json.daily.precipitation_probability_mean[idx]
          : null,
      precipHours:
        json.daily.precipitation_hours &&
        json.daily.precipitation_hours[idx] != null
          ? json.daily.precipitation_hours[idx]
          : null,
      precipSum:
        json.daily.precipitation_sum && json.daily.precipitation_sum[idx] != null
          ? json.daily.precipitation_sum[idx]
          : null,
      sunrise:
        json.daily.sunrise && json.daily.sunrise[idx] != null
          ? json.daily.sunrise[idx]
          : null,
      sunset:
        json.daily.sunset && json.daily.sunset[idx] != null
          ? json.daily.sunset[idx]
          : null,
      windSpeedMax:
        json.daily.windspeed_10m_max && json.daily.windspeed_10m_max[idx] != null
          ? json.daily.windspeed_10m_max[idx]
          : null,
      windDir:
        json.daily.winddirection_10m_dominant &&
        json.daily.winddirection_10m_dominant[idx] != null
          ? json.daily.winddirection_10m_dominant[idx]
          : null,
      uvIndex:
        json.daily.uv_index_max && json.daily.uv_index_max[idx] != null
          ? json.daily.uv_index_max[idx]
          : null,
    }));

    const payload = {
      latitude: json.latitude,
      longitude: json.longitude,
      timezone: json.timezone,
      days,
    };

    weatherCache = {
      ts: now,
      lat,
      lon,
      data: payload,
    };

    res.json(payload);
  } catch (err) {
    console.error("Weather API error:", err.message);
    res.status(500).json({ error: "Failed to load weather forecast" });
  }
});

const httpServer = http.createServer(app);
httpServer.listen(PORT, () => {
  console.log(`Pi Control HTTP server listening on port ${PORT}`);
});

if (TLS_KEY_PATH && TLS_CERT_PATH) {
  try {
    const httpsOpts = {
      key: fs.readFileSync(TLS_KEY_PATH),
      cert: fs.readFileSync(TLS_CERT_PATH),
    };
    https.createServer(httpsOpts, app).listen(HTTPS_PORT, () => {
      console.log(`Pi Control HTTPS server listening on port ${HTTPS_PORT}`);
    });
  } catch (err) {
    console.error("Failed to start HTTPS server:", err.message);
  }
} else {
  console.log("HTTPS disabled (set PICO_TLS_KEY_PATH and PICO_TLS_CERT_PATH to enable)");
}
