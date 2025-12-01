
/* Remote focus helpers */
const eventRegister = (() => {
  const items = () => document.getElementsByClassName("item");
  const blurAll = () => { for (const n of items()) n.blur(); };
  const over = e => { blurAll(); e.target.focus(); };
  const kd = e => { if (e.keyCode === 13) e.target.classList.add("active"); };
  const ku = e => { if (e.keyCode === 13) e.target.classList.remove("active"); };
  const add = () => { for (const n of items()) { n.addEventListener("mouseover", over); n.addEventListener("mouseout", () => n.blur()); n.addEventListener("keydown", kd); n.addEventListener("keyup", ku); } };
  return { add };
})();

let curState = "UNKNOWN", poll = null;
const mgmtPort = 7505;

function lunaCall(uri, parameters, timeout = 8000) {
  return Promise.race([
    new Promise((_, r) => setTimeout(() => r(new Error("Timeout")), timeout)),
    new Promise((res, rej) => {
      const s = uri.indexOf('/', 7);
      webOS.service.request(uri.substring(0, s), {
        method: uri.substring(s + 1),
        parameters,
        onSuccess: res, onFailure: r => rej(new Error(JSON.stringify(r)))
      });
    })
  ]);
}

function setButtonLabel(state) {
  const btn = document.getElementById('cbtn');
  btn.innerText = state === "CONNECTED" ? "Stop" : "Connect";
}
function setButtonDisabled(dis) { document.getElementById('cbtn').disabled = dis; }
function setDropdownDisabled(dis) { document.getElementById('configDropdown').disabled = dis; }

function updateStateLabel(text, cls) {
  const s = document.getElementById('state');
  s.className = '';
  if (cls) s.classList.add(cls);
  s.innerText = text;
}
function setDebug(msg) { document.getElementById('debugInfo').innerText = msg; }
function extendDebug(msg) { document.getElementById('debugInfo').innerText = document.getElementById('debugInfo').innerText + "\n" + msg; }
function showError(msg) { document.getElementById('errorMsg').innerText = msg; }

function startPoll() { if (poll) clearInterval(poll); poll = setInterval(getState, 3000); }
function stopPoll() { if (poll) { clearInterval(poll); poll = null; } }

async function getState(retries = 3) {
  try {
    const r = await lunaCall('luna://org.webosbrew.hbchannel.service/exec', { command: `{ echo "state"; sleep 1s; echo "exit";} | nc 127.0.0.1 ${mgmtPort}` });
    const out = r.stdoutString || '';
    extendDebug(out);
    if (out.includes('CONNECTED')) {
      curState = 'CONNECTED';
      updateStateLabel('CONNECTED', 'connected');
      setButtonLabel(curState);
      setButtonDisabled(false);
      setDropdownDisabled(true);
      stopPoll();
    } else {
      curState = 'DISCONNECTED';
      updateStateLabel('DISCONNECTED', 'disconnected');
      setButtonLabel(curState);
      setButtonDisabled(false);
      setDropdownDisabled(false);
    }
  } catch (e) {
    if (retries > 0) { setTimeout(() => getState(retries - 1), 1500); }
    else {
      curState = 'DISCONNECTED';
      updateStateLabel('DISCONNECTED', 'disconnected');
      setButtonLabel(curState);
      setButtonDisabled(false);
      setDropdownDisabled(false);
      extendDebug(e.message);
    }
  }
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
      setDropdownDisabled(true);
      setButtonDisabled(true);
      return;
    }

    setDropdownDisabled(false);
    setButtonDisabled(false);
    files.forEach((file) => {
      const option = document.createElement("option");
      option.value = file;
      option.textContent = file.replace(/\.ovpn$/i, "");
      dropdown.appendChild(option);
    });
  } catch (e) {
    setDropdownDisabled(true);
    setButtonDisabled(true);
    showError("Profile could not be loaded: " + e.message);
  }
}

async function connect() {
  const cfg = document.getElementById('configDropdown').value;
  if (!value) {
    showError('No Profile found');
    return;
  }
  setButtonDisabled(true);
  setDropdownDisabled(true);
  setDebug('Launching OpenVPN with ' + cfg);
  try {
    await lunaCall('luna://org.webosbrew.hbchannel.service/spawn', { command: `/media/developer/apps/usr/palm/applications/com.sk.app.lgtv-vpn/res/openvpn --management 0.0.0.0 ${mgmtPort} --config /media/developer/apps/usr/palm/applications/com.sk.app.lgtv-vpn/profiles/${cfg} --daemon` });
    startPoll();
  } catch (e) {
    showError('Start failed ' + e.message);
    setButtonDisabled(false);
    setDropdownDisabled(false);
  }
}
async function disconnect() {
  setButtonDisabled(true);
  setDropdownDisabled(true);
  setDebug('Sending SIGTERM...');
  try {
    await lunaCall('luna://org.webosbrew.hbchannel.service/exec', { command: `{ echo "signal SIGTERM"; sleep 1s; echo "exit";} | nc 127.0.0.1 ${mgmtPort}` });
    setTimeout(getState, 2500);
  } catch (e) {
    showError('Stop failed ' + e.message); setButtonDisabled(false);
    setDropdownDisabled(false);
  }
}
function btnClick() { curState === 'CONNECTED' ? disconnect() : connect(); }

async function initVPN() {
  setDebug('Init +x on openvpn...');
  await lunaCall('luna://org.webosbrew.hbchannel.service/exec', {
    command: 'chmod +x /media/developer/apps/usr/palm/applications/com.sk.app.lgtv-vpn/res/openvpn'
  });
  extendDebug('Checking management interface…');
  await getState(1);
}

window.addEventListener('beforeunload', () => {
  polling = false;           // stop Promise-Loop
  stopPoll();                // falls setInterval-Backup
});

window.addEventListener('load', () => {
  SpatialNavigation.init();
  SpatialNavigation.add({ selector: '.item' });
  SpatialNavigation.makeFocusable();
  eventRegister.add();
  document.getElementById('cbtn').addEventListener('click', btnClick);
  loadProfiles().then(initVPN);
  document.addEventListener('webOSLaunch', () => getState(5), true);
  document.addEventListener('webOSRelaunch', () => getState(5), true);
});
