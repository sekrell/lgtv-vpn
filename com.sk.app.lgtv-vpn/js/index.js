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
// Where this app is installed, read from the page URL so the app works under any app id.
const appDir = (() => {
  const root = webOS.fetchAppRootPath();
  return root.indexOf('file://') === 0
    ? decodeURIComponent(root.slice('file://'.length)).replace(/\/$/, '')
    : '/media/developer/apps/usr/palm/applications/com.sk.app.lgtv-vpn';
})();
const profilesDir = `${appDir}/profiles`;
let visibilityProp = null;
let visibilityEvent = null;
let launched = false;

const themes = [
  { id: 'dark', name: 'Dark' },
  { id: 'light', name: 'Light' },
  { id: 'midnight', name: 'Midnight' },
  { id: 'oled', name: 'OLED Black' },
];

const stateLabels = {
  CONNECTED: ['Connected', 'All apps on this TV use the VPN.'],
  DISCONNECTED: ['Disconnected', 'Pick a profile and press Connect.'],
  AUTH: ['Sign-in needed', 'This profile asks for a password.'],
};

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

function storageGet(key) {
  try { return window.localStorage.getItem(key); } catch (e) { return null; }
}
function storageSet(key, value) {
  try { window.localStorage.setItem(key, value); } catch (e) { /* not persisted */ }
}

function applyTheme(id) {
  const theme = themes.find(t => t.id === id) || themes[0];
  document.documentElement.setAttribute('data-theme', theme.id);
  document.getElementById('themeBtn').innerText = 'Theme: ' + theme.name;
  storageSet('theme', theme.id);
}
function nextTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  const i = themes.findIndex(t => t.id === cur);
  applyTheme(themes[(i + 1) % themes.length].id);
}

function setLogVisible(visible) {
  document.getElementById('debugBlock').hidden = !visible;
  document.getElementById('logBtn').innerText = visible ? 'Hide log' : 'Show log';
  storageSet('logVisible', visible ? '1' : '0');
}
function toggleLog() { setLogVisible(document.getElementById('debugBlock').hidden); }

// Switches for res/vpn-hook.sh. The hook runs as root outside the app, so the app
// writes them to a file it reads; both default to on.
const hookSettings = { NOTIFY: 'Notifications', BLOCK_IPV6: 'Block IPv6', VPN_DNS: 'VPN DNS' };
const hookButtons = { NOTIFY: 'notifyBtn', BLOCK_IPV6: 'ipv6Btn', VPN_DNS: 'dnsBtn' };

function hookSettingOn(key) { return storageGet('hook.' + key) !== '0'; }

function renderHookSettings() {
  for (const key in hookSettings) {
    document.getElementById(hookButtons[key]).innerText = `${hookSettings[key]}: ${hookSettingOn(key) ? 'On' : 'Off'}`;
  }
}

// Writes hook-settings and makes the IPv6 block and DNS match it right away, even while connected.
async function applyHookSettings() {
  const lines = Object.keys(hookSettings).map(key => `${key}=${hookSettingOn(key) ? 1 : 0}`).join('\\n');
  try {
    await lunaCall('luna://org.webosbrew.hbchannel.service/exec', {
      command: `printf '${lines}\\n' > ${appDir}/hook-settings && ${appDir}/res/vpn-hook.sh apply`
    });
  } catch (e) {
    extendDebug(`Saving settings failed: ${e.message}`);
  }
}

function toggleHookSetting(key) {
  storageSet('hook.' + key, hookSettingOn(key) ? '0' : '1');
  renderHookSettings();
  extendDebug(`${hookSettings[key]} ${hookSettingOn(key) ? 'on' : 'off'}.`);
  applyHookSettings();
}

