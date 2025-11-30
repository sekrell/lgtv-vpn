
const eventRegister = (() => {
  const itemArray = document.getElementsByClassName("item");

  const _onMouseOverEvent = (e) => {
    for (let item of itemArray) {
      item.blur();
    }
    document.getElementById(e.target.id).focus();
  };

  const _itemKeyDownHandler = (e) => {
    if (e.keyCode === 13) {
      document.getElementById(e.target.id).classList.add("active");
    }
  };

  const _itemKeyUpHandler = (e) => {
    if (e.keyCode === 13) {
      document.getElementById(e.target.id).classList.remove("active");
    }
  };

  const _itemMouseOutHandler = (e) => {
    document.getElementById(e.target.id).blur();
  };

  const addEventListeners = () => {
    for (let item of itemArray) {
      item.addEventListener("mouseover", _onMouseOverEvent);
      item.addEventListener("mouseout", _itemMouseOutHandler);
      item.addEventListener("keyup", _itemKeyUpHandler);
      item.addEventListener("keydown", _itemKeyDownHandler);
    }
  };

  return { addEventListeners };
})();

let curState = "UNKNOWN";
let pollInterval = null;

function lunaCall(uri, parameters, timeout = 10000) {
  return Promise.race([
    new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), timeout)),
    new Promise((resolve, reject) => {
      const s = uri.indexOf("/", 7);
      webOS.service.request(uri.substr(0, s), {
        method: uri.substr(s + 1),
        parameters,
        onSuccess: resolve,
        onFailure: (res) => reject(new Error(JSON.stringify(res)))
      });
    })
  ]);
}

function showError(msg) {
  const err = document.getElementById("errorMsg");
  err.innerText = msg;
}

function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(getState, 3000);
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

async function btnClicked() {
  const btn = document.getElementById("cbtn");
  btn.disabled = true;
  showError("");

  if (curState === "CONNECTED") {
    await stopVpn();
  } else {
    await connect();
  }
  btn.disabled = false;
}

async function connect() {
  document.getElementById("cbtn").innerText = "Connecting...";
  try {
    await startVPN();
    startPolling();
  } catch (e) {
    showError("Connection failed: " + e.message);
    document.getElementById("cbtn").innerText = "Connect";
  }
}

async function stopVpn() {
  document.getElementById("cbtn").innerText = "Stopping...";
  try {
    await lunaCall("luna://org.webosbrew.hbchannel.service/exec", {
      command: '{ echo "signal SIGTERM"; sleep 1s; echo "exit";} | nc 127.0.0.1 7505'
    });
    setTimeout(getState, 3000);
  } catch (e) {
    showError("Stop failed: " + e.message);
  } finally {
    document.getElementById("cbtn").innerText = "Connect";
  }
}

async function getState() {
  try {
    const r = await lunaCall("luna://org.webosbrew.hbchannel.service/exec", {
      command: '{ echo "state"; sleep 1s; echo "exit";} | nc 127.0.0.1 7505'
    });
    const output = r.stdoutString || "";
    if (output.includes("CONNECTED")) {
      curState = "CONNECTED";
      document.getElementById("cbtn").innerText = "Stop";
      document.getElementById("state").innerText = "CONNECTED";
      stopPolling();
    } else {
      curState = "CONNECTING";
      document.getElementById("cbtn").innerText = "Connecting...";
      document.getElementById("state").innerText = "CONNECTING...";
    }
  } catch (e) {
    curState = "DISCONNECTED";
    document.getElementById("cbtn").innerText = "Connect";
    document.getElementById("state").innerText = "DISCONNECTED";
  }
}

async function startVPN() {
  const e = document.getElementById("configDropdown");
  const value = e.value;
  if (!value) {
    throw new Error("Kein Profil ausgewählt");
  }
  await lunaCall("luna://org.webosbrew.hbchannel.service/spawn", {
    command: "/media/developer/apps/usr/palm/applications/com.sk.app.lgtv-vpn/res/openvpn --management 0.0.0.0 7505 --config /media/developer/apps/usr/palm/applications/com.sk.app.lgtv-vpn/profiles/" + value + " --daemon"
  });
}

async function loadProfiles() {
  const dropdown = document.getElementById("configDropdown");
  dropdown.innerHTML = "";

  try {
    const r = await lunaCall("luna://org.webosbrew.hbchannel.service/exec", {
      command:
        "cd /media/developer/apps/usr/palm/applications/com.sk.app.lgtv-vpn/profiles && ls -1 *.ovpn 2>/dev/null"
    });

    const files = (r.stdoutString || "")
      .split(/\r?\n/)
      .map((f) => f.trim())
      .filter((f) => f.length > 0);

    if (files.length === 0) {
      const emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = "Keine Profile gefunden";
      dropdown.appendChild(emptyOption);
      dropdown.disabled = true;
      return;
    }

    dropdown.disabled = false;
    files.forEach((file) => {
      const option = document.createElement("option");
      option.value = file;
      option.textContent = file.replace(/\.ovpn$/i, "");
      dropdown.appendChild(option);
    });
  } catch (e) {
    dropdown.disabled = true;
    showError("Profile konnten nicht geladen werden: " + e.message);
  }
}

async function initVPN() {
  try {
    await lunaCall("luna://org.webosbrew.hbchannel.service/exec", {
      command: "chmod +x /media/developer/apps/usr/palm/applications/com.sk.app.lgtv-vpn/res/openvpn"
    });
  } catch (e) {
    showError("Init failed: " + e.message);
  }
  await getState();
}

window.addEventListener("load", () => {
  SpatialNavigation.init();
  SpatialNavigation.add({ selector: ".item" });
  SpatialNavigation.makeFocusable();
  eventRegister.addEventListeners();
  document.getElementById("cbtn").addEventListener("click", btnClicked);
  loadProfiles().then(initVPN);

  document.addEventListener("webOSLaunch", getState, true);
  document.addEventListener("webOSRelaunch", getState, true);
});
