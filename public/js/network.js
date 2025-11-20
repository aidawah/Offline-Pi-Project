export function initNetwork(isActive) {
  const ethIpEl = document.getElementById("eth-ip");
  const ethGwEl = document.getElementById("eth-gw");
  const ethStatusEl = document.getElementById("eth-status");
  const ethStateEl = document.getElementById("eth-state");
  const ethToggleBtn = document.getElementById("ethToggleBtn");
  const ethToggleStatus = document.getElementById("ethToggleStatus");

  const wlanIpEl = document.getElementById("wlan-ip");
  const wlanGwEl = document.getElementById("wlan-gw");
  const wlanStatusEl = document.getElementById("wlan-status");

  const clientsBody = document.getElementById("clientsBody");
  const clientsEmpty = document.getElementById("clientsEmpty");
  const netStatusEl = document.getElementById("netStatus");
  const defaultEthNote =
    "Toggle eth0 to force wired offline while leaving the hotspot running.";
  const disabledStates = ["down", "dormant", "lowerlayerdown"];

  if (ethToggleStatus && !ethToggleStatus.textContent) {
    ethToggleStatus.textContent = defaultEthNote;
  }

  function setNetStatus(el, iface) {
    if (!el) return;
    el.classList.remove("offline", "disabled");

    const disabled =
      iface && disabledStates.includes((iface.state || "").toLowerCase());
    const online = iface && !!iface.ipv4;

    if (disabled) {
      el.classList.add("disabled");
      el.textContent = "Disabled";
      return;
    }

    if (online) {
      el.textContent = "Online";
    } else {
      el.classList.add("offline");
      el.textContent = "Offline";
    }
  }

  function updateEthMeta(eth) {
    if (ethStateEl) {
      const stateText = eth && eth.state ? eth.state : "unknown";
      const carrier =
        eth && Object.prototype.hasOwnProperty.call(eth, "carrier")
          ? eth.carrier
          : null;
      const carrierText =
        carrier === true ? " (link detected)" : carrier === false ? " (no link)" : "";
      ethStateEl.textContent = `State: ${stateText}${carrierText}`;
    }

    if (ethToggleBtn) {
      const isDisabled = disabledStates.includes((eth?.state || "").toLowerCase());
      const targetAction = isDisabled ? "up" : "down";
      ethToggleBtn.dataset.target = targetAction;
      ethToggleBtn.textContent =
        targetAction === "down" ? "Disable Ethernet" : "Enable Ethernet";
      ethToggleBtn.disabled = false;
    }
  }

  async function toggleEth() {
    if (!ethToggleBtn) return;
    const target = ethToggleBtn.dataset.target;
    if (target !== "up" && target !== "down") {
      if (ethToggleStatus) {
        ethToggleStatus.textContent = "Ethernet state unknown. Refresh and try again.";
      }
      return;
    }

    const previousText = ethToggleBtn.textContent;
    ethToggleBtn.disabled = true;
    ethToggleBtn.textContent = target === "down" ? "Disabling..." : "Enabling...";
    if (ethToggleStatus) {
      ethToggleStatus.textContent =
        target === "down"
          ? "Bringing eth0 down. Hotspot stays up."
          : "Bringing eth0 back up...";
    }

    try {
      const res = await fetch("/api/network/eth0", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: target }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.error) {
        const msg = payload.error || `HTTP ${res.status}`;
        throw new Error(msg);
      }
      if (ethToggleStatus) {
        ethToggleStatus.textContent =
          payload.message ||
          `Ethernet ${target === "down" ? "disabled" : "enabled"}.`;
      }
    } catch (err) {
      if (ethToggleStatus) {
        ethToggleStatus.textContent = "Ethernet change failed: " + err.message;
      }
    } finally {
      ethToggleBtn.disabled = false;
      ethToggleBtn.textContent = previousText;
      updateNetwork();
    }
  }

  if (ethToggleBtn) {
    ethToggleBtn.addEventListener("click", () => {
      toggleEth();
    });
  }

  async function updateNetwork() {
    if (!isActive()) return;
    try {
      const res = await fetch("/api/network-info");
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();

      const interfaces = data.interfaces || {};
      const clients = data.clients || [];
      const eth = interfaces.eth0 || {};
      const wlan = interfaces.wlan0 || {};

      ethIpEl.textContent = "IP: " + (eth.ipv4 || "--");
      ethGwEl.textContent = "Gateway: " + (eth.gateway || "--");
      setNetStatus(ethStatusEl, eth);
      updateEthMeta(eth);

      wlanIpEl.textContent = "IP: " + (wlan.ipv4 || "--");
      wlanGwEl.textContent = "Gateway: " + (wlan.gateway || wlan.ipv4 || "--");
      setNetStatus(wlanStatusEl, wlan);

      clientsBody.innerHTML = "";
      if (clients && clients.length > 0) {
        clients.forEach((c) => {
          const tr = document.createElement("tr");
          const tdIp = document.createElement("td");
          const tdMac = document.createElement("td");
          const tdHost = document.createElement("td");

          tdIp.textContent = c.ip || "--";
          tdMac.textContent = c.mac || "--";
          tdHost.textContent = c.host || "";

          tr.appendChild(tdIp);
          tr.appendChild(tdMac);
          tr.appendChild(tdHost);
          clientsBody.appendChild(tr);
        });
        clientsEmpty.style.display = "none";
      } else {
        clientsEmpty.style.display = "block";
      }

      netStatusEl.textContent = "";
    } catch (err) {
      netStatusEl.textContent = "Network info error: " + err.message;
    }
  }

  const interval = setInterval(() => {
    if (isActive()) {
      updateNetwork();
    }
  }, 5000);

  return {
    refresh: updateNetwork,
    destroy() {
      clearInterval(interval);
    },
  };
}