function setButtonLabel(state) {
  const btn = document.getElementById('cbtn');
  btn.innerText = state === "CONNECTED" ? "Disconnect" : "Connect";
  btn.classList.toggle('is-stop', state === "CONNECTED");
}
function focusFirstEnabledItem() {
  const active = document.activeElement;
  if (active && active.classList.contains('item') && !active.disabled && active.offsetWidth > 0) return;
  // Prefer the VPN controls over the theme and log buttons.
  const items = [...document.querySelectorAll('.controls .item, .auth-form .item'), ...document.getElementsByClassName('item')];
  for (const el of items) {
    if (!el.disabled && el.offsetWidth > 0) {
      el.focus();
      return;
    }
  }
}

function setButtonDisabled(dis) {
  document.getElementById('cbtn').disabled = dis;
  SpatialNavigation.makeFocusable();
  focusFirstEnabledItem();
}
function setDropdownDisabled(dis) { document.getElementById('configDropdown').disabled = dis;
  SpatialNavigation.makeFocusable();
  focusFirstEnabledItem();
}

function updateStateLabel(text, cls = null) {
  const block = document.getElementById('statusBlock');
  block.className = 'status' + (cls ? ' ' + cls : '');
  document.body.setAttribute('data-vpn', cls || '');
  const [label, detail] = stateLabels[text] || [text, ''];
  document.getElementById('state').innerText = label;
  document.getElementById('stateDetail').innerText = detail;
}

// Keep the newest log line in view; the log can't be scrolled with the remote.
function scrollLog() { const el = document.getElementById('debugInfo'); el.scrollTop = el.scrollHeight; }
function setDebug(msg) { document.getElementById('debugInfo').innerText = msg; scrollLog(); }
function extendDebug(msg) { document.getElementById('debugInfo').innerText = document.getElementById('debugInfo').innerText + "\n" + msg; scrollLog(); }
function showError(msg) { document.getElementById('errorMsg').innerText = msg; }

// closable: the help was opened from the dropdown, so profiles exist and it can be closed again.
function showSetupHelp(show, closable = false) {
  document.getElementById('setupCard').hidden = !show;
  document.getElementById('setupClose').hidden = !closable;
  SpatialNavigation.makeFocusable();
}

function renderScpCommand(ip) {
  document.getElementById('tvAddress').innerText = ip ? 'TV address: ' + ip : '';
  document.getElementById('scpCmd').innerText = `scp -O *.ovpn root@${ip || '<TV-IP>'}:${profilesDir}/`;
}

async function loadTvAddress() {
  renderScpCommand(null);
  try {
    const r = await lunaCall('luna://com.palm.connectionmanager/getStatus', {});
    const net = [r.wired, r.wifi].find(n => n && n.state === 'connected' && n.ipAddress);
    renderScpCommand(net ? net.ipAddress : null);
  } catch (e) {
    extendDebug(`Could not read TV address: ${e.message}`);
  }
}

async function terminateDaemon() {
  try {
    await lunaCall('luna://org.webosbrew.hbchannel.service/exec', { command: `{ echo "signal SIGTERM"; sleep 1s; echo "exit";} | nc 127.0.0.1 ${mgmtPort}` }, 15000);
  } catch (e) {
    extendDebug(`Cleanup stop failed: ${e.message}`);
  }
}

// OpenVPN states (from the management `state` command) that mean "still on the way up".
const connectingStates = ['CONNECTING', 'WAIT', 'AUTH', 'AUTH_PENDING', 'GET_CONFIG', 'ASSIGN_IP', 'ADD_ROUTES', 'RESOLVE', 'TCP_CONNECT', 'RECONNECTING'];
let authSubmitted = false;

// With --management-query-passwords OpenVPN repeats a pending request to every new management connection, e.g.
// >PASSWORD:Need 'Auth' username/password
// >PASSWORD:Need 'Private Key' password
function parsePasswordRequest(out) {
  const m = out.match(/>PASSWORD:Need '([^']+)' (username\/password|password)/);
  return m ? { type: m[1], needsUsername: m[2] === 'username/password' } : null;
}

