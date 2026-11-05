// ==UserScript==
// @name         FocusSync - Instagram
// @namespace    https://github.com/EnricoDiMaria/focussync
// @version      1.0.0
// @description  Daily Instagram time limit synced across your devices with Upstash Redis.
// @match        https://www.instagram.com/*
// @grant        GM_xmlhttpRequest
// @connect      *.upstash.io
// ==/UserScript==

(() => {
    'use strict';

    // ── PERSONAL CONFIGURATION ───────────────────────────────────────────────
    // Create your own Upstash Redis database. Never publish your REST token.
    const REST_URL = 'https://YOUR-DATABASE.upstash.io';
    const REST_TOKEN = 'YOUR_UPSTASH_REST_TOKEN';

    const DAILY_LIMIT_SECONDS = 15 * 60; // 15 minutes
    const SYNC_INTERVAL_SECONDS = 15;    // Upload accumulated time every 15 seconds
    const RESET_HOUR_LOCAL = 0;          // 0 = midnight in this device's local timezone
    // ─────────────────────────────────────────────────────────────────────────

    const KEY_PREFIX = 'focussync:instagram:';
    let dayKey = getDayKey();
    let cloudSeconds = 0;
    let pendingSeconds = 0;
    let ready = false;
    let blocked = false;
    let syncInFlight = false;

    function getDayKey() {
        const date = new Date(Date.now() - RESET_HOUR_LOCAL * 60 * 60 * 1000);
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        return `${KEY_PREFIX}${yyyy}-${mm}-${dd}`;
    }

    function request(method, path, onSuccess, onError) {
        GM_xmlhttpRequest({
            method,
            url: `${REST_URL.replace(/\/$/, '')}/${path}`,
            headers: { Authorization: `Bearer ${REST_TOKEN}` },
            onload: response => {
                if (response.status < 200 || response.status >= 300) {
                    onError?.(new Error(`Upstash HTTP ${response.status}`));
                    return;
                }
                try {
                    const payload = JSON.parse(response.responseText);
                    if (payload.error) throw new Error(payload.error);
                    onSuccess?.(payload);
                } catch (error) {
                    onError?.(error);
                }
            },
            onerror: () => onError?.(new Error('Network request failed'))
        });
    }

    function formatTime(seconds) {
        const minutes = Math.floor(seconds / 60);
        const remainder = seconds % 60;
        return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
    }

    function showBlock() {
        if (blocked || !document.body) return;
        blocked = true;
        document.body.replaceChildren();

        const panel = document.createElement('main');
        Object.assign(panel.style, {
            minHeight: '100vh', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', textAlign: 'center',
            padding: '24px', boxSizing: 'border-box', background: '#000',
            color: '#fff', fontFamily: 'system-ui, sans-serif'
        });

        const heading = document.createElement('h1');
        heading.textContent = 'Daily limit reached';
        heading.style.fontSize = '28px';

        const message = document.createElement('p');
        message.textContent = `You have used your ${formatTime(DAILY_LIMIT_SECONDS)} Instagram allowance for today.`;
        message.style.color = '#aaa';

        panel.append(heading, message);
        document.body.append(panel);
    }

    function loadCloudTime() {
        ready = false;
        request('GET', `get/${encodeURIComponent(dayKey)}`, payload => {
            cloudSeconds = Math.max(0, Number.parseInt(payload.result ?? '0', 10) || 0);
            ready = true;
            if (cloudSeconds + pendingSeconds >= DAILY_LIMIT_SECONDS) showBlock();
        }, error => {
            console.error('[FocusSync] Could not load Instagram usage:', error);
            // Fail open: browsing remains available if the cloud cannot be reached.
            ready = true;
        });
    }

    function syncTime() {
        if (pendingSeconds <= 0 || syncInFlight) return;
        const amount = pendingSeconds;
        const targetKey = dayKey;
        pendingSeconds = 0;
        syncInFlight = true;

        request('POST', `incrby/${encodeURIComponent(targetKey)}/${amount}`, payload => {
            if (targetKey === dayKey) {
                cloudSeconds = Math.max(cloudSeconds, Number(payload.result) || 0);
            }
            request('POST', `expire/${encodeURIComponent(targetKey)}/172800`,
                () => {}, error => console.warn('[FocusSync] Could not set key expiry:', error));
            syncInFlight = false;
            if (targetKey === dayKey && cloudSeconds + pendingSeconds >= DAILY_LIMIT_SECONDS) {
                showBlock();
            }
            if (pendingSeconds > 0) syncTime();
        }, error => {
            // Restore the unsent amount for a later retry.
            if (targetKey === dayKey) pendingSeconds += amount;
            syncInFlight = false;
            console.error('[FocusSync] Could not sync Instagram usage:', error);
        });
    }

    loadCloudTime();

    setInterval(() => {
        const newDayKey = getDayKey();
        if (newDayKey !== dayKey) {
            syncTime();
            dayKey = newDayKey;
            cloudSeconds = 0;
            pendingSeconds = 0;
            blocked = false;
            loadCloudTime();
            return;
        }

        if (!ready || blocked || document.hidden) return;

        if (cloudSeconds + pendingSeconds >= DAILY_LIMIT_SECONDS) {
            syncTime();
            showBlock();
            return;
        }

        pendingSeconds += 1;
        if (pendingSeconds >= SYNC_INTERVAL_SECONDS) syncTime();

        if (cloudSeconds + pendingSeconds >= DAILY_LIMIT_SECONDS) {
            syncTime();
            showBlock();
        }
    }, 1000);

    const flush = () => syncTime();
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
})();
