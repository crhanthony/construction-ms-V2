const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { q } = require('../config/db');
const audit = require('../lib/audit');
const { validate } = require('../lib/validate');
const { HttpError, wrap } = require('../lib/errors');
const { requireAuth, csrf } = require('../middleware/auth');

const router = express.Router();
const PASS = /^(?=.*[A-Za-z])(?=.*\d).{8,72}$/;
const DUMMY = bcrypt.hashSync('not-a-real-password-1', 10);   // equalises timing for unknown usernames
const attempts = new Map();                                    // very small in-memory login throttle (per IP)

const publicUser = u => ({ id: u.user_id, username: u.username, full_name: u.full_name, email: u.email, role: u.role_name, client_id: u.client_id });

router.post('/login', wrap(async (req, res) => {
  const ip = req.ip, rec = attempts.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - rec.t > 15 * 60 * 1000) { rec.n = 0; rec.t = Date.now(); }
  if (rec.n >= 10) throw new HttpError(429, 'Too many failed attempts. Try again in 15 minutes.');

  const username = String(req.body.username || '').trim(), password = String(req.body.password || '');
  const errors = [];
  if (!username) errors.push({ field: 'username', message: 'Username is required' });
  if (!password) errors.push({ field: 'password', message: 'Password is required' });
  if (errors.length) throw new HttpError(400, 'Validation failed', errors);

  const [u] = await q('SELECT u.*, r.role_name FROM users u JOIN roles r ON r.role_id = u.role_id WHERE u.username = ?', [username]);
  const ok = await bcrypt.compare(password, u ? u.password_hash : DUMMY);
  if (!u || !ok || !u.is_active) {
    attempts.set(ip, { n: rec.n + 1, t: rec.t });
    throw new HttpError(401, 'Invalid username or password');
  }
  attempts.delete(ip);
  await new Promise((resolve, reject) => req.session.regenerate(e => (e ? reject(e) : resolve())));   // prevents session fixation
  req.session.user = publicUser(u);
  req.session.csrf = crypto.randomBytes(24).toString('hex');
  await audit.log(null, u.user_id, 'LOGIN', 'users', u.user_id);
  res.json({ success: true, data: req.session.user, csrf: req.session.csrf });
}));

router.use(requireAuth, csrf);

router.post('/logout', (req, res) => req.session.destroy(() => { res.clearCookie('cms.sid'); res.json({ success: true }); }));
router.get('/me', (req, res) => res.json({ success: true, data: req.user, csrf: req.session.csrf }));

// Minor function 6: profile + password management
router.put('/profile', wrap(async (req, res) => {
  const { errors, data } = await validate({
    full_name: { label: 'Full name', type: 'string', required: true, max: 100 },
    email: { label: 'Email', type: 'email', required: true }
  }, req.body);
  if (errors.length) throw new HttpError(400, 'Validation failed', errors);
  try { await q('UPDATE users SET full_name = ?, email = ? WHERE user_id = ?', [data.full_name, data.email, req.user.id]); }
  catch (e) { if (e.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'This email is already in use', [{ field: 'email', message: 'This email is already in use' }]); throw e; }
  Object.assign(req.session.user, { full_name: data.full_name, email: data.email });
  await audit.log(null, req.user.id, 'UPDATE', 'users', req.user.id);
  res.json({ success: true, data: req.session.user });
}));

router.put('/password', wrap(async (req, res) => {
  const { current_password: cur, new_password: pw, confirm_password: conf } = req.body;
  const errors = [];
  const [u] = await q('SELECT password_hash FROM users WHERE user_id = ?', [req.user.id]);
  if (!cur || !(await bcrypt.compare(String(cur), u.password_hash))) errors.push({ field: 'current_password', message: 'Current password is incorrect' });
  if (!PASS.test(String(pw || ''))) errors.push({ field: 'new_password', message: 'Password must be at least 8 characters with letters and numbers' });
  if (pw !== conf) errors.push({ field: 'confirm_password', message: 'Passwords do not match' });
  if (errors.length) throw new HttpError(400, 'Validation failed', errors);
  await q('UPDATE users SET password_hash = ? WHERE user_id = ?', [await bcrypt.hash(pw, 10), req.user.id]);
  await audit.log(null, req.user.id, 'UPDATE', 'users', req.user.id);
  res.json({ success: true });
}));

module.exports = router;
