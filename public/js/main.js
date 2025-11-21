import { initNav } from "./nav.js";
import { initMap } from "./map.js";
import { initWeather } from "./weather.js";
import { initSystem } from "./system.js";
import { initNetwork } from "./network.js";
import { initCamera } from "./camera.js";

const views = {
  home: document.getElementById("view-home"),
  camera: document.getElementById("view-camera"),
  map: document.getElementById("view-map"),
  system: document.getElementById("view-system"),
  weather: document.getElementById("view-weather"),
  network: document.getElementById("view-network"),
};

const nav = initNav(views, handleViewChange);

const map = initMap();
const weather = initWeather(() => nav.currentView === "weather");
const system = initSystem(() => nav.currentView === "system");
const network = initNetwork(() => nav.currentView === "network");
const camera = initCamera(() => nav.currentView === "camera");

function handleViewChange(view) {
  if (view === "map") {
    map.onShow();
  } else if (view === "weather") {
    weather.refresh();
  } else if (view === "system") {
    system.refresh();
  } else if (view === "network") {
    network.refresh();
  } else if (view === "camera") {
    camera.refresh();
  }
}

// initial fetches for default view adjacents
weather.refresh();
system.refresh();
network.refresh();
camera.refresh();
