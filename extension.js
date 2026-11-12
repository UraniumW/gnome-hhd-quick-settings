// SPDX-License-Identifier: GPL-3.0-or-later
//
// Handheld Daemon quick settings tile.
//
// The main part of the tile opens hhd-ui. The small arrow button on the
// right expands the tile and shows the TDP power mode and fan mode controls.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {HhdClient, HhdError} from './hhdClient.js';

const POWER_VALUES = ['quiet', 'balanced', 'performance'];
const FAN_VALUES = ['disabled', 'manual'];

const POWER_LABELS = {
    quiet: 'Quiet',
    balanced: 'Balanced',
    performance: 'Performance',
};
const FAN_LABELS = {
    disabled: 'Disabled',
    manual: 'Manual',
};

const POWER_KEY = 'tdp.asus.tdp_v2';
const FAN_KEY = 'tdp.asus.fan';
const POLL_INTERVAL = 5;

function getValue(object, path) {
    let value = object;
    for (const key of path.split('.')) {
        if (value === null || typeof value !== 'object' || !(key in value))
            return undefined;
        value = value[key];
    }
    return value;
}

// Find a "mode" node in the hhd settings tree, e.g. tdp.asus.tdp_v2.
function findModeNode(node, path, predicate) {
    if (!node || typeof node !== 'object')
        return null;

    if (node.type === 'mode' && node.modes && predicate(node.modes))
        return {path, modes: node.modes};

    // A settings node stores its children in `children`. The top-level
    // `tdp` object, however, maps plugin names directly to nodes.
    const children = node.children ?? node;
    for (const [key, child] of Object.entries(children)) {
        if (key === 'modes')
            continue;
        const result = findModeNode(child, `${path}.${key}`, predicate);
        if (result)
            return result;
    }
    return null;
}

// Find the parent path of a "mode" value in the runtime state.
function findStateMode(node, path, predicate) {
    if (!node || typeof node !== 'object')
        return null;

    for (const [key, value] of Object.entries(node)) {
        if (key === 'mode' && typeof value === 'string' && predicate(value))
            return path;
        if (value && typeof value === 'object') {
            const result = findStateMode(value, `${path}.${key}`, predicate);
            if (result)
                return result;
        }
    }
    return null;
}

function makeOptions(values, modeNode, fallbackLabels) {
    return values.map(value => ({
        value,
        label: modeNode?.modes?.[value]?.title || fallbackLabels[value] || value,
    }));
}

const ModeRow = GObject.registerClass({
    GTypeName: 'HhdModeRow',
}, class ModeRow extends PopupMenu.PopupBaseMenuItem {
    _init(title) {
        super._init({
            reactive: false,
            activate: false,
            hover: false,
            can_focus: false,
            style_class: 'hhd-menu-row',
        });

        this.setOrnament(PopupMenu.Ornament.HIDDEN);

        this._signature = '';
        this._enabled = true;
        this._callback = null;
        this._buttons = new Map();

        const titleLabel = new St.Label({
            text: title,
            style_class: 'hhd-row-title',
            x_align: Clutter.ActorAlign.START,
        });

        this._buttonBox = new St.BoxLayout({
            style_class: 'hhd-mode-box',
            x_expand: true,
        });

        const box = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            style_class: 'hhd-row-box',
        });
        box.add_child(titleLabel);
        box.add_child(this._buttonBox);
        this.add_child(box);
    }

    setOptions(options, callback) {
        this._callback = callback;

        const signature = options.map(o => `${o.value}:${o.label}`).join('|');
        if (signature === this._signature)
            return;
        this._signature = signature;

        this._buttonBox.destroy_all_children();
        this._buttons.clear();

        for (const option of options) {
            const label = new St.Label({
                text: option.label,
                x_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });

            const button = new St.Button({
                style_class: 'hhd-mode-button button',
                toggle_mode: true,
                can_focus: true,
                x_expand: true,
                child: label,
                accessible_name: option.label,
            });

            button.connect('clicked', () => {
                if (this._enabled)
                    this._callback?.(option.value);
            });

            this._buttonBox.add_child(button);
            this._buttons.set(option.value, button);
        }

        this.setEnabled(this._enabled);
    }

    setCurrent(value) {
        for (const [mode, button] of this._buttons)
            button.checked = mode === value;
    }

    setEnabled(enabled) {
        this._enabled = enabled;
        for (const button of this._buttons.values())
            button.reactive = enabled;
    }
});

