/**
 * Express Server for Charterly Release
 * - Admin manager dashboard & allowlist API
 * - User login / register API with email gating
 * - Session token validation via HTTP-only signed cookies
 * - App serving and per-user state synchronization
 */
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const crypto = require('crypto');
const store = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'charterly-sec-' + crypto.randomBytes(16).toString('hex');

// In-memory token store: token -> { userId, email, isAdmin, expiresAt }
const sessions = new Map();

function createSession(data, maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + maxAgeMs;
  sessions.set(token, { ...data, expiresAt });
  return token;
}

function getSession(token) {
  if (!token) return null;
  const sess = sessions.get(token);
  if (!sess) return null;
  if (Date.now() > sess.expiresAt) {
    sessions.delete(token);
    return null;
  }
  return sess;
}

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(cookieParser(SESSION_SECRET));

// Auth middlewares
function requireUser(req, res, next) {
  const token = req.signedCookies?.user_token || req.headers.authorization?.replace('Bearer ', '');
  const sess = getSession(token);
  if (!sess || !sess.userId) {
    return res.status(401).json({ error: 'Unauthorized. Please log in.' });
  }
  // Check if email still allowed
  if (!store.isEmailAllowed(sess.email)) {
    sessions.delete(token);
    res.clearCookie('user_token');
    return res.status(403).json({ error: 'Access has been revoked by the administrator.' });
  }
  req.user = sess;
  next();
}

function requireAdmin(req, res, next) {
  const token = req.signedCookies?.admin_token || req.headers['x-admin-token'];
  const sess = getSession(token);
  if (!sess || !sess.isAdmin) {
    return res.status(401).json({ error: 'Admin authentication required.' });
  }
  next();
}

// ─────────────────────────────────────────────
// User Auth Endpoints
// ─────────────────────────────────────────────

// Check email eligibility before password input (helpful UX)
app.post('/api/auth/check-email', (req, res) => {
  const { email } = req.body;
  const norm = store.normalizeEmail(email);
  if (!norm || !norm.includes('@')) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  const isAllowed = store.isEmailAllowed(norm);
  if (!isAllowed) {
    return res.status(403).json({
      allowed: false,
      error: 'This email is not on the private release list. Please request access from the administrator.'
    });
  }
  const allAllowed = store.getAllowedEmails();
  const info = allAllowed.find(e => e.email === norm);
  res.json({
    allowed: true,
    isRegistered: !!info?.isRegistered
  });
});

// Register account (first-time password creation)
app.post('/api/auth/register', (req, res) => {
  try {
    const { email, password } = req.body;
    const user = store.registerUser(email, password);
    const token = createSession({ userId: user.id, email: user.email });
    res.cookie('user_token', token, {
      httpOnly: true,
      signed: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: 'lax'
    });
    res.json({ success: true, user: { id: user.id, email: user.email } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Login
app.post('/api/auth/login', (req, res) => {
  try {
    const { email, password } = req.body;
    const user = store.authenticateUser(email, password);
    const token = createSession({ userId: user.id, email: user.email });
    res.cookie('user_token', token, {
      httpOnly: true,
      signed: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: 'lax'
    });
    res.json({ success: true, user: { id: user.id, email: user.email } });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// Current session
app.get('/api/auth/me', (req, res) => {
  const token = req.signedCookies?.user_token || req.headers.authorization?.replace('Bearer ', '');
  const sess = getSession(token);
  if (!sess || !sess.userId || !store.isEmailAllowed(sess.email)) {
    return res.json({ authenticated: false });
  }
  res.json({ authenticated: true, user: { id: sess.userId, email: sess.email } });
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  const token = req.signedCookies?.user_token;
  if (token) sessions.delete(token);
  res.clearCookie('user_token');
  res.json({ success: true });
});

// ─────────────────────────────────────────────
// User State Sync Endpoints (Auto-save)
// ─────────────────────────────────────────────

app.get('/api/user/state', requireUser, (req, res) => {
  const state = store.getUserState(req.user.userId);
  res.json({ state });
});

app.post('/api/user/state', requireUser, (req, res) => {
  const { state } = req.body;
  if (state && typeof state === 'object') {
    store.saveUserState(req.user.userId, state);
  }
  res.json({ success: true });
});

// ─────────────────────────────────────────────
// Admin Endpoints
// ─────────────────────────────────────────────

// Admin login
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (!password || !store.verifyAdminPassword(password)) {
    return res.status(401).json({ error: 'Invalid Administrator password.' });
  }
  const token = createSession({ isAdmin: true }, 24 * 60 * 60 * 1000);
  res.cookie('admin_token', token, {
    httpOnly: true,
    signed: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax'
  });
  res.json({ success: true });
});

// Admin logout
app.post('/api/admin/logout', (req, res) => {
  const token = req.signedCookies?.admin_token;
  if (token) sessions.delete(token);
  res.clearCookie('admin_token');
  res.json({ success: true });
});

// Admin status
app.get('/api/admin/me', (req, res) => {
  const token = req.signedCookies?.admin_token;
  const sess = getSession(token);
  res.json({ authenticated: !!(sess && sess.isAdmin) });
});

// Change admin password
app.post('/api/admin/change-password', requireAdmin, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!store.verifyAdminPassword(currentPassword)) {
    return res.status(400).json({ error: 'Current password incorrect' });
  }
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }
  store.setAdminPassword(newPassword);
  res.json({ success: true, message: 'Password updated successfully' });
});

// Get all allowed emails & registered users
app.get('/api/admin/emails', requireAdmin, (req, res) => {
  res.json({ emails: store.getAllowedEmails() });
});

// Add single email
app.post('/api/admin/emails', requireAdmin, (req, res) => {
  try {
    const { email, notes } = req.body;
    const emails = store.addAllowedEmail(email, notes);
    res.json({ success: true, emails });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Bulk add emails
app.post('/api/admin/emails/bulk', requireAdmin, (req, res) => {
  try {
    const { text, notes } = req.body;
    if (!text) return res.status(400).json({ error: 'No emails provided' });
    const rawList = text.split(/[\r\n,;]+/).map(s => s.trim()).filter(Boolean);
    const added = store.addAllowedEmailsBulk(rawList, notes);
    res.json({ success: true, count: added.length, emails: store.getAllowedEmails() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Toggle email active status
app.patch('/api/admin/emails/:email/toggle', requireAdmin, (req, res) => {
  const { email } = req.params;
  const { active } = req.body;
  const emails = store.toggleAllowedEmail(email, active);
  res.json({ success: true, emails });
});

// Delete email from allowlist
app.delete('/api/admin/emails/:email', requireAdmin, (req, res) => {
  const { email } = req.params;
  const emails = store.removeAllowedEmail(email);
  res.json({ success: true, emails });
});

// ─────────────────────────────────────────────
// Page Routing
// ─────────────────────────────────────────────

// Main App (requires user authentication)
app.get('/', (req, res) => {
  const token = req.signedCookies?.user_token;
  const sess = getSession(token);
  if (!sess || !sess.userId || !store.isEmailAllowed(sess.email)) {
    return res.redirect('/login');
  }
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

// Login & Registration Page
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Admin Manager Page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Static assets (if any)
app.use(express.static(path.join(__dirname, 'public')));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`🚀 Charterly Release Server running on http://localhost:${PORT}`);
    console.log(`👤 User Login Portal:      http://localhost:${PORT}/login`);
    console.log(`🔐 Admin Back-end Manager:  http://localhost:${PORT}/admin`);
    console.log(`   Default Admin Password:  admin123 (Change this in Admin Manager)`);
    console.log(`======================================================\n`);
  });
}

module.exports = app;
