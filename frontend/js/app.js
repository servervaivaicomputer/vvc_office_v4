const App = (function () {
  const API_BASE = '/api';
  let currentUser = null;
  let csrfToken = null;
  let authChecked = false;

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
     writeDocument — backend full HTML সরাসরি লিখো
     document.open  → পুরো document clear হয়ে যায়
     document.write → backend HTML (style+script সহ) বসে
     document.close → browser parse করে, scripts চলে
     ══════════════════════════════════════════════════ */
  function writeDocument(html) {
    document.open();
    document.write(html);
    document.close();
    /* document.close() এর পরে এই execution context
       effectively dead — তাই return করা safest */
  }

  /* ── Error page (self-contained) ───────────────── */
  function errorPage(msg) {
    return '<!DOCTYPE html>' +
      '<html><head><meta charset="utf-8"><title>Error</title>' +
      '<style>' +
        'body{min-height:100vh;display:flex;align-items:center;justify-content:center;' +
        'flex-direction:column;gap:1rem;font-family:system-ui;background:#f5f5f5}' +
        'h2{font-size:1.4rem}p{color:#888;font-size:.9rem}' +
        'a{padding:.6rem 1.4rem;background:#333;color:#fff;border-radius:6px;text-decoration:none}' +
      '</style></head>' +
      '<body><h2>Access Denied</h2>' +
      '<p>' + esc(msg || 'No permission') + '</p>' +
      '<a href="/home">Go Home</a></body></html>';
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
    var slug = getSlug();

    /* login page → আলাদা handle */
    if (slug === 'login') {
      await initLogin();
      return;
    }

    /* auth check */
    var ok = await ensureAuth();
    if (!ok) {
      window.location.href = '/login';
      return;
    }

    /* page fetch → document.write */
    var res = await api('GET', '/pages/' + slug);
    if (!res.success) {
      writeDocument(errorPage(res.error));
      return;
    }

    writeDocument(res.data.content);
    /* এখানের পরে কিছু execute হবে না —
       নতুন document load হয়ে গেছে */
  }

  /* ══════════════════════════════════════════════════
     initLogin()
     ══════════════════════════════════════════════════ */
  async function initLogin() {
    if (!csrfToken) {
      var r = await api('GET', '/auth/csrf');
      if (r.csrfToken) csrfToken = r.csrfToken;
    }
    var me = await api('GET', '/auth/me');
    if (me.success) {
      window.location.href = '/home';
    }
    /* logged out → login page দেখাও (initial HTML এ আছে) */
  }

  /* ══════════════════════════════════════════════════
     login()
     ══════════════════════════════════════════════════ */
  async function login(isAdmin) {
    var username = document.getElementById('login-username').value.trim();
    var password = document.getElementById('login-password').value;
    var errEl    = document.getElementById('login-error');
    var btn      = document.getElementById('login-btn');

    errEl.style.display = 'none';
    if (!username || !password) {
      errEl.textContent = 'Enter username and password.';
      errEl.style.display = 'block';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Signing in...';

    var res = await api('POST', isAdmin ? '/auth/admin-login' : '/auth/login', {
      username: username,
      password: password
    });

    if (res.success) {
      resetSession();
      window.location.href = isAdmin ? '/admin' : '/home';
    } else {
      errEl.textContent = res.error +
        (res.attemptsRemaining != null ? ' (' + res.attemptsRemaining + ' left)' : '');
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

  /* ── Helpers ───────────────────────────────────── */
  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  return {
    init: init,
    initLogin: initLogin,
    login: login,
    logout: logout,
    api: api,
    getCsrf: getCsrf,
    esc: esc,
    getSlug: getSlug
  };
})();
