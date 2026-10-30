# lgtv-vpn
A small LG webOS TV app that wraps an OpenVPN client so you can start and stop VPN connections directly from your TV without an external router or device.

<img width="1920" height="1080" alt="The app on a TV with no profiles yet: status and log on the left, setup steps with an scp command on the right" src="docs/screenshot.png" />

## What the app does
- Uses the bundled OpenVPN binary to start a VPN connection on your LG TV.
- Talks to the Homebrew Channel service to run OpenVPN in the background and manage its lifecycle.
- Provides an on-device UI built for the remote to connect, disconnect, and view connection status.
- The VPN connection is kept even when switching apps. So Youtube / Netflix etc. is also running through the VPN connection.

## Using the app
The screen fits on the TV without scrolling and is navigated with the remote's arrow keys and OK button.

- **Status** (top left): a colored dot and label show Connected (green), Connecting… (amber), Sign-in needed, or Disconnected (red).
- **Profile** (below the status): pick a profile, then press **Connect**; the button turns into a red **Disconnect** while the VPN is up. **Reload** re-reads the profiles folder, so new profiles show up without restarting the app.
- **Sign-in** (in place of the profile row): appears when a profile asks for a username and password or a key passphrase. See [Profiles that need a password](#profiles-that-need-a-password).
- **Log** (bottom left): OpenVPN and app messages, newest at the bottom. **Hide log** folds it away.
- **Add a VPN profile** (right): shown only while no profiles are found. It lists the setup steps with a ready-to-paste `scp` command that includes the TV's IP address and profiles folder.
- **Theme** (top right): cycles through Dark, Light, Midnight and OLED Black. The choice is remembered.


## Installation options
### Install a published IPK
1. Download the latest `com.sk.app.lgtv-vpn_*.ipk` from the project releases.
2. Install the IPK via `ares-install` or with the [webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop).

### Build the IPK yourself
1. Install the webOS TV CLI so you have access to `ares-package` and `ares-install`.
2. From the repository root, run:
   ```bash
   ares-package com.sk.app.lgtv-vpn
   ```
   This produces an IPK file such as `com.sk.app.lgtv-vpn_0.0.1_all.ipk` in the current directory.
3. Deploy the generated IPK to your TV:
   ```bash
   ares-install com.sk.app.lgtv-vpn_0.0.1_all.ipk
   ```

### Install this checkout next to the released app
With the SSH server enabled in the Homebrew Channel settings:
```bash
./install-to-tv.sh <tv-ip> [profile.ovpn ...]
```
This builds an IPK with the app id `com.sk.app.lgtv-vpn.dev` ("VPN (dev)") and installs it alongside the released app, so you can try changes without touching it. It reuses the released app's `openvpn` binary and copies its profiles on the first install. Running it again updates the dev app and keeps its profiles. Set `APP_ID` and `APP_TITLE` to use another id and name. No webOS SDK is needed.

Both apps control OpenVPN through the same management port, so they see and control the same connection; only run one VPN at a time.

## Provide your VPN profiles
The app expects your OpenVPN profiles to live in `/media/developer/apps/usr/palm/applications/com.sk.app.lgtv-vpn/profiles` on the TV:
1. Copy your `.ovpn` files (and any referenced certificates/keys) into that folder (possible also with [webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop)).
2. Launch the app and select the desired profile from the drop-down list, then press **Connect**.

If the app finds no profiles, it shows these steps along with a ready-to-paste `scp` command for your TV (enable the SSH server in the Homebrew Channel settings first). Press **Reload** after copying. The dev build installed by `install-to-tv.sh` has its own folder, `.../com.sk.app.lgtv-vpn.dev/profiles`, and its setup steps show that path.

Relative paths in a profile (`ca`, `cert`, `key`, `auth-user-pass` files) are resolved against the profiles folder.

### Profiles that need a password
If a profile asks for a username and password (`auth-user-pass`) or has an encrypted private key, the app shows a sign-in form when you connect. A wrong password brings the form back. To avoid typing on the TV, put the username and password on two lines in a file in the profiles folder and reference it from the profile:
```
auth-user-pass login.txt
```

## Requirements
- An LG TV with webOS that has the Homebrew Channel with root installed and running.
- Valid OpenVPN configuration files that work with your VPN provider.

## Stability and troubleshooting
- The app is still experimental and may not be fully stable yet. If it becomes unresponsive, restart the TV with QuickStart disabled.
- You can terminate any leftover OpenVPN processes through the root shell on the TV if a restart is not possible.
