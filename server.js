require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const { requireAuth, csrf } = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');
const { HttpError } = require('./lib/errors');
const { ROLES: R, SESSION_MINUTES } = require('./config/constants');

const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: { useDefaults: true, directives: { 'upgrade-insecure-requests': null } }, hsts: false }));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(session({
  name: 'cms.sid', secret: process.env.SESSION_SECRET || 'dev-only-secret', resave: false, saveUninitialized: false, rolling: true,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', maxAge: SESSION_MINUTES * 60 * 1000 }   // 30 min inactivity timeout
}));
app.use(express.static(path.join(__dirname, 'public')));

// ---- modules (order = sidebar order) ----
const ALL = [R.A, R.PM, R.SE, R.FN, R.CL];
const NAV = [
  { page: 'dashboard', title: 'Dashboard', roles: ALL },
  { module: require('./routes/projects') }, { module: require('./routes/clients') },
  { module: require('./routes/tasks') }, { page: 'timeline', title: 'Timeline', roles: ALL },
  { module: require('./routes/materials') }, { module: require('./routes/stock') }, { module: require('./routes/suppliers') },
  { module: require('./routes/expenses') }, { page: 'budget', title: 'Budget vs Actual', roles: [R.FN, R.PM, R.A, R.CL] },
  { module: require('./routes/reports') }, { module: require('./routes/documents') }, { module: require('./routes/incidents') },
  { module: require('./routes/users') }, { module: require('./routes/audit') },
  { link: '/api/backup', title: 'Download backup', roles: [R.A] },
  { page: 'profile', title: 'My profile', roles: ALL }
];

const api = express.Router();
api.use('/auth', require('./routes/auth'));
api.use(requireAuth, csrf);
api.get('/meta', (req, res) => {
  const nav = [], modules = {};
  for (const n of NAV) {
    if (n.module) {
      const m = n.module.meta(req.user);
      if (m) { modules[m.key] = m; nav.push({ type: 'module', key: m.key, title: m.title }); }
    } else if (n.roles.includes(req.user.role)) nav.push({ type: n.page ? 'page' : 'link', key: n.page, href: n.link, title: n.title });
  }
  res.json({ success: true, user: req.user, csrf: req.session.csrf, nav, modules });
});
api.use('/lookup', require('./routes/lookup'));
api.use('/dashboard', require('./routes/dashboard'));
api.use('/', require('./routes/budget'));
api.use('/', require('./routes/export'));
for (const n of NAV) if (n.module) api.use('/' + n.module.cfg.key, n.module);
api.use((req, res, next) => next(new HttpError(404, 'Not found')));
app.use('/api', api);

app.use(errorHandler);

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`BuildTrack running at http://localhost:${PORT}`);
    require('./config/db').q('SELECT 1 FROM roles LIMIT 1').catch(e => {
      const code = e.code || (e.errors && e.errors[0] && e.errors[0].code) || e.message;
      console.error(`\n[!] Cannot use the database (${code}).`);
      console.error('    1) Make sure MySQL / XAMPP is running   2) Check DB_* values in .env   3) Run "npm run setup" once to create the tables.\n');
    });
  });
  server.on('error', e => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use. Stop the other program or change PORT in .env.` : e);
    process.exit(1);
  });
}
module.exports = app;
