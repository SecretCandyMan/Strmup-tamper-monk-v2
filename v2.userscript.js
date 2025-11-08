// ==UserScript==
// @name         Strmup.cc HLS/M3U8 URL Extractor with Real Size Detection
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  Extract HLS URLs with actual file size detection and compression options
// @author       You
// @match        https://strmup.cc/*
// @match        https://*.strmup.cc/*
// @grant        GM_setClipboard
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    const foundUrls = new Set();
    let panel = null;

    // Parse M3U8 playlist to extract variant streams
    async function parseM3U8(url) {
        try {
            const response = await fetch(url);
            const text = await response.text();
            const variants = [];
            const lines = text.split('\n');

            let currentVariant = {};

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();

                if (line.startsWith('#EXT-X-STREAM-INF:')) {
                    currentVariant = { info: line };

                    const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
                    if (bandwidthMatch) {
                        currentVariant.bandwidth = parseInt(bandwidthMatch[1]);
                    }

                    const resolutionMatch = line.match(/RESOLUTION=(\d+x\d+)/);
                    if (resolutionMatch) {
                        currentVariant.resolution = resolutionMatch[1];
                        const [width, height] = resolutionMatch[1].split('x').map(Number);
                        currentVariant.width = width;
                        currentVariant.height = height;
                    }

                } else if (line && !line.startsWith('#') && currentVariant.info) {
                    currentVariant.url = line.startsWith('http') ? line : new URL(line, url).href;
                    variants.push(currentVariant);
                    currentVariant = {};
                }
            }

            // Sort by bandwidth (smallest to largest)
            variants.sort((a, b) => (a.bandwidth || 0) - (b.bandwidth || 0));

            return variants.length > 0 ? variants : null;
        } catch (error) {
            console.error('[HLS Extractor] Error parsing M3U8:', error);
            return null;
        }
    }

    // Get actual file size by fetching headers
    async function getActualFileSize(url) {
        try {
            const response = await fetch(url, { method: 'HEAD' });
            const contentLength = response.headers.get('content-length');

            if (contentLength) {
                return parseInt(contentLength);
            }

            // If HEAD doesn't work, try GET with range
            const rangeResponse = await fetch(url, {
                method: 'GET',
                headers: { 'Range': 'bytes=0-0' }
            });

            const contentRange = rangeResponse.headers.get('content-range');
            if (contentRange) {
                const match = contentRange.match(/bytes \d+-\d+\/(\d+)/);
                if (match) {
                    return parseInt(match[1]);
                }
            }

            return null;
        } catch (error) {
            console.error('[HLS Extractor] Error getting file size:', error);
            return null;
        }
    }

    // Calculate total size of HLS segments
    async function calculateHLSSize(m3u8Url) {
        try {
            const response = await fetch(m3u8Url);
            const text = await response.text();
            const lines = text.split('\n');

            let totalSize = 0;
            let segmentCount = 0;
            const baseUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);

            // Sample first 5 segments to estimate total
            const segmentUrls = [];
            for (const line of lines) {
                if (line.trim() && !line.startsWith('#')) {
                    const segmentUrl = line.startsWith('http') ? line : baseUrl + line;
                    segmentUrls.push(segmentUrl);
                    if (segmentUrls.length >= 5) break;
                }
            }

            // Get size of sample segments
            for (const segUrl of segmentUrls) {
                const size = await getActualFileSize(segUrl);
                if (size) {
                    totalSize += size;
                    segmentCount++;
                }
            }

            // Count total segments
            const totalSegments = lines.filter(l => l.trim() && !l.startsWith('#')).length;

            // Estimate total size
            if (segmentCount > 0) {
                const avgSegmentSize = totalSize / segmentCount;
                return Math.round(avgSegmentSize * totalSegments);
            }

            return null;
        } catch (error) {
            console.error('[HLS Extractor] Error calculating HLS size:', error);
            return null;
        }
    }

    // Format bytes to human-readable
    function formatBytes(bytes) {
        if (!bytes || bytes === 0) return 'Unknown';
        const mb = bytes / (1024 * 1024);
        if (mb < 1024) {
            return `${mb.toFixed(2)} MB`;
        }
        return `${(mb / 1024).toFixed(2)} GB`;
    }

    // Format bandwidth
    function formatBandwidth(bps) {
        if (!bps) return 'Unknown';
        const mbps = (bps / 1000000).toFixed(2);
        return `${mbps} Mbps`;
    }

    // Generate compression commands
    function getCompressionCommands(url, resolution, currentSize) {
        const qualities = [
            { name: 'Tiny (360p)', scale: '640:360', crf: '28', size: '~' + formatBytes(currentSize * 0.15) },
            { name: 'Low (480p)', scale: '854:480', crf: '26', size: '~' + formatBytes(currentSize * 0.25) },
            { name: 'Medium (720p)', scale: '1280:720', crf: '24', size: '~' + formatBytes(currentSize * 0.40) },
            { name: 'Good (1080p)', scale: '1920:1080', crf: '22', size: '~' + formatBytes(currentSize * 0.60) }
        ];

        return qualities.map(q => ({
            ...q,
            command: `ffmpeg -i "${url}" -vf scale=${q.scale} -c:v libx264 -crf ${q.crf} -preset medium -c:a aac -b:a 128k output_${q.name.toLowerCase().split(' ')[0]}.mp4`
        }));
    }

    // Create UI panel
    function createUI() {
        if (panel) return panel;

        panel = document.createElement('div');
        panel.id = 'hls-extractor-panel';
        panel.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            width: 520px;
            max-height: 750px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border-radius: 16px;
            padding: 0;
            z-index: 999999;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            color: #ffffff;
            overflow: hidden;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.1);
            backdrop-filter: blur(10px);
        `;

        panel.innerHTML = `
            <div style="background: rgba(255,255,255,0.1); padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <h3 style="margin: 0; font-size: 18px; font-weight: 600;">🎬 Stream Extractor Pro</h3>
                        <p style="margin: 5px 0 0 0; font-size: 13px; opacity: 0.8;" id="status-text">Real Size Detection</p>
                    </div>
                    <button id="close-panel" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 32px; height: 32px; cursor: pointer; border-radius: 8px; font-size: 18px; transition: all 0.2s; display: flex; align-items: center; justify-content: center;">✕</button>
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

        const closeBtn = document.getElementById('close-panel');
        closeBtn.addEventListener('mouseenter', () => {
            closeBtn.style.background = 'rgba(255,255,255,0.3)';
            closeBtn.style.transform = 'scale(1.1)';
        });
        closeBtn.addEventListener('mouseleave', () => {
            closeBtn.style.background = 'rgba(255,255,255,0.2)';
            closeBtn.style.transform = 'scale(1)';
        });
        closeBtn.addEventListener('click', () => {
            panel.style.display = 'none';
        });

        const style = document.createElement('style');
        style.textContent = `
            #url-list-container::-webkit-scrollbar {
                width: 8px;
            }
            #url-list-container::-webkit-scrollbar-track {
                background: rgba(255,255,255,0.05);
                border-radius: 4px;
            }
            #url-list-container::-webkit-scrollbar-thumb {
                background: rgba(255,255,255,0.3);
                border-radius: 4px;
            }
            #url-list-container::-webkit-scrollbar-thumb:hover {
                background: rgba(255,255,255,0.4);
            }
            @keyframes slideIn {
                from { opacity: 0; transform: translateY(-10px); }
                to { opacity: 1; transform: translateY(0); }
            }
            @keyframes spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
            @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.5; }
            }
        `;
        document.head.appendChild(style);

        return panel;
    }

    function updateStatusText(count) {
        const statusText = document.getElementById('status-text');
        if (statusText) {
            statusText.textContent = count > 0 ? `${count} URL${count > 1 ? 's' : ''} found` : 'Real Size Detection';
        }
    }

    function copyToClipboard(text, button) {
        let success = false;

        if (typeof GM_setClipboard !== 'undefined') {
            try {
                GM_setClipboard(text);
                success = true;
            } catch (e) {}
        }

        if (!success && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                showCopySuccess(button);
            }).catch(() => {
                fallbackCopy(text, button);
            });
            return;
        }

        if (!success) {
            fallbackCopy(text, button);
        } else {
            showCopySuccess(button);
        }
    }

    function fallbackCopy(text, button) {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.select();

        try {
            document.execCommand('copy');
            showCopySuccess(button);
        } catch (err) {
            showCopyError(button);
        }

        document.body.removeChild(textArea);
    }

    function showCopySuccess(button) {
        const originalHTML = button.innerHTML;
        const originalBg = button.style.background;

        button.innerHTML = '✓ Copied!';
        button.style.background = '#10b981';
        button.style.color = 'white';

        setTimeout(() => {
            button.innerHTML = originalHTML;
            button.style.background = originalBg;
        }, 2000);
    }

    function showCopyError(button) {
        const originalHTML = button.innerHTML;
        button.innerHTML = '❌ Failed';
        button.style.background = '#ef4444';

        setTimeout(() => {
            button.innerHTML = originalHTML;
            button.style.background = 'rgba(255, 255, 255, 0.9)';
        }, 2000);
    }

    async function updateUI(url) {
        if (!panel) {
            setTimeout(() => createUI(), 100);
        }

        setTimeout(async () => {
            const urlList = document.getElementById('url-list');
            const emptyState = document.getElementById('empty-state');

            if (!urlList) return;
            if (emptyState) emptyState.style.display = 'none';

            const urlEntry = document.createElement('div');
            urlEntry.style.cssText = `
                margin-bottom: 12px;
                padding: 16px;
                background: rgba(255, 255, 255, 0.1);
                border-radius: 12px;
                border: 1px solid rgba(255, 255, 255, 0.1);
                transition: all 0.3s ease;
                animation: slideIn 0.3s ease;
            `;

            const truncatedUrl = url.length > 60 ? url.substring(0, 60) + '...' : url;

            urlEntry.innerHTML = `
                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
                    <div style="background: rgba(255,255,255,0.2); padding: 6px 12px; border-radius: 6px; font-size: 11px; font-weight: 600; text-transform: uppercase;">
                        ${url.includes('.m3u8') ? 'M3U8' : 'HLS'}
                    </div>
                    <div style="background: rgba(255,255,255,0.1); padding: 6px 12px; border-radius: 6px; font-size: 11px;">
                        #${foundUrls.size}
                    </div>
                </div>
                <div style="color: rgba(255,255,255,0.9); margin-bottom: 12px; font-size: 13px; word-break: break-all; font-family: 'Courier New', monospace; line-height: 1.5;" title="${url}">
                    ${truncatedUrl}
                </div>
                <div style="display: flex; gap: 8px; margin-bottom: 12px;">
                    <button class="copy-url-btn" style="background: rgba(255, 255, 255, 0.9); border: none; color: #667eea; padding: 10px 16px; cursor: pointer; border-radius: 8px; font-weight: 600; font-size: 13px; flex: 1; transition: all 0.2s;">
                        📋 Copy URL
                    </button>
                    <button class="analyze-btn" style="background: rgba(16, 185, 129, 0.3); border: 1px solid rgba(16, 185, 129, 0.5); color: white; padding: 10px 16px; cursor: pointer; border-radius: 8px; font-weight: 600; font-size: 13px; transition: all 0.2s;">
                        🔍 Detect Size
                    </button>
                </div>
                <div class="variants-section" style="display: none; margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.1);">
                    <div class="variants-loading" style="text-align: center; padding: 20px;">
                        <div style="display: inline-block; width: 24px; height: 24px; border: 3px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                        <div style="margin-top: 10px; font-size: 12px; opacity: 0.8;">Detecting real file sizes...</div>
                    </div>
                    <div class="variants-content" style="display: none;"></div>
                </div>
            `;

            urlList.insertBefore(urlEntry, urlList.firstChild);

            urlEntry.addEventListener('mouseenter', () => {
                urlEntry.style.background = 'rgba(255, 255, 255, 0.15)';
                urlEntry.style.transform = 'translateY(-2px)';
                urlEntry.style.boxShadow = '0 8px 16px rgba(0,0,0,0.2)';
            });
            urlEntry.addEventListener('mouseleave', () => {
                urlEntry.style.background = 'rgba(255, 255, 255, 0.1)';
                urlEntry.style.transform = 'translateY(0)';
                urlEntry.style.boxShadow = 'none';
            });

            const copyUrlBtn = urlEntry.querySelector('.copy-url-btn');
            copyUrlBtn.addEventListener('click', function(e) {
                e.preventDefault();
                copyToClipboard(url, this);
            });

            const analyzeBtn = urlEntry.querySelector('.analyze-btn');
            const variantsSection = urlEntry.querySelector('.variants-section');
            const variantsLoading = urlEntry.querySelector('.variants-loading');
            const variantsContent = urlEntry.querySelector('.variants-content');

            let isAnalyzed = false;

            analyzeBtn.addEventListener('click', async function(e) {
                e.preventDefault();

                if (isAnalyzed) {
                    variantsSection.style.display = variantsSection.style.display === 'none' ? 'block' : 'none';
                    return;
                }

                isAnalyzed = true;
                this.style.background = 'rgba(16, 185, 129, 0.5)';
                this.innerHTML = '⏳ Detecting...';
                variantsSection.style.display = 'block';
                variantsLoading.style.display = 'block';
                variantsContent.style.display = 'none';

                const variants = await parseM3U8(url);

                if (variants && variants.length > 0) {
                    // Get real sizes for each variant
                    const variantsWithSize = [];

                    for (const variant of variants) {
                        variantsLoading.innerHTML = `
                            <div style="display: inline-block; width: 24px; height: 24px; border: 3px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                            <div style="margin-top: 10px; font-size: 12px; opacity: 0.8;">Checking ${variant.resolution || 'quality'}...</div>
                        `;

                        const size = await calculateHLSSize(variant.url);
                        variantsWithSize.push({ ...variant, actualSize: size });
                    }

                    // Sort by actual size (smallest to largest)
                    variantsWithSize.sort((a, b) => (a.actualSize || 0) - (b.actualSize || 0));

                    variantsLoading.style.display = 'none';

                    // Create quality badges for header
                    const qualityBadges = variantsWithSize.map(v => {
                        const res = v.resolution || 'Unknown';
                        const height = res.split('x')[1] || '';
                        const size = v.actualSize ? formatBytes(v.actualSize) : '...';
                        return `<span style="background: rgba(16, 185, 129, 0.2); padding: 4px 8px; border-radius: 4px; font-size: 10px; white-space: nowrap;">${height}p: ${size}</span>`;
                    }).join(' ');

                    let variantsHTML = `
                        <div style="margin-bottom: 12px;">
                            <div style="font-size: 12px; font-weight: 600; margin-bottom: 8px; opacity: 0.9;">📊 Sizes Detected (Smallest → Largest)</div>
                            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                                ${qualityBadges}
                            </div>
                        </div>
                    `;

                    variantsWithSize.forEach((variant) => {
                        const quality = variant.resolution || 'Unknown';
                        const bitrate = formatBandwidth(variant.bandwidth);
                        const sizeText = variant.actualSize ? formatBytes(variant.actualSize) : 'Calculating...';

                        const ffmpegDownload = `ffmpeg -i "${variant.url}" -c copy output_${quality.replace('x', '_')}.mp4`;

                        variantsHTML += `
                            <div class="variant-item" style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 8px; margin-bottom: 8px; border: 1px solid rgba(255,255,255,0.1);">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                    <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                                        <div style="background: rgba(16, 185, 129, 0.3); padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 600;">
                                            ${quality}
                                        </div>
                                        <div style="font-size: 11px; opacity: 0.8;">${bitrate}</div>
                                    </div>
                                    <div style="font-size: 12px; font-weight: 700; color: #fbbf24;">${sizeText}</div>
                                </div>
                                <div style="display: flex; gap: 6px; margin-bottom: 8px;">
                                    <button class="copy-variant-url" data-url="${variant.url}" style="background: rgba(255, 255, 255, 0.15); border: none; color: white; padding: 8px 12px; cursor: pointer; border-radius: 6px; font-size: 11px; font-weight: 600; flex: 1; transition: all 0.2s;">
                                        📋 URL
                                    </button>
                                    <button class="copy-variant-cmd" data-cmd="${ffmpegDownload.replace(/"/g, '&quot;')}" style="background: rgba(255, 255, 255, 0.1); border: none; color: white; padding: 8px 12px; cursor: pointer; border-radius: 6px; font-size: 11px; font-weight: 600; flex: 1; transition: all 0.2s;">
                                        ⚙️ Download
                                    </button>
                                    <button class="show-compress" style="background: rgba(99, 102, 241, 0.3); border: none; color: white; padding: 8px 12px; cursor: pointer; border-radius: 6px; font-size: 11px; font-weight: 600; transition: all 0.2s;">
                                        🗜️
                                    </button>
                                </div>
                                <div class="compress-section" style="display: block; margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.1);">
                                    <div style="font-size: 11px; font-weight: 600; margin-bottom: 8px; opacity: 0.9;">Compression Options:</div>
                                    ${getCompressionCommands(variant.url, quality, variant.actualSize).map(comp => `
                                        <div style="background: rgba(0,0,0,0.2); padding: 8px; border-radius: 6px; margin-bottom: 6px;">
                                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                                <span style="font-size: 11px; font-weight: 600;">${comp.name}</span>
                                                <span style="font-size: 10px; color: #fbbf24;">${comp.size}</span>
                                            </div>
                                            <button class="copy-compress-cmd" data-cmd="${comp.command.replace(/"/g, '&quot;')}" style="background: rgba(255, 255, 255, 0.1); border: none; color: white; padding: 6px 10px; cursor: pointer; border-radius: 4px; font-size: 10px; font-weight: 600; width: 100%; transition: all 0.2s;">
                                                📋 Copy FFmpeg Command
                                            </button>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        `;
                    });

                    variantsContent.innerHTML = variantsHTML;
                    variantsContent.style.display = 'block';

                    // Event listeners
                    variantsContent.querySelectorAll('.copy-variant-url').forEach(btn => {
                        btn.addEventListener('click', function(e) {
                            e.preventDefault();
                            copyToClipboard(this.dataset.url, this);
                        });
                    });

                    variantsContent.querySelectorAll('.copy-variant-cmd').forEach(btn => {
                        btn.addEventListener('click', function(e) {
                            e.preventDefault();
                            copyToClipboard(this.dataset.cmd, this);
                        });
                    });

                    variantsContent.querySelectorAll('.show-compress').forEach(btn => {
                        btn.addEventListener('click', function(e) {
                            e.preventDefault();
                            const compressSection = this.closest('.variant-item').querySelector('.compress-section');
                            compressSection.style.display = compressSection.style.display === 'none' ? 'block' : 'none';
                        });
                    });

                    variantsContent.querySelectorAll('.copy-compress-cmd').forEach(btn => {
                        btn.addEventListener('click', function(e) {
                            e.preventDefault();
                            copyToClipboard(this.dataset.cmd, this);
                        });
                    });

                } else {
                    variantsLoading.style.display = 'none';
                    variantsContent.innerHTML = `
                        <div style="text-align: center; padding: 20px; opacity: 0.7;">
                            <div style="font-size: 32px; margin-bottom: 8px;">ℹ️</div>
                            <div style="font-size: 13px;">No variants found</div>
                            <div style="font-size: 11px; margin-top: 5px;">This might be a direct stream</div>
                        </div>
                    `;
                    variantsContent.style.display = 'block';
                }

                this.innerHTML = '✓ Analyzed';
            });

            updateStatusText(foundUrls.size);
        }, 200);
    }

    function addUrl(url) {
        if (!foundUrls.has(url)) {
            foundUrls.add(url);
            console.log('[HLS Extractor] Found URL:', url);
            updateUI(url);
        }
    }

    // Intercept requests
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
        if (typeof url === 'string' && (url.includes('.m3u8') || url.toLowerCase().includes('m3u8'))) {
            addUrl(url);
        }
        return originalOpen.apply(this, arguments);
    };

    const originalFetch = window.fetch;
    window.fetch = function(resource, options) {
        const url = typeof resource === 'string' ? resource : (resource.url || '');
        if (url && (url.includes('.m3u8') || url.toLowerCase().includes('m3u8'))) {
            addUrl(url);
        }
        return originalFetch.apply(this, arguments);
    };

    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.tagName === 'VIDEO' || node.tagName === 'SOURCE') {
                    const src = node.src || node.getAttribute('src');
                    if (src && (src.includes('.m3u8') || src.toLowerCase().includes('m3u8'))) {
                        addUrl(src);
                    }
                }
            });
        });
    });

    function init() {
        createUI();
        if (document.body) {
            observer.observe(document.body, { childList: true, subtree: true });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    console.log('[HLS Extractor Pro] Loaded with real size detection');
})();
