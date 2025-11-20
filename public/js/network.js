export function initNetwork(isActive) {
  const ethIpEl = document.getElementById("eth-ip");
  const ethGwEl = document.getElementById("eth-gw");
  const ethStatusEl = document.getElementById("eth-status");

  const wlanIpEl = document.getElementById("wlan-ip");
  const wlanGwEl = document.getElementById("wlan-gw");
  const wlanStatusEl = document.getElementById("wlan-status");

  const clientsBody = document.getElementById("clientsBody");
  const clientsEmpty = document.getElementById("clientsEmpty");
  const netStatusEl = document.getElementById("netStatus");

  function setNetStatus(el, online) {
    if (online) {
      el.classList.remove("offline");
      el.textContent = "Online";
    } else {
      el.classList.add("offline");
      el.textContent = "Offline";
    }
  }

  async function updateNetwork() {
    if (!isActive()) return;
    try {
      const res = await fetch("/api/network-info");
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();

      const { interfaces, clients } = data;
      const eth = interfaces.eth0 || {};
      const wlan = interfaces.wlan0 || {};

      ethIpEl.textContent = "IP: " + (eth.ipv4 || "--");
      ethGwEl.textContent = "Gateway: " + (eth.gateway || "--");
      setNetStatus(ethStatusEl, !!eth.ipv4);

      wlanIpEl.textContent = "IP: " + (wlan.ipv4 || "--");
      wlanGwEl.textContent = "Gateway: " + (wlan.gateway || wlan.ipv4 || "--");
      setNetStatus(wlanStatusEl, !!wlan.ipv4);

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
