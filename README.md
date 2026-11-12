# Handheld Daemon Quick Settings

A GNOME Shell extension that puts [Handheld Daemon](https://github.com/hhd-dev/hhd)
(`hhd`) controls in the quick settings menu.

The main tile opens `hhd-ui`. The small arrow on the right expands the tile and
shows the current TDP power mode and fan mode.

## Features

- Quick settings tile with live status in the subtitle
- Click the main tile to launch `hhd-ui`
- Expand the arrow to switch power and fan modes without leaving the menu
- Three power modes: quiet, balanced, performance
- Two fan modes: disabled, manual
- Mode labels come from Handheld Daemon itself, so they follow the daemon's
  language and the device's supported modes
- Automatic detection of the TDP and fan settings paths in the hhd settings tree
- Polls hhd every 5 seconds and refreshes immediately when the menu opens

## Requirements

- GNOME Shell 45 or newer (developed and tested on GNOME Shell 50.6)
- Handheld Daemon running with its local HTTP API on `127.0.0.1:5335`
- `hhd-ui` available in `PATH` or at `~/.local/bin/hhd-ui`

The extension reads the hhd bearer token from `/tmp/hhd/token` and falls back to
`/etc/hhd/.token` when token authentication is enabled.

## Install

### From a release

Download the latest `*.shell-extension.zip` from the
[releases page](https://github.com/UraniumW/gnome-hhd-quick-settings/releases)
and install it:

```sh
gnome-extensions install --force hhd-quick-settings@uraniumw.github.io.shell-extension.zip
```

### From this repository

```sh
git clone https://github.com/UraniumW/gnome-hhd-quick-settings.git
cd gnome-hhd-quick-settings
make install
```

Or install manually:

```sh
UUID=hhd-quick-settings@uraniumw.github.io
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
mkdir -p "$DEST"
cp extension.js hhdClient.js metadata.json stylesheet.css "$DEST"/
gnome-extensions enable "$UUID"
```

After installing a new extension on Wayland, log out and back in (or restart
GNOME Shell on X11) so the shell discovers it.

## Usage

1. Open the GNOME quick settings menu.
2. Click the **Handheld** tile to open `hhd-ui`.
3. Click the arrow on the right of the tile to expand the controls.
4. Choose a power mode or fan mode.

The tile subtitle shows the current state, for example `Balanced · Disabled`.
With a non-English hhd locale the labels match `hhd-ui` instead.

## How it works

`hhdClient.js` is a small client for the Handheld Daemon HTTP API:

- `GET /api/v1/state` reads the current state
- `GET /api/v1/settings` discovers mode labels and supported values
- `POST /api/v1/state` applies a mode change

The extension does not modify Handheld Daemon or link against its code. It only
uses the daemon's documented local HTTP API.

## Development

```sh
# Build a distributable zip
make pack

# Copy the extension into the user extension directory
make install

# Remove the installed extension
make uninstall
```

The build artifact is written to `dist/`.

## Compatibility notes

The extension searches the hhd settings tree for:

- a `mode` node containing the three supported power modes
- a `mode` node containing the two supported fan modes

This keeps it working across hhd devices even though the settings paths differ
between vendors. It has been tested with an ASUS ROG Flow Z13.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
