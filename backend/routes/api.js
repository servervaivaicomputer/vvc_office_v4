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
