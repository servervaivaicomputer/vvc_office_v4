const router = require('express').Router();
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const db = require('../database/database');
const {
  generateToken, generateCsrfToken,
  authenticate, authenticateAdmin, verifyCsrf,
  getClientIp, getDeviceName, MAX_FAILED
} = require('../middleware/auth');

/* ═══════════════════════════════════════════════════
   CSRF HELPER
   ═══════════════════════════════════════════════════ */

function setCsrfCookie(res) {
  const t = generateCsrfToken();
  const isProduction = process.env.NODE_ENV === 'production';

  res.cookie('csrf_token', t, {
    httpOnly: false,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: 864e5,
    path: '/'
  });

  return t;
}

/* ═══════════════════════════════════════════════════
   AUTH COOKIE HELPER
   ═══════════════════════════════════════════════════ */

function setAuthCookies(res, user) {
  const token = generateToken(user);
  const csrf = generateCsrfToken();
  const isProduction = process.env.NODE_ENV === 'production';

  res.cookie('token', token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: 864e5,
    path: '/'
  });

  res.cookie('csrf_token', csrf, {
    httpOnly: false,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: 864e5,
    path: '/'
  });
}

/* ═══════════════════════════════════════════════════
   SAFE USER SERIALIZER
   ═══════════════════════════════════════════════════ */

function safeUser(u) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    role: u.roles?.name,
    isAdmin: u.roles?.is_admin || false,
    isBlocked: u.is_blocked,
    blockedAt: u.blocked_at,
    failedLoginAttempts: u.failed_login_attempts,
    lastLogin: u.last_login,
    lastActivity: u.last_activity,
    createdAt: u.created_at
  };
}

/* ═══════════════════════════════════════════════════
   AUTH ROUTES
   ═══════════════════════════════════════════════════ */

/* ── CSRF bootstrap ───────────────────────────────── */
router.get('/auth/csrf', (_req, res) => {
  const t = setCsrfCookie(res);
  res.json({ success: true, csrfToken: t });
});

