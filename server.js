const express = require("express");
const { exec, spawn } = require("child_process");
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
const CAMERA_STREAM_URL = process.env.CAMERA_STREAM_URL || "/camera/stream";
const CAMERA_STILL_WIDTH = Number.isFinite(parseInt(process.env.CAMERA_STILL_WIDTH, 10))
  ? parseInt(process.env.CAMERA_STILL_WIDTH, 10)
  : 1600;
const CAMERA_STILL_HEIGHT = Number.isFinite(parseInt(process.env.CAMERA_STILL_HEIGHT, 10))
  ? parseInt(process.env.CAMERA_STILL_HEIGHT, 10)
  : 900;
const CAMERA_PIPE_WIDTH = Number.isFinite(parseInt(process.env.CAMERA_PIPE_WIDTH, 10))
  ? parseInt(process.env.CAMERA_PIPE_WIDTH, 10)
  : 1280;
const CAMERA_PIPE_HEIGHT = Number.isFinite(parseInt(process.env.CAMERA_PIPE_HEIGHT, 10))
  ? parseInt(process.env.CAMERA_PIPE_HEIGHT, 10)
  : 720;
const CAMERA_PIPE_FPS = Number.isFinite(parseInt(process.env.CAMERA_PIPE_FPS, 10))
  ? parseInt(process.env.CAMERA_PIPE_FPS, 10)
  : 20;
const CAMERA_PIPE_CMD = process.env.CAMERA_PIPE_CMD || "rpicam-vid";
const CAMERA_PIPE_FALLBACK_CMD = process.env.CAMERA_PIPE_FALLBACK_CMD || "libcamera-vid";

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

let weatherCache = {
  ts: 0,
  lat: WEATHER_LAT,
  lon: WEATHER_LON,
  data: null,
};
let lastHotspotHostLog = 0;
let cameraPipe = null;
const cameraClients = new Set();
const cameraErrors = {
  last: null,
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
    camera: {
      streamUrl: CAMERA_STREAM_URL || "/camera/stream",
      module: "Arducam 5MP IMX335 Low-Light (Sony STARVIS)",
      maxStill: {
        width: 2592,
        height: 1944,
      },
      snapshotDefault: {
        width: CAMERA_STILL_WIDTH,
        height: CAMERA_STILL_HEIGHT,
      },
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

function readInterfaceState(name) {
  const state = {
    operstate: null,
    carrier: null,
  };

  try {
    const raw = fs.readFileSync(`/sys/class/net/${name}/operstate`, "utf8");
    state.operstate = raw.trim();
  } catch (_) {}

  try {
    const raw = fs.readFileSync(`/sys/class/net/${name}/carrier`, "utf8");
    const val = raw.trim();
    if (val === "1") state.carrier = true;
    else if (val === "0") state.carrier = false;
  } catch (_) {}

  return state;
}

function runCmd(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { encoding: "utf8" }, (err, stdout) => {
      if (err || !stdout) return resolve("");
      resolve(stdout);
    });
  });
}

function listVideoDevices() {
  try {
    const entries = fs.readdirSync("/dev");
    return entries
      .filter((name) => /^video\d+/.test(name))
      .map((name) => path.join("/dev", name));
  } catch (_) {
    return [];
  }
}

async function hasLibcameraBinary() {
  const knownPaths = ["/usr/bin/libcamera-still", "/usr/local/bin/libcamera-still"];
  if (knownPaths.some((p) => fs.existsSync(p))) return true;
  try {
    const out = await runCmd("command -v libcamera-still");
    return !!out.trim();
  } catch (_) {
    return false;
  }
}

