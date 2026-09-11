const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const db = require('../database/database');
const { JWT_SECRET, getClientIp, getDeviceName } = require('../middleware/auth');

const FRONTEND_URL = process.env.FRONTEND_URL || '';

function errorPage(status, title, msg) {
  return '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<title>' + status + '</title>' +
    '<style>body{font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f5f5f5;color:#333}' +
    '.box{text-align:center}.box h1{font-size:4rem;margin:0;color:#ccc}.box p{color:#888;margin:0.5rem 0 1.5rem}' +
    '.box a{padding:0.6rem 1.4rem;background:#333;color:#fff;border-radius:6px;text-decoration:none;font-size:0.9rem}</style>' +
    '</head><body><div class="box"><h1>' + status + '</h1><p>' + msg + '</p>' +
    '<a href="/home">Go Home</a></div></body></html>';
}

/* ═══════════════════════════════════════════════════
   GET /page/:slug

   Permission rule:
   - username "admin" → ALL pages including admin
   - username != "admin" → ALL pages EXCEPT admin
   - No database permission check needed
   ═══════════════════════════════════════════════════ */
router.get('/:slug', async (req, res) => {
  try {
    var slug = req.params.slug;
    var ip = getClientIp(req);
    var device = getDeviceName(req);

    if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
      return res.status(400).send(errorPage(400, 'Bad Request', 'Invalid page'));
    }

    var filePath = path.join(__dirname, '..', 'projects', slug, 'index.html');
    if (!fs.existsSync(filePath)) {
      return res.status(404).send(errorPage(404, 'Not Found', 'Page does not exist'));
    }

    /* ── Login page: no auth required ── */
    if (slug === 'login') {
      var token = req.cookies?.token;
      if (token) {
        try {
          var decoded = jwt.verify(token, JWT_SECRET);
          var user = await db.findUserById(decoded.userId);
          if (user && !user.is_blocked) {
            return res.redirect(302, FRONTEND_URL + '/home');
          }
        } catch (e) {}
      }
      var content = fs.readFileSync(filePath, 'utf-8');
      return res.type('html').send(content);
    }

    /* ── Protected pages: auth required ── */
    var token = req.cookies?.token;
    if (!token) {
      return res.redirect(302, FRONTEND_URL + '/login');
    }

    var decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (e) {
      return res.redirect(302, FRONTEND_URL + '/login');
    }

    var user = await db.findUserById(decoded.userId);
    if (!user || user.is_blocked) {
      return res.redirect(302, FRONTEND_URL + '/login');
    }

    /* ── Permission check (simple: no database) ── */
    if (slug === 'admin' && user.username !== 'admin') {
      return res.status(403).send(errorPage(403, 'Access Denied', 'Admin access only'));
    }

    /* ── Log ── */
    await db.logView(slug, user.id, ip, device);
    await db.logActivity(user.id, 'PAGE_VIEW', 'Viewed: ' + slug, ip, device);
    await db.updateLastActivity(user.id);

    /* ── Serve full HTML ── */
    var content = fs.readFileSync(filePath, 'utf-8');
    res.type('html').send(content);

  } catch (err) {
    console.error('Page serve error:', err);
    res.status(500).send(errorPage(500, 'Error', 'Internal server error'));
  }
});

module.exports = router;
