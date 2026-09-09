const App = (function () {
  const API_BASE = '/api';

  let currentUser = null;
  let csrfToken = null;
  let authChecked = false;

  /* ── Debug Logger ─────────────────────────────── */
  function log(step, data) {
    console.log(
      '%c[APP] ' + step,
      'color:#2196f3;font-weight:bold;',
      data !== undefined ? data : ''
    );
  }

  function logError(step, error) {
    console.error(
      '[APP ERROR] ' + step,
      error
    );
  }

  log('app.js loaded');

  /* ── CSRF ─────────────────────────────────────── */
  function getCsrf() {
    log('Getting CSRF token');

    if (csrfToken) {
      log('Using cached CSRF token');
      return csrfToken;
    }

    var m = document.cookie.match(
      /(?:^|;\s*)csrf_token=([^;]+)/
    );

    var token = m
      ? decodeURIComponent(m[1])
      : '';

    log('CSRF cookie found:', !!token);

    return token;
  }

  /* ── API ──────────────────────────────────────── */
  async function api(method, path, body) {

    log('API REQUEST', {
      method: method,
      path: path,
      body: body || null
    });

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

    try {

      var res = await fetch(
        API_BASE + path,
        opts
      );

      log('API STATUS', {
        status: res.status,
        ok: res.ok,
        url: res.url
      });

      var text = await res.text();

      log('API RAW RESPONSE', text);

      var data;

      try {
        data = JSON.parse(text);
      } catch (e) {
        logError(
          'API JSON parse failed',
          e
        );

        throw new Error(
          'Server returned invalid JSON'
        );
      }

      log('API JSON RESPONSE', data);

      return data;

    } catch (err) {

      logError(
        'API request failed',
        err
      );

      throw err;
    }
  }

  /* ── Backend HTML Injection ───────────────────── */
  function writeDocument(html) {

    log('========== PAGE INJECTION START ==========');

    var app =
      document.getElementById(
        'app-content'
      );

    if (!app) {
      logError(
        '#app-content not found'
      );
      return;
    }

    log(
      '#app-content found',
      app
    );

    /*
     * Show exactly what backend sent
     */
    log(
      'BACKEND CONTENT LENGTH',
      String(html || '').length
    );

    console.group(
      '%cBACKEND CONTENT',
      'color:#9c27b0;font-weight:bold;'
    );

    console.log(
      String(html || '')
    );

    console.groupEnd();


    try {

      /*
       * Parse HTML
       */
      var template =
        document.createElement(
          'template'
        );

      template.innerHTML =
        String(html || '');

      log(
        'HTML parsed successfully'
      );


      /*
       * Find scripts
       */
      var scripts =
        Array.from(
          template.content
            .querySelectorAll('script')
        );

      log(
        'Scripts found',
        scripts.length
      );


      scripts.forEach(
        function (script, index) {

          log(
            'SCRIPT #' + (index + 1),
            {
              src: script.src || null,
              type: script.type || 'classic',
              content:
                script.textContent
            }
          );

        }
      );


      /*
       * Remove scripts from fragment
       */
      scripts.forEach(
        function (script) {
          script.remove();
        }
      );

      log(
        'Scripts temporarily removed'
      );


      /*
       * Insert HTML
       */
      app.replaceChildren(
        template.content.cloneNode(true)
      );

      log(
        'Backend HTML inserted into #app-content'
      );


      /*
       * Check inserted HTML
       */
      log(
        'Current #app-content HTML',
        app.innerHTML
      );


      /*
       * Execute scripts
       */
      scripts.forEach(
        function (script, index) {

          log(
            'Executing script #' +
            (index + 1)
          );

          runScript(
            script,
            index + 1
          );

        }
      );


      /*
       * Check test function
       */
      setTimeout(function () {

        log(
          'Checking window.test',
          typeof window.test
        );

        if (typeof window.test === 'function') {

          console.log(
            '%c✓ window.test EXISTS',
            'color:green;font-weight:bold;'
          );

        } else {

          console.warn(
            '%c✗ window.test NOT FOUND',
            'color:red;font-weight:bold;'
          );

        }

        log(
          '========== PAGE INJECTION END =========='
        );

      }, 0);

    } catch (err) {

      logError(
        'PAGE INJECTION FAILED',
        err
      );

    }
  }


  /* ── Execute Script ───────────────────────────── */
  function runScript(
    oldScript,
    number
  ) {

    log(
      'Preparing script #' + number
    );

    var script =
      document.createElement(
        'script'
      );

    /*
     * Classic script
     */
    script.type =
      'text/javascript';


    /*
     * Copy attributes
     */
    Array.from(
      oldScript.attributes
    ).forEach(
      function (attr) {

        if (
          attr.name.toLowerCase() !==
          'type'
        ) {

          script.setAttribute(
            attr.name,
            attr.value
          );

        }

      }
    );


    /*
     * External script
     */
    if (oldScript.src) {

      log(
        'External script detected',
        oldScript.src
      );

      script.onload =
        function () {

          log(
            'External script loaded',
            oldScript.src
          );

        };

      script.onerror =
        function (err) {

          logError(
            'External script failed',
            oldScript.src
          );

        };

      script.src =
        oldScript.src;

      document.head.appendChild(
        script
      );

      return;
    }


    /*
     * Inline script
     */
    var code =
      oldScript.textContent || '';

    log(
      'Inline script length',
      code.length
    );

    console.group(
      '%cSCRIPT #' + number + ' CODE',
      'color:#ff9800;font-weight:bold;'
    );

    console.log(code);

    console.groupEnd();


    /*
     * Execute as classic global script
     */
    script.textContent = code;


    try {

      document.head.appendChild(
        script
      );

      log(
        'Script #' + number +
        ' appended to document.head'
      );

    } catch (err) {

      logError(
        'Script #' + number +
        ' execution failed',
        err
      );

    }
  }


  /* ── Error Page ───────────────────────────────── */
  function errorPage(msg) {

    log(
      'Generating error page',
      msg
    );

    return '<!DOCTYPE html>' +
      '<html>' +
      '<head>' +
      '<meta charset="utf-8">' +
      '<title>Error</title>' +
      '<style>' +
        'body{' +
          'min-height:100vh;' +
          'display:flex;' +
          'align-items:center;' +
          'justify-content:center;' +
          'flex-direction:column;' +
          'gap:1rem;' +
          'font-family:system-ui;' +
          'background:#f5f5f5' +
        '}' +
        'h2{font-size:1.4rem}' +
        'p{color:#888;font-size:.9rem}' +
        'a{' +
          'padding:.6rem 1.4rem;' +
          'background:#333;' +
          'color:#fff;' +
          'border-radius:6px;' +
          'text-decoration:none' +
        '}' +
      '</style>' +
      '</head>' +
      '<body>' +
      '<h2>Access Denied</h2>' +
      '<p>' +
      esc(msg || 'No permission') +
      '</p>' +
      '<a href="/home">Go Home</a>' +
      '</body>' +
      '</html>';
  }


  /* ── Slug ─────────────────────────────────────── */
  function getSlug() {

    var path =
      window.location.pathname;

    log(
      'Current pathname',
      path
    );

    var p =
      path.replace(
        /^\/+|\/+$/g,
        ''
      );

    if (!p || p === 'home') {

      log(
        'Resolved slug',
        'home'
      );

      return 'home';
    }

    log(
      'Resolved slug',
      p
    );

    return p;
  }


  /* ── Auth ─────────────────────────────────────── */
  async function ensureAuth() {

    log(
      '========== AUTH CHECK START =========='
    );

    try {

      if (!csrfToken) {

        log(
          'Fetching CSRF token'
        );

        var r =
          await api(
            'GET',
            '/auth/csrf'
          );

        log(
          'CSRF response',
          r
        );

        if (r.csrfToken) {

          csrfToken =
            r.csrfToken;

          log(
            'CSRF token saved'
          );

        }

      }


      if (!authChecked) {

        log(
          'Checking current user'
        );

        var me =
          await api(
            'GET',
            '/auth/me'
          );

        log(
          'Auth/me response',
          me
        );

        if (!me.success) {

          log(
            'Authentication failed'
          );

          return false;
        }

        currentUser =
          me.data.user;

        authChecked = true;

        log(
          'Authenticated user',
          currentUser
        );

      } else {

        log(
          'Auth already checked'
        );

      }

      log(
        '========== AUTH CHECK SUCCESS =========='
      );

      return true;

    } catch (err) {

      logError(
        'Authentication error',
        err
      );

      return false;
    }
  }


  /* ── Reset Session ────────────────────────────── */
  function resetSession() {

    log(
      'Resetting session'
    );

    currentUser = null;
    authChecked = false;
    csrfToken = null;
  }


  /* ── Init ─────────────────────────────────────── */
  async function init() {

    console.group(
      '%c[APP] INITIALIZATION',
      'color:#4caf50;font-size:14px;font-weight:bold;'
    );

    try {

      var slug =
        getSlug();

      log(
        'Init slug',
        slug
      );


      /*
       * Login
       */
      if (slug === 'login') {

        log(
          'Login page detected'
        );

        await initLogin();

        console.groupEnd();

        return;
      }


      /*
       * Auth
       */
      var ok =
        await ensureAuth();

      log(
        'Authentication result',
        ok
      );

      if (!ok) {

        log(
          'Redirecting to /login'
        );

        window.location.href =
          '/login';

        console.groupEnd();

        return;
      }


      /*
       * Fetch backend page
       */
      var endpoint =
        '/pages/' +
        encodeURIComponent(slug);

      log(
        'Fetching page',
        endpoint
      );

      var res =
        await api(
          'GET',
          endpoint
        );

      log(
        'Page API response',
        res
      );


      /*
       * Error
       */
      if (!res.success) {

        log(
          'Backend returned error',
          res.error
        );

        writeDocument(
          errorPage(
            res.error
          )
        );

        console.groupEnd();

        return;
      }


      /*
       * Validate content
       */
      if (
        !res.data ||
        typeof res.data.content !==
        'string'
      ) {

        logError(
          'Invalid backend content',
          res.data
        );

        console.groupEnd();

        return;
      }


      log(
        'Backend content received successfully'
      );


      /*
       * Inject
       */
      writeDocument(
        res.data.content
      );

    } catch (err) {

      logError(
        'INIT FAILED',
        err
      );

      var app =
        document.getElementById(
          'app-content'
        );

      if (app) {

        app.innerHTML =
          '<h2>Something went wrong.</h2>';

      }

    }

    console.groupEnd();
  }


  /* ── Login Init ───────────────────────────────── */
  async function initLogin() {

    log(
      'Login initialization'
    );

    try {

      if (!csrfToken) {

        var r =
          await api(
            'GET',
            '/auth/csrf'
          );

        if (r.csrfToken) {
          csrfToken =
            r.csrfToken;
        }

      }

      var me =
        await api(
          'GET',
          '/auth/me'
        );

      log(
        'Login auth response',
        me
      );

      if (me.success) {

        log(
          'Already logged in → /home'
        );

        window.location.href =
          '/home';
      }

    } catch (err) {

      logError(
        'Login initialization failed',
        err
      );

    }
  }


  /* ── Login ────────────────────────────────────── */
  async function login(isAdmin) {

    log(
      'Login attempt',
      {
        isAdmin: isAdmin
      }
    );

    var username =
      document
        .getElementById(
          'login-username'
        )
        .value
        .trim();

    var password =
      document
        .getElementById(
          'login-password'
        )
        .value;

    var errEl =
      document.getElementById(
        'login-error'
      );

    var btn =
      document.getElementById(
        'login-btn'
      );

    errEl.style.display =
      'none';


    if (!username || !password) {

      log(
        'Login validation failed'
      );

      errEl.textContent =
        'Enter username and password.';

      errEl.style.display =
        'block';

      return;
    }


    btn.disabled = true;
    btn.textContent =
      'Signing in...';


    try {

      var res =
        await api(
          'POST',
          isAdmin
            ? '/auth/admin-login'
            : '/auth/login',
          {
            username: username,
            password: password
          }
        );


      log(
        'Login response',
        res
      );


      if (res.success) {

        log(
          'Login successful'
        );

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

      logError(
        'Login failed',
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

    log(
      'Logout started'
    );

    try {

      var res =
        await api(
          'POST',
          '/auth/logout'
        );

      log(
        'Logout response',
        res
      );

    } catch (err) {

      logError(
        'Logout error',
        err
      );

    }

    resetSession();

    log(
      'Redirecting to /login'
    );

    window.location.href =
      '/login';
  }


  /* ── Helpers ──────────────────────────────────── */
  function esc(s) {

    var d =
      document.createElement(
        'div'
      );

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


/* ── Start ───────────────────────────────────────── */
console.log(
  '%c[APP] Starting App.init()',
  'color:#4caf50;font-weight:bold;'
);

App.init();
