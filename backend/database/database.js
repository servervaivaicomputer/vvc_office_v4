const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/* ═══════════════ Users ═══════════════ */

async function findUserByUsername(username) {
  const { data, error } = await supabase
    .from('users').select('*, roles(*)')
    .eq('username', username).single();
  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

async function findUserById(id) {
  const { data, error } = await supabase
    .from('users').select('*, roles(*)')
    .eq('id', id).single();
  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

async function createUser({ username, email, passwordHash, roleId = 2 }) {
  const { data, error } = await supabase
    .from('users')
    .insert([{ username, email, password_hash: passwordHash, role_id: roleId }])
    .select('*, roles(*)').single();
  if (error) throw error;
  return data;
}

async function updateLoginAttempts(userId, attempts) {
  const { error } = await supabase
    .from('users')
    .update({ failed_login_attempts: attempts, updated_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) throw error;
}

async function resetLoginAttempts(userId) {
  const { error } = await supabase
    .from('users')
    .update({ failed_login_attempts: 0, updated_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) throw error;
}

async function blockUser(userId) {
  const { data, error } = await supabase
    .from('users')
    .update({ is_blocked: true, blocked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', userId).select('*, roles(*)').single();
  if (error) throw error;
  return data;
}

async function unblockUser(userId) {
  const { data, error } = await supabase
    .from('users')
    .update({ is_blocked: false, blocked_at: null, failed_login_attempts: 0, updated_at: new Date().toISOString() })
    .eq('id', userId).select('*, roles(*)').single();
  if (error) throw error;
  return data;
}

async function updateLastLogin(userId) {
  await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', userId);
}

async function updateLastActivity(userId) {
  await supabase.from('users').update({ last_activity: new Date().toISOString() }).eq('id', userId);
}

async function updateUserRole(userId, roleId) {
  const { data, error } = await supabase
    .from('users')
    .update({ role_id: roleId, updated_at: new Date().toISOString() })
    .eq('id', userId).select('*, roles(*)').single();
  if (error) throw error;
  return data;
}

async function getAllUsers() {
  const { data, error } = await supabase
    .from('users').select('*, roles(name, is_admin)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

/* ═══════════════ Roles ═══════════════ */

async function getAllRoles() {
  const { data, error } = await supabase.from('roles').select('*').order('id');
  if (error) throw error;
  return data;
}

async function findRoleById(id) {
  const { data, error } = await supabase.from('roles').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

/* ═══════════════ Permissions ═══════════════ */

async function checkPagePermission(userId, pageSlug) {
  const user = await findUserById(userId);
  if (!user) return false;

  const { data: rolePerm } = await supabase
    .from('role_page_permissions').select('id')
    .eq('role_id', user.role_id).eq('page_slug', pageSlug).maybeSingle();
  if (rolePerm) return true;

  const { data: userPerm } = await supabase
    .from('page_permissions').select('id')
    .eq('user_id', userId).eq('page_slug', pageSlug).maybeSingle();
  return !!userPerm;
}

async function getUserPagePermissions(userId) {
  const user = await findUserById(userId);
  if (!user) return [];
  const { data: rp } = await supabase
    .from('role_page_permissions').select('page_slug').eq('role_id', user.role_id);
  const { data: up } = await supabase
    .from('page_permissions').select('page_slug').eq('user_id', userId);
  const slugs = new Set();
  (rp || []).forEach(r => slugs.add(r.page_slug));
  (up || []).forEach(u => slugs.add(u.page_slug));
  return [...slugs];
}

async function grantPagePermission(pageSlug, userId, grantedBy) {
  const { data, error } = await supabase
    .from('page_permissions')
    .insert([{ page_slug: pageSlug, user_id: userId, granted_by: grantedBy }])
    .select().single();
  if (error) throw error;
  return data;
}

async function revokePagePermission(pageSlug, userId) {
  const { error } = await supabase
    .from('page_permissions').delete()
    .eq('page_slug', pageSlug).eq('user_id', userId);
  if (error) throw error;
}

async function getAllPagePermissions() {
  const { data, error } = await supabase
    .from('page_permissions').select('*, users(username, email)')
    .order('granted_at', { ascending: false });
  if (error) throw error;
  return data;
}

async function getRolePagePermissions() {
  const { data, error } = await supabase
    .from('role_page_permissions').select('*, roles(name)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

/* ═══════════════ Views ═══════════════ */

async function logView(pageSlug, userId, ip, device) {
  await supabase.from('views').insert([{
    page_slug: pageSlug, user_id: userId,
    ip_address: ip, device_name: device
  }]);
}

async function getViewStats(pageSlug) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const sevenAgo = new Date(now - 7 * 864e5).toISOString();
  const thirtyAgo = new Date(now - 30 * 864e5).toISOString();

  async function count(from) {
    let q = supabase.from('views').select('id', { count: 'exact', head: true }).gte('viewed_at', from);
    if (pageSlug) q = q.eq('page_slug', pageSlug);
    const { count: c } = await q;
    return c || 0;
  }

  return {
    today: await count(todayStart),
    sevenDays: await count(sevenAgo),
    thirtyDays: await count(thirtyAgo)
  };
}

async function getViewsList(pageSlug, limit = 100, offset = 0) {
  let q = supabase.from('views')
    .select('*, users(username)')
    .order('viewed_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (pageSlug) q = q.eq('page_slug', pageSlug);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

/* ═══════════════ Activity ═══════════════ */

async function logActivity(userId, action, details, ip, device) {
  await supabase.from('activity_logs').insert([{
    user_id: userId, action, details,
    ip_address: ip, device_name: device
  }]);
}

async function getActivityLogs(limit = 100, offset = 0) {
  const { data, error } = await supabase
    .from('activity_logs').select('*, users(username, email)')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return data;
}

/* ═══════════════ Failed Logins ═══════════════ */

async function logFailedAttempt(username, ip, device) {
  await supabase.from('failed_login_attempts').insert([{
    username, ip_address: ip, device_name: device
  }]);
}

async function getFailedLoginAttempts(limit = 100) {
  const { data, error } = await supabase
    .from('failed_login_attempts').select('*')
    .order('attempted_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data;
}

/* ═══════════════ Dashboard ═══════════════ */

async function getDashboardStats() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  const [{ count: totalUsers }, { count: todayViews }, { count: blockedUsers }] = await Promise.all([
    supabase.from('users').select('id', { count: 'exact', head: true }),
    supabase.from('views').select('id', { count: 'exact', head: true }).gte('viewed_at', todayStart),
    supabase.from('users').select('id', { count: 'exact', head: true }).eq('is_blocked', true)
  ]);

  return { totalUsers: totalUsers || 0, todayViews: todayViews || 0, blockedUsers: blockedUsers || 0 };
}

module.exports = {
  supabase,
  findUserByUsername, findUserById, createUser,
  updateLoginAttempts, resetLoginAttempts,
  blockUser, unblockUser,
  updateLastLogin, updateLastActivity, updateUserRole,
  getAllUsers, getAllRoles, findRoleById,
  checkPagePermission, getUserPagePermissions,
  grantPagePermission, revokePagePermission,
  getAllPagePermissions, getRolePagePermissions,
  logView, getViewStats, getViewsList,
  logActivity, getActivityLogs,
  logFailedAttempt, getFailedLoginAttempts,
  getDashboardStats
};
