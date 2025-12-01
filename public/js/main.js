import { initNav } from "./nav.js";
import { initMap } from "./map.js";
import { initWeather } from "./weather.js";
import { initSystem } from "./system.js";
import { initNetwork } from "./network.js";
import { initCamera } from "./camera.js";
import { initCarTemp } from "./carTemp.js";

const views = {
  home: document.getElementById("view-home"),
  camera: document.getElementById("view-camera"),
  "car-temp": document.getElementById("view-car-temp"),
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
const carTemp = initCarTemp(() => nav.currentView === "car-temp");

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
  } else if (view === "car-temp") {
    carTemp.refresh();
  }
}

// initial fetches for default view adjacents
weather.refresh();
system.refresh();
network.refresh();
camera.refresh();
carTemp.refresh();

// Mobile menu toggle
const mobileMenuBtn = document.getElementById("mobile-menu-btn");
const mobileMenu = document.getElementById("mobile-menu");

if (mobileMenuBtn && mobileMenu) {
  mobileMenuBtn.addEventListener("click", () => {
    mobileMenu.classList.toggle("hidden");
  });

  // Close mobile menu when a nav button is clicked
  const mobileNavBtns = mobileMenu.querySelectorAll(".nav-btn");
  mobileNavBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      mobileMenu.classList.add("hidden");
    });
  });

  // Close mobile menu when clicking outside
  document.addEventListener("click", (e) => {
    if (!mobileMenuBtn.contains(e.target) && !mobileMenu.contains(e.target)) {
      mobileMenu.classList.add("hidden");
    }
  });
}
