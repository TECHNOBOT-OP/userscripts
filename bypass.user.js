// ==UserScript==
// @name         Shortlinks Bypass
// @namespace    https://github.com/...
// @version      3.0.1-alpha
// @description  Shortlinks automation — Professional, safe, production edition
// @author       TechnoBoy
// @match        *://*/*
// @grant        unsafeWindow
// @run-at       document-start
// @downloadURL  https://raw.githubusercontent.com/TECHNOBOT-OP/userscripts/refs/heads/main/bypass.user.js
// updateURL     https://raw.githubusercontent.com/TECHNOBOT-OP/userscripts/refs/heads/main/bypass.user.js
// ==/UserScript==

(function () {
    'use strict';

    const w = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    const unsupported = ['rarestudy.site'];

    /**
     * Utils
    */
    const Utils = {
        now: () => Date.now(),
        isVisible: el => el && el.offsetParent !== null && window.getComputedStyle(el).display !== 'none' && window.getComputedStyle(el).visibility !== 'hidden' && el.offsetWidth > 0 && el.offsetHeight > 0 && !el.disabled,
        normalizeUrl: url => { try { return new URL(url, w.location.href).toString(); } catch { return url; } },
        randomInt: (min, max) => Math.floor(Math.random() * (max - min + 1) + min),
        sleep: ms => new Promise(res => setTimeout(res, ms))
    };

    /**
     * Logger Utility
     */
    class Logger {
        constructor(cls) { this.cls = cls || "Logger"; }
        _log(type, color, args) {
            console.log(
                `%c[GP-Auto]%c [%c${this.cls}%c] [${new Date().toLocaleString()}] `,
                "font-weight:bold;color:" + color, "", "font-style:italic;color:" + color, "",
                ...args
            );
        }
        info(...a) { this._log("info", "green", a); }
        warn(...a) { this._log("warn", "orange", a); }
        error(...a) { this._log("error", "red", a); }
    }

    class StyleWatcher {
        #el; #cb = {}; #stop = false; #raf;
        constructor(el, timeout, onTimeout) {
            this.#el = el;
            const f = () => {
                if (this.#stop) return;
                const v = Utils.isVisible(this.#el);
                if (v !== this.#cb._visibleState) {
                    this.#cb._visibleState = v;
                    this.onVisibilityChange?.(this.#el, v);
                    // this.onStyleChange?.({ type: 'visible', el: this.#el });
                }
                // For Future integration: detect style changes
                const s = this.#el.style.cssText;
                if (s !== this.#cb._styleState) {
                    this.#cb._styleState = s;
                    this.onStyleChange?.({ type: 'style', el: this.#el });
                }
            };
            const obs = new MutationObserver(f);
            obs.observe(this.#el, { attributes: true, attributeFilter: ['style', 'class', 'hidden', 'disabled'] });
            const loop = () => { f(); if (!this.#stop) this.#raf = requestAnimationFrame(loop); };
            loop();
            if (timeout) {
                setTimeout(() => {
                if (!this.#cb._visibleState && !this.#cb._styleState) onTimeout?.(this.#el);
                this.stop();
            }, timeout);
            this.stopObserver = () => { obs.disconnect(); };
        }
        }
        stop() { this.#stop = true; cancelAnimationFrame(this.#raf); this.stopObserver?.(); }
        set onVisibilityChange(cb) { this.#cb.onVisibilityChange = cb; }
        get onVisibilityChange() { return this.#cb.onVisibilityChange; }
        set onStyleChange(cb) { this.#cb.onStyleChange = cb; }
        get onStyleChange() { return this.#cb.onStyleChange; }
    }

    /**
     * Async Job Queue
     */
    class AsyncQueue {
        constructor() { this.queue = []; this.processing = false; this.logger = new Logger(this.constructor.name); }
        push(job) { this.queue.push(job); this.process(); }
        async process() {
            if (this.processing) return;
            this.processing = true;
            while (this.queue.length > 0) {
                const job = this.queue.shift();
                try { await job(); } catch (e) { this.logger.error('Queue job error:', e); }
                await Utils.sleep(100);
            }
            this.processing = false;
        }
    }

    /**
     * Token Manager
     */
    class TokenManager {
        constructor() { this._token = null; this.initialPath = null; this.logger = new Logger(this.constructor.name); }
        generateToken() {
            const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
            let token = 'sl';
            this.initialPath = this.getCurrentPathQuery();
            for (let i = 0; i < 8; i++) token += chars.charAt(Utils.randomInt(0, 35));
            token += "-" + btoa(JSON.stringify(this.initialPath));
            this._token = token;
            this.logger.info('Generated token:', token);
            return token;
        }
        getCurrentPathQuery() {
            const { hostname, pathname, search } = w.location;
            return { hostname, pathname, search };
        }
        appendTokenToHash(url, token = this._token) {
            if (!token || !url) return url;
            try {
                const u = new URL(url, w.location.href);
                const params = new URLSearchParams(u.hash.slice(1));
                params.set('sl', token);
                u.hash = params.toString();
                return ((url.startsWith('/') || url.startsWith('#')) ? u.pathname + u.search + u.hash : u.toString());
            } catch { return url; }
        }
        removeTokenFromHash(url) {
            if (!url) return url;
            try {
                const u = new URL(url, w.location.href);
                const params = new URLSearchParams(u.hash.slice(1));
                params.delete('sl');
                u.hash = params.toString();
                return u.toString();
            } catch { return url; }
        }

        set token(value) {
            this._token = value;
            this.initialPath = JSON.parse(atob(value.split('-')[1]));
        }
        get token() { return this._token; }
    }

    /**
     * Page Heuristics
     */
    class PageDetector {
        static GP_KEYWORDS = /scroll\s*(down\s*to|dowm\s*(and|&)\s*click)\s*(to)?\s*continue|you\s*are\s*(currently)?\s*on\s*step\s*\d*|click\s*(on)?\s*image\s*(and|&)\s*(wait\s*for|wait)\s*(\d*\s*se?c?o?n?d?s?)/ig;
        static BUTTON_KEYWORDS = /^(continue|verify(?:\s*now)?|proceed|get link|next|unlock|skip|i am human|please wait|click here for next step)\b(?!.{9})/i;

        static isGPPage() {
            const body = (document.body?.innerText || '').trim();
            if (document.querySelector('meta[http-equiv="refresh"]')) return true;
            if (!body) return undefined;
            if (body.length > 500) return false;
            if ((body.length < 200) && /\b(generating|click here|redirecting|please wait|opening link)\b/i.test(body)) return true;
            if (document.querySelector('nav, header > [role="navigation"], [class*="navbar"]')) return false;
            if (document.querySelector('article, main, [role="main"]')) return false;
            return undefined;
        }

        static isSpamBlog() {
            const bodyText = (document.body.textContent || '').toLowerCase();
            if (this.GP_KEYWORDS.test(bodyText)) return true;
            const actionButtons = document.querySelectorAll('a, button, input[type="button"], input[type="submit"]');
            const hasButton = Array.from(actionButtons).filter(btn => {
                const text = (btn.textContent || btn.innerText || '').toLowerCase();
                if (this.BUTTON_KEYWORDS.test(text)) { return true; }
                return false;
            });
            return hasButton?.length && (hasButton.length >= 2 || document.querySelector('div.site > div.site-content div.content-area > main > article[id^="post"]'));
        }

        static lastStep() {
            const body = (document.body?.innerText || '').trim();
            if (!body) return false;
            const match = body.match(/(?:you\s*are\s*)?(?:currently)?\s*(?:on)?\s*step\s*(\d+)[\/\\|](\d+)/i);
            return match ? match[1] === match[2] : undefined;
    }

    /**
     * Navigation Interceptor (safe)
     */
    class NavigationInterceptor {
        constructor(tokenManager) { this.tokenManager = tokenManager; this.logger = new Logger(this.constructor.name); }
        init() { this.observeMetaRefresh(); this.logger.info('Started Observer and Function Wrapper'); }
        observeMetaRefresh() {
            this.observer = new MutationObserver(muts => {
                muts.forEach(m => {
                    m.addedNodes.forEach(n => {
                        if (n.tagName === 'META' && n.httpEquiv?.toLowerCase() === 'refresh') {
                            const content = n.getAttribute('content');
                            const match = content?.match(/url=([^;]+)/i);
                            if (match) n.setAttribute('content', `0;url=${this.tokenManager.appendTokenToHash(match[1])}`);
                        }
                        if (n.tagName === 'SCRIPT' && /(?<!['"])(?:location\s*(?:\.href)?\s*=\s*['"]|location\s*(?:\.replace|\.assign)\(\s*['"]|\.replace\(\s*['"])[^'"]+['"]\s*(?![+,])\)?/i.test(n.textContent)) {
                            n.textContent = n.textContent.replace(/(location\s*(?:\.href)?\s*=\s*['"]|location\s*(?:\.replace|\.assign)\(\s*['"]|\.replace\(\s*['"])([^'"]+)(['"]\s*\)?)/i, (_, p1, url, p2) => {
                                return `${p1}${this.tokenManager.appendTokenToHash(url)}${p2}`;
                            });
                        }
                    });
                });
            });
            this.observer.observe(document.documentElement, { childList: true, subtree: true });
        }

        interceptClicks() {
            if (!this.tokenManager.token) return;
            document.addEventListener('click', e => {
                const a = e.target.closest("a[href]");
                if (a) {
                    if (a.href.startsWith('javascript:')) return;
                    const urlObj = new URL(a.href, w.location.href);
                    if (urlObj.hostname === w.location.hostname && urlObj.pathname === w.location.pathname) a.setAttribute('href', '/readmore#sl=' + this.tokenManager.token);
                    else if (this.tokenManager.initialPath.hostname === w.location.hostname && (urlObj.hostname === this.tokenManager.initialPath.hostname || PageDetector.lastStep())) return;
                    else a.setAttribute('href', this.tokenManager.appendTokenToHash(a.getAttribute('href')));
                }
            });
            document.addEventListener('submit', e => {
                const form = e.target;
                if (form && form.action) {
                    form.setAttribute('action', this.tokenManager.appendTokenToHash(form.getAttribute('action')));
                }
            });
        }
    }


    /**
     * Stealth Timer Acceleration
     */
    class StealthTimer {
        constructor(targetDelay = 0) { this.targetDelay = targetDelay; }
        init() {
            const targetDelay = this.targetDelay;
            const originalSetTimeout = w.setTimeout;
            const originalSetInterval = w.setInterval;
            // const funcWrapper = new StealthFunctions();
            // funcWrapper.init(w.setTimeout, this.targetDelay).init(w.setInterval, Math.floor(this.targetDelay / 20));
            function stealthSetTimeout(fn, delay, ...args) {
                const adjustedDelay = Math.min(delay, targetDelay);
                return originalSetTimeout(fn, adjustedDelay, ...args);
            }
            function stealthSetInterval(fn, delay, ...args) {
                const adjustedDelay = Math.min(delay, Math.floor(targetDelay / 10));
                return originalSetInterval(fn, adjustedDelay, ...args);
            }
            Object.defineProperties(stealthSetInterval, Object.getOwnPropertyDescriptors(originalSetInterval));
            Object.defineProperties(stealthSetTimeout, Object.getOwnPropertyDescriptors(originalSetTimeout));
            Object.setPrototypeOf(stealthSetTimeout, Object.getPrototypeOf(originalSetTimeout));
            Object.setPrototypeOf(stealthSetInterval, Object.getPrototypeOf(originalSetInterval));

            try {
                Object.defineProperty(w, 'setTimeout', { ...Object.getOwnPropertyDescriptor(w, 'setTimeout'), value: stealthSetTimeout });
                Object.defineProperty(w, 'setInterval', { ...Object.getOwnPropertyDescriptor(w, 'setInterval'), value: stealthSetInterval });
            } catch (e) {
                w.setTimeout = stealthSetTimeout;
                w.setInterval = stealthSetInterval;
            }
            new Logger(this.constructor.name).info('Activated Stealth Timer with target delay:', this.targetDelay);
        }
    }

    /**
     * Auto Clicker
     */
    class AutoClicker {
        constructor(queue) { this.queue = queue; this.clicked = new WeakSet(); this.logger = new Logger(this.constructor.name); }
        findClickableElements() {
            const elements = [];
            document.querySelectorAll('a, button, input[type="button"], input[type="submit"]').forEach(el => { if (!this.clicked.has(el) && PageDetector.BUTTON_KEYWORDS.test(el.textContent) && !el.closest('[class="nav"], [class*="pagination"], [class*="navigation"], [rel="next"]') && !/\b(ad|ads|banner)\b/i.test((el.classname || '') + (el.id || ''))) elements.push(el); });
            return elements;
        }

        attemptClick(t) {
            const candidates = this.findClickableElements();
            this.logger.info('Found candidates to click:', candidates, this.clicked);
            candidates.forEach(el => {
                this.clicked.add(el);
                if (!Utils.isVisible(el)) {
                    new StyleWatcher(el, 30000, () => this.logger.warn('Timed out waiting for element to be visible/enabled:', el)).onVisibilityChange = (element, isVisible) => {
                        this.logger.info('Element became visible/enabled:', element);
                        this.queue.push(async () => element.click());
                        this.queue.push(async () => {
                            await Utils.sleep(50);
                            if (Utils.isVisible(element)) element.click();
                        });
                    }
                    return;
                }
                if (/\bwait\b/.test(el.textContent)) {
                    const obs = new MutationObserver(() => {
                        this.queue.push(async () => {
                            el.click();
                            this.logger.info('Clicked element:', el);
                        });
                        this.queue.push(async () => {
                            await Utils.sleep(50);
                            if (Utils.isVisible(el)) el.click();
                        });
                        obs.disconnect();
                    });
                    setTimeout(() => { obs.disconnect(); this.logger.warn('Timed out waiting for element:', el); }, 15000);
                    obs.observe(el, { characterData: true, attributes: true, attributeFilter: ['innerText', 'textContent'], });
                    return;
                }
                this.queue.push(async () => el.click());
                this.queue.push(async () => {
                    await Utils.sleep(100);
                    if (Utils.isVisible(el)) el.click();
                });
            });
        }

        observeMutations() {
            this.observer = new MutationObserver((muts) => {
                muts.forEach(m => {
                    if (Array.from(m.addedNodes).some(n => n.matches?.('a, button, input[type="button"], input[type="submit"]'))) this.attemptClick();
                });
            });
            this.observer.observe(document.body, { childList: true, subtree: true });
        }
    }

    /**
     * Main Automator
     */
    class GPShortlinkAutomator {
        #heldScript = {}; #justCreated = false;
        constructor() {
            this.tokenManager = new TokenManager();
            this.queue = new AsyncQueue();
            this.navigation = new NavigationInterceptor(this.tokenManager);
            this.timer = new StealthTimer(10);
            this.clicker = new AutoClicker(this.queue);
            this.logger = new Logger(this.constructor.name);
        }

        async waitForDOM() {
            this.logger.info('Waiting for DOM to load...');
            const observer = new MutationObserver((muts, obs) => {
                muts.forEach(m => {
                    m.addedNodes?.forEach(n => {
                        if (n.tagName === 'SCRIPT' && !n.src && /(?<!['"])(?:location\s*(?:\.href)?\s*=\s*['"]|location\s*(?:\.replace|\.assign)\(\s*['"]|\.replace\(\s*['"])[^'"]+['"]\s*(?![+,])\)?/i.test(n.textContent)) {
                            this.#heldScript.el = n;
                            this.#heldScript.type = n.type;
                            n.setAttribute('type', 'text/held-xcript');
                            this.logger.info('Held a script modifying location:', n);
                            obs.disconnect();
                        }
                    });
                });
            });
            observer.observe(document.documentElement, { childList: true, subtree: true });
            const timeout = setTimeout(() => observer.disconnect(), 100);
            while (document.body.innerHTML.trim().length < 30 && document.readyState !== 'complete') {
                await new Promise(res => requestAnimationFrame(res));
            }
            clearTimeout(timeout);
            observer?.disconnect?.();
        }

        async init() {
            const existingToken = new URLSearchParams(w.location.hash.slice(1)).get('sl');
            this.tg = w.location.hostname === 'tipsguru.in';
            if (!existingToken && (/\.|\/.*\//i.test(pathname) || pathname.length > 20 || pathname === '/' || searchParams > 1 || search.length > 20 || unsupported.includes(w.loction.hostname)) && !this.tg) {
                this.logger.info('Pathname indicates not a shortlink, exiting.');
                history.replaceState(null, '', this.tokenManager.removeTokenFromHash(w.location.href));
                this.navigation.observer?.disconnect();
                return;
            }
            if (!existingToken) await this.waitForDOM();
            let isGPPage;
            if (this.#heldScript.el) isGPPage = true;
            this.isSpamBlog = PageDetector.isSpamBlog();
            if (!existingToken) isGPPage = isGPPage || PageDetector.isGPPage();
            this.logger.info(' IsGPPage:', isGPPage, ' ExistingToken:', existingToken);
            if (!isGPPage && !existingToken) {
                this.logger.info('Not a Shortlink redirect or redirected page.');
                return;
            }
            if (existingToken) {
                this.tokenManager.token = existingToken;
                history.replaceState(null, '', this.tokenManager.removeTokenFromHash(w.location.href));
            }
            else { this.tokenManager.generateToken(); this.#justCreated = true; }

            if (this.#heldScript.el) {
                this.logger.info('Restoring held script');
                const { el, type } = this.#heldScript;
                const clone = document.createElement('script');
                if (type) el.setAttribute('type', type);
                else el.removeAttribute('type');
                [...el.attributes].forEach(attr => clone.setAttribute(attr.name, attr.value));
                clone.textContent = el.textContent.replace(/(location\s*(?:\.href)?\s*=\s*['"]|location\s*(?:\.replace|\.assign)\(\s*['"]|\.replace\(\s*['"])([^'"]+)(['"]\s*\)?)/i, (_, p1, url, p2) => {
                    return `${p1}${url !== w.location.href ? this.tokenManager.appendTokenToHash(url) : url}${p2}`;
                });
                el.replaceWith(clone);
            }

            if (this.isSpamBlog || (existingToken && this.tokenManager.initialPath?.hostname !== w.location.hostname)) {
                this.timer.init();
            }
            if (this.tokenManager.initialPath?.hostname !== w.location.hostname || this.tg) {
                this.navigation.init();
            }

            this.logger.info('Initialized the xcript');
        }

        onDOMReady() {
            if (!this.tokenManager.token && !this.isSpamBlog) {
                this.logger.info('No token and not a spam blog, exiting.');
                return;
            }
            if (w.location.hostname.includes('google')) {
                this.navigation.interceptClicks();
                return;
            }
            if (!this.tg && ((this.tokenManager.token && !this.#justCreated && JSON.parse(atob(this.tokenManager.token.split('-')[1])).hostname === w.location.hostname) || (!PageDetector.isSpamBlog() && !PageDetector.isGPPage()))) {
                history.replaceState(null, '', this.tokenManager.removeTokenFromHash(w.location.href));
                this.navigation.observer?.disconnect();
                this.logger.info('Token belongs to this hostname, removed from URL.');
            } else {
                this.navigation.interceptClicks();
            }
            const i = document.createElement('iframe');
            i.style = 'height:0;width:0;border:0;';
            i.id = 'a';
            document.body.appendChild(i);
            i.focus();
            setTimeout(() => w.focus(), 500);
            this.clicker.observeMutations();
            this.clicker.attemptClick()
            this.logger.info('DOM is ready, interception and auto-clicking activated.');
        }
    }

    // Launch
    var pathname = w.location.pathname;
    var search = w.location.search;
    var searchParams = new URLSearchParams(search).size;
    // if (search.length > 60 || searchParams > 3) return;
    const automator = new GPShortlinkAutomator();
    automator.init();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => automator.onDOMReady());
    } else {
        automator.onDOMReady();
    }

})();