function captureStill(width, height) {
  return new Promise((resolve, reject) => {
    const w = Math.max(320, Math.min(Number(width) || CAMERA_STILL_WIDTH, 2592));
    const h = Math.max(240, Math.min(Number(height) || CAMERA_STILL_HEIGHT, 1944));
    const args = [
      "-n",
      "-t",
      "1",
      "--immediate",
      "--width",
      String(w),
      "--height",
      String(h),
      "-o",
      "-",
    ];

    const child = spawn("libcamera-still", args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    let stderr = "";
    const timeout = setTimeout(() => {
      stderr += "Timed out capturing still. ";
      child.kill("SIGTERM");
    }, 8000);

    child.stdout.on("data", (d) => chunks.push(d));
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        return reject(new Error(stderr.trim() || "libcamera-still failed"));
      }
      if (!chunks.length) {
        return reject(new Error("No image returned from camera"));
      }
      resolve({
        buffer: Buffer.concat(chunks),
        width: w,
        height: h,
      });
    });
  });
}

function execPromise(cmd) {
  // Run a command and reject on failure so callers can surface errors
  return new Promise((resolve, reject) => {
    exec(cmd, { encoding: "utf8" }, (err, stdout, stderr) => {
      if (err) {
        const msg =
          (stderr && stderr.toString().trim()) ||
          (stdout && stdout.toString().trim()) ||
          err.message;
        return reject(new Error(msg || "Command failed"));
      }
      resolve({ stdout, stderr });
    });
  });
}

async function readIwStations() {
  // Try multiple invocations to handle PATH differences and sudo needs
  const cmds = [
    "sudo -n /usr/sbin/iw dev wlan0 station dump",
    "sudo -n iw dev wlan0 station dump",
    "/usr/sbin/iw dev wlan0 station dump",
    "iw dev wlan0 station dump",
  ];

  for (const cmd of cmds) {
    try {
      const { stdout } = await execPromise(cmd);
      if (stdout && stdout.trim()) return stdout;
    } catch (_) {}
  }
  return "";
}

const HOST_CACHE_TTL_MS = 10 * 60 * 1000;
const hostCache = new Map();