/* ── Regular login ────────────────────────────────── */
router.post('/auth/login', verifyCsrf, async (req, res) => {
  try {
    const { username, password } = req.body;
    const ip = getClientIp(req);
    const device = getDeviceName(req);

    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ success: false, error: 'Username and password are required' });
    }

    const user = await db.findUserByUsername(username.trim());

    if (!user) {
      await db.logFailedAttempt(username, ip, device);
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    if (user.is_blocked) {
      return res.status(403).json({ success: false, error: 'Account is blocked. Contact administrator.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      const attempts = (user.failed_login_attempts || 0) + 1;
      await db.updateLoginAttempts(user.id, attempts);
      await db.logFailedAttempt(username, ip, device);

      if (attempts >= MAX_FAILED) {
        await db.blockUser(user.id);
        await db.logActivity(user.id, 'AUTO_BLOCKED', `Blocked after ${MAX_FAILED} failed attempts`, ip, device);
        return res.status(403).json({ success: false, error: `Account blocked after ${MAX_FAILED} failed attempts.` });
      }

      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
        attemptsRemaining: MAX_FAILED - attempts
      });
    }

    await db.resetLoginAttempts(user.id);
    await db.updateLastLogin(user.id);
    await db.logActivity(user.id, 'LOGIN', 'Successful login', ip, device);

    setAuthCookies(res, user);
    res.json({ success: true, data: { user: safeUser(user) } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/* ── Admin login ──────────────────────────────────── */
router.post('/auth/admin-login', verifyCsrf, async (req, res) => {
  try {
    const { username, password } = req.body;
    const ip = getClientIp(req);
    const device = getDeviceName(req);

    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Credentials required' });
    }

    const user = await db.findUserByUsername(username.trim());

    if (!user) {
      await db.logFailedAttempt(username, ip, device);
      return res.status(401).json({ success: false, error: 'Invalid admin credentials — user not found' });
    }

    if (user.is_blocked) {
      return res.status(403).json({ success: false, error: 'Account is blocked' });
    }

    if (!user.roles?.is_admin) {
      await db.logActivity(user.id, 'ADMIN_LOGIN_DENIED', 'Non-admin admin-login attempt', ip, device);
      return res.status(403).json({
        success: false,
        error: 'Admin access required — your role is: ' + (user.roles?.name || 'unknown')
      });
    }

    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      const attempts = (user.failed_login_attempts || 0) + 1;
      await db.updateLoginAttempts(user.id, attempts);
      await db.logFailedAttempt(username, ip, device);

      if (attempts >= MAX_FAILED) {
        await db.blockUser(user.id);
        await db.logActivity(user.id, 'AUTO_BLOCKED', `Blocked after ${MAX_FAILED} failed attempts`, ip, device);
        return res.status(403).json({ success: false, error: 'Account blocked.' });
      }

      return res.status(401).json({ success: false, error: 'Invalid admin credentials — wrong password' });
    }

    await db.resetLoginAttempts(user.id);
    await db.updateLastLogin(user.id);
    await db.logActivity(user.id, 'ADMIN_LOGIN', 'Admin login', ip, device);

    setAuthCookies(res, user);
    res.json({ success: true, data: { user: { ...safeUser(user), isAdmin: true } } });
  } catch (err) {
    console.error('[ADMIN LOGIN] Error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/* ── Logout ───────────────────────────────────────── */
router.post('/auth/logout', authenticate, async (req, res) => {
  const ip = getClientIp(req);
  const device = getDeviceName(req);

  await db.logActivity(req.user.id, 'LOGOUT', 'Logged out', ip, device).catch(() => {});

  res.clearCookie('token', { path: '/' });
  res.clearCookie('csrf_token', { path: '/' });
  res.json({ success: true });
});

/* ── Current user ─────────────────────────────────── */
router.get('/auth/me', authenticate, async (req, res) => {
  const permissions = await db.getUserPagePermissions(req.user.id);
  res.json({
    success: true,
    data: { user: { ...safeUser(req.user), permissions } }
  });
});

/* ═══════════════════════════════════════════════════
   TEMPORARY SEED — admin create / password reset
   Admin create হওয়ার পর এই route মুছে ফেলো
   ═══════════════════════════════════════════════════ */

router.post('/seed/admin', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ success: false, error: 'username, email, password required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ success: false, error: 'Password minimum 8 characters' });
    }

    const rounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    const hash = await bcrypt.hash(password, rounds);

    console.log('[SEED] Hash generated for:', username);

    const existing = await db.findUserByUsername(username);

    if (existing) {
      console.log('[SEED] User exists, resetting password...');

      const { error } = await db.supabase
        .from('users')
        .update({
          password_hash: hash,
          email: email.trim().toLowerCase(),
          role_id: 1,
          is_blocked: false,
          blocked_at: null,
          failed_login_attempts: 0,
          updated_at: new Date().toISOString()
        })
        .eq('username', username);

      if (error) {
        console.error('[SEED] Update error:', error);
        throw error;
      }

      console.log('[SEED] Password reset done for:', username);

      return res.json({
        success: true,
        message: 'Password reset done. Now try login with your new password.',
        data: { username, role: 'admin', action: 'password_reset' }
      });
    }

    console.log('[SEED] Creating new admin user:', username);

    const user = await db.createUser({
      username: username.trim(),
      email: email.trim().toLowerCase(),
      passwordHash: hash,
      roleId: 1
    });

    console.log('[SEED] Admin created:', user.id);

    res.status(201).json({
      success: true,
      message: 'Admin created successfully.',
      data: { id: user.id, username: user.username, role: 'admin', action: 'created' }
    });
  } catch (err) {
    console.error('[SEED] Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ═══════════════════════════════════════════════════
   PROTECTED PAGE CONTENT
   ═══════════════════════════════════════════════════ */

router.get('/pages/:slug', authenticate, async (req, res) => {
  try {
    const slug = req.params.slug;
    const ip = getClientIp(req);
    const device = getDeviceName(req);

    if (!/^[a-z0-9-]+$/.test(slug)) {
      return res.status(400).json({ success: false, error: 'Invalid page slug' });
    }

    const allowed = await db.checkPagePermission(req.user.id, slug);

    if (!allowed) {
      await db.logActivity(req.user.id, 'ACCESS_DENIED', `Denied: ${slug}`, ip, device);
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const filePath = path.join(__dirname, '..', 'projects', slug, 'index.html');

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'Page not found' });
    }

    const content = fs.readFileSync(filePath, 'utf-8');

    await db.logView(slug, req.user.id, ip, device);
    await db.logActivity(req.user.id, 'PAGE_VIEW', `Viewed: ${slug}`, ip, device);

    res.json({
      success: true,
      data: {
        page: slug,
        content,
        user: { username: req.user.username, role: req.user.roles?.name }
      }
    });
  } catch (err) {
    console.error('Page error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/* ═══════════════════════════════════════════════════
   ADMIN — USERS
   ═══════════════════════════════════════════════════ */

/* ── List all users ───────────────────────────────── */
router.get('/admin/users', authenticateAdmin, async (_req, res) => {
  try {
    const users = await db.getAllUsers();
    res.json({
      success: true,
      data: users.map(u => ({
        id: u.id,
        username: u.username,
        email: u.email,
        role: u.roles?.name,
        isAdmin: u.roles?.is_admin,
        isBlocked: u.is_blocked,
        blockedAt: u.blocked_at,
        failedLoginAttempts: u.failed_login_attempts,
        lastLogin: u.last_login,
        lastActivity: u.last_activity,
        createdAt: u.created_at
      }))
    });
  } catch (err) {
    console.error('Get users error:', err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

/* ── Create user ──────────────────────────────────── */
router.post('/admin/users', authenticateAdmin, verifyCsrf, async (req, res) => {
  try {
    const { username, email, password, roleId } = req.body;
    const ip = getClientIp(req);
    const device = getDeviceName(req);

    if (!username || !email || !password) {
      return res.status(400).json({ success: false, error: 'All fields required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, error: 'Password min 8 characters' });
    }

    const hash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 12);
    const user = await db.createUser({
      username: username.trim(),
      email: email.trim().toLowerCase(),
      passwordHash: hash,
      roleId: roleId || 2
    });

    await db.logActivity(req.user.id, 'CREATE_USER', `Created: ${user.username}`, ip, device);
    res.status(201).json({ success: true, data: safeUser(user) });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ success: false, error: 'Username or email already exists' });
    }
    console.error('Create user error:', err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

/* ── Block user ───────────────────────────────────── */
router.post('/admin/users/:id/block', authenticateAdmin, verifyCsrf, async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ success: false, error: 'Cannot block yourself' });
    }

    const user = await db.blockUser(req.params.id);
    await db.logActivity(
      req.user.id, 'BLOCK_USER',
      `Blocked: ${user.username}`,
      getClientIp(req), getDeviceName(req)
    );
    res.json({ success: true, data: safeUser(user) });
  } catch (err) {
    console.error('Block user error:', err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

/* ── Unblock user ─────────────────────────────────── */
router.post('/admin/users/:id/unblock', authenticateAdmin, verifyCsrf, async (req, res) => {
  try {
    const user = await db.unblockUser(req.params.id);
    await db.logActivity(
      req.user.id, 'UNBLOCK_USER',
      `Unblocked: ${user.username}`,
      getClientIp(req), getDeviceName(req)
    );
    res.json({ success: true, data: safeUser(user) });
  } catch (err) {
    console.error('Unblock user error:', err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

/* ── Change user role ─────────────────────────────── */
router.put('/admin/users/:id/role', authenticateAdmin, verifyCsrf, async (req, res) => {
  try {
    const { roleId } = req.body;

    if (!roleId) {
      return res.status(400).json({ success: false, error: 'roleId required' });
    }

    const role = await db.findRoleById(roleId);
    if (!role) {
      return res.status(400).json({ success: false, error: 'Invalid role' });
    }

    if (req.params.id === req.user.id && !role.is_admin) {
      return res.status(400).json({ success: false, error: 'Cannot remove own admin role' });
    }

    const user = await db.updateUserRole(req.params.id, roleId);
    await db.logActivity(
      req.user.id, 'CHANGE_ROLE',
      `Changed ${user.username} to ${role.name}`,
      getClientIp(req), getDeviceName(req)
    );
    res.json({ success: true, data: safeUser(user) });
  } catch (err) {
    console.error('Change role error:', err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

/* ═══════════════════════════════════════════════════
   ADMIN — ROLES & PERMISSIONS
   ═══════════════════════════════════════════════════ */

/* ── Get all roles ────────────────────────────────── */
router.get('/admin/roles', authenticateAdmin, async (_req, res) => {
  try {
    res.json({ success: true, data: await db.getAllRoles() });
  } catch (err) {
    console.error('Get roles error:', err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

/* ── Get all permissions ──────────────────────────── */
router.get('/admin/permissions', authenticateAdmin, async (_req, res) => {
  try {
    const [userPerms, rolePerms] = await Promise.all([
      db.getAllPagePermissions(),
      db.getRolePagePermissions()
    ]);
    res.json({
      success: true,
      data: { userPermissions: userPerms, rolePermissions: rolePerms }
    });
  } catch (err) {
    console.error('Get permissions error:', err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

/* ── Grant page permission ────────────────────────── */
router.post('/admin/permissions/grant', authenticateAdmin, verifyCsrf, async (req, res) => {
  try {
    const { pageSlug, userId } = req.body;

    if (!pageSlug || !userId) {
      return res.status(400).json({ success: false, error: 'pageSlug and userId required' });
    }

    await db.grantPagePermission(pageSlug, userId, req.user.id);
    await db.logActivity(
      req.user.id, 'GRANT_PERM',
      `Granted ${pageSlug} to ${userId}`,
      getClientIp(req), getDeviceName(req)
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Grant permission error:', err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

/* ── Revoke page permission ───────────────────────── */
router.post('/admin/permissions/revoke', authenticateAdmin, verifyCsrf, async (req, res) => {
  try {
    const { pageSlug, userId } = req.body;

    if (!pageSlug || !userId) {
      return res.status(400).json({ success: false, error: 'pageSlug and userId required' });
    }

    await db.revokePagePermission(pageSlug, userId);
    await db.logActivity(
      req.user.id, 'REVOKE_PERM',
      `Revoked ${pageSlug} from ${userId}`,
      getClientIp(req), getDeviceName(req)
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Revoke permission error:', err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

/* ═══════════════════════════════════════════════════
   ADMIN — VIEWS, ACTIVITY, FAILED LOGINS, STATS
   ═══════════════════════════════════════════════════ */

/* ── View statistics ──────────────────────────────── */
router.get('/admin/views', authenticateAdmin, async (req, res) => {
  try {
    const { page, limit, offset } = req.query;
    const [stats, views] = await Promise.all([
      db.getViewStats(page || null),
      db.getViewsList(page || null, parseInt(limit) || 100, parseInt(offset) || 0)
    ]);
    res.json({ success: true, data: { stats, views } });
  } catch (err) {
    console.error('Get views error:', err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

/* ── Activity logs ────────────────────────────────── */
router.get('/admin/activity', authenticateAdmin, async (req, res) => {
  try {
    const logs = await db.getActivityLogs(
      parseInt(req.query.limit) || 100,
      parseInt(req.query.offset) || 0
    );
    res.json({ success: true, data: logs });
  } catch (err) {
    console.error('Get activity error:', err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

/* ── Failed login attempts ────────────────────────── */
router.get('/admin/failed-logins', authenticateAdmin, async (req, res) => {
  try {
    res.json({
      success: true,
      data: await db.getFailedLoginAttempts(parseInt(req.query.limit) || 100)
    });
  } catch (err) {
    console.error('Get failed logins error:', err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

/* ── Dashboard stats ──────────────────────────────── */
router.get('/admin/stats', authenticateAdmin, async (_req, res) => {
  try {
    const [dashboard, views] = await Promise.all([
      db.getDashboardStats(),
      db.getViewStats()
    ]);
    res.json({ success: true, data: { ...dashboard, views } });
  } catch (err) {
    console.error('Get stats error:', err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});


/* ═══════════════════════════════════════════════════
   ADMIN — CLEAR DATA
   ═══════════════════════════════════════════════════ */

/* ── Clear views by range ─────────────────────────── */
router.delete('/admin/clear/views/:range', authenticateAdmin, verifyCsrf, async (req, res) => {
  try {
    var range = req.params.range;
    var q = db.supabase.from('views').delete();

    if (range === 'today') {
      var today = new Date();
      today.setHours(0, 0, 0, 0);
      q = q.gte('viewed_at', today.toISOString());
    } else if (range === '7days') {
      q = q.gte('viewed_at', new Date(Date.now() - 7 * 864e5).toISOString());
    } else if (range === '30days') {
      q = q.gte('viewed_at', new Date(Date.now() - 30 * 864e5).toISOString());
    } else if (range === 'all') {
      q = q.neq('id', 0);
    } else {
      return res.status(400).json({ success: false, error: 'Invalid range. Use: today, 7days, 30days, all' });
    }

    var { error } = await q;
    if (error) throw error;

    await db.logActivity(req.user.id, 'CLEAR_VIEWS', 'Cleared views: ' + range, getClientIp(req), getDeviceName(req));
    res.json({ success: true, message: 'Views cleared: ' + range });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

/* ── Clear activity by range ──────────────────────── */
router.delete('/admin/clear/activity/:range', authenticateAdmin, verifyCsrf, async (req, res) => {
  try {
    var range = req.params.range;
    var q = db.supabase.from('activity_logs').delete();

    if (range === 'today') {
      var today = new Date();
      today.setHours(0, 0, 0, 0);
      q = q.gte('created_at', today.toISOString());
    } else if (range === '7days') {
      q = q.gte('created_at', new Date(Date.now() - 7 * 864e5).toISOString());
    } else if (range === '30days') {
      q = q.gte('created_at', new Date(Date.now() - 30 * 864e5).toISOString());
    } else if (range === 'all') {
      q = q.neq('id', 0);
    } else {
      return res.status(400).json({ success: false, error: 'Invalid range' });
    }

    var { error } = await q;
    if (error) throw error;

    await db.logActivity(req.user.id, 'CLEAR_ACTIVITY', 'Cleared activity: ' + range, getClientIp(req), getDeviceName(req));
    res.json({ success: true, message: 'Activity cleared: ' + range });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

/* ── Clear failed logins by range ─────────────────── */
router.delete('/admin/clear/failed/:range', authenticateAdmin, verifyCsrf, async (req, res) => {
  try {
    var range = req.params.range;
    var q = db.supabase.from('failed_login_attempts').delete();

    if (range === 'today') {
      var today = new Date();
      today.setHours(0, 0, 0, 0);
      q = q.gte('attempted_at', today.toISOString());
    } else if (range === '7days') {
      q = q.gte('attempted_at', new Date(Date.now() - 7 * 864e5).toISOString());
    } else if (range === '30days') {
      q = q.gte('attempted_at', new Date(Date.now() - 30 * 864e5).toISOString());
    } else if (range === 'all') {
      q = q.neq('id', 0);
    } else {
      return res.status(400).json({ success: false, error: 'Invalid range' });
    }

    var { error } = await q;
    if (error) throw error;

    await db.logActivity(req.user.id, 'CLEAR_FAILED', 'Cleared failed logins: ' + range, getClientIp(req), getDeviceName(req));
    res.json({ success: true, message: 'Failed logins cleared: ' + range });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

/* ── Clear everything ─────────────────────────────── */
router.delete('/admin/clear/all', authenticateAdmin, verifyCsrf, async (req, res) => {
  try {
    await db.supabase.from('views').delete().neq('id', 0);
    await db.supabase.from('activity_logs').delete().neq('id', 0);
    await db.supabase.from('failed_login_attempts').delete().neq('id', 0);
    res.json({ success: true, message: 'All data cleared' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});





/* ═══════════════════════════════════════════════════
   EXPORTS
   ═══════════════════════════════════════════════════ */

module.exports = router;
