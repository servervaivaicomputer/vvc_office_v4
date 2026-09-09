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

    if (!res.ok) {
      throw new Error('HTTP ' + res.status);
    }

    return await res.json();
  }

  /* ── Backend HTML Injection ────────────────────── */
  function writeDocument(html) {
    var app = document.getElementById('app-content');

    if (!app) {
      console.error('app-content not found');
      return;
    }

    try {
      /*
       * Parse backend HTML without executing scripts
       */
      var template = document.createElement('template');
      template.innerHTML = String(html || '');

      /*
       * Collect scripts BEFORE inserting content
       */
      var scripts = Array.from(
        template.content.querySelectorAll('script')
      );

      /*
       * Remove scripts from HTML.
       * They will be executed manually below.
       */
      scripts.forEach(function (script) {
        script.remove();
      });

      /*
       * Insert normal HTML
       */
      app.replaceChildren(
        template.content.cloneNode(true)
      );

      /*
       * Execute backend scripts as REAL classic scripts.
       *
       * This is important:
       * function test() {}
       * becomes window.test()
       *
       * Therefore:
       * onclick="test()"
       * works.
       */
      executeScripts(scripts);

    } catch (err) {
      console.error(
        'Page injection error:',
        err
      );
    }
  }

  /* ── Execute Backend Scripts ───────────────────── */
  function executeScripts(scripts) {
    if (!scripts || !scripts.length) return;

    var index = 0;

    function next() {
      if (index >= scripts.length) return;

      var oldScript = scripts[index++];
      var newScript = document.createElement('script');

      /*
       * Copy all script attributes
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
        newScript.text = oldScript.textContent || '';

        /*
         * Append to document.
         * Classic script executes in global scope.
         */
        document.body.appendChild(newScript);

        /*
         * Remove after execution.
         * Functions/variables declared by a classic
         * script remain available globally.
         */
        newScript.remove();

        next();
        return;
      }

      /*
       * External script
       * Keep execution order.
       */
      newScript.onload = function () {
        newScript.remove();
        next();
      };

      newScript.onerror = function () {
        console.error(
          'Failed to load script:',
          oldScript.src
        );

        newScript.remove();
        next();
      };

      document.body.appendChild(newScript);
    }

    next();
  }

  /* ── Error page ───────────────────────────────── */
  function errorPage(msg) {
    return '<!DOCTYPE html>' +
      '<html><head><meta charset="utf-8"><title>Error</title>' +
      '<style>' +
        'body{min-height:100vh;display:flex;align-items:center;justify-content:center;' +
        'flex-direction:column;gap:1rem;font-family:system-ui;background:#f5f5f5}' +
        'h2{font-size:1.4rem}' +
        'p{color:#888;font-size:.9rem}' +
        'a{padding:.6rem 1.4rem;background:#333;color:#fff;' +
        'border-radius:6px;text-decoration:none}' +
      '</style></head>' +
      '<body><h2>Access Denied</h2>' +
      '<p>' + esc(msg || 'No permission') + '</p>' +
      '<a href="/home">Go Home</a></body></html>';
  }

  /* ── Slug ──────────────────────────────────────── */
  function getSlug() {
    var p = window.location.pathname
      .replace(/^\/+|\/+$/g, '');

    if (!p || p === 'home') {
      return 'home';
    }

    return p;
  }

  /* ── Auth ──────────────────────────────────────── */
  async function ensureAuth() {
    if (!csrfToken) {
      var r = await api(
        'GET',
        '/auth/csrf'
      );

      if (r.csrfToken) {
        csrfToken = r.csrfToken;
      }
    }

    if (!authChecked) {
      var me = await api(
        'GET',
        '/auth/me'
      );

      if (!me.success) {
        return false;
      }

      currentUser = me.data.user;
      authChecked = true;
    }

    return true;
  }

  /* ── Reset Session ────────────────────────────── */
  function resetSession() {
    currentUser = null;
    authChecked = false;
    csrfToken = null;
  }

  /* ── Init ──────────────────────────────────────── */
  async function init() {
    var slug = getSlug();

    /* Login page */
    if (slug === 'login') {
      await initLogin();
      return;
    }

    try {
      /* Auth check */
      var ok = await ensureAuth();

      if (!ok) {
        window.location.href = '/login';
        return;
      }

      /* Backend page */
      var res = await api(
        'GET',
        '/pages/' + encodeURIComponent(slug)
      );

      if (!res.success) {
        writeDocument(
          errorPage(res.error)
        );
        return;
      }

      /*
       * Inject backend content
       * No document.open()
       * No document.write()
       * No new window
       */
      writeDocument(
        res.data.content
      );

    } catch (err) {
      console.error(
        'App init error:',
        err
      );

      var app = document.getElementById(
        'app-content'
      );

      if (app) {
        app.innerHTML =
          '<h2>Something went wrong.</h2>';
      }
    }
  }

  /* ── Login Init ───────────────────────────────── */
  async function initLogin() {
    try {
      if (!csrfToken) {
        var r = await api(
          'GET',
          '/auth/csrf'
        );

        if (r.csrfToken) {
          csrfToken = r.csrfToken;
        }
      }

      var me = await api(
        'GET',
        '/auth/me'
      );

      if (me.success) {
        window.location.href = '/home';
      }

    } catch (err) {
      console.error(
        'Login init error:',
        err
      );
    }
  }

  /* ── Login ────────────────────────────────────── */
  async function login(isAdmin) {
    var username =
      document
        .getElementById('login-username')
        .value
        .trim();

    var password =
      document
        .getElementById('login-password')
        .value;

    var errEl =
      document.getElementById(
        'login-error'
      );

    var btn =
      document.getElementById(
        'login-btn'
      );

    errEl.style.display = 'none';

    if (!username || !password) {
      errEl.textContent =
        'Enter username and password.';

      errEl.style.display =
        'block';

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
          isAdmin
            ? '/admin'
            : '/home';

        return;
      }

      errEl.textContent =
        res.error +
        (
          res.attemptsRemaining != null
            ? ' (' +
              res.attemptsRemaining +
              ' left)'
            : ''
        );

      errEl.style.display =
        'block';

      btn.disabled = false;
      btn.textContent =
        'Sign In';

    } catch (err) {
      console.error(
        'Login error:',
        err
      );

      errEl.textContent =
        'Network error. Please try again.';

      errEl.style.display =
        'block';

      btn.disabled = false;
      btn.textContent =
        'Sign In';
    }
  }

  /* ── Logout ───────────────────────────────────── */
  async function logout() {
    try {
      await api(
        'POST',
        '/auth/logout'
      );
    } catch (err) {
      console.error(
        'Logout error:',
        err
      );
    }

    resetSession();

    window.location.href =
      '/login';
  }

  /* ── Helpers ──────────────────────────────────── */
  function esc(s) {
    var d =
      document.createElement('div');

    d.textContent =
      s || '';

    return d.innerHTML;
  }

  /* ── Public API ───────────────────────────────── */
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
