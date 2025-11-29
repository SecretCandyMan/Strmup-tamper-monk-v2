// ==UserScript==
// @name         Universal HLS/M3U8 URL Extractor with Real Size Detection
// @namespace    http://tampermonkey.net/
// @version      6.0
// @description  Extract HLS URLs from any website with actual file size detection and compression options
// @author       SecretCandyMan
// @match        *://*/*
// @grant        GM_setClipboard
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    const foundUrls = new Set();
    let panel = null;
    let toggleBtn = null;
    let isOpen = false;

    // Cached DOM elements
    const cache = {
        urlList: null,
        emptyState: null,
        statusText: null
    };

    // Parse M3U8 playlist
    async function parseM3U8(url) {
        try {
            const response = await fetch(url);
            const text = await response.text();
            const lines = text.split('\n');
            const variants = [];
            let currentVariant = {};

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (line.startsWith('#EXT-X-STREAM-INF:')) {
                    currentVariant = { info: line };
                    const bwMatch = line.match(/BANDWIDTH=(\d+)/);
                    const resMatch = line.match(/RESOLUTION=(\d+x\d+)/);

                    if (bwMatch) currentVariant.bandwidth = parseInt(bwMatch[1]);
                    if (resMatch) {
                        currentVariant.resolution = resMatch[1];
                        const [w, h] = resMatch[1].split('x').map(Number);
                        currentVariant.width = w;
                        currentVariant.height = h;
                    }
                } else if (line && !line.startsWith('#') && currentVariant.info) {
                    currentVariant.url = line.startsWith('http') ? line : new URL(line, url).href;
                    variants.push(currentVariant);
                    currentVariant = {};
                }
            }

            variants.sort((a, b) => (a.bandwidth || 0) - (b.bandwidth || 0));
            return variants.length > 0 ? variants : null;
        } catch (e) {
            console.error('[HLS] Parse error:', e);
            return null;
        }
    }

    // Get file size
    async function getActualFileSize(url) {
        try {
            const res = await fetch(url, { method: 'HEAD' });
            const cl = res.headers.get('content-length');
            if (cl) return parseInt(cl);

            const rRes = await fetch(url, { method: 'GET', headers: { 'Range': 'bytes=0-0' } });
            const cr = rRes.headers.get('content-range');
            if (cr) {
                const m = cr.match(/bytes \d+-\d+\/(\d+)/);
                if (m) return parseInt(m[1]);
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    // Calculate HLS size
    async function calculateHLSSize(m3u8Url) {
        try {
            const res = await fetch(m3u8Url);
            const text = await res.text();
            const lines = text.split('\n');
            const baseUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);

            const segUrls = lines
                .filter(l => l.trim() && !l.startsWith('#'))
                .slice(0, 5)
                .map(l => l.startsWith('http') ? l : baseUrl + l);

            let total = 0, count = 0;
            for (const url of segUrls) {
                const size = await getActualFileSize(url);
                if (size) { total += size; count++; }
            }

            const totalSegs = lines.filter(l => l.trim() && !l.startsWith('#')).length;
            return count > 0 ? Math.round((total / count) * totalSegs) : null;
        } catch (e) {
            return null;
        }
    }

    // Format helpers
    const formatBytes = (b) => {
        if (!b) return 'Unknown';
        const mb = b / (1024 * 1024);
        return mb < 1024 ? `${mb.toFixed(2)} MB` : `${(mb / 1024).toFixed(2)} GB`;
    };

    const formatBandwidth = (bps) => bps ? `${(bps / 1000000).toFixed(2)} Mbps` : 'Unknown';

    // Compression commands
    function getCompressionCommands(url, res, size) {
        const qualities = [
            { name: 'Tiny (360p)', scale: '640:360', crf: '28', mult: 0.15 },
            { name: 'Low (480p)', scale: '854:480', crf: '26', mult: 0.25 },
            { name: 'Medium (720p)', scale: '1280:720', crf: '24', mult: 0.40 },
            { name: 'Good (1080p)', scale: '1920:1080', crf: '22', mult: 0.60 }
        ];

        return qualities.map(q => ({
            name: q.name,
            size: '~' + formatBytes(size * q.mult),
            command: `ffmpeg -i "${url}" -vf scale=${q.scale} -c:v libx264 -crf ${q.crf} -preset medium -c:a aac -b:a 128k output_${q.name.split(' ')[0].toLowerCase()}.mp4`
        }));
    }

    // Clipboard helper
    function copyToClipboard(text, btn) {
        const success = () => {
            const orig = btn.innerHTML, origBg = btn.style.background;
            btn.innerHTML = '✓ Copied!';
            btn.style.background = '#10b981';
            setTimeout(() => { btn.innerHTML = orig; btn.style.background = origBg; }, 2000);
        };

        if (typeof GM_setClipboard !== 'undefined') {
            try { GM_setClipboard(text); success(); return; } catch (e) {}
        }

        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(text).then(success).catch(() => fallbackCopy(text, btn));
            return;
        }

        fallbackCopy(text, btn);
    }

    function fallbackCopy(text, btn) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); showCopySuccess(btn); }
        catch (e) { btn.innerHTML = '❌ Failed'; btn.style.background = '#ef4444'; }
        document.body.removeChild(ta);
    }

    function showCopySuccess(btn) {
        const orig = btn.innerHTML, origBg = btn.style.background;
        btn.innerHTML = '✓ Copied!';
        btn.style.background = '#10b981';
        setTimeout(() => { btn.innerHTML = orig; btn.style.background = origBg; }, 2000);
    }

    // Create toggle button
    function createToggleButton() {
        if (toggleBtn) return toggleBtn;

        toggleBtn = document.createElement('div');
        toggleBtn.style.cssText = `
            position: fixed; bottom: 20px; right: 20px; width: 60px; height: 60px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border-radius: 50%; cursor: pointer; z-index: 999998;
            box-shadow: 0 4px 20px rgba(102,126,234,0.4);
            display: flex; align-items: center; justify-content: center;
            font-size: 28px; transition: all 0.3s ease;
        `;
        toggleBtn.innerHTML = '🎬';
        toggleBtn.title = 'Toggle HLS Extractor';

        toggleBtn.addEventListener('mouseenter', () => {
            toggleBtn.style.transform = 'scale(1.1)';
            toggleBtn.style.boxShadow = '0 6px 30px rgba(102,126,234,0.6)';
        });
        toggleBtn.addEventListener('mouseleave', () => {
            toggleBtn.style.transform = 'scale(1)';
            toggleBtn.style.boxShadow = '0 4px 20px rgba(102,126,234,0.4)';
        });
        toggleBtn.addEventListener('click', togglePanel);

        document.body.appendChild(toggleBtn);
        return toggleBtn;
    }

    // Toggle panel visibility
    function togglePanel() {
        if (!panel) createUI();
        isOpen = !isOpen;
        panel.style.display = isOpen ? 'block' : 'none';
        toggleBtn.style.opacity = isOpen ? '0.5' : '1';
    }

    // Create UI panel
    function createUI() {
        if (panel) return panel;

        panel = document.createElement('div');
        panel.style.cssText = `
            position: fixed; top: 20px; right: 20px; width: 520px; max-height: 750px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border-radius: 16px; z-index: 999999; display: none;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            color: #fff; overflow: hidden;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.1);
        `;

        panel.innerHTML = `
            <div style="background: rgba(255,255,255,0.1); padding: 15px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <h3 style="margin: 0; font-size: 18px; font-weight: 600;">🎬 Universal Stream Extractor</h3>
                        <p style="margin: 5px 0 0 0; font-size: 12px; opacity: 0.8;" id="status-text">Works on any website</p>
                    </div>
                    <button id="close-panel" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 32px; height: 32px; cursor: pointer; border-radius: 8px; font-size: 18px; transition: all 0.2s;">✕</button>
                </div>
            </div>
            <div id="url-list-container" style="padding: 20px; max-height: 630px; overflow-y: auto;">
                <div id="url-list"></div>
                <div id="empty-state" style="text-align: center; padding: 40px 20px; opacity: 0.6;">
                    <div style="font-size: 48px; margin-bottom: 10px;">🔍</div>
                    <div style="font-size: 14px;">Searching for streams...</div>
                    <div style="font-size: 12px; margin-top: 5px; opacity: 0.7;">URLs will appear here when detected</div>
                </div>
            </div>
        `;

        document.body.appendChild(panel);

        // Cache DOM elements
        cache.urlList = document.getElementById('url-list');
        cache.emptyState = document.getElementById('empty-state');
        cache.statusText = document.getElementById('status-text');

        const closeBtn = document.getElementById('close-panel');
        closeBtn.addEventListener('click', togglePanel);

        // Event delegation for all buttons
        cache.urlList.addEventListener('click', handleButtonClick);

        // Add styles
        const style = document.createElement('style');
        style.textContent = `
            #url-list-container::-webkit-scrollbar { width: 8px; }
            #url-list-container::-webkit-scrollbar-track { background: rgba(255,255,255,0.05); border-radius: 4px; }
            #url-list-container::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.3); border-radius: 4px; }
            #url-list-container::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.4); }
            @keyframes slideIn { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
            @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        `;
        document.head.appendChild(style);

        return panel;
    }

    // Event delegation handler
    function handleButtonClick(e) {
        const btn = e.target.closest('button');
        if (!btn) return;

        const cls = btn.className;
        e.preventDefault();

        if (cls.includes('copy-url-btn')) {
            copyToClipboard(btn.dataset.url, btn);
        } else if (cls.includes('copy-variant-url')) {
            copyToClipboard(btn.dataset.url, btn);
        } else if (cls.includes('copy-variant-cmd') || cls.includes('copy-ytdlp-cmd') || cls.includes('copy-compress-cmd')) {
            copyToClipboard(btn.dataset.cmd, btn);
        } else if (cls.includes('analyze-btn')) {
            handleAnalyze(btn);
        } else if (cls.includes('show-compress')) {
            const section = btn.closest('.variant-item').querySelector('.compress-section');
            section.style.display = section.style.display === 'none' ? 'block' : 'none';
        }
    }

    // Handle analyze button
    async function handleAnalyze(btn) {
        const entry = btn.closest('[data-url]');
        const url = entry.dataset.url;
        const variantsSection = entry.querySelector('.variants-section');
        const variantsLoading = entry.querySelector('.variants-loading');
        const variantsContent = entry.querySelector('.variants-content');

        if (entry.dataset.analyzed === 'true') {
            variantsSection.style.display = variantsSection.style.display === 'none' ? 'block' : 'none';
            return;
        }

        entry.dataset.analyzed = 'true';
        btn.style.background = 'rgba(16, 185, 129, 0.5)';
        btn.innerHTML = '⏳ Detecting...';
        variantsSection.style.display = 'block';
        variantsLoading.style.display = 'block';

        const variants = await parseM3U8(url);

        if (variants?.length > 0) {
            const variantsWithSize = [];
            for (const v of variants) {
                variantsLoading.innerHTML = `<div style="display: inline-block; width: 24px; height: 24px; border: 3px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                    <div style="margin-top: 10px; font-size: 12px; opacity: 0.8;">Checking ${v.resolution || 'quality'}...</div>`;
                const size = await calculateHLSSize(v.url);
                variantsWithSize.push({ ...v, actualSize: size });
            }

            variantsWithSize.sort((a, b) => (a.actualSize || 0) - (b.actualSize || 0));
            variantsLoading.style.display = 'none';

            const qualityBadges = variantsWithSize.map(v => {
                const h = v.resolution?.split('x')[1] || '';
                return `<span style="background: rgba(16, 185, 129, 0.2); padding: 4px 8px; border-radius: 4px; font-size: 10px; white-space: nowrap;">${h}p: ${formatBytes(v.actualSize)}</span>`;
            }).join(' ');

            let html = `<div style="margin-bottom: 12px;">
                <div style="font-size: 12px; font-weight: 600; margin-bottom: 8px; opacity: 0.9;">📊 Sizes Detected (Smallest → Largest)</div>
                <div style="display: flex; gap: 6px; flex-wrap: wrap;">${qualityBadges}</div></div>`;

            variantsWithSize.forEach(v => {
                const q = v.resolution || 'Unknown';
                const br = formatBandwidth(v.bandwidth);
                const st = formatBytes(v.actualSize);
                const ffmpegDl = `ffmpeg -i "${v.url}" -c copy output_${q.replace('x', '_')}.mp4`;

                html += `<div class="variant-item" style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 8px; margin-bottom: 8px; border: 1px solid rgba(255,255,255,0.1);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <div style="display: flex; gap: 8px;">
                            <div style="background: rgba(16, 185, 129, 0.3); padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 600;">${q}</div>
                            <div style="font-size: 11px; opacity: 0.8;">${br}</div>
                        </div>
                        <div style="font-size: 12px; font-weight: 700; color: #fbbf24;">${st}</div>
                    </div>
                    <div style="display: flex; gap: 6px; margin-bottom: 8px;">
                        <button class="copy-variant-url" data-url="${v.url}" style="background: rgba(255, 255, 255, 0.15); border: none; color: white; padding: 8px 12px; cursor: pointer; border-radius: 6px; font-size: 11px; font-weight: 600; flex: 1;">📋 URL</button>
                        <button class="copy-variant-cmd" data-cmd="${ffmpegDl.replace(/"/g, '&quot;')}" style="background: rgba(255, 255, 255, 0.1); border: none; color: white; padding: 8px 12px; cursor: pointer; border-radius: 6px; font-size: 11px; font-weight: 600; flex: 1;">⚙️ FFmpeg</button>
                        <button class="copy-ytdlp-cmd" data-cmd="yt-dlp &quot;${v.url}&quot; -o output_${q.replace('x', '_')}.mp4" style="background: rgba(239, 68, 68, 0.3); border: none; color: white; padding: 8px 12px; cursor: pointer; border-radius: 6px; font-size: 11px; font-weight: 600; flex: 1;">📥 yt-dlp</button>
                        <button class="show-compress" style="background: rgba(99, 102, 241, 0.3); border: none; color: white; padding: 8px 12px; cursor: pointer; border-radius: 6px; font-size: 11px; font-weight: 600;">🗜️</button>
                    </div>
                    <div class="compress-section" style="display: none; margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.1);">
                        <div style="font-size: 11px; font-weight: 600; margin-bottom: 8px; opacity: 0.9;">Compression Options:</div>
                        ${getCompressionCommands(v.url, q, v.actualSize).map(c => `
                            <div style="background: rgba(0,0,0,0.2); padding: 8px; border-radius: 6px; margin-bottom: 6px;">
                                <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                    <span style="font-size: 11px; font-weight: 600;">${c.name}</span>
                                    <span style="font-size: 10px; color: #fbbf24;">${c.size}</span>
                                </div>
                                <button class="copy-compress-cmd" data-cmd="${c.command.replace(/"/g, '&quot;')}" style="background: rgba(255, 255, 255, 0.1); border: none; color: white; padding: 6px 10px; cursor: pointer; border-radius: 4px; font-size: 10px; font-weight: 600; width: 100%;">📋 Copy FFmpeg Command</button>
                            </div>
                        `).join('')}
                    </div>
                </div>`;
            });

            variantsContent.innerHTML = html;
            variantsContent.style.display = 'block';
        } else {
            variantsLoading.style.display = 'none';
            variantsContent.innerHTML = `<div style="text-align: center; padding: 20px; opacity: 0.7;">
                <div style="font-size: 32px; margin-bottom: 8px;">ℹ️</div>
                <div style="font-size: 13px;">No variants found</div></div>`;
            variantsContent.style.display = 'block';
        }

        btn.innerHTML = '✓ Analyzed';
    }

    // Update UI
    async function updateUI(url) {
        if (!cache.urlList) {
            setTimeout(() => updateUI(url), 100);
            return;
        }

        if (cache.emptyState) cache.emptyState.style.display = 'none';

        const truncUrl = url.length > 60 ? url.substring(0, 60) + '...' : url;
        const entry = document.createElement('div');
        entry.dataset.url = url;
        entry.style.cssText = `margin-bottom: 12px; padding: 16px; background: rgba(255, 255, 255, 0.1);
            border-radius: 12px; border: 1px solid rgba(255, 255, 255, 0.1); animation: slideIn 0.3s ease;`;

        entry.innerHTML = `
            <div style="display: flex; gap: 8px; margin-bottom: 10px;">
                <div style="background: rgba(255,255,255,0.1); padding: 6px 12px; border-radius: 6px; font-size: 11px;">#${foundUrls.size}</div>
            </div>
            <div style="color: rgba(255,255,255,0.9); margin-bottom: 12px; font-size: 13px; word-break: break-all; font-family: 'Courier New', monospace;" title="${url}">${truncUrl}</div>
            <div style="display: flex; gap: 8px; margin-bottom: 12px;">
                <button class="copy-url-btn" data-url="${url}" style="background: rgba(255, 255, 255, 0.9); border: none; color: #667eea; padding: 10px 16px; cursor: pointer; border-radius: 8px; font-weight: 600; font-size: 13px; flex: 1;">📋 Copy URL</button>
                <button class="analyze-btn" style="background: rgba(16, 185, 129, 0.3); border: 1px solid rgba(16, 185, 129, 0.5); color: white; padding: 10px 16px; cursor: pointer; border-radius: 8px; font-weight: 600; font-size: 13px;">🔍 Detect Size</button>
            </div>
            <div class="variants-section" style="display: none; margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.1);">
                <div class="variants-loading" style="text-align: center; padding: 20px;">
                    <div style="display: inline-block; width: 24px; height: 24px; border: 3px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                    <div style="margin-top: 10px; font-size: 12px; opacity: 0.8;">Detecting real file sizes...</div>
                </div>
                <div class="variants-content" style="display: none;"></div>
            </div>
        `;

        cache.urlList.insertBefore(entry, cache.urlList.firstChild);
        if (cache.statusText) {
            cache.statusText.textContent = `${foundUrls.size} URL${foundUrls.size > 1 ? 's' : ''} found`;
        }
    }

    // Add URL
    function addUrl(url) {
        if (!foundUrls.has(url)) {
            foundUrls.add(url);
            console.log('[HLS Extractor] Found:', url);
            updateUI(url);
        }
    }

    // Intercept requests
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
        if (typeof url === 'string' && url.toLowerCase().includes('m3u8')) addUrl(url);
        return origOpen.apply(this, arguments);
    };

    const origFetch = window.fetch;
    window.fetch = function(res, opts) {
        const url = typeof res === 'string' ? res : (res.url || '');
        if (url && url.toLowerCase().includes('m3u8')) addUrl(url);
        return origFetch.apply(this, arguments);
    };

    // Observer
    const obs = new MutationObserver((muts) => {
        muts.forEach(m => {
            m.addedNodes.forEach(n => {
                if ((n.tagName === 'VIDEO' || n.tagName === 'SOURCE')) {
                    const src = n.src || n.getAttribute('src');
                    if (src && src.toLowerCase().includes('m3u8')) addUrl(src);
                }
            });
        });
    });

    // Init
    function init() {
        createToggleButton();
        if (document.body) obs.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    console.log('[HLS Extractor Pro] Loaded - Universal mode (works on ALL websites)');
})();
