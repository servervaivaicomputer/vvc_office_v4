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

  /* ══════════════════════════════════════════════════
     injectContent()

     HTML-এর ভিতরের:
     - <style>
     - <script>
     - external JS
     - inline JS

     আলাদা করে process করা হয়।

     External JS সম্পূর্ণ load হওয়ার পরে
     inline JS execute হবে।
     ══════════════════════════════════════════════════ */
  async function injectContent(container, html) {

    if (!html || typeof html !== 'string') {
      container.innerHTML = '';
      return;
    }

    /* ── 1. Styles extract ── */
    var styleRegex = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
    var styleMatch;
    var styleContents = [];

    while ((styleMatch = styleRegex.exec(html)) !== null) {
      styleContents.push(styleMatch[1]);
    }

    /* ── 2. Scripts extract ── */
    var scriptTagRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    var scriptMatch;

    var inlineScripts = [];
    var externalScripts = [];

    while ((scriptMatch = scriptTagRegex.exec(html)) !== null) {

      var attrs = scriptMatch[1] || '';
      var code = scriptMatch[2] || '';

      var srcMatch = attrs.match(
        /\bsrc\s*=\s*["']([^"']+)["']/i
      );

      if (srcMatch) {

        externalScripts.push({
          src: srcMatch[1],
          attrs: attrs
        });

      } else if (code.trim()) {

        /* JSON-LD / non-JS scripts ignore */
        var typeMatch = attrs.match(
          /\btype\s*=\s*["']([^"']+)["']/i
        );

        var type = typeMatch
          ? typeMatch[1].toLowerCase().trim()
          : '';

        if (
          !type ||
          type === 'text/javascript' ||
          type === 'application/javascript' ||
          type === 'application/ecmascript' ||
          type === 'text/ecmascript' ||
          type === 'module'
        ) {
          inlineScripts.push({
            code: code,
            attrs: attrs
          });
        }
      }
    }

    /* ── 3. Script + style remove ── */
    var cleanHtml = html
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .trim();

    /* ── 4. Old injected styles clear ── */
    clearInjectedStyles();

    /* ── 5. New styles → document.head ── */
    for (var i = 0; i < styleContents.length; i++) {

      var s = document.createElement('style');

      s.textContent = styleContents[i];
      s.setAttribute('data-pg', '1');

      document.head.appendChild(s);
    }

    /* ── 6. Clean HTML → container ── */
    container.innerHTML = cleanHtml;

    /* ── 7. External scripts load sequentially ── */
    for (var j = 0; j < externalScripts.length; j++) {

      await loadExternalScript(
        externalScripts[j].src,
        externalScripts[j].attrs
      );
    }

    /* ── 8. Inline scripts execute ── */
    for (var k = 0; k < inlineScripts.length; k++) {

      try {

        executeInlineScript(
          inlineScripts[k].code,
          inlineScripts[k].attrs
        );

      } catch (err) {

        console.error(
          '[App] Inline script error:',
          err
        );
      }
    }

    /* ── 9. Injected page lifecycle event ── */
    try {

      document.dispatchEvent(
        new CustomEvent('page:loaded', {
          detail: {
            container: container
          }
        })
      );

    } catch (err) {

      console.error(
        '[App] page:loaded event error:',
        err
      );
    }
  }

  /* ── External Script Loader ────────────────────── */
  function loadExternalScript(src, attrs) {

    return new Promise(function (resolve) {

      if (!src) {
        resolve();
        return;
      }

      /*
       * একই script আগে load করা থাকলে
       * আবার load না করার চেষ্টা।
       */
      var existing = document.querySelector(
        'script[data-pg-src="' +
        CSS.escape(src) +
        '"]'
      );

      if (existing) {
        if (existing.dataset.pgLoaded === '1') {
          resolve();
          return;
        }

        existing.addEventListener(
          'load',
          resolve,
          { once: true }
        );

        existing.addEventListener(
          'error',
          resolve,
          { once: true }
        );

        return;
      }

      var script = document.createElement('script');

      script.src = src;

      script.setAttribute(
        'data-pg',
        '1'
      );

      script.setAttribute(
        'data-pg-src',
        src
      );

      /*
       * Original attributes থেকে useful attributes copy।
       */
      var typeMatch = attrs.match(
        /\btype\s*=\s*["']([^"']+)["']/i
      );

      if (typeMatch) {
        script.type = typeMatch[1];
      }

      var asyncMatch = /\basync\b/i.test(attrs);
      var deferMatch = /\bdefer\b/i.test(attrs);

      /*
       * Original script-এর async/defer এখানে ইচ্ছাকৃতভাবে
       * sequential loader-এর সাথে compatible রাখা হচ্ছে।
       */
      if (asyncMatch) {
        script.async = false;
      }

      if (deferMatch) {
        script.defer = false;
      }

      script.onload = function () {

        script.dataset.pgLoaded = '1';

        resolve();
      };

      script.onerror = function () {

        console.error(
          '[App] Failed to load external script:',
          src
        );

        /*
         * একটা external JS fail করলেও
         * পরের script/inline JS যেন execute করতে পারে।
         */
        resolve();
      };

      document.head.appendChild(script);
    });
  }

  /* ── Inline Script Executor ────────────────────── */
  function executeInlineScript(code, attrs) {

    /*
     * module script হলে dynamic module হিসেবে execute।
     */
    var typeMatch = attrs.match(
      /\btype\s*=\s*["']([^"']+)["']/i
    );

    var type = typeMatch
      ? typeMatch[1].toLowerCase().trim()
      : '';

    if (type === 'module') {

      var blob = new Blob(
        [code],
        { type: 'text/javascript' }
      );

      var url = URL.createObjectURL(blob);

      var script = document.createElement('script');

      script.type = 'module';
      script.src = url;
      script.setAttribute('data-pg', '1');

      script.onload = function () {
        URL.revokeObjectURL(url);
      };

      script.onerror = function (err) {
        console.error(
          '[App] Module script error:',
          err
        );

        URL.revokeObjectURL(url);
      };

      document.head.appendChild(script);

      return;
    }

    /*
     * Normal inline JS.
     *
     * Indirect eval → global scope।
     */
    (0, eval)(code);
  }

  /* ── Old styles clear ──────────────────────────── */
  function clearInjectedStyles() {

    var old = document.querySelectorAll(
      'style[data-pg]'
    );

    for (var i = 0; i < old.length; i++) {
      old[i].remove();
    }
  }

  /* ── Loader ────────────────────────────────────── */
  function showLoader(c) {

    c.innerHTML =
      '<div class="pg-loader">' +
        '<span></span>' +
        '<span></span>' +
        '<span></span>' +
      '</div>';
  }

  /* ── Access denied ─────────────────────────────── */
  function showDenied(c, msg) {

    c.innerHTML =
      '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:1rem">' +
        '<h2 style="font-size:1.4rem">Access Denied</h2>' +
        '<p style="color:#888;font-size:0.9rem">' +
          esc(msg || 'No permission') +
        '</p>' +
        '<a href="/home" style="padding:0.6rem 1.4rem;background:#333;color:#fff;border-radius:6px;text-decoration:none;font-size:0.9rem">' +
          'Go Home' +
        '</a>' +
      '</div>';
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

  /* ══════════════════════════════════════════════════
     init()
     ══════════════════════════════════════════════════ */
  async function init() {

    var c = document.getElementById(
      'app-content'
    );

    if (!c) {
      return;
    }

    injectBaseStyle();

    var slug = getSlug();

    /* ── Login page ── */
    if (slug === 'login') {

      await initLogin();

      return;
    }

    /* ── Auth loader ── */
    showLoader(c);

    var ok = await ensureAuth();

    if (!ok) {

      window.location.href = '/login';

      return;
    }

    /* ── Page load ── */
    showLoader(c);

    var res = await api(
      'GET',
      '/pages/' + encodeURIComponent(slug)
    );

    if (!res.success) {

      showDenied(
        c,
        res.error
      );

      return;
    }

    /*
     * IMPORTANT:
     * External JS load শেষ হওয়া পর্যন্ত wait করবে।
     */
    await injectContent(
      c,
      res.data.content
    );
  }

  /* ══════════════════════════════════════════════════
     initLogin()
     ══════════════════════════════════════════════════ */
  async function initLogin() {

    injectBaseStyle();

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
  }

  /* ══════════════════════════════════════════════════
     login()
     ══════════════════════════════════════════════════ */
  async function login(isAdmin) {

    var usernameEl = document.getElementById(
      'login-username'
    );

    var passwordEl = document.getElementById(
      'login-password'
    );

    var errEl = document.getElementById(
      'login-error'
    );

    var btn = document.getElementById(
      'login-btn'
    );

    if (!usernameEl || !passwordEl || !errEl || !btn) {
      console.error(
        '[App] Login elements not found.'
      );

      return;
    }

    var username =
      usernameEl.value.trim();

    var password =
      passwordEl.value;

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

      } else {

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
      }

    } catch (err) {

      console.error(
        '[App] Login error:',
        err
      );

      errEl.textContent =
        'Something went wrong. Please try again.';

      errEl.style.display =
        'block';

      btn.disabled = false;
      btn.textContent =
        'Sign In';
    }
  }

  /* ══════════════════════════════════════════════════
     logout()
     ══════════════════════════════════════════════════ */
  async function logout() {

    try {

      await api(
        'POST',
        '/auth/logout'
      );

    } catch (err) {

      console.error(
        '[App] Logout error:',
        err
      );
    }

    resetSession();

    window.location.href =
      '/login';
  }

  /* ── Escape HTML ───────────────────────────────── */
  function esc(s) {

    var d = document.createElement(
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
    getSlug: getSlug,
    injectContent: injectContent
  };

})();
