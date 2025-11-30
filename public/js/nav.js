export function initNav(views, onViewChange) {
  const navBtns = document.querySelectorAll(".nav-btn");
  const navTriggers = document.querySelectorAll("[data-nav-target]");
  let currentView = "home";

  function switchView(view) {
    if (!views[view]) return;
    currentView = view;
    navBtns.forEach((b) => {
      b.classList.toggle("active", b.dataset.view === view);
    });
    Object.entries(views).forEach(([key, el]) => {
      const isActive = key === view;
      el.classList.toggle("active", isActive);
      if (isActive) {
        el.classList.remove("hidden");
      } else {
        el.classList.add("hidden");
      }
    });
    if (typeof onViewChange === "function") {
      onViewChange(view);
    }
  }

  navBtns.forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });

  navTriggers.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const view = btn.dataset.navTarget;
      if (view) switchView(view);
    });
  });

  switchView(currentView);

  return {
    switchView,
    get currentView() {
      return currentView;
    },
  };
}
