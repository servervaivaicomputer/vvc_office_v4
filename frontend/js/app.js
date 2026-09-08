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
     injectContent — FINAL FIX

     Browser behavior:
     - innerHTML = html    → DOM create হয়, script execute হয় না
     - replaceChild(script) → fresh script DOM এ insert হয়, execute হয়
     ══════════════════════════════════════════════════ */
  function injectContent(container, html) {
    /* Step 1: HTML set করো (scripts won't run) */
    container.innerHTML = html;

    /* Step 2: Styles → document.head এ move করো */
    var styles = container.querySelectorAll('style');
    for (var i = 0; i < styles.length; i++) {
      var ns = document.createElement('style');
      ns.textContent = styles[i].textContent;
      ns.setAttribute('data-pg', '1');
      document.head.appendChild(ns);
      styles[i].remove();
    }

    /* Step 3: প্রতিটি script কে fresh createElement দিয়ে replace করো
       Browser fresh createElement script execute করে */
    var scripts = container.querySelectorAll('script');
    var scriptsCopy = [];
    for (var j = 0; j < scripts.length; j++) {
      scriptsCopy.push(scripts[j]);
    }

    for (var k = 0; k < scriptsCopy.length; k++) {
      var old = scriptsCopy[k];
      var ns = document.createElement('script');

      /* Copy all attributes (src, type, etc) */
      for (var a = 0; a < old.attributes.length; a++) {
        ns.setAttribute(old.attributes[a].name, old.attributes[a].value);
      }

      /* Copy inline content */
      if (old.src || old.getAttribute('src')) {
        ns.src = old.getAttribute('src');
      } else {
        ns.textContent = old.textContent;
      }

      /* Replace — this triggers execution */
      old.parentNode.replaceChild(ns, old);
    }
  }

  /* ── Clear old styles ──────────────────────────── */
  function clearInjectedStyles() {
    var old = document.querySelectorAll('style[data-pg]');
    for (var i = 0; i < old.length; i++) {
      old[i].remove();
    }
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
