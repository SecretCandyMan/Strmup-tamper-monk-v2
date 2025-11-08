// ==UserScript==
// @name         Strmup.cc HLS/M3U8 URL Extractor
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Extract HLS and M3U8 URLs from strmup.cc
// @author       SecretCandyMan
// @match        https://strmup.cc/*
// @match        https://*.strmup.cc/*
// @grant        GM_setClipboard
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    const foundUrls = new Set();
    let panel = null;
    
    // Create UI panel
    function createUI() {
        if (panel) return panel;
        
        panel = document.createElement('div');
        panel.id = 'hls-extractor-panel';
        panel.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            width: 420px;
            max-height: 600px;
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
                        <h3 style="margin: 0; font-size: 18px; font-weight: 600;">Stream Extractor</h3>
                        <p style="margin: 5px 0 0 0; font-size: 13px; opacity: 0.8;" id="status-text">M3U8 & HLS URLs</p>
                    </div>
                    <button id="close-panel" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 32px; height: 32px; cursor: pointer; border-radius: 8px; font-size: 18px; transition: all 0.2s; display: flex; align-items: center; justify-content: center;">✕</button>
                </div>
            </div>
            <div id="url-list-container" style="padding: 20px; max-height: 480px; overflow-y: auto;">
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
        
        // Custom scrollbar
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
                from {
                    opacity: 0;
                    transform: translateY(-10px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
        `;
        document.head.appendChild(style);
        
        return panel;
    }
    
    function updateStatusText(count) {
        const statusText = document.getElementById('status-text');
        if (statusText) {
            statusText.textContent = count > 0 ? `${count} URL${count > 1 ? 's' : ''} found` : 'M3U8 & HLS URLs';
        }
    }
    
    function copyToClipboard(text, button) {
        // Try multiple methods to copy
        let success = false;
        
        // Method 1: GM_setClipboard (Tampermonkey specific)
        if (typeof GM_setClipboard !== 'undefined') {
            try {
                GM_setClipboard(text);
                success = true;
            } catch (e) {
                console.log('GM_setClipboard failed:', e);
            }
        }
        
        // Method 2: Clipboard API
        if (!success && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                success = true;
                showCopySuccess(button);
            }).catch(err => {
                console.log('Clipboard API failed:', err);
                fallbackCopy(text, button);
            });
            return;
        }
        
        // Method 3: Fallback method
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
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        
        try {
            const successful = document.execCommand('copy');
            if (successful) {
                showCopySuccess(button);
            } else {
                showCopyError(button);
            }
        } catch (err) {
            console.error('Fallback copy failed:', err);
            showCopyError(button);
        }
        
        document.body.removeChild(textArea);
    }
    
    function showCopySuccess(button) {
        const originalHTML = button.innerHTML;
        const originalBg = button.style.background;
        const originalColor = button.style.color;
        
        button.innerHTML = '✓ Copied!';
        button.style.background = '#10b981';
        button.style.color = 'white';
        
        setTimeout(() => {
            button.innerHTML = originalHTML;
            button.style.background = originalBg;
            button.style.color = originalColor;
        }, 2000);
    }
    
    function showCopyError(button) {
        const originalHTML = button.innerHTML;
        button.innerHTML = '❌ Copy failed';
        button.style.background = '#ef4444';
        button.style.color = 'white';
        
        setTimeout(() => {
            button.innerHTML = originalHTML;
            button.style.background = 'rgba(255, 255, 255, 0.9)';
            button.style.color = '#667eea';
        }, 2000);
    }
    
    function updateUI(url) {
        if (!panel) {
            setTimeout(() => createUI(), 100);
        }
        
        setTimeout(() => {
            const urlList = document.getElementById('url-list');
            const emptyState = document.getElementById('empty-state');
            
            if (!urlList) return;
            
            // Hide empty state
            if (emptyState) {
                emptyState.style.display = 'none';
            }
            
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
            
            const ffmpegDownloadCmd = `ffmpeg -i "${url}" -c copy output.mp4`;
            const ffmpegCheckCmd = `ffprobe -v error -show_entries format=size,duration -of default=noprint_wrappers=1:nokey=1 "${url}"`;
            
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
                    <button class="copy-url-btn" style="background: rgba(255, 255, 255, 0.9); border: none; color: #667eea; padding: 10px 16px; cursor: pointer; border-radius: 8px; font-weight: 600; font-size: 13px; flex: 1; transition: all 0.2s; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                        📋 Copy URL
                    </button>
                    <button class="show-commands-btn" style="background: rgba(255, 255, 255, 0.2); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 10px 16px; cursor: pointer; border-radius: 8px; font-weight: 600; font-size: 13px; transition: all 0.2s;">
                        ⚙️
                    </button>
                </div>
                <div class="commands-section" style="display: none; margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.1);">
                    <div style="margin-bottom: 12px;">
                        <div style="font-size: 11px; font-weight: 600; margin-bottom: 6px; opacity: 0.8; text-transform: uppercase;">FFmpeg Download</div>
                        <div style="background: rgba(0,0,0,0.3); padding: 10px; border-radius: 6px; font-family: 'Courier New', monospace; font-size: 11px; word-break: break-all; margin-bottom: 6px; color: rgba(255,255,255,0.9);">
                            ${ffmpegDownloadCmd}
                        </div>
                        <button class="copy-download-btn" style="background: rgba(255, 255, 255, 0.15); border: none; color: white; padding: 6px 12px; cursor: pointer; border-radius: 6px; font-size: 11px; font-weight: 600; width: 100%; transition: all 0.2s;">
                            📋 Copy Download Command
                        </button>
                    </div>
                    <div>
                        <div style="font-size: 11px; font-weight: 600; margin-bottom: 6px; opacity: 0.8; text-transform: uppercase;">Check Size (No Download)</div>
                        <div style="background: rgba(0,0,0,0.3); padding: 10px; border-radius: 6px; font-family: 'Courier New', monospace; font-size: 11px; word-break: break-all; margin-bottom: 6px; color: rgba(255,255,255,0.9);">
                            ${ffmpegCheckCmd}
                        </div>
                        <button class="copy-check-btn" style="background: rgba(255, 255, 255, 0.15); border: none; color: white; padding: 6px 12px; cursor: pointer; border-radius: 6px; font-size: 11px; font-weight: 600; width: 100%; transition: all 0.2s;">
                            📋 Copy Check Command
                        </button>
                    </div>
                </div>
            `;
            
            urlList.insertBefore(urlEntry, urlList.firstChild);
            
            // Hover effects
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
            
            // Main copy URL button
            const copyUrlBtn = urlEntry.querySelector('.copy-url-btn');
            copyUrlBtn.addEventListener('mouseenter', () => {
                copyUrlBtn.style.background = '#ffffff';
                copyUrlBtn.style.transform = 'scale(1.02)';
            });
            copyUrlBtn.addEventListener('mouseleave', () => {
                copyUrlBtn.style.background = 'rgba(255, 255, 255, 0.9)';
                copyUrlBtn.style.transform = 'scale(1)';
            });
            copyUrlBtn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                copyToClipboard(url, this);
            });
            
            // Show/hide commands button
            const showCommandsBtn = urlEntry.querySelector('.show-commands-btn');
            const commandsSection = urlEntry.querySelector('.commands-section');
            
            let isExpanded = false;
            
            showCommandsBtn.addEventListener('mouseenter', () => {
                showCommandsBtn.style.background = 'rgba(255, 255, 255, 0.3)';
                showCommandsBtn.style.transform = 'scale(1.05)';
            });
            showCommandsBtn.addEventListener('mouseleave', () => {
                if (!isExpanded) {
                    showCommandsBtn.style.background = 'rgba(255, 255, 255, 0.2)';
                }
                showCommandsBtn.style.transform = 'scale(1)';
            });
            showCommandsBtn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                isExpanded = !isExpanded;
                
                if (isExpanded) {
                    commandsSection.style.display = 'block';
                    this.innerHTML = '✕';
                    this.style.background = 'rgba(255, 255, 255, 0.3)';
                } else {
                    commandsSection.style.display = 'none';
                    this.innerHTML = '⚙️';
                    this.style.background = 'rgba(255, 255, 255, 0.2)';
                }
            });
            
            // Copy download command button
            const copyDownloadBtn = urlEntry.querySelector('.copy-download-btn');
            copyDownloadBtn.addEventListener('mouseenter', () => {
                copyDownloadBtn.style.background = 'rgba(255, 255, 255, 0.25)';
            });
            copyDownloadBtn.addEventListener('mouseleave', () => {
                copyDownloadBtn.style.background = 'rgba(255, 255, 255, 0.15)';
            });
            copyDownloadBtn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                copyToClipboard(ffmpegDownloadCmd, this);
            });
            
            // Copy check command button
            const copyCheckBtn = urlEntry.querySelector('.copy-check-btn');
            copyCheckBtn.addEventListener('mouseenter', () => {
                copyCheckBtn.style.background = 'rgba(255, 255, 255, 0.25)';
            });
            copyCheckBtn.addEventListener('mouseleave', () => {
                copyCheckBtn.style.background = 'rgba(255, 255, 255, 0.15)';
            });
            copyCheckBtn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                copyToClipboard(ffmpegCheckCmd, this);
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
    
    // Intercept XMLHttpRequest
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
        if (typeof url === 'string' && (url.includes('.m3u8') || url.toLowerCase().includes('m3u8'))) {
            console.log('[HLS Extractor] XHR detected:', url);
            addUrl(url);
        }
        return originalOpen.apply(this, arguments);
    };
    
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function() {
        this.addEventListener('load', function() {
            const url = this.responseURL || this._url;
            if (url && (url.includes('.m3u8') || url.toLowerCase().includes('m3u8'))) {
                console.log('[HLS Extractor] XHR response:', url);
                addUrl(url);
            }
        });
        return originalSend.apply(this, arguments);
    };
    
    // Intercept Fetch API
    const originalFetch = window.fetch;
    window.fetch = function(resource, options) {
        const url = typeof resource === 'string' ? resource : (resource.url || '');
        if (url && (url.includes('.m3u8') || url.toLowerCase().includes('m3u8'))) {
            console.log('[HLS Extractor] Fetch detected:', url);
            addUrl(url);
        }
        return originalFetch.apply(this, arguments);
    };
    
    // Monitor DOM for video sources
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.tagName === 'VIDEO' || node.tagName === 'SOURCE') {
                    const src = node.src || node.getAttribute('src');
                    if (src && (src.includes('.m3u8') || src.toLowerCase().includes('m3u8'))) {
                        console.log('[HLS Extractor] DOM element:', src);
                        addUrl(src);
                    }
                }
            });
        });
    });
    
    // Initialize UI when DOM is ready
    function init() {
        createUI();
        
        if (document.body) {
            observer.observe(document.body, { childList: true, subtree: true });
        }
        
        // Check existing video elements
        document.querySelectorAll('video, source').forEach(el => {
            const src = el.src || el.getAttribute('src');
            if (src && (src.includes('.m3u8') || src.toLowerCase().includes('m3u8'))) {
                addUrl(src);
            }
        });
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    
    // Periodic check for video elements
    setInterval(() => {
        document.querySelectorAll('video, source').forEach(el => {
            const src = el.src || el.getAttribute('src');
            if (src && (src.includes('.m3u8') || src.toLowerCase().includes('m3u8'))) {
                addUrl(src);
            }
        });
    }, 2000);
    
    console.log('[HLS Extractor] Script loaded and monitoring for M3U8/HLS URLs');
})();
