// SPDX-License-Identifier: GPL-3.0-or-later
//
// Small client for the Handheld Daemon HTTP API.
//
// Handheld Daemon listens on 127.0.0.1:5335 and protects the API with a
// bearer token when authentication is enabled. The token is world-readable
// and is written to /tmp/hhd/token (with /etc/hhd/.token as a fallback).

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup';

const API_BASE = 'http://127.0.0.1:5335/api/v1';
const TOKEN_PATHS = ['/tmp/hhd/token', '/etc/hhd/.token'];
const REQUEST_TIMEOUT = 5;

function readToken() {
    for (const path of TOKEN_PATHS) {
        const [ok, contents] = GLib.file_get_contents(path);
        if (!ok)
            continue;

        const token = new TextDecoder().decode(contents).trim();
        if (token)
            return token;
    }
    return null;
}

export class HhdError extends Error {
    constructor(message, status = 0) {
        super(message);
        this.name = 'HhdError';
        this.status = status;
    }
}

export class HhdClient {
    constructor() {
        this._session = new Soup.Session();
        this._session.timeout = REQUEST_TIMEOUT;
        this._cancellable = new Gio.Cancellable();
    }

    async getState() {
        return this._request('GET', '/state');
    }

    async getSettings() {
        return this._request('GET', '/settings');
    }

    async setState(state) {
        return this._request('POST', '/state', state);
    }

    async _request(method, path, body = null) {
        const message = Soup.Message.new(method, `${API_BASE}${path}`);
        if (!message)
            throw new HhdError(`Invalid request: ${method} ${path}`);

        const headers = message.get_request_headers();
        const token = readToken();
        if (token)
            headers.append('Authorization', `Bearer ${token}`);

        if (body !== null) {
            const data = new TextEncoder().encode(JSON.stringify(body));
            message.set_request_body_from_bytes(
                'application/json', new GLib.Bytes(data));
        }

        const bytes = await this._send(message);
        const text = new TextDecoder().decode(bytes.get_data());
        const status = message.get_status();

        if (status !== Soup.Status.OK)
            throw new HhdError(text.trim() || `HTTP ${status}`, status);

        try {
            return JSON.parse(text);
        } catch (e) {
            throw new HhdError(`Invalid response from Handheld Daemon: ${e.message}`);
        }
    }

    _send(message) {
        return new Promise((resolve, reject) => {
            this._session.send_and_read_async(
                message, GLib.PRIORITY_DEFAULT, this._cancellable,
                (session, result) => {
                    try {
                        resolve(session.send_and_read_finish(result));
                    } catch (e) {
                        reject(e);
                    }
                });
        });
    }

    destroy() {
        this._cancellable.cancel();
        this._session.abort();
        this._session = null;
    }
}
