const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../database/database');

const JWT_SECRET = process.env.JWT_SECRET;
const MAX_FAILED = parseInt(process.env.MAX_FAILED_ATTEMPTS) || 10;

function generateToken(user) {
  return jwt.sign(
    { userId: user.id, username: user.username, roleId: user.role_id, isAdmin: !!user.roles?.is_admin },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.socket?.remoteAddress
    || 'unknown';
}

function getDeviceName(req) {
  return req.headers['user-agent'] || 'unknown';
}

/* ── Verify JWT cookie ────────────────────────────── */
async function authenticate(req, res, next) {
  try {
    const token = req.cookies?.token;
    if (!token) return res.status(401).json({ success: false, error: 'Authentication required' });

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await db.findUserById(decoded.userId);
    if (!user) return res.status(401).json({ success: false, error: 'User not found' });
    if (user.is_blocked) return res.status(403).json({ success: false, error: 'Account is blocked' });

    db.updateLastActivity(user.id).catch(() => {});
    req.user = user;
    next();
  } catch (err) {
    const msg = err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token';
    return res.status(401).json({ success: false, error: msg });
  }
}

/* ── Verify admin role ────────────────────────────── */
async function authenticateAdmin(req, res, next) {
  try {
    const token = req.cookies?.token;
    if (!token) return res.status(401).json({ success: false, error: 'Authentication required' });

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await db.findUserById(decoded.userId);
    if (!user) return res.status(401).json({ success: false, error: 'User not found' });
    if (user.is_blocked) return res.status(403).json({ success: false, error: 'Account is blocked' });
    if (!user.roles?.is_admin) return res.status(403).json({ success: false, error: 'Admin access required' });

    db.updateLastActivity(user.id).catch(() => {});
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ success: false, error: 'Invalid session' });
  }
}

/* ── CSRF double-submit cookie ────────────────────── */
function verifyCsrf(req, res, next) {
  const cookie = req.cookies?.csrf_token;
  const header = req.headers['x-csrf-token'];
  if (!cookie || !header || cookie !== header) {
    return res.status(403).json({ success: false, error: 'CSRF validation failed' });
  }
  next();
}

module.exports = {
  generateToken, generateCsrfToken,
  authenticate, authenticateAdmin, verifyCsrf,
  getClientIp, getDeviceName,
  JWT_SECRET, MAX_FAILED
};
