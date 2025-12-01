
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
let visibilityProp = null;
let visibilityEvent = null;

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
function focusFirstEnabledItem() {
  const enabledItem = Array.from(document.getElementsByClassName('item'))
    .find(el => !el.disabled);

  if (enabledItem && document.activeElement?.disabled) {
    enabledItem.focus();
  }
}
function setButtonDisabled(dis) { document.getElementById('cbtn').disabled = dis;
  SpatialNavigation.makeFocusable();
  focusFirstEnabledItem();}
function setDropdownDisabled(dis) { document.getElementById('configDropdown').disabled = dis;
  SpatialNavigation.makeFocusable();
  focusFirstEnabledItem();}

function updateStateLabel(text, cls = null) {
  const s = document.getElementById('state');
  s.className = '';
  if (cls) s.classList.add(cls);
  s.innerText = text;
}
function setDebug(msg) { document.getElementById('debugInfo').innerText = msg; }
function extendDebug(msg) { document.getElementById('debugInfo').innerText = document.getElementById('debugInfo').innerText + "\n" + msg; }
function showError(msg) { document.getElementById('errorMsg').innerText = msg; }

async function terminateDaemon() {
  try {
    await lunaCall('luna://org.webosbrew.hbchannel.service/exec', { command: `{ echo "signal SIGTERM"; sleep 1s; echo "exit";} | nc 127.0.0.1 ${mgmtPort}` });
  } catch (e) {
    extendDebug(`Cleanup stop failed: ${e.message}`);
  }
}

async function getState(retries = 3, canfail = false) {
  try {
    updateStateLabel('Checking...');
    showError("");
    const r = await lunaCall('luna://org.webosbrew.hbchannel.service/exec', { command: `{ echo "state"; sleep 1s; echo "exit";} | nc 127.0.0.1 ${mgmtPort}` });
    const out = r.stdoutString || '';
    setDebug(out);
    if (out.includes('CONNECTED')) {
      curState = 'CONNECTED';
      updateStateLabel('CONNECTED', 'connected');
      setButtonLabel(curState);
      setButtonDisabled(false);
      setDropdownDisabled(true);
    } else if (out.includes('WAIT')) {
      setTimeout((retries, canfail) => {console.log('state from retry wait'); getState(retries - 1, canfail)}, 1500, retries, canfail); 
      extendDebug('VPN is connecting, retrying state check...');
    } else {
      curState = 'DISCONNECTED';
      updateStateLabel('DISCONNECTED', 'disconnected');
      setButtonLabel(curState);
      setButtonDisabled(false);
      setDropdownDisabled(false);
    }
  } catch (e) {
    if (retries > 0) { 
      setTimeout((retries, canfail) => {console.log('state from retry'); getState(retries - 1, canfail)}, 1500,retries, canfail); 
      if(!canfail){
        extendDebug(`VPN not responding, retrying state check (${retries} attempts left)...`);
      }
    }
    else {
      curState = 'DISCONNECTED';
      updateStateLabel('DISCONNECTED', 'disconnected');
      setButtonLabel(curState);
      setButtonDisabled(false);
      setDropdownDisabled(false);
      if(!canfail)
      {
        setDebug(e.message);
        showError('Could not connect to management interface.');
      }
    }
  }
}

async function loadProfiles() {
  const dropdown = document.getElementById("configDropdown");
  dropdown.innerHTML = "";
  try {
    const r = await lunaCall("luna://org.webosbrew.hbchannel.service/exec", {
      command:
        `cd /media/developer/apps/usr/palm/applications/com.sk.app.lgtv-vpn/profiles && ls -1 *.ovpn`
    },timeout=15000);
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
      showError("No Profiles found in profiles folder. Please make sure to upload .ovpn files into /media/developer/apps/usr/palm/applications/com.sk.app.lgtv-vpn/profiles");
      return Promise.reject("No Profiles found");
    }

    files.forEach((file) => {
      const option = document.createElement("option");
      option.value = file;
      option.textContent = file.replace(/\.ovpn$/i, "");
      dropdown.appendChild(option);
    });
    extendDebug(`Loaded ${files.length} profile(s).`);
    return Promise.resolve();
  } catch (e) {
    setDropdownDisabled(true);
    setButtonDisabled(true);
    showError("Profiles could not be loaded: " + e.message);
    return Promise.resolve(e); //still resolve, maybe management interface is still up
  }
}

async function connect() {
  const cfg = document.getElementById('configDropdown').value;
  if (!cfg) {
    showError('No Profile found');
    return;
  }
  showError('');
  setButtonDisabled(true);
  setDropdownDisabled(true);
  setDebug('Launching OpenVPN with ' + cfg);
  try {
    await lunaCall('luna://org.webosbrew.hbchannel.service/spawn', { command: `/media/developer/apps/usr/palm/applications/com.sk.app.lgtv-vpn/res/openvpn --management 0.0.0.0 ${mgmtPort} --config /media/developer/apps/usr/palm/applications/com.sk.app.lgtv-vpn/profiles/${cfg} --daemon` });
    console.log('state from connect');
    setTimeout(getState,2000);
  } catch (e) {
    setDebug(e.message);
    showError('Start failed ' + e.message);
    setButtonDisabled(false);
    setDropdownDisabled(false);
  }
}
async function disconnect() {
  showError('');
  setButtonDisabled(true);
  setDropdownDisabled(true);
  setDebug('Sending SIGTERM...');
  try {
    await terminateDaemon();
    setTimeout(() => {
      console.log('state from disconnect');
      getState(1, true);
    }, 2000);
  } catch (e) {
    showError('Stop failed ' + e.message); setButtonDisabled(false);
    setDropdownDisabled(false);
  }
}
function btnClick() { curState === 'CONNECTED' ? disconnect() : connect(); }

async function initVPN() {
  extendDebug('Preparing openvpn binary...');
  await lunaCall('luna://org.webosbrew.hbchannel.service/exec', {
    command: 'chmod +x /media/developer/apps/usr/palm/applications/com.sk.app.lgtv-vpn/res/openvpn'
  });
  extendDebug('Checking management interface…');
  console.log('state from initVPN');
  await getState(1, true);
  extendDebug('Initialization complete.');
  setDropdownDisabled(false);
  setButtonDisabled(false);
}

function configureVisibilityHandling() {
  if (visibilityEvent) return;
  if (typeof document.hidden !== 'undefined') {
    visibilityProp = 'hidden';
    visibilityEvent = 'visibilitychange';
  } else if (typeof document.webkitHidden !== 'undefined') {
    visibilityProp = 'webkitHidden';
    visibilityEvent = 'webkitvisibilitychange';
  }

  if (!visibilityEvent) return;

  document.addEventListener(visibilityEvent, () => {
    const isHidden = document[visibilityProp];
    if (!isHidden) {
      console.log('state from Hiddenlistener');
      getState(1, true);
    }
  }, true);
}

function launchEvent() {
  SpatialNavigation.init();
  SpatialNavigation.add({ selector: '.item' });
  SpatialNavigation.makeFocusable();
  eventRegister.add();
  document.getElementById('cbtn').addEventListener('click', btnClick);
  configureVisibilityHandling();
  setDebug('Loading Profiles, this could take some seconds...');
  loadProfiles().then(() => { initVPN(); },()=>{setDebug('Failed to load profiles.');});
}


document.addEventListener('webOSLaunch', launchEvent, true);
document.addEventListener('webOSRelaunch', launchEvent, true);