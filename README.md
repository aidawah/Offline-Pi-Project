# Pi Control Dashboard

Offline-friendly Raspberry Pi car dashboard with hotspot access, system stats, networking, maps, weather, and reboot control.

## What you get
- Hotspot UI at `http://10.42.0.1:3000` (default); HTTPS on `3443` if enabled
- System gauges: CPU temp/load, RAM, fan (if exposed), uptime
- Networking: eth0/wlan0 details, hotspot clients
- Maps: Colorado-focused, street/topo toggle, quick jumps, saved camp location (named), “use my location” (GPS over HTTPS) with IP + saved fallback
- Weather: 7-day snapshot, detail modal
- Reboot: safe reboot button

## Requirements
- Raspberry Pi with Node.js (v18+ recommended)
- `npm install` in the project dir (only once or when deps change)
- For HTTPS: a TLS key/cert readable by the service user (defaults to `admin`)
- Optional: local tileserver/MBTiles for offline Colorado maps

## Quick start (manual)
```bash
cd ~/pi-control
git pull
npm install          # only if package.json changed
PORT=3000 HTTPS_PORT=3443 \
PICO_TLS_KEY_PATH=/etc/pi-control/certs/pi-control.key \
PICO_TLS_CERT_PATH=/etc/pi-control/certs/pi-control.crt \
npm start
```
Then open `http://<pi-ip>:3000/` (and `https://<pi-ip>:3443/` if TLS is set).

## Systemd service (recommended)
Service file: `systemd/pi-control.service`
```bash
sudo cp systemd/pi-control.service /etc/systemd/system/pi-control.service
sudo systemctl daemon-reload
sudo systemctl enable pi-control
sudo systemctl restart pi-control
sudo systemctl status pi-control
```
Defaults in the unit:
- `PORT=3000`, `HTTPS_PORT=3443`
- `PICO_TLS_KEY_PATH=/etc/pi-control/certs/pi-control.key`
- `PICO_TLS_CERT_PATH=/etc/pi-control/certs/pi-control.crt`
- Tile envs for local tiles (see below)
Adjust `User`, `WorkingDirectory`, and envs if your paths differ.

### TLS setup (self-signed)
```bash
sudo mkdir -p /etc/pi-control/certs
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/pi-control/certs/pi-control.key \
  -out /etc/pi-control/certs/pi-control.crt \
  -subj "/CN=pi-control.local"
sudo chgrp admin /etc/pi-control/certs/pi-control.*   # match your service user’s group
sudo chmod 640 /etc/pi-control/certs/pi-control.key
sudo chmod 644 /etc/pi-control/certs/pi-control.crt
sudo systemctl restart pi-control
```
Visit `https://<pi-ip>:3443/`, accept the cert, then “Use my location” will use GPS/Wi‑Fi. IP fallback and saved camp still work offline.

## Offline Colorado map tiles
- Default tile source (local tileserver): `http://127.0.0.1:8090/styles/bright/{z}/{x}/{y}.png`
- Fallback (only if local fails): `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`
- Env knobs:
  - `MAP_TILE_URL`, `MAP_TILE_ATTRIB`
  - `MAP_TILE_FALLBACK_URL`, `MAP_TILE_FALLBACK_ATTRIB`
  - `MAP_TILE_MAX_ZOOM`, `MAP_TILE_MAX_NATIVE_ZOOM`

Run a tileserver (example with TileServer-GL v4.4.10):
```bash
docker run --rm -it -v $PWD/mapdata:/data -p 8090:8080 maptiler/tileserver-gl
# place colorado.mbtiles in mapdata/
```
Or use `mbtileserver`:
```bash
docker run --rm -it -v $PWD/mapdata:/data -p 8090:8000 ghcr.io/consbio/mbtileserver:latest /data
```
Point `MAP_TILE_URL` at the served style/tiles. For plain raster folders, serve from `public/tiles/` and set `MAP_TILE_URL=/tiles/{z}/{x}/{y}.png`.

## Using the dashboard
- Home: CTA buttons to System/Map/Weather/Networking.
- Map:
  - “Use my location” prefers HTTPS geolocation; falls back to saved camp, then IP.
  - Save camp: enter name + lat/lon (auto-filled to map center) and “Save camp location.” A named quick-jump appears.
  - “Use saved spot” jumps to your saved camp. “Remove saved camp” clears it.
  - Quick jumps include your saved camp (if set) plus Colorado staples.
  - Layer toggle for street/topo; Reset view returns to statewide bounds.
- Weather: 7-day at configured lat/lon (`WEATHER_LAT`, `WEATHER_LON` envs), detail modal on click.
- System: live gauges (CPU temp, load, RAM, fan if exposed), reboot button.
- Networking: eth0/wlan0 IP/gateway/status and hotspot clients table.

## Env reference (common)
- `PORT`, `HTTPS_PORT`
- `PICO_TLS_KEY_PATH`, `PICO_TLS_CERT_PATH`
- `WEATHER_LAT`, `WEATHER_LON`
- Tile envs: `MAP_TILE_URL`, `MAP_TILE_ATTRIB`, `MAP_TILE_FALLBACK_URL`, `MAP_TILE_MAX_ZOOM`, `MAP_TILE_MAX_NATIVE_ZOOM`

## Troubleshooting
- Port in use: `sudo lsof -i :3000` (or 3443), then stop/kill the conflicting process.
- TLS load fails: ensure the service user/group can read the key/cert (`chmod 640 key`, `chmod 644 cert`).
- Location hangs: ensure HTTPS is used; otherwise rely on saved camp or IP.
- Tiles missing: confirm your tileserver is running and `MAP_TILE_URL` points to it; check network access if using internet fallbacks.

## Reboot test
```bash
sudo reboot
sudo systemctl status pi-control
sudo lsof -i :3000
sudo lsof -i :3443
```
Dash should be reachable at both HTTP and HTTPS after boot.
