# Pi Control

Offline-friendly Raspberry Pi car control dashboard.

Features:

- Wi-Fi hotspot UI reachable at `http://10.42.0.1:3000`
- System page with circular gauges (CPU temp, load, RAM, fan RPM)
- Networking page (Ethernet, hotspot, connected clients)
- Reboot button

## Setup

```bash
cd ~/pi-control
git pull
npm install           # only needed if package.json changed
sudo systemctl restart pi-control.service

## Offline Colorado map tiles

Leaflet is bundled locally. To keep full-quality maps without internet, point the app at a local tileserver:

1) Get a Colorado MBTiles file (vector/raster) from an OpenMapTiles/MapTiler extract.
2) Run a local tileserver, e.g.:
   - Docker: `docker run --rm -it -v $PWD/mapdata:/data -p 8090:8080 maptiler/tileserver-gl` (place `colorado.mbtiles` into `mapdata/`; the server exposes `/styles/` and `/data/`).
   - Or `mbtileserver`: `docker run --rm -it -v $PWD/mapdata:/data -p 8090:8000 ghcr.io/consbio/mbtileserver:latest /data`
3) Set environment for this app to use the local tiles (examples):
   - `MAP_TILE_URL=http://127.0.0.1:8090/styles/bright/{z}/{x}/{y}.png` (default)
   - `MAP_TILE_ATTRIB="(local Colorado tiles)"`
   - Optional fallback (when local tiles missing): `MAP_TILE_FALLBACK_URL=https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png` (default is OSM, used only if local fails)
   - Optional max zoom overrides: `MAP_TILE_MAX_ZOOM=17`, `MAP_TILE_MAX_NATIVE_ZOOM=17`

Place raster tile folders under `public/tiles/{z}/{x}/{y}.png` if you prefer a simple directory instead of a tileserver; `MAP_TILE_URL=/tiles/{z}/{x}/{y}.png` will serve them directly.

### Running the bundled tileserver service

We ship a systemd unit for TileServer-GL (ARM-friendly v4.4.10):

1. Ensure your MBTiles lives at `/home/admin/pi-control/mapdata/colorado.mbtiles`.
2. Enable/start the tileserver:
   ```bash
   sudo systemctl enable tileserver.service
   sudo systemctl start tileserver.service
   ```
3. It serves tiles at `http://127.0.0.1:8090/styles/bright/{z}/{x}/{y}.png`.
4. The dashboard reads that via `MAP_TILE_URL` (set in the pi-control.service unit).
