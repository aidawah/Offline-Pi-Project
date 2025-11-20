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