# Sing-box Menu (Raycast extension)

Menu bar controller for [sing-box](https://github.com/SagerNet/sing-box) on macOS. Reuses the LaunchDaemon and `sudoers` entry installed by [SingBoxMenu](https://github.com/kazelise/SingBoxMenu) — this extension only drives `launchctl` and stages configs through the existing root-owned slot, so day-to-day profile switching is fully passwordless.

## Prerequisites

1. Run `SingBoxMenu.app` once → **Install / Enable Boot Service**. This creates:
   - `/Library/LaunchDaemons/io.local.sing-box.profiled.plist`
   - `/Library/SingBoxMenu/active.json` (root-owned, the running config)
   - `/etc/sudoers.d/singboxmenu` (narrow `NOPASSWD` allow-list for the current user)
2. Ensure the `sing-box` binary is at `/opt/homebrew/bin/sing-box` (or set the path in this extension's Preferences).

## Develop

```bash
git clone https://github.com/kazelise/singbox-menu.git
cd singbox-menu
npm install
npm run dev
```

On first run, Raycast prompts for a **Config Folder** in the extension Preferences. Point it at any directory containing your `*.json` sing-box configs; an optional `profiles/` subfolder is also scanned.

## What it does

- **Menu bar icon** — official sing-box logo. Shown in full color when the daemon is `Running`, dimmed gray silhouette otherwise.
- **First menu item** — `sing-box: Running / Loaded / Stopped / Not Installed` with a green/gray dot, like Linux service status.
- **Profiles submenu** — every `*.json` at the top level of your config folder (and in the optional `profiles/` subfolder). Each entry is validated by `sing-box check` in the background:
  - ✓ green — valid and currently active
  - ○ gray — valid, not active
  - ✗ red — `sing-box check` failed (tooltip shows the error)
  - Click an entry to activate: `sing-box check` → stage to `/tmp/singboxmenu-staged.json` → `sudo -n install` to `/Library/SingBoxMenu/active.json` → `launchctl kickstart`.
- **Start / Stop / Refresh** — direct `launchctl` controls via the existing sudoers allow-list, no password prompt.
- **Reveal Config Folder / Open Preferences** — convenience.

## How activation works

Same flow as `SingBoxMenu.app`:

```
sing-box check -c <profile>           # validate first
cp <profile> /tmp/singboxmenu-staged.json
sudo -n /usr/bin/install -o root -g wheel -m 644 \
    /tmp/singboxmenu-staged.json /Library/SingBoxMenu/active.json
sudo -n /bin/launchctl kickstart -k system/io.local.sing-box.profiled
```

All `sudo -n` calls are covered by the SingBoxMenu sudoers entry; if that file is missing, install via SingBoxMenu first.

## Credits

- Icon: [Sing-box.svg](https://commons.wikimedia.org/wiki/File:Sing-box.svg) on Wikimedia Commons.
- Daemon scaffolding: [SingBoxMenu](https://github.com/kazelise/SingBoxMenu).

## License

MIT