function openHhdUi() {
    let program = GLib.find_program_in_path('hhd-ui');
    if (!program) {
        const fallback = GLib.build_filenamev([
            GLib.get_home_dir(), '.local', 'bin', 'hhd-ui',
        ]);
        if (GLib.file_test(fallback, GLib.FileTest.IS_EXECUTABLE))
            program = fallback;
    }

    if (!program) {
        Main.notify('Handheld Daemon', 'Could not find the hhd-ui program.');
        return;
    }

    try {
        Gio.Subprocess.new([program],
            Gio.SubprocessFlags.STDOUT_SILENCE |
            Gio.SubprocessFlags.STDERR_SILENCE);
    } catch (e) {
        console.error(`[hhd-quick-settings] Could not start hhd-ui: ${e.message}`);
        Main.notify('Handheld Daemon', `Could not start hhd-ui: ${e.message}`);
    }
}

const HhdToggle = GObject.registerClass({
    GTypeName: 'HhdQuickToggle',
}, class HhdToggle extends QuickSettings.QuickMenuToggle {
    _init() {
        super._init({
            title: 'Handheld',
            subtitle: 'Loading…',
            iconName: 'input-gaming-symbolic',
            toggleMode: false,
            menuButtonAccessibleName: 'Handheld Daemon power and fan options',
        });

        this._client = new HhdClient();
        this._destroyed = false;
        this._refreshing = false;
        this._pendingWrites = 0;
        this._busy = {power: false, fan: false};
        this._schemaLoaded = false;
        this._lastError = null;
        this._version = 0;
        this._refreshSource = 0;
        this._lastUiLaunch = 0;

        this._powerPath = null;
        this._fanPath = null;
        this._powerValue = null;
        this._fanValue = null;
        this._powerOptions = makeOptions(POWER_VALUES, null, POWER_LABELS);
        this._fanOptions = makeOptions(FAN_VALUES, null, FAN_LABELS);

        this.menu.setHeader('input-gaming-symbolic', 'Handheld Daemon',
            'Power and fan control');

        this._powerRow = new ModeRow('Power mode');
        this._fanRow = new ModeRow('Fan mode');
        this._powerRow.setOptions(this._powerOptions,
            value => this._setMode('power', value));
        this._fanRow.setOptions(this._fanOptions,
            value => this._setMode('fan', value));

        this.menu.addMenuItem(this._powerRow);
        this.menu.addMenuItem(this._fanRow);

        const openItem = new PopupMenu.PopupMenuItem('Open Handheld Daemon UI');
        openItem.connectObject('activate', () => this._openUi(), this);
        this.menu.addMenuItem(openItem);

        this.connectObject('clicked', () => this._openUi(), this);

        this.menu.connectObject('open-state-changed', (_menu, open) => {
            if (open)
                this._refresh(true);
        }, this);

        this._timeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, POLL_INTERVAL, () => {
                this._refresh();
                return GLib.SOURCE_CONTINUE;
            });

        this._refresh(true);
    }

    _openUi() {
        // The tile and its inner button can both emit 'clicked' on some
        // versions. Avoid launching two instances for one click.
        const now = GLib.get_monotonic_time();
        if (now - this._lastUiLaunch < 1000000)
            return;
        this._lastUiLaunch = now;

        this.menu.close();
        Main.panel.statusArea.quickSettings?.menu?.close();
        openHhdUi();
    }

    _setError(error) {
        let message = 'Handheld Daemon unavailable';
        if (error instanceof HhdError && error.status === 401)
            message = 'Handheld Daemon authentication failed';

        this.subtitle = message;
        this._powerRow.setEnabled(false);
        this._fanRow.setEnabled(false);

        if (this._lastError !== message) {
            this._lastError = message;
            console.warn(`[hhd-quick-settings] ${message}: ${error.message}`);
        }
    }

    _applySettings(settings) {
        const power = findModeNode(settings.tdp ?? {}, 'tdp',
            modes => POWER_VALUES.every(value => value in modes));
        const fan = findModeNode(settings.tdp ?? {}, 'tdp',
            modes => FAN_VALUES.every(value => value in modes));

        if (power) {
            this._powerPath = power.path;
            this._powerOptions = makeOptions(POWER_VALUES, power, POWER_LABELS);
            this._powerRow.setOptions(this._powerOptions,
                value => this._setMode('power', value));
        }

        if (fan) {
            this._fanPath = fan.path;
            this._fanOptions = makeOptions(FAN_VALUES, fan, FAN_LABELS);
            this._fanRow.setOptions(this._fanOptions,
                value => this._setMode('fan', value));
        }

        this._schemaLoaded = true;
    }

    _detectPaths(state) {
        if (!this._powerPath) {
            this._powerPath = findStateMode(state.tdp ?? {}, 'tdp',
                value => POWER_VALUES.includes(value)) ?? POWER_KEY;
        }
        if (!this._fanPath) {
            this._fanPath = findStateMode(state.tdp ?? {}, 'tdp',
                value => FAN_VALUES.includes(value)) ?? FAN_KEY;
        }
    }

    _applyState(state) {
        this._detectPaths(state);

        this._powerValue = getValue(state, `${this._powerPath}.mode`) ?? null;
        this._fanValue = getValue(state, `${this._fanPath}.mode`) ?? null;

        this._powerRow.setCurrent(this._powerValue);
        this._fanRow.setCurrent(this._fanValue);
        this._powerRow.setEnabled(this._powerValue !== null);
        this._fanRow.setEnabled(this._fanValue !== null);

        this._updateSubtitle();
        this._lastError = null;
    }

    _applyOptimistic(kind, value) {
        if (kind === 'power') {
            this._powerValue = value;
            this._powerRow.setCurrent(value);
            this._powerRow.setEnabled(true);
        } else {
            this._fanValue = value;
            this._fanRow.setCurrent(value);
            this._fanRow.setEnabled(true);
        }
        this._updateSubtitle();
    }

    _updateSubtitle() {
        const powerLabel = this._labelFor(this._powerOptions, this._powerValue);
        const fanLabel = this._labelFor(this._fanOptions, this._fanValue);
        const labels = [powerLabel, fanLabel].filter(Boolean);
        this.subtitle = labels.length > 0 ? labels.join(' · ') : 'No controls found';
    }

    _labelFor(options, value) {
        return options.find(option => option.value === value)?.label ?? null;
    }

    // The daemon can answer a state change with a response that was produced
    // just before another event finished. Read the state again shortly after
    // applying a value instead of trusting the write response indefinitely.
    _scheduleRefresh(delayMs = 500) {
        if (this._destroyed)
            return;

        if (this._refreshSource) {
            GLib.source_remove(this._refreshSource);
            this._refreshSource = 0;
        }

        this._refreshSource = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, delayMs, () => {
                this._refreshSource = 0;
                this._refresh();
                return GLib.SOURCE_REMOVE;
            });
    }

    async _refresh(loadSettings = false) {
        if (this._destroyed || this._refreshing || this._pendingWrites > 0)
            return;

        const version = this._version;
        this._refreshing = true;
        try {
            if (loadSettings && !this._schemaLoaded) {
                try {
                    const settings = await this._client.getSettings();
                    if (!this._destroyed)
                        this._applySettings(settings);
                } catch {
                    // Older daemons may not expose /settings; state detection
                    // and the built-in labels are enough.
                }
            }

            const state = await this._client.getState();
            if (this._destroyed ||
                version !== this._version || this._pendingWrites > 0)
                return;

            this._applyState(state);
        } catch (e) {
            if (!this._destroyed)
                this._setError(e);
        } finally {
            this._refreshing = false;
        }
    }

    async _setMode(kind, value) {
        if (this._destroyed || this._busy[kind])
            return;

        const path = kind === 'power' ? this._powerPath : this._fanPath;
        if (!path)
            return;

        const row = kind === 'power' ? this._powerRow : this._fanRow;
        this._version++;
        this._pendingWrites++;
        this._busy[kind] = true;
        row.setEnabled(false);
        this.subtitle = 'Applying…';

        let failed = false;
        try {
            await this._client.setState({[`${path}.mode`]: value});
            if (!this._destroyed) {
                // The write response may be one event loop behind if another
                // write is in flight. Show the requested value immediately and
                // let the scheduled read settle the final state.
                this._applyOptimistic(kind, value);
                this._lastError = null;
            }
        } catch (e) {
            failed = true;
            if (!this._destroyed)
                this._setError(e);
        } finally {
            this._pendingWrites--;
            this._busy[kind] = false;
        }

        if (failed || this._pendingWrites === 0)
            this._scheduleRefresh(failed ? 0 : 500);
    }

    destroy() {
        this._destroyed = true;

        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }

        if (this._refreshSource) {
            GLib.source_remove(this._refreshSource);
            this._refreshSource = 0;
        }

        this._client?.destroy();
        this._client = null;

        this.menu.destroy();
        super.destroy();
    }
});

const HhdIndicator = GObject.registerClass({
    GTypeName: 'HhdQuickSettingsIndicator',
}, class HhdIndicator extends QuickSettings.SystemIndicator {
    _init() {
        super._init();

        this._toggle = new HhdToggle();
        this.quickSettingsItems.push(this._toggle);
    }

    destroy() {
        this.quickSettingsItems.forEach(item => item.destroy());
        this.quickSettingsItems = [];
        super.destroy();
    }
});

export default class HhdQuickSettingsExtension extends Extension {
    enable() {
        this._indicator = new HhdIndicator();
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
