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
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': getCsrf()
      }
    };

    if (body) opts.body = JSON.stringify(body);

    var res = await fetch(API_BASE + path, opts);
    return res.json();
  }

  /* ── Inject Backend Page ───────────────────────── */
  function writeDocument(html) {
    var app = document.getElementById('app-content');
    if (!app) return;

    app.innerHTML = html;

    app.querySelectorAll('script').forEach(function (oldScript) {
      var newScript = document.createElement('script');

      Array.from(oldScript.attributes).forEach(function (attr) {
        newScript.setAttribute(attr.name, attr.value);
      });

      newScript.textContent = oldScript.textContent;
      oldScript.replaceWith(newScript);
    });
  }

  /* ── Error page ────────────────────────────────── */
  function errorPage(msg) {
    return '<div>' +
      '<style>' +
        '#app-content .error-page{' +
          'min-height:100vh;display:flex;align-items:center;' +
          'justify-content:center;flex-direction:column;gap:1rem;' +
          'font-family:system-ui;background:#f5f5f5' +
        '}' +
        '#app-content .error-page h2{font-size:1.4rem}' +
        '#app-content .error-page p{color:#888;font-size:.9rem}' +
        '#app-content .error-page a{' +
          'padding:.6rem 1.4rem;background:#333;color:#fff;' +
          'border-radius:6px;text-decoration:none' +
        '}' +
      '</style>' +
      '<div class="error-page">' +
        '<h2>Access Denied</h2>' +
        '<p>' + esc(msg || 'No permission') + '</p>' +
        '<a href="/home">Go Home</a>' +
      '</div>' +
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

  /* ── Init ──────────────────────────────────────── */
  async function init() {
    var slug = getSlug();

    if (slug === 'login') {
      await initLogin();
      return;
    }

    var ok = await ensureAuth();

    if (!ok) {
      window.location.href = '/login';
      return;
    }

    var res = await api('GET', '/pages/' + slug);

    if (!res.success) {
      writeDocument(errorPage(res.error));
      return;
    }

    writeDocument(res.data.content);
  }

  /* ── Login Init ────────────────────────────────── */
  async function initLogin() {
    if (!csrfToken) {
      var r = await api('GET', '/auth/csrf');
      if (r.csrfToken) csrfToken = r.csrfToken;
    }

    var me = await api('GET', '/auth/me');

    if (me.success) {
      window.location.href = '/home';
    }
  }

  /* ── Login ─────────────────────────────────────── */
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

    var res = await api(
      'POST',
      isAdmin ? '/auth/admin-login' : '/auth/login',
      {
        username: username,
        password: password
      }
    );

    if (res.success) {
      resetSession();
      window.location.href = isAdmin ? '/admin' : '/home';
    } else {
      errEl.textContent = res.error +
        (res.attemptsRemaining != null
          ? ' (' + res.attemptsRemaining + ' left)'
          : '');

      errEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  }

  /* ── Logout ────────────────────────────────────── */
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
