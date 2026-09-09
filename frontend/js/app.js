const App = (function () {
  const API_BASE = '/api';

  let currentUser = null;
  let csrfToken = null;
  let authChecked = false;

  /* ── CSRF ──────────────────────────────────────── */
  function getCsrf() {
    if (csrfToken) return csrfToken;

    var m = document.cookie.match(/csrf_token=([^;]+)/);

    return m ? decodeURIComponent(m[1]) : '';
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

    if (body) {
      opts.body = JSON.stringify(body);
    }

    var res = await fetch(API_BASE + path, opts);

    return res.json();
  }

  /* ── Inject Backend HTML ───────────────────────── */
  function writeDocument(html) {
    var app = document.getElementById('app-content');

    if (!app) return;

    /*
     * Parse backend HTML
     */
    var template = document.createElement('template');

    template.innerHTML = String(html || '');

    /*
     * Get scripts
     */
    var scripts = Array.from(
      template.content.querySelectorAll('script')
    );

    /*
     * Remove scripts before inserting HTML
     */
    scripts.forEach(function (script) {
      script.remove();
    });

    /*
     * Insert backend HTML
     */
    app.replaceChildren(
      template.content.cloneNode(true)
    );

    /*
     * Execute backend scripts
     */
    scripts.forEach(function (oldScript) {
      var newScript = document.createElement('script');

      /*
       * Copy attributes
       */
      Array.from(oldScript.attributes).forEach(function (attr) {
        newScript.setAttribute(
          attr.name,
          attr.value
        );
      });

      /*
       * Inline script
       */
      if (!oldScript.src) {
        newScript.textContent =
          oldScript.textContent || '';
      } else {
        /*
         * External script
         */
        newScript.src = oldScript.src;
      }

      /*
       * Classic script → global scope
       */
      document.body.appendChild(newScript);
    });
  }

  /* ── Error Page ───────────────────────────────── */
  function errorPage(msg) {
    return '<!DOCTYPE html>' +
      '<html><head><meta charset="utf-8"><title>Error</title>' +
      '<style>' +
        'body{min-height:100vh;display:flex;align-items:center;justify-content:center;' +
        'flex-direction:column;gap:1rem;font-family:system-ui;background:#f5f5f5}' +
        'h2{font-size:1.4rem}' +
        'p{color:#888;font-size:.9rem}' +
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

      if (r.csrfToken) {
        csrfToken = r.csrfToken;
      }
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

    try {
      var ok = await ensureAuth();

      if (!ok) {
        window.location.href = '/login';
        return;
      }

      var res = await api(
        'GET',
        '/pages/' + encodeURIComponent(slug)
      );

      if (!res.success) {
        writeDocument(errorPage(res.error));
        return;
      }

      /*
       * Backend response:
       *
       * res.data.content
       *
       * এখানে HTML + script আছে
       */
      writeDocument(res.data.content);

    } catch (err) {
      var app = document.getElementById('app-content');

      if (app) {
        app.innerHTML =
          '<h2>Something went wrong.</h2>';
      }
    }
  }

  /* ── Login ─────────────────────────────────────── */
  async function initLogin() {
    if (!csrfToken) {
      var r = await api('GET', '/auth/csrf');

      if (r.csrfToken) {
        csrfToken = r.csrfToken;
      }
    }

    var me = await api('GET', '/auth/me');

    if (me.success) {
      window.location.href = '/home';
    }
  }

  async function login(isAdmin) {
    var username =
      document.getElementById('login-username').value.trim();

    var password =
      document.getElementById('login-password').value;

    var errEl =
      document.getElementById('login-error');

    var btn =
      document.getElementById('login-btn');

    errEl.style.display = 'none';

    if (!username || !password) {
      errEl.textContent =
        'Enter username and password.';

      errEl.style.display = 'block';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Signing in...';

    try {
      var res = await api(
        'POST',
        isAdmin
          ? '/auth/admin-login'
          : '/auth/login',
        {
          username: username,
          password: password
        }
      );

      if (res.success) {
        resetSession();

        window.location.href =
          isAdmin ? '/admin' : '/home';

        return;
      }

      errEl.textContent =
        res.error +
        (res.attemptsRemaining != null
          ? ' (' + res.attemptsRemaining + ' left)'
          : '');

      errEl.style.display = 'block';

      btn.disabled = false;
      btn.textContent = 'Sign In';

    } catch (err) {
      errEl.textContent =
        'Network error. Please try again.';

      errEl.style.display = 'block';

      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  }

  /* ── Logout ────────────────────────────────────── */
  async function logout() {
    try {
      await api('POST', '/auth/logout');
    } catch (err) {}

    resetSession();

    window.location.href = '/login';
  }

  /* ── Helpers ───────────────────────────────────── */
  function esc(s) {
    var d = document.createElement('div');

    d.textContent = s || '';

    return d.innerHTML;
  }

  /* ── Public API ────────────────────────────────── */
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

App.init();
