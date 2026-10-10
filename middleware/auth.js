const { HttpError } = require('../lib/errors');

const { q } = require('../config/db');

// Logged-in check. The account is re-read from the database on every request, so a user who is
// deactivated, or whose role changes, is affected immediately instead of when the session expires.
exports.requireAuth = async (req, res, next) => {
  try {
    if (!(req.session && req.session.user)) return next(new HttpError(401, 'Please log in'));
    const [u] = await q('SELECT u.full_name, u.email, u.client_id, u.is_active, r.role_name FROM users u JOIN roles r ON r.role_id = u.role_id WHERE u.user_id = ?', [req.session.user.id]);
    if (!u || !u.is_active) return req.session.destroy(() => next(new HttpError(401, 'Your account is no longer active')));
    Object.assign(req.session.user, { role: u.role_name, client_id: u.client_id, full_name: u.full_name, email: u.email });
    req.user = req.session.user;
    next();
  } catch (e) { next(e); }
};

exports.requireRoles = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : next(new HttpError(403, 'Access denied'));

// CSRF: every state-changing request must carry the token issued at login.
exports.csrf = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.session.csrf && req.get('X-CSRF-Token') === req.session.csrf) return next();
  next(new HttpError(403, 'Invalid or missing CSRF token'));
};