async function resolveClientHost(ip, leaseHost) {
  if (!ip) return leaseHost || null;
  if (leaseHost) {
    hostCache.set(ip, { host: leaseHost, ts: Date.now() });
    return leaseHost;
  }

  const cached = hostCache.get(ip);
  if (cached && Date.now() - cached.ts < HOST_CACHE_TTL_MS) {
    return cached.host;
  }

  const candidates = [
    `avahi-resolve-address -4 ${ip}`,
    `getent hosts ${ip}`,
  ];

  for (const cmd of candidates) {
    try {
      const { stdout } = await execPromise(cmd);
      if (!stdout) continue;
      const line = stdout.trim().split("\n")[0];
      if (!line) continue;

      let host = null;
      if (cmd.startsWith("avahi-resolve-address")) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) host = parts[1];
      } else {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) host = parts[1];
      }

      if (host && host !== ip) {
        hostCache.set(ip, { host, ts: Date.now() });
        return host;
      }
    } catch (_) {}
  }

  hostCache.set(ip, { host: null, ts: Date.now() });
  return null;
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
    const state = readInterfaceState(name);
    const info = {
      name,
      type,
      ipv4: null,
      ipv6: null,
      mac: null,
      gateway: null,
      up: false,
      state: state.operstate,
      carrier: state.carrier,
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

    if (state.operstate === "up") {
      info.up = true;
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

async function readHotspotClients() {
  // Collect hostnames from dnsmasq lease files, then intersect with stations
  // currently associated to wlan0 (via `iw`) to avoid stale entries.
  const knownFiles = [
    "/run/NetworkManager/dnsmasq-Hotspot.leases",
    "/run/nm-dnsmasq-Hotspot.leases",
    "/var/lib/NetworkManager/dnsmasq-Hotspot.leases",
    "/var/lib/NetworkManager/dnsmasq-wlan0.leases",
    "/var/lib/misc/dnsmasq.leases",
  ];
  const leaseDirs = ["/run/NetworkManager", "/var/lib/NetworkManager", "/run", "/var/lib/misc"];
  const leaseFiles = new Set(knownFiles);

  for (const dir of leaseDirs) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && /dnsmasq.*\.leases$/i.test(entry.name)) {
          leaseFiles.add(path.join(dir, entry.name));
        }
      }
    } catch (_) {}
  }

  const leasesByIp = new Map();
  const leasesByMac = new Map();
  const nowSec = Math.floor(Date.now() / 1000);
  const leaseGraceSec = 60; // allow brief grace after expiry to avoid flicker
  const leaseDebug = [];

  function parseLeaseText(text) {
    const lines = text.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length < 3) continue;

      const expiresRaw = parts[0];
      const macRaw = parts[1];
      const ip = parts[2];
      const host = parts[3] && parts[3] !== "*" ? parts[3] : null;
      const expires =
        expiresRaw && /^\d+$/.test(expiresRaw) ? parseInt(expiresRaw, 10) : null;

      // Skip leases that are clearly expired to avoid stale rows.
      if (expires && expires > 0 && expires + leaseGraceSec < nowSec) continue;
      if (!ip || !macRaw) continue;

      const mac = macRaw.toLowerCase();
      leasesByIp.set(ip, { host, mac });
      leasesByMac.set(mac, { host, ip });
    }
  }

  for (const file of leaseFiles) {
    let text = null;
    let readErr = null;
    try {
      if (fs.existsSync(file)) {
        text = fs.readFileSync(file, "utf8");
      }
    } catch (err) {
      readErr = err;
    }

    // If direct read fails (permissions or missing), try sudo -n cat anyway
    if (!text) {
      try {
        const { stdout } = await execPromise(`sudo -n cat ${file}`);
        text = stdout;
        readErr = null;
      } catch (err) {
        readErr = err;
      }
    }

    if (text) {
      parseLeaseText(text);
      leaseDebug.push({ file, parsed: true });
    } else {
      leaseDebug.push({
        file,
        parsed: false,
        error: readErr ? readErr.message || "read failed" : "no data",
      });
    }
  }

  const stationDump = await readIwStations();
  const stationMacs = new Set();
  if (stationDump) {
    const lines = stationDump.split("\n");
    for (const line of lines) {
      const match = line.match(/Station\s+([0-9a-f:]{17})/i);
      if (match && match[1]) {
        stationMacs.add(match[1].toLowerCase());
      }
    }
  }

  if (stationMacs.size === 0) {
    if (Date.now() - lastHotspotHostLog > 10000) {
      lastHotspotHostLog = Date.now();
      console.log("[hotspot] no associated stations; lease read summary", leaseDebug);
    }
    return [];
  }

  const arpEntries = [];
  try {
    const arpText = fs.readFileSync("/proc/net/arp", "utf8");
    const lines = arpText.split("\n").slice(1);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 6) {
        const ip = parts[0];
        const mac = (parts[3] || "").toLowerCase();
        const dev = parts[5];
        const flagsRaw = parts[2];
        const flagsNum = parseInt(flagsRaw, 16) || 0;
        const isComplete = (flagsNum & 0x2) !== 0;

        if (dev === "wlan0" && /^10\.42\./.test(ip) && isComplete) {
          if (!mac || mac === "00:00:00:00:00:00") continue;
          arpEntries.push({ ip, mac });
        }
      }
    }
  } catch (_) {}

  const clients = [];
  for (const mac of stationMacs) {
    const arp = arpEntries.find((a) => a.mac === mac);
    const lease = leasesByMac.get(mac) || (arp?.ip ? leasesByIp.get(arp.ip) : null);
    clients.push({
      ip: arp?.ip || lease?.ip || null,
      mac,
      host: lease?.host || null,
    });
  }

  const withHosts = await Promise.all(
    clients.map(async (c) => {
      const resolvedHost = await resolveClientHost(c.ip, c.host);
      return { ...c, host: resolvedHost };
    })
  );

  const missingHosts = withHosts.filter((c) => !c.host);
  if (missingHosts.length > 0 && Date.now() - lastHotspotHostLog > 10000) {
    lastHotspotHostLog = Date.now();
    console.log("[hotspot] missing hostnames", {
      missing: missingHosts,
      leases: Array.from(leasesByIp.entries()),
      leaseDebug,
      leaseFiles: Array.from(leaseFiles),
    });
  }

  return withHosts;
}

