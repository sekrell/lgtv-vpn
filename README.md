# lgtv-vpn
A small LG webOS TV app that wraps an OpenVPN client so you can start and stop VPN connections directly from your TV without an external router or device.

<img width="1830" height="668" alt="lg_vpn2" src="https://github.com/user-attachments/assets/9c07e479-1d45-47b8-bbf6-f2ea46c8ee42" />

## What the app does
- Uses the bundled OpenVPN binary to start a VPN connection on your LG TV.
- Talks to the Homebrew Channel service to run OpenVPN in the background and manage its lifecycle.
- Provides a simple on-device UI to connect, disconnect, and view connection status.
- The VPN connection is kept even when switching apps. So Youtube / Netflix etc. is also running through the VPN connection.


## Installation options
### Install a published IPK
1. Download the latest `com.sk.app.lgtv-vpn_*.ipk` from the project releases.
2. Install the IPK via `ares-install`.

### Build the IPK yourself
1. Install the webOS TV CLI so you have access to `ares-package` and `ares-install`.
2. From the repository root, run:
   ```bash
   ares-package .
   ```
   This produces an IPK file such as `com.sk.app.lgtv-vpn_0.0.1_all.ipk` in the current directory.
3. Deploy the generated IPK to your TV:
   ```bash
   ares-install com.sk.app.lgtv-vpn_0.0.1_all.ipk
   ```

## Provide your VPN profiles
The app expects your OpenVPN profiles to live in `/media/developer/apps/usr/palm/applications/com.sk.app.lgtv-vpn/profiles` on the TV:
1. Copy your `.ovpn` files (and any referenced certificates/keys) into that folder.
2. Launch the app and select the desired profile from the drop-down list, then press **Connect**.

## Requirements
- An LG TV with webOS that has the Homebrew Channel installed and running.
- Valid OpenVPN configuration files that work with your VPN provider.

## Stability and troubleshooting
- The app is still experimental and may not be fully stable yet. If it becomes unresponsive, restart the TV with QuickStart disabled.
- You can terminate any leftover OpenVPN processes through the root shell on the TV if a restart is not possible.
