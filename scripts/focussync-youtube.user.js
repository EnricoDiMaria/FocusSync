// ==UserScript==
// @name         FocusSync - YouTube
// @namespace    https://github.com/EnricoDiMaria/focussync
// @version      1.0.0
// @description  Daily YouTube playback limit with optional keyword exclusions, synced via Upstash Redis.
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @grant        GM_xmlhttpRequest
// @connect      *.upstash.io
// ==/UserScript==

(() => {
    'use strict';

    // ── PERSONAL CONFIGURATION ───────────────────────────────────────────────
    // Create your own Upstash Redis database. Never publish your REST token.
    const REST_URL = 'https://YOUR-DATABASE.upstash.io';
    const REST_TOKEN = 'YOUR_UPSTASH_REST_TOKEN';

    const DAILY_LIMIT_SECONDS = 60 * 60; // 60 minutes of eligible playback
    const SYNC_INTERVAL_SECONDS = 10;    // Upload accumulated time every 10 seconds
    const RESET_HOUR_LOCAL = 1;          // 1 = 01:00 in this device's local timezone

    // Videos whose title, channel name, or page title contains one of these
    // terms are excluded from the timer. Use [] to count every video.
    const EXCLUDED_KEYWORDS = [
        // 'tutorial',
        // 'programming',
        // 'guitar'
    ];
    // ─────────────────────────────────────────────────────────────────────────

    const KEY_PREFIX = 'focussync:youtube:';
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

    function getVideoText() {
        const titleSelectors = [
            'h1.ytd-watch-metadata yt-formatted-string',
            '#title h1',
            '.slim-video-metadata-title',
            'ytd-reel-player-header-renderer .yt-core-attributed-string'
        ];
        const channelSelectors = [
            '#owner #channel-name',
            'ytd-channel-name',
            '.ytm-slim-owner-channel-name',
            'ytm-channel-name',
            '#channel-name.ytd-reel-player-header-renderer'
        ];

        const firstText = selectors => {
            for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element?.textContent?.trim()) return element.textContent.trim();
            }
            return '';
        };

        return `${firstText(titleSelectors)} ${firstText(channelSelectors)} ${document.title || ''}`.toLowerCase();
    }

    function isExcluded() {
        const text = getVideoText();
        return EXCLUDED_KEYWORDS.some(keyword =>
            keyword.trim() && text.includes(keyword.toLowerCase().trim())
        );
    }

    function isPlaybackPage() {
        return location.pathname.startsWith('/watch') ||
               location.pathname.startsWith('/shorts/');
    }

    function updateBadge(remainingSeconds, excluded) {
        let badge = document.getElementById('focussync-youtube-badge');
        if (!badge) {
            badge = document.createElement('div');
            badge.id = 'focussync-youtube-badge';
            Object.assign(badge.style, {
                position: 'fixed', bottom: '12px', right: '12px',
                padding: '6px 10px', background: 'rgba(15,15,15,.88)',
                color: '#fff', font: '12px monospace', borderRadius: '6px',
                zIndex: '2147483640', pointerEvents: 'none',
                border: '1px solid rgba(255,255,255,.15)'
            });
            document.documentElement.append(badge);
        }

        if (document.fullscreenElement) {
            badge.style.display = 'none';
            return;
        }

        badge.style.display = 'block';
        if (excluded) {
            badge.style.color = '#4ade80';
            badge.textContent = 'FocusSync: excluded video';
        } else {
            const minutes = Math.floor(Math.max(0, remainingSeconds) / 60);
            const seconds = Math.max(0, remainingSeconds) % 60;
            badge.style.color = remainingSeconds <= 300 ? '#f87171' : '#fff';
            badge.textContent = `FocusSync: ${minutes}:${String(seconds).padStart(2, '0')} left`;
        }
    }

    function removeOverlay() {
        document.getElementById('focussync-youtube-overlay')?.remove();
        blocked = false;
        const video = document.querySelector('video');
        if (video) {
            video.onplay = null;
            video.disablePictureInPicture = false;
            video.removeAttribute('disablepictureinpicture');
        }
    }

    function showOverlay() {
        blocked = true;
        const video = document.querySelector('video');
        if (document.pictureInPictureElement) {
            document.exitPictureInPicture().catch(() => {});
        }
        if (video) {
            video.pause();
            video.disablePictureInPicture = true;
            video.setAttribute('disablepictureinpicture', 'true');
            video.onplay = () => {
                if (blocked && !isExcluded()) video.pause();
            };
        }

        if (document.getElementById('focussync-youtube-overlay')) return;

        const overlay = document.createElement('div');
        overlay.id = 'focussync-youtube-overlay';
        Object.assign(overlay.style, {
            position: 'fixed', inset: '0', width: '100vw', height: '100vh',
            background: '#0f0f0f', color: '#f1f1f1', zIndex: '2147483647',
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', padding: '24px', boxSizing: 'border-box',
            textAlign: 'center', fontFamily: 'system-ui, sans-serif'
        });

        const title = document.createElement('h1');
        title.textContent = 'Daily limit reached';
        title.style.fontSize = '26px';

        const description = document.createElement('p');
        description.textContent =
            'Your shared daily YouTube playback allowance has been used. Videos matching your excluded keywords remain available.';
        description.style.color = '#aaa';
        description.style.lineHeight = '1.5';

        overlay.append(title, description);
        document.documentElement.append(overlay);
    }

    function loadCloudTime() {
        ready = false;
        request('GET', `get/${encodeURIComponent(dayKey)}`, payload => {
            cloudSeconds = Math.max(0, Number.parseInt(payload.result ?? '0', 10) || 0);
            ready = true;
            if (cloudSeconds + pendingSeconds >= DAILY_LIMIT_SECONDS && !isExcluded()) {
                showOverlay();
            }
        }, error => {
            console.error('[FocusSync] Could not load YouTube usage:', error);
            ready = true; // Fail open if the cloud is unavailable.
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
            if (targetKey === dayKey && cloudSeconds + pendingSeconds >= DAILY_LIMIT_SECONDS && !isExcluded()) {
                showOverlay();
            }
            if (pendingSeconds > 0) syncTime();
        }, error => {
            if (targetKey === dayKey) pendingSeconds += amount;
            syncInFlight = false;
            console.error('[FocusSync] Could not sync YouTube usage:', error);
        });
    }

    loadCloudTime();

    document.addEventListener('fullscreenchange', () => {
        const badge = document.getElementById('focussync-youtube-badge');
        if (badge) badge.style.display = document.fullscreenElement ? 'none' : 'block';
    });

    // YouTube uses in-page navigation; re-check after route changes.
    window.addEventListener('yt-navigate-finish', () => {
        if (isExcluded()) {
            removeOverlay();
        } else if (ready && cloudSeconds + pendingSeconds >= DAILY_LIMIT_SECONDS) {
            showOverlay();
        }
    });

    setInterval(() => {
        const newDayKey = getDayKey();
        if (newDayKey !== dayKey) {
            syncTime();
            dayKey = newDayKey;
            cloudSeconds = 0;
            pendingSeconds = 0;
            removeOverlay();
            loadCloudTime();
        }

        if (!isPlaybackPage()) {
            const badge = document.getElementById('focussync-youtube-badge');
            if (badge) badge.style.display = 'none';
            return;
        }

        const video = document.querySelector('video');
        if (!video || !ready) return;

        const excluded = isExcluded();
        const remaining = DAILY_LIMIT_SECONDS - cloudSeconds - pendingSeconds;
        updateBadge(remaining, excluded);

        if (excluded) {
            if (blocked) removeOverlay();
            return;
        }

        if (remaining <= 0) {
            syncTime();
            showOverlay();
            return;
        }

        if (!video.paused && !video.ended && !document.hidden) {
            pendingSeconds += 1;
            if (pendingSeconds >= SYNC_INTERVAL_SECONDS) syncTime();
            if (cloudSeconds + pendingSeconds >= DAILY_LIMIT_SECONDS) {
                syncTime();
                showOverlay();
            }
        }
    }, 1000);

    const flush = () => {
        if (!isExcluded()) syncTime();
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
})();