function showAuthForm(req) {
  const form = document.getElementById('authForm');
  const wasHidden = form.hidden;
  curState = 'AUTH';
  form.dataset.type = req.type;
  updateStateLabel('AUTH', 'connecting');
  document.getElementById('authTitle').innerText = req.type === 'Auth' ? 'Sign in to the VPN' : `Enter the ${req.type} password`;
  document.getElementById('authUserRow').hidden = !req.needsUsername;
  document.getElementById('authPass').value = '';
  document.getElementById('controls').hidden = true;
  form.hidden = false;
  if (authSubmitted) showError('Sign-in failed. Check the username and password and try again.');
  authSubmitted = false;
  SpatialNavigation.makeFocusable();
  if (wasHidden) {
    const first = req.needsUsername && !document.getElementById('authUser').value ? 'authUser' : 'authPass';
    document.getElementById(first).focus();
  }
}

function hideAuthForm() {
  document.getElementById('authForm').hidden = true;
  document.getElementById('controls').hidden = false;
  document.getElementById('authPass').value = '';
  SpatialNavigation.makeFocusable();
}

// Quote a value for an OpenVPN management command argument.
function mgmtQuote(v) { return '"' + v.replace(/[\r\n]/g, '').replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }
// Quote a value for the shell that runs `nc`.
function shQuote(v) { return "'" + v.replace(/'/g, "'\\''") + "'"; }

async function submitAuth() {
  const form = document.getElementById('authForm');
  const type = form.dataset.type;
  const user = document.getElementById('authUser').value;
  const pass = document.getElementById('authPass').value;
  const needsUsername = !document.getElementById('authUserRow').hidden;
  if ((needsUsername && !user) || !pass) {
    showError(needsUsername ? 'Enter a username and password.' : 'Enter the password.');
    return;
  }
  const lines = [];
  if (needsUsername) lines.push(`username ${mgmtQuote(type)} ${mgmtQuote(user)}`);
  lines.push(`password ${mgmtQuote(type)} ${mgmtQuote(pass)}`);
  showError('');
  hideAuthForm();
  setButtonDisabled(true);
  setDropdownDisabled(true);
  updateStateLabel('Connecting…', 'connecting');
  extendDebug('Sending credentials...');
  try {
    const r = await lunaCall('luna://org.webosbrew.hbchannel.service/exec', {
      command: `{ printf '%s\\n' ${lines.map(shQuote).join(' ')}; sleep 1s; echo "exit";} | nc 127.0.0.1 ${mgmtPort}`
    }, 15000);
    extendDebug(r.stdoutString || '');
    authSubmitted = true;
  } catch (e) {
    extendDebug(`Sending credentials failed: ${e.message}`);
  }
  setTimeout(getState, 2000);
}

async function cancelAuth() {
  authSubmitted = false;
  showError('');
  hideAuthForm();
  setButtonDisabled(true);
  setDropdownDisabled(true);
  updateStateLabel('Disconnecting…', 'connecting');
  await terminateDaemon();
  setTimeout(() => getState(1, true), 2000);
}

async function getState(retries = 3, canfail = false) {
  try {
    updateStateLabel('Checking…', "connecting");
    showError("");
    const r = await lunaCall('luna://org.webosbrew.hbchannel.service/exec', { command: `{ echo "state"; sleep 1s; echo "exit";} | nc 127.0.0.1 ${mgmtPort}` });
    const out = r.stdoutString || '';
    setDebug(out);
    const passwordRequest = parsePasswordRequest(out);
    const stateMatch = out.match(/^\d+,([A-Z_]+),/m);
    const vpnState = stateMatch ? stateMatch[1] : '';
    if (passwordRequest) {
      showAuthForm(passwordRequest);
    } else if (vpnState === 'CONNECTED' || (!vpnState && out.includes('CONNECTED'))) {
      hideAuthForm();
      curState = 'CONNECTED';
      updateStateLabel('CONNECTED', 'connected');
      setButtonLabel(curState);
      setButtonDisabled(false);
      setDropdownDisabled(true);
    } else if (connectingStates.includes(vpnState) || (!vpnState && out.includes('WAIT'))) {
      hideAuthForm();
      updateStateLabel('Connecting…', 'connecting');
      setTimeout((retries, canfail) => {console.log('state from retry wait'); getState(retries - 1, canfail)}, 1500, retries, canfail);
      extendDebug('VPN is connecting, retrying state check...');
    } else {
      hideAuthForm();
      curState = 'DISCONNECTED';
      updateStateLabel('DISCONNECTED', 'disconnected');
      setButtonLabel(curState);
      setButtonDisabled(!hasProfiles());
      setDropdownDisabled(!hasProfiles());
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
      setButtonDisabled(!hasProfiles());
      setDropdownDisabled(!hasProfiles());
      if(!canfail)
      {
        setDebug(e.message);
        showError('Could not connect to management interface.');
      }
    }
  }
}

// The last dropdown entry opens the "add a profile" help instead of selecting a profile.
const addProfileValue = '__add_profile__';
let selectedProfile = '';

function hasProfiles() {
  const value = document.getElementById('configDropdown').value;
  return value !== '' && value !== addProfileValue;
}

function profileChanged() {
  const dropdown = document.getElementById('configDropdown');
  if (dropdown.value !== addProfileValue) {
    selectedProfile = dropdown.value;
    return;
  }
  dropdown.value = selectedProfile;
  showSetupHelp(true, true);
  document.getElementById('setupClose').focus();
}

function closeSetupHelp() {
  showSetupHelp(false);
  document.getElementById('configDropdown').focus();
}

async function loadProfiles() {
  const dropdown = document.getElementById("configDropdown");
  const previous = dropdown.value;
  dropdown.innerHTML = "";
  try {
    // `ls *.ovpn` exits non-zero when nothing matches, so filter with grep and always succeed.
    const r = await lunaCall("luna://org.webosbrew.hbchannel.service/exec", {
      command:
        `mkdir -p ${profilesDir} && cd ${profilesDir} && ls -1 | grep -i '\\.ovpn$' || true`
    }, 15000);
    const files = (r.stdoutString || "")
      .split(/\r?\n/)
      .map((f) => f.trim())
      .filter((f) => f.length > 0);

    if (files.length === 0) {
      const emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = "No profiles found";
      dropdown.appendChild(emptyOption);
      showSetupHelp(true);
      if (curState !== 'CONNECTED') {
        setDropdownDisabled(true);
        setButtonDisabled(true);
      }
      return Promise.reject("No Profiles found");
    }

    files.forEach((file) => {
      const option = document.createElement("option");
      option.value = file;
      option.textContent = file.replace(/\.ovpn$/i, "");
      dropdown.appendChild(option);
    });
    const addOption = document.createElement("option");
    addOption.value = addProfileValue;
    addOption.textContent = "+ Add a profile…";
    dropdown.appendChild(addOption);
    if (files.includes(previous)) dropdown.value = previous;
    selectedProfile = dropdown.value;
    showSetupHelp(false);
    showError("");
    if (curState !== 'CONNECTED') {
      setDropdownDisabled(false);
      setButtonDisabled(false);
    }
    extendDebug(`Loaded ${files.length} profile(s).`);
    return Promise.resolve();
  } catch (e) {
    setDropdownDisabled(true);
    setButtonDisabled(curState !== 'CONNECTED');
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
  authSubmitted = false;
  setButtonDisabled(true);
  setDropdownDisabled(true);
  updateStateLabel('Connecting…', 'connecting');
  setDebug('Launching OpenVPN with ' + cfg);
  try {
    // --management-query-passwords: OpenVPN asks the app for logins instead of reading a terminal it doesn't have.
    // --auth-retry interact: ask again after a wrong password instead of exiting.
    // --cd: relative paths in the profile (ca, cert, auth-user-pass files) resolve against the profiles folder.
    // --up/--down (after --config, so they win): res/vpn-hook.sh shows a TV toast and blocks IPv6 while
    // connected, also around reconnects (--up-restart).
    const hook = `${appDir}/res/vpn-hook.sh`;
    // Profiles and stored logins are secrets, but webOS can reset the app folder to world-readable
    // (seen after a reboot), so lock the folder down again before every connect.
    await lunaCall('luna://org.webosbrew.hbchannel.service/exec', {
      command: `chmod 700 ${profilesDir} && chmod -R go-rwx ${profilesDir}`
    }).catch(e => extendDebug(`Could not restrict the profiles folder: ${e.message}`));
    await lunaCall('luna://org.webosbrew.hbchannel.service/spawn', { command: `${appDir}/res/openvpn --management 127.0.0.1 ${mgmtPort} --management-query-passwords --auth-retry interact --cd ${profilesDir} --config ${profilesDir}/${cfg} --script-security 2 --up ${hook} --down ${hook} --up-restart --daemon` });
    console.log('state from connect');
    setTimeout(getState,2000);
  } catch (e) {
    setDebug(e.message);
    showError('Start failed ' + e.message);
    updateStateLabel('DISCONNECTED', 'disconnected');
    setButtonDisabled(false);
    setDropdownDisabled(false);
  }
}
async function disconnect() {
  showError('');
  setButtonDisabled(true);
  setDropdownDisabled(true);
  updateStateLabel('Disconnecting…', 'connecting');
  setDebug('Stopping VPN Connection...');
  try {
    await terminateDaemon();
    setTimeout(async() => {
      console.log('state from disconnect');
      await getState(1, true);
      setDebug('VPN Stopped.');
    }, 2000);
  } catch (e) {
    showError('Stop failed ' + e.message); setButtonDisabled(false);
    setDropdownDisabled(false);
  }
}
function btnClick() { curState === 'CONNECTED' ? disconnect() : connect(); }

function reloadClick() {
  extendDebug('Reloading profiles...');
  loadProfiles().then(() => {}, () => extendDebug('No profiles found.'));
}

async function initVPN() {
  setDebug('Preparing openvpn binary...');
  try {
    await lunaCall('luna://org.webosbrew.hbchannel.service/exec', {
      command: `chmod +x ${appDir}/res/openvpn ${appDir}/res/vpn-hook.sh`
    });
  } catch (e) {
    extendDebug(`Failed to set executable flag: ${e.message}`);
  }
  extendDebug('Checking management interface…');
  console.log('state from initVPN');
  await getState(1, true);
  // Also lifts a leftover IPv6 block if OpenVPN died without running its down hook.
  applyHookSettings();
}

function launchEvent() {
  if (!launched) {
    launched = true;
    setLogVisible(storageGet('logVisible') !== '0');
    renderHookSettings();
    document.getElementById('profilesPath').innerText = profilesDir;
    SpatialNavigation.init();
    SpatialNavigation.add({ selector: '.item' });
    SpatialNavigation.makeFocusable();
    eventRegister.add();
    document.getElementById('cbtn').addEventListener('click', btnClick);
    document.getElementById('reloadBtn').addEventListener('click', reloadClick);
    document.getElementById('themeBtn').addEventListener('click', nextTheme);
    document.getElementById('logBtn').addEventListener('click', toggleLog);
    document.getElementById('notifyBtn').addEventListener('click', () => toggleHookSetting('NOTIFY'));
    document.getElementById('ipv6Btn').addEventListener('click', () => toggleHookSetting('BLOCK_IPV6'));
    document.getElementById('dnsBtn').addEventListener('click', () => toggleHookSetting('VPN_DNS'));
    document.getElementById('authSubmit').addEventListener('click', submitAuth);
    document.getElementById('authCancel').addEventListener('click', cancelAuth);
    document.getElementById('configDropdown').addEventListener('change', profileChanged);
    document.getElementById('setupClose').addEventListener('click', closeSetupHelp);
  }
  loadTvAddress();
  initVPN().then(() => {
    extendDebug('Loading Profiles, this could take some seconds...');
    loadProfiles().then(()=>{
      extendDebug("Initialization complete.")
    },
    ()=>{
      extendDebug('No profiles found.');
    });
  });
}

applyTheme(storageGet('theme'));
document.addEventListener('webOSLaunch', launchEvent, true);
document.addEventListener('webOSRelaunch', launchEvent, true);
