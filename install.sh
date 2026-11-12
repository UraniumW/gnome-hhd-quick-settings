#!/usr/bin/env bash
set -euo pipefail

UUID="hhd-quick-settings@uraniumw.github.io"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"

mkdir -p "$DEST"
install -m 644 \
    "$SCRIPT_DIR/extension.js" \
    "$SCRIPT_DIR/hhdClient.js" \
    "$SCRIPT_DIR/metadata.json" \
    "$SCRIPT_DIR/stylesheet.css" \
    "$DEST/"

if gnome-extensions enable "$UUID"; then
    echo "Enabled $UUID"
else
    echo "Installed to $DEST"
    echo "The current shell has not discovered the extension yet."
fi

echo "Log out and back in on Wayland (or restart GNOME Shell on X11) to load it."