async function setEthState(action) {
  const desired = action === "down" ? "down" : "up";
  // Try a few command paths with sudo -n to avoid password prompts
  const commands = [
    `sudo -n /sbin/ip link set eth0 ${desired}`,
    `sudo -n ip link set eth0 ${desired}`,
    `/sbin/ip link set eth0 ${desired}`,
    `ip link set eth0 ${desired}`,
  ];

  let lastError = null;
  for (const cmd of commands) {
    try {
      await execPromise(cmd);
      return;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error("Failed to change eth0 state");
}

async function getNetworkInfo() {
  const ipRoute = await runCmd("ip route");
  const nmActive = await runCmd(
    "nmcli -t -f NAME,DEVICE,TYPE,STATE connection show --active"
  );

  const interfaces = summarizeInterfaces(ipRoute);
  const clients = await readHotspotClients();

  return {
    interfaces,
    nmActive,
    clients,
  };
}

// ---------- Simple MJPEG pipe (libcamera-vid -> multipart/x-mixed-replace) ----------
function startCameraPipe() {
  if (cameraPipe) return cameraPipe;

  const args = [
    "--nopreview",
    "--inline",
    "--width",
    String(CAMERA_PIPE_WIDTH),
    "--height",
    String(CAMERA_PIPE_HEIGHT),
    "--framerate",
    String(CAMERA_PIPE_FPS),
    "--codec",
    "mjpeg",
    "-t",
    "0",
    "-o",
    "-",
  ];

  const commands = [CAMERA_PIPE_CMD, CAMERA_PIPE_FALLBACK_CMD].filter(Boolean);
  let proc = null;
  let usedCmd = null;
  let lastErr = null;

  for (const cmd of commands) {
    try {
      proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
      usedCmd = cmd;
      break;
    } catch (err) {
      lastErr = err;
    }
  }

  if (!proc) {
    cameraErrors.last = lastErr || new Error("Failed to spawn camera pipe");
    console.error("[camera] pipe spawn failed:", cameraErrors.last.message);
    return null;
  }

  const boundary = "ffserver";
  let buffer = Buffer.alloc(0);

  proc.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    // Find JPEG SOI/EOI markers and emit frames
    while (true) {
      const start = buffer.indexOf(Buffer.from([0xff, 0xd8]));
      if (start < 0) {
        buffer = Buffer.alloc(0);
        break;
      }
      const end = buffer.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
      if (end < 0) {
        if (start > 0) buffer = buffer.slice(start);
        break;
      }
      const frame = buffer.slice(start, end + 2);
      buffer = buffer.slice(end + 2);
      const header =
        "--" +
        boundary +
        "\r\n" +
        "Content-Type: image/jpeg\r\n" +
        "Content-Length: " +
        frame.length +
        "\r\n\r\n";
      cameraClients.forEach((res) => {
        res.write(header);
        res.write(frame);
        res.write("\r\n");
      });
    }
  });

  proc.stderr.on("data", (d) => {
    const msg = d.toString();
    cameraErrors.last = new Error(msg.trim());
  });

  proc.on("error", (err) => {
    cameraErrors.last = err;
    console.error("[camera] pipe error:", err.message);
    cameraPipe = null;
    cameraClients.forEach((res) => {
      try {
        res.end();
      } catch (_) {}
    });
    cameraClients.clear();
  });

  proc.on("exit", (code, signal) => {
    console.warn("[camera] pipe exited", { code, signal });
    cameraPipe = null;
    cameraClients.forEach((res) => {
      try {
        res.end();
      } catch (_) {}
    });
    cameraClients.clear();
  });

  cameraPipe = { proc, boundary, cmd: usedCmd };
  console.log(
    `[camera] pipe started with ${usedCmd} at ${CAMERA_PIPE_WIDTH}x${CAMERA_PIPE_HEIGHT}@${CAMERA_PIPE_FPS}`
  );
  return cameraPipe;
}

