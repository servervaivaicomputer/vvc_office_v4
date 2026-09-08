const App = (function () {
  const API_BASE = '/api';
  let currentUser = null;
  let csrfToken = null;
  let authChecked = false;

  /* ── Loader Style ──────────────────────────────── */
  var styleInjected = false;
  function injectBaseStyle() {
    if (styleInjected) return;
    styleInjected = true;
    var s = document.createElement('style');
    s.textContent = [
      '*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }',
      'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f5f5f5; color: #333; min-height: 100vh; }',
      '#app-content { width: 100%; min-height: 100vh; }',
      '.pg-loader { min-height: 100vh; display: flex; align-items: center; justify-content: center; gap: 6px; }',
      '.pg-loader span { width: 8px; height: 8px; background: #999; border-radius: 50%; animation: _pgB 1.2s infinite ease-in-out; }',
      '.pg-loader span:nth-child(2) { animation-delay: 0.2s; }',
      '.pg-loader span:nth-child(3) { animation-delay: 0.4s; }',
      '@keyframes _pgB { 0%,80%,100% { transform: scale(0.6); opacity: 0.4; } 40% { transform: scale(1); opacity: 1; } }'
    ].join('\n');
    document.head.appendChild(s);
  }

  /* ── CSRF ──────────────────────────────────────── */
  function getCsrf() {
    if (csrfToken) return csrfToken;
    var m = document.cookie.match(/csrf_token=([^;]+)/);
    return m ? m[1] : '';
  }

  /* ── Fetch ─────────────────────────────────────── */
  async function api(method, path, body) {
    var opts = {
      method: method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrf() }
    };
    if (body) opts.body = JSON.stringify(body);
    var res = await fetch(API_BASE + path, opts);
    return res.json();
  }

  /* ══════════════════════════════════════════════════
     injectContent — FINAL

     innerHTML parser-inserted flag সমস্যা bypass করে
     Regex দিয়ে raw HTML string থেকে style/script বের করে
     Clean HTML innerHTML এ বসায়, script eval দিয়ে চালায়
     ══════════════════════════════════════════════════ */
  function injectContent(container, html) {

    /* ── 1. Styles extract করো regex দিয়ে ── */
    var styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
    var styleMatch;
    var styleContents = [];
    while ((styleMatch = styleRegex.exec(html)) !== null) {
      styleContents.push(styleMatch[1]);
    }

    /* ── 2. Scripts extract করো regex দিয়ে ── */
    var scriptTagRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    var scriptMatch;
    var inlineScripts = [];
    var externalScripts = [];
    while ((scriptMatch = scriptTagRegex.exec(html)) !== null) {
      var attrs = scriptMatch[1] || '';
      var code = scriptMatch[2] || '';
      var srcMatch = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i);

      if (srcMatch) {
        externalScripts.push(srcMatch[1]);
      } else if (code.trim()) {
        inlineScripts.push(code);
      }
    }

    /* ── 3. Style + Script tags remove করো HTML থেকে ── */
    var cleanHtml = html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .trim();

    /* ── 4. Styles → document.head ── */
    for (var i = 0; i < styleContents.length; i++) {
      var s = document.createElement('style');
      s.textContent = styleContents[i];
      s.setAttribute('data-pg', '1');
      document.head.appendChild(s);
    }

    /* ── 5. Clean HTML → container ── */
    container.innerHTML = cleanHtml;

    /* ── 6. External scripts load করো ── */
    for (var j = 0; j < externalScripts.length; j++) {
      var es = document.createElement('script');
      es.src = externalScripts[j];
      es.setAttribute('data-pg', '1');
      document.head.appendChild(es);
    }

    /* ── 7. Inline scripts execute করো ── */
    for (var k = 0; k < inlineScripts.length; k++) {
      try {
        /* (0, eval)(code) = indirect eval = global scope execute */
        (0, eval)(inlineScripts[k]);
      } catch (err) {
        console.error('[App] Script error:', err);
      }
    }
  }

  /* ── Old styles clear ──────────────────────────── */
  function clearInjectedStyles() {
    var old = document.querySelectorAll('style[data-pg]');
    for (var i = 0; i < old.length; i++) old[i].remove();
  }

  /* ── Loader ────────────────────────────────────── */
  function showLoader(c) {
    c.innerHTML = '<div class="pg-loader"><span></span><span></span><span></span></div>';
  }

  /* ── Access denied ─────────────────────────────── */
  function showDenied(c, msg) {
    c.innerHTML =
      '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:1rem">' +
        '<h2 style="font-size:1.4rem">Access Denied</h2>' +
        '<p style="color:#888;font-size:0.9rem">' + esc(msg || 'No permission') + '</p>' +
        '<a href="/home" style="padding:0.6rem 1.4rem;background:#333;color:#fff;border-radius:6px;text-decoration:none;font-size:0.9rem">Go Home</a>' +
      '</div>';
  }

  /* ── Slug ──────────────────────────────────────── */
  function getSlug() {
    var p = window.location.pathname.replace(/^\/+|\/+$/g, '');
    if (!p || p === 'home') return 'home';
    return p;
  }

  /* ── Auth ──────────────────────────────────────── */
  async function ensureAuth() {
    if (!csrfToken) {
      var r = await api('GET', '/auth/csrf');
      if (r.csrfToken) csrfToken = r.csrfToken;
    }
    if (!authChecked) {
      var me = await api('GET', '/auth/me');
      if (!me.success) return false;
      currentUser = me.data.user;
      authChecked = true;
    }
    return true;
  }

  function resetSession() {
    currentUser = null;
    authChecked = false;
    csrfToken = null;
  }

  /* ══════════════════════════════════════════════════
     init()
     ══════════════════════════════════════════════════ */
  async function init() {
    var c = document.getElementById('app-content');
    if (!c) return;

    injectBaseStyle();
    var slug = getSlug();

    if (slug === 'login') { await initLogin(); return; }

    showLoader(c);
    var ok = await ensureAuth();
    if (!ok) { window.location.href = '/login'; return; }

    clearInjectedStyles();

    showLoader(c);
    var res = await api('GET', '/pages/' + slug);
    if (!res.success) { showDenied(c, res.error); return; }

    injectContent(c, res.data.content);
  }

  /* ══════════════════════════════════════════════════
     initLogin()
     ══════════════════════════════════════════════════ */
  async function initLogin() {
    injectBaseStyle();
    if (!csrfToken) {
      var r = await api('GET', '/auth/csrf');
      if (r.csrfToken) csrfToken = r.csrfToken;
    }
    var me = await api('GET', '/auth/me');
    if (me.success) { window.location.href = '/home'; }
  }

  /* ══════════════════════════════════════════════════
     login()
     ══════════════════════════════════════════════════ */
  async function login(isAdmin) {
    var username = document.getElementById('login-username').value.trim();
    var password = document.getElementById('login-password').value;
    var errEl = document.getElementById('login-error');
    var btn = document.getElementById('login-btn');

    errEl.style.display = 'none';
    if (!username || !password) {
      errEl.textContent = 'Enter username and password.';
      errEl.style.display = 'block';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Signing in...';

    var res = await api('POST', isAdmin ? '/auth/admin-login' : '/auth/login', { username: username, password: password });

    if (res.success) {
      resetSession();
      window.location.href = isAdmin ? '/admin' : '/home';
    } else {
      errEl.textContent = res.error + (res.attemptsRemaining != null ? ' (' + res.attemptsRemaining + ' left)' : '');
      errEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  }

  /* ══════════════════════════════════════════════════
     logout()
     ══════════════════════════════════════════════════ */
  async function logout() {
    await api('POST', '/auth/logout');
    resetSession();
    window.location.href = '/login';
  }

  function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

  return { init: init, initLogin: initLogin, login: login, logout: logout, api: api, getCsrf: getCsrf, esc: esc, getSlug: getSlug };
})();
