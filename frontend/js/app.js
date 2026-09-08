const App = (function () {
  const API_BASE = '/api';
  let currentUser = null;
  let csrfToken = null;
  let authChecked = false;

  /* ── Loader Style (একবার inject হয়) ─────────────── */
  let styleInjected = false;
  function injectBaseStyle() {
    if (styleInjected) return;
    styleInjected = true;
    const s = document.createElement('style');
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

  /* ── CSRF ─────────────────────────────────────────── */
  function getCsrf() {
    if (csrfToken) return csrfToken;
    const m = document.cookie.match(/csrf_token=([^;]+)/);
    return m ? m[1] : '';
  }

  /* ── Fetch wrapper ───────────────────────────────── */
  async function api(method, path, body) {
    const opts = {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrf() }
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(API_BASE + path, opts);
    return res.json();
  }

  /* ── Content inject (style + script সহ) ──────────── */
  function injectContent(container, html) {
    container.innerHTML = '';
    const tmp = document.createElement('div');
    tmp.innerHTML = html;

    /* backend style tags → document.head এ যোগ */
    tmp.querySelectorAll('style').forEach(function (old) {
      const s = document.createElement('style');
      s.textContent = old.textContent;
      s.setAttribute('data-pg', '1');
      document.head.appendChild(s);
      old.remove();
    });

    /* backend script tags → execute */
    tmp.querySelectorAll('script').forEach(function (old) {
      const s = document.createElement('script');
      if (old.src) { s.src = old.src; } else { s.textContent = old.textContent; }
      old.parentNode.replaceChild(s, old);
    });

    container.innerHTML = tmp.innerHTML;
  }

  /* ── পুরোনো injected style remove ──────────────── */
  function clearInjectedStyles() {
    document.querySelectorAll('style[data-pg]').forEach(function (s) { s.remove(); });
  }

  /* ── Centered loader (JavaScript দিয়ে) ─────────── */
  function showLoader(c) {
    c.innerHTML = '<div class="pg-loader"><span></span><span></span><span></span></div>';
  }

  /* ── Access denied message ──────────────────────── */
  function showDenied(c, msg) {
    c.innerHTML =
      '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:1rem">' +
        '<h2 style="font-size:1.4rem">Access Denied</h2>' +
        '<p style="color:#888;font-size:0.9rem">' + esc(msg || 'No permission') + '</p>' +
        '<a href="/home" style="padding:0.6rem 1.4rem;background:#333;color:#fff;border-radius:6px;text-decoration:none;font-size:0.9rem">Go Home</a>' +
      '</div>';
  }

  /* ── Slug from URL ──────────────────────────────── */
  function getSlug() {
    var p = window.location.pathname.replace(/^\/+|\/+$/g, '');
    if (!p || p === 'home') return 'home';
    return p;
  }

  /* ── Auth (একবার check, cache) ─────────────────── */
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

  /* ── Page content cache (sessionStorage) ────────── */
  function getCached(slug) {
    try {
      var c = sessionStorage.getItem('pg_' + slug);
      if (c) { var d = JSON.parse(c); if (Date.now() - d.t < 300000) return d.h; }
    } catch (e) {}
    return null;
  }
  function setCached(slug, html) {
    try { sessionStorage.setItem('pg_' + slug, JSON.stringify({ h: html, t: Date.now() })); } catch (e) {}
  }
  function clearCache() {
    try { sessionStorage.clear(); } catch (e) {}
  }

  /* ── Reset session ──────────────────────────────── */
  function resetSession() {
    currentUser = null;
    authChecked = false;
    csrfToken = null;
    clearCache();
  }

  /* ══════════════════════════════════════════════════
     init() — প্রতিটি page-এ এটা call হয়
     ══════════════════════════════════════════════════ */
  async function init() {
    var c = document.getElementById('app-content');
    if (!c) return;

    injectBaseStyle();

    var slug = getSlug();

    /* login page হলে আলাদা */
    if (slug === 'login') { await initLogin(); return; }

    /* auth check */
    showLoader(c);
    var ok = await ensureAuth();
    if (!ok) { window.location.href = '/login'; return; }

    /* cache check */
    clearInjectedStyles();
    var cached = getCached(slug);
    if (cached) { injectContent(c, cached); return; }

    /* backend থেকে fetch */
    showLoader(c);
    var res = await api('GET', '/pages/' + slug);

    if (!res.success) { showDenied(c, res.error); return; }

    setCached(slug, res.data.content);
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
    /* already logged in → home */
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

  /* ── Escape ─────────────────────────────────────── */
  function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

  return { init: init, initLogin: initLogin, login: login, logout: logout, api: api, getCsrf: getCsrf, esc: esc, getSlug: getSlug };
})();
