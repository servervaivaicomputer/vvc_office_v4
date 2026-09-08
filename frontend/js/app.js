const App = (function () {
  const API_BASE = '/api';
  let currentUser = null;

  function getCsrf() {
    const m = document.cookie.match(/csrf_token=([^;]+)/);
    return m ? m[1] : '';
  }

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

  function injectContent(container, html) {
    container.innerHTML = html;
    const scripts = container.querySelectorAll('script');
    scripts.forEach(old => {
      const s = document.createElement('script');
      if (old.src) { s.src = old.src; }
      else { s.textContent = old.textContent; }
      old.parentNode.replaceChild(s, old);
    });
  }

  function renderNav(user) {
    const nav = document.getElementById('navbar');
    if (!nav) return;
    const slug = getSlug();
    const links = [
      { href: '/home', label: 'Home' },
      { href: '/about', label: 'About' },
      { href: '/workspace', label: 'Workspace' }
    ];
    if (user?.isAdmin) links.push({ href: '/admin', label: 'Admin' });

    nav.innerHTML =
      '<div class="navbar">' +
        '<span class="nav-brand">SecureApp</span>' +
        '<div class="nav-links">' +
          (user ? '<span class="nav-user">' + esc(user.username) + '</span>' : '') +
          links.map(l => {
            const lSlug = l.href.replace(/^\/+|\/+$/g, '');
            return '<a href="' + l.href + '"' + (slug === lSlug ? ' class="active"' : '') + '>' + l.label + '</a>';
          }).join('') +
          (user ? '<button onclick="App.logout()">Logout</button>' : '<a href="/login">Login</a>') +
        '</div>' +
      '</div>';
  }

  function renderFooter() {
    const f = document.getElementById('footer');
    if (f) f.innerHTML = '<footer>&copy; ' + new Date().getFullYear() + ' SecureApp. All rights reserved.</footer>';
  }

  function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

  function showLoader(container) {
    container.innerHTML =
      '<div class="loader-wrap"><div class="loader"></div><p>Loading secure content...</p></div>';
  }

  /* URL থেকে slug বের করা: /about → about, / → home, /reports/quarterly → reports/quarterly */
  function getSlug() {
    let path = window.location.pathname.replace(/^\/+|\/+$/g, '');
    if (!path || path === 'home') return 'home';
    return path;
  }

  /* ══════════════════════════════════════════════════
     init() — প্রতিটি পেজ এই ফাংশন কল করে (login ব্যতীত)
     URL পড়ে slug নির্ধারণ করে, অথেন্টিকেশন চেক করে,
     তারপর ব্যাকএন্ড থেকে পেজ কন্টেন্ট আনে
     ══════════════════════════════════════════════════ */
  async function init() {
    const container = document.getElementById('app-content');
    if (!container) return;

    const slug = getSlug();

    /* login পেজ হলে আলাদাভাবে হ্যান্ডেল */
    if (slug === 'login') {
      await initLogin();
      return;
    }

    /* ১। CSRF টোকেন বুটস্ট্র্যাপ */
    await api('GET', '/auth/csrf');

    /* ২। অথেন্টিকেশন চেক */
    const me = await api('GET', '/auth/me');
    if (!me.success) {
      window.location.href = '/login';
      return;
    }
    currentUser = me.data.user;

    /* ৩। Navbar ও Footer রেন্ডার */
    renderNav(currentUser);
    renderFooter();

    /* ৪। ব্যাকএন্ড থেকে এই URL-এর পেজ কন্টেন্ট আনো */
    showLoader(container);
    const res = await api('GET', '/pages/' + slug);

    if (!res.success) {
      container.innerHTML =
        '<div class="card" style="text-align:center;margin-top:3rem">' +
          '<h2>Access Denied</h2>' +
          '<p style="margin:1rem 0;color:var(--text-muted)">' +
            esc(res.error || 'You do not have permission to view this page.') +
          '</p>' +
          '<a href="/home" class="btn btn-accent">Go Home</a>' +
        '</div>';
      return;
    }

    /* ৫। কন্টেন্ট ইনজেক্ট করো (script সহ) */
    injectContent(container, res.data.content);
  }

  /* ══════════════════════════════════════════════════
     Login পেজের জন্য আলাদা init
     ══════════════════════════════════════════════════ */
  async function initLogin() {
    await api('GET', '/auth/csrf');

    /* যদি আগে থেকে লগইন করা থাকে → home-এ পাঠাও */
    const me = await api('GET', '/auth/me');
    if (me.success) { window.location.href = '/home'; return; }

    renderNav(null);
    renderFooter();
  }

  /* ══════════════════════════════════════════════════
     Login সাবমিট
     ══════════════════════════════════════════════════ */
  async function login(isAdmin) {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    const btn = document.getElementById('login-btn');

    errEl.style.display = 'none';
    if (!username || !password) {
      errEl.textContent = 'Please enter username and password.';
      errEl.style.display = 'block';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Signing in...';

    const endpoint = isAdmin ? '/auth/admin-login' : '/auth/login';
    const res = await api('POST', endpoint, { username, password });

    if (res.success) {
      window.location.href = isAdmin ? '/admin' : '/home';
    } else {
      errEl.textContent = res.error +
        (res.attemptsRemaining != null ? ' (' + res.attemptsRemaining + ' attempts remaining)' : '');
      errEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  }

  /* ══════════════════════════════════════════════════
     Logout
     ══════════════════════════════════════════════════ */
  async function logout() {
    await api('POST', '/auth/logout');
    currentUser = null;
    window.location.href = '/login';
  }

  return { init, initLogin, login, logout, api, getCsrf, esc, getSlug };
})();