// ---------- Camera API ----------
app.get("/api/camera/status", async (req, res) => {
  try {
    const [libcameraInstalled, devices] = await Promise.all([
      hasLibcameraBinary(),
      Promise.resolve(listVideoDevices()),
    ]);
    const online = devices.length > 0;
    res.json({
      name: "Arducam 5MP IMX335 Low-Light",
      sensor: "Sony STARVIS IMX335",
      lens: "M12 wide-angle with IR-cut filter",
      streamUrl: CAMERA_STREAM_URL || null,
      maxStill: { width: 2592, height: 1944 },
      defaultStill: { width: CAMERA_STILL_WIDTH, height: CAMERA_STILL_HEIGHT },
      devices,
      online,
      libcameraInstalled,
      notes: online
        ? "Camera node present; live preview depends on your streaming command."
        : "No /dev/video* nodes detected. Check ribbon cable and Pi 5 camera slot.",
    });
  } catch (err) {
    console.error("Camera status error:", err.message);
    res.status(500).json({ error: "Failed to read camera status" });
  }
});

app.post("/api/camera/snapshot", async (req, res) => {
  const width = Number.isFinite(parseInt(req.body?.width, 10))
    ? parseInt(req.body.width, 10)
    : CAMERA_STILL_WIDTH;
  const height = Number.isFinite(parseInt(req.body?.height, 10))
    ? parseInt(req.body.height, 10)
    : CAMERA_STILL_HEIGHT;

  try {
    const libcameraInstalled = await hasLibcameraBinary();
    if (!libcameraInstalled) {
      return res.status(500).json({ error: "libcamera-still is not available on this system" });
    }
    const still = await captureStill(width, height);
    res.json({
      image: "data:image/jpeg;base64," + still.buffer.toString("base64"),
      width: still.width,
      height: still.height,
    });
  } catch (err) {
    console.error("Camera snapshot error:", err.message);
    res.status(500).json({ error: err.message || "Failed to capture still" });
  }
});

// ---------- Camera stream proxy (multipart MJPEG) ----------
app.get("/camera/stream", (req, res) => {
  startCameraPipe();
  res.writeHead(200, {
    "Content-Type": "multipart/x-mixed-replace; boundary=ffserver",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  });
  cameraClients.add(res);
  req.on("close", () => {
    cameraClients.delete(res);
  });
});

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
    const info = await getNetworkInfo();
    res.json(info);
  } catch (err) {
    console.error("Network info error:", err);
    res.status(500).json({ error: "Failed to get network info" });
  }
});

// ---------- Network control API (eth0 enable/disable) ----------
app.post("/api/network/eth0", async (req, res) => {
  const action =
    typeof req.body?.action === "string"
      ? req.body.action.toLowerCase()
      : typeof req.body?.state === "string"
        ? req.body.state.toLowerCase()
        : null;

  if (!action || (action !== "down" && action !== "up")) {
    return res
      .status(400)
      .json({ error: "Invalid action. Use 'up' or 'down' for eth0." });
  }

  try {
    await setEthState(action);
    const info = await getNetworkInfo();
    res.json({
      message: `Ethernet ${action === "down" ? "disabled" : "enabled"}.`,
      interfaces: info.interfaces,
    });
  } catch (err) {
    console.error("Ethernet toggle error:", err.message);
    res.status(500).json({
      error: `Failed to ${action === "down" ? "disable" : "enable"} eth0: ${err.message}`,
    });
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
