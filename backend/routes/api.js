const router = require('express').Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../database/database');
const {
  authenticate,
  authenticateAdmin,
  verifyCsrf,
  JWT_SECRET,
  JWT_EXPIRES_IN,
  getClientIp,
  getDeviceName
} = require('../middleware/auth');

/* ═══════════════════════════════════════════════════
   AUTH ROUTES
   ═══════════════════════════════════════════════════ */

/* ── CSRF Token (signed cookie) ───────────────────── */
router.get('/auth/csrf', (req, res) => {
  let token = req.signedCookies?.csrf_token;
  if (!token) {
    token = crypto.randomBytes(32).toString('hex');
    res.cookie('csrf_token', token, {
      httpOnly: false,
      signed: true,
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000
    });
  }
  res.json({ success: true, csrfToken: token });
});

/* ── Login ────────────────────────────────────────── */
router.post('/auth/login', verifyCsrf, async (req, res) => {
  try {
    const { username, password } = req.body;
    const ip = getClientIp(req);
    const device = getDeviceName(req);

    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username and password required' });
    }

    const user = await db.findUserByUsername(username);
    if (!user) {
      await db.logFailedLogin(username, ip, device);
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    if (user.is_blocked) {
      return res.status(403).json({ success: false, error: 'Account is blocked' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      const failed = await db.incrementFailedAttempts(user.id);
      await db.logFailedLogin(username, ip, device);

      if (failed >= 10) {
        await db.blockUser(user.id);
        await db.logActivity(user.id, 'AUTO_BLOCKED', 'Blocked after 10 failed attempts', ip, device);
        return res.status(403).json({ success: false, error: 'Account blocked due to too many failed attempts' });
      }

      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
        attemptsRemaining: 10 - failed
      });
    }

    await db.resetFailedAttempts(user.id);
    await db.updateLastLogin(user.id);
    await db.logActivity(user.id, 'LOGIN', 'User logged in', ip, device);

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    res.cookie('token', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 24 * 60 * 60 * 1000
    });

    res.json({
      success: true,
      data: { user: { id: user.id, username: user.username, email: user.email } }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/* ── Admin Login ──────────────────────────────────── */
router.post('/auth/admin-login', verifyCsrf, async (req, res) => {
  try {
    const { username, password } = req.body;
    const ip = getClientIp(req);
    const device = getDeviceName(req);

    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username and password required' });
    }

    const user = await db.findUserByUsername(username);
    if (!user) {
      await db.logFailedLogin(username, ip, device);
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    if (user.is_blocked) {
      return res.status(403).json({ success: false, error: 'Account is blocked' });
    }

    if (user.username !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin access only' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      const failed = await db.incrementFailedAttempts(user.id);
      await db.logFailedLogin(username, ip, device);
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
        attemptsRemaining: 10 - failed
      });
    }

    await db.resetFailedAttempts(user.id);
    await db.updateLastLogin(user.id);
    await db.logActivity(user.id, 'ADMIN_LOGIN', 'Admin logged in', ip, device);

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    res.cookie('token', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 24 * 60 * 60 * 1000
    });

    res.json({
      success: true,
      data: { user: { id: user.id, username: user.username, email: user.email } }
    });
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/* ── Current User ─────────────────────────────────── */
router.get('/auth/me', authenticate, (req, res) => {
  res.json({
    success: true,
    data: {
      user: {
        id: req.user.id,
        username: req.user.username,
        email: req.user.email,
        role: req.user.roles?.name || 'user'
      }
    }
  });
});

/* ── Logout ───────────────────────────────────────── */
router.post('/auth/logout', verifyCsrf, (req, res) => {
  res.clearCookie('token', { httpOnly: true, secure: true, sameSite: 'none' });
  res.json({ success: true, message: 'Logged out' });
});

/* ═══════════════════════════════════════════════════
   ADMIN — STATS
   ═══════════════════════════════════════════════════ */

router.get('/admin/stats', authenticateAdmin, async (req, res) => {
  try {
    const stats = await db.getStats();
    res.json({ success: true, data: stats });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

/* ═══════════════════════════════════════════════════
   ADMIN — USERS
   ═══════════════════════════════════════════════════ */

router.get('/admin/users', authenticateAdmin, async (req, res) => {
  try {
    const users = await db.getAllUsers();
    res.json({ success: true, data: users });
  } catch (err) {
    console.error('Users error:', err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

router.post('/admin/users', authenticateAdmin, verifyCsrf, async (req, res) => {
  try {
    const { username, email, password, roleId } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ success: false, error: 'All fields required' });
    }

    if (username.length < 3 || username.length > 30) {
      return res.status(400).json({ success: false, error: 'Username must be 3-30 characters' });
    }

    if (password.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }

    const existing = await db.findUserByUsername(username);
    if (existing) {
      return res.status(409).json({ success: false, error: 'Username already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await db.createUser(username, email, passwordHash, roleId || 2);

    await db.logActivity(req.user.id, 'USER_CREATED', 'Created: ' + username, getClientIp(req), getDeviceName(req));
    res.status(201).json({ success: true, data: user });
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

router.post('/admin/users/:id/block', authenticateAdmin, verifyCsrf, async (req, res) => {
  try {
    const user = await db.findUserById(req.params.id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    if (user.username === 'admin') return res.status(400).json({ success: false, error: 'Cannot block admin' });

    await db.blockUser(req.params.id);
    await db.logActivity(req.user.id, 'USER_BLOCKED', 'Blocked: ' + user.username, getClientIp(req), getDeviceName(req));
    res.json({ success: true, message: 'User blocked' });
  } catch (err) {
    console.error('Block error:', err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

router.post('/admin/users/:id/unblock', authenticateAdmin, verifyCsrf, async (req, res) => {
  try {
    const user = await db.findUserById(req.params.id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    await db.unblockUser(req.params.id);
    await db.resetFailedAttempts(req.params.id);
    await db.logActivity(req.user.id, 'USER_UNBLOCKED', 'Unblocked: ' + user.username, getClientIp(req), getDeviceName(req));
    res.json({ success: true, message: 'User unblocked' });
  } catch (err) {
    console.error('Unblock error:', err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

router.put('/admin/users/:id/role', authenticateAdmin, verifyCsrf, async (req, res) => {
  try {
    const { roleId } = req.body;
    const user = await db.findUserById(req.params.id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    if (user.username === 'admin') return res.status(400).json({ success: false, error: 'Cannot change admin role' });

    await db.updateUserRole(req.params.id, roleId);
    await db.logActivity(req.user.id, 'ROLE_CHANGED', 'Changed role: ' + user.username, getClientIp(req), getDeviceName(req));
    res.json({ success: true, message: 'Role updated' });
  } catch (err) {
    console.error('Role error:', err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

router.get('/admin/roles', authenticateAdmin, async (req, res) => {
  try {
    const roles = await db.getRoles();
    res.json({ success: true, data: roles });
  } catch (err) {
    console.error('Roles error:', err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

/* ═══════════════════════════════════════════════════
   ADMIN — VIEWS
   ═══════════════════════════════════════════════════ */

router.get('/admin/views', authenticateAdmin, async (req, res) => {
  try {
    const page = req.query.page || '';
    const data = await db.getViews(page);
    res.json({ success: true, data });
  } catch (err) {
    console.error('Views error:', err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

/* ═══════════════════════════════════════════════════
   ADMIN — ACTIVITY
   ═══════════════════════════════════════════════════ */

router.get('/admin/activity', authenticateAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const data = await db.getActivity(limit);
    res.json({ success: true, data });
  } catch (err) {
    console.error('Activity error:', err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

/* ═══════════════════════════════════════════════════
   ADMIN — FAILED LOGINS
   ═══════════════════════════════════════════════════ */

router.get('/admin/failed-logins', authenticateAdmin, async (req, res) => {
  try {
    const data = await db.getFailedLogins();
    res.json({ success: true, data });
  } catch (err) {
    console.error('Failed logins error:', err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

/* ═══════════════════════════════════════════════════
   ADMIN — CLEAR DATA
   ═══════════════════════════════════════════════════ */

function getRangeDate(range) {
  if (range === 'today') {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }
  if (range === '7days') return new Date(Date.now() - 7 * 864e5).toISOString();
  if (range === '30days') return new Date(Date.now() - 30 * 864e5).toISOString();
  return null;
}

/* ── Clear views ──────────────────────────────────── */
router.delete('/admin/clear/views/:range', authenticateAdmin, verifyCsrf, async (req, res) => {
  try {
    var range = req.params.range;
    var since = getRangeDate(range);

    if (range === 'all') {
      var { error } = await db.supabase.from('views').delete().neq('id', 0);
      if (error) throw error;
    } else if (since) {
      var { error } = await db.supabase.from('views').delete().gte('viewed_at', since);
      if (error) throw error;
    } else {
      return res.status(400).json({ success: false, error: 'Invalid range' });
    }

    await db.logActivity(req.user.id, 'CLEAR_VIEWS', 'Cleared views: ' + range, getClientIp(req), getDeviceName(req));
    res.json({ success: true, message: 'Views cleared: ' + range });
  } catch (err) {
    console.error('Clear views error:', err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

/* ── Clear activity ───────────────────────────────── */
router.delete('/admin/clear/activity/:range', authenticateAdmin, verifyCsrf, async (req, res) => {
  try {
    var range = req.params.range;
    var since = getRangeDate(range);

    if (range === 'all') {
      var { error } = await db.supabase.from('activity_logs').delete().neq('id', 0);
      if (error) throw error;
    } else if (since) {
      var { error } = await db.supabase.from('activity_logs').delete().gte('created_at', since);
      if (error) throw error;
    } else {
      return res.status(400).json({ success: false, error: 'Invalid range' });
    }

    await db.logActivity(req.user.id, 'CLEAR_ACTIVITY', 'Cleared activity: ' + range, getClientIp(req), getDeviceName(req));
    res.json({ success: true, message: 'Activity cleared: ' + range });
  } catch (err) {
    console.error('Clear activity error:', err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

/* ── Clear failed logins ──────────────────────────── */
router.delete('/admin/clear/failed/:range', authenticateAdmin, verifyCsrf, async (req, res) => {
  try {
    var range = req.params.range;
    var since = getRangeDate(range);

    if (range === 'all') {
      var { error } = await db.supabase.from('failed_login_attempts').delete().neq('id', 0);
      if (error) throw error;
    } else if (since) {
      var { error } = await db.supabase.from('failed_login_attempts').delete().gte('attempted_at', since);
      if (error) throw error;
    } else {
      return res.status(400).json({ success: false, error: 'Invalid range' });
    }

    await db.logActivity(req.user.id, 'CLEAR_FAILED', 'Cleared failed logins: ' + range, getClientIp(req), getDeviceName(req));
    res.json({ success: true, message: 'Failed logins cleared: ' + range });
  } catch (err) {
    console.error('Clear failed error:', err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

/* ── Clear everything ─────────────────────────────── */
router.delete('/admin/clear/all/:range', authenticateAdmin, verifyCsrf, async (req, res) => {
  try {
    var range = req.params.range;
    var since = getRangeDate(range);

    if (range === 'all') {
      await db.supabase.from('views').delete().neq('id', 0);
      await db.supabase.from('activity_logs').delete().neq('id', 0);
      await db.supabase.from('failed_login_attempts').delete().neq('id', 0);
    } else if (since) {
      await db.supabase.from('views').delete().gte('viewed_at', since);
      await db.supabase.from('activity_logs').delete().gte('created_at', since);
      await db.supabase.from('failed_login_attempts').delete().gte('attempted_at', since);
    } else {
      return res.status(400).json({ success: false, error: 'Invalid range' });
    }

    await db.logActivity(req.user.id, 'CLEAR_ALL', 'Cleared all data: ' + range, getClientIp(req), getDeviceName(req));
    res.json({ success: true, message: 'All data cleared: ' + range });
  } catch (err) {
    console.error('Clear all error:', err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

module.exports = router;
