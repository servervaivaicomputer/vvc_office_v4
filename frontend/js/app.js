const App = (function () {
  const API_BASE = '/api';
  let currentUser = null;
  let csrfToken = null;
  let authChecked = false;

  /* ── Loader Style (একবার inject হয়) ─────────────── */
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

  /* ── CSRF ─────────────────────────────────────────── */
  function getCsrf() {
    if (csrfToken) return csrfToken;
    var m = document.cookie.match(/csrf_token=([^;]+)/);
    return m ? m[1] : '';
  }

  /* ── Fetch wrapper ───────────────────────────────── */
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

  /* ── Content inject (FIXED — scripts execute হবে) ── */
  function injectContent(container, html) {
    container.innerHTML = '';

    var tmp = document.createElement('div');
    tmp.innerHTML = html;

    /* style tags collect */
    var styles = [];
    tmp.querySelectorAll('style').forEach(function (old) {
      styles.push(old.textContent);
      old.remove();
    });

    /* script tags collect */
    var inlineScripts = [];
    var externalScripts = [];
    tmp.querySelectorAll('script').forEach(function (old) {
      if (old.src) {
        externalScripts.push(old.getAttribute('src'));
      } else {
        inlineScripts.push(old.textContent);
      }
      old.remove();
    });

    /* styles → head */
    styles.forEach(function (content) {
      var s = document.createElement('style');
      s.textContent = content;
      s.setAttribute('data-pg', '1');
      document.head.appendChild(s);
    });

    /* HTML (without scripts/styles) */
    container.innerHTML = tmp.innerHTML;

    /* external scripts → execute */
    externalScripts.forEach(function (src) {
      var s = document.createElement('script');
      s.src = src;
      document.body.appendChild(s);
    });

    /* inline scripts → execute */
    inlineScripts.forEach(function (code) {
      var s = document.createElement('script');
      s.textContent = code;
      document.body.appendChild(s);
    });
  }

  /* ── পুরোনো injected style remove ──────────────── */
  function clearInjectedStyles() {
    document.querySelectorAll('style[data-pg]').forEach(function (s) { s.remove(); });
  }

  /* ── পুরোনো injected script remove ─────────────── */
  function clearInjectedScripts() {
    document.querySelectorAll('script[data-pg]').forEach(function (s) { s.remove(); });
  }

  /* ── Centered loader ─────────────────────────────── */
  function showLoader(c) {
    c.innerHTML = '<div class="pg-loader"><span></span><span></span><span></span></div>';
  }

  /* ── Access denied ──────────────────────────────── */
  function showDenied(c, msg) {
    c.innerHTML =
      '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:1rem">' +
        '<h2 style="font-size:1.4rem">Access Denied</h2>' +
        '<p style="color:#888;font-size:0.9rem">' + esc(msg || 'No permission') + '</p>' +
        '<a href="/home" style="padding:0.6rem 1.4rem;background:#333;color:#fff;border-radius:6px;text-decoration:none;font-size:0.9rem">Go Home</a>' +
      '</div>';
  }

  /* ── Slug ────────────────────────────────────────── */
  function getSlug() {
    var p = window.location.pathname.replace(/^\/+|\/+$/g, '');
    if (!p || p === 'home') return 'home';
    return p;
  }

  /* ── Auth ────────────────────────────────────────── */
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

    /* পুরোনো inject clear */
    clearInjectedStyles();

    /* backend fetch */
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
