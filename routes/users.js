const bcrypt = require('bcryptjs');
const makeCrud = require('../lib/crud');
const { q } = require('../config/db');
const { HttpError } = require('../lib/errors');
const { ROLES: R } = require('../config/constants');

const PASS = /^(?=.*[A-Za-z])(?=.*\d).{8,72}$/;
const PASS_MSG = 'Password must be at least 8 characters with letters and numbers';
const activeAdmins = async () =>
  (await q('SELECT COUNT(*) n FROM users u JOIN roles r ON r.role_id = u.role_id WHERE r.role_name = ? AND u.is_active = 1', [R.A]))[0].n;

const toggle = (key, label, when) => ({
  key, label, roles: [R.A], when, confirm: `${label} this account?`,
  run: async (conn, row, d, req) => {
    if (row.user_id === req.user.id) throw new HttpError(409, 'You cannot deactivate your own account');
    if (row.is_active && row.role_name === R.A && (await activeAdmins()) <= 1) throw new HttpError(409, 'Cannot deactivate the last active administrator');
    await conn.query('UPDATE users SET is_active = 1 - is_active WHERE user_id = ?', [row.user_id]);
  }
});

module.exports = makeCrud({
  key: 'users', title: 'Users & Roles', table: 'users', pk: 'user_id', alias: 'u',
  cols: 'u.user_id, u.full_name, u.email, u.username, u.is_active, u.created_at, u.role_id, u.client_id, r.role_name, c.client_name',
  from: 'FROM users u JOIN roles r ON r.role_id = u.role_id LEFT JOIN clients c ON c.client_id = u.client_id',
  search: ['u.full_name', 'u.username', 'u.email', 'r.role_name'],
  filters: { role_id: 'u.role_id', is_active: 'u.is_active' },
  filterUi: [{ key: 'role_id', label: 'Role', lookup: 'roles' }, { key: 'is_active', label: 'Status', options: [['1', 'Active'], ['0', 'Inactive']] }],
  sort: { full_name: 'u.full_name', username: 'u.username', role_name: 'r.role_name', created_at: 'u.created_at' },
  defaultSort: 'u.user_id DESC',
  columns: [{ key: 'full_name', label: 'Name' }, { key: 'username', label: 'Username' }, { key: 'email', label: 'Email' },
    { key: 'role_name', label: 'Role' }, { key: 'client_name', label: 'Client' }, { key: 'is_active', label: 'Status', type: 'active' }],
  perms: { read: [R.A], create: [R.A], update: [R.A], delete: [R.A] },
  fields: {
    full_name: { label: 'Full name', type: 'string', required: true, max: 100 },
    email: { label: 'Email', type: 'email', required: true },
    username: { label: 'Username', type: 'string', required: true, max: 40, pattern: /^[A-Za-z0-9_.-]{3,40}$/, patternMsg: 'Username: 3-40 letters, digits, . _ -' },
    password: { label: 'Password', type: 'string', input: 'password', virtual: true, requiredOnCreate: true, skipIfEmpty: true, max: 72,
      pattern: PASS, patternMsg: PASS_MSG, help: 'Leave blank on edit to keep the current password' },
    role_id: { label: 'Role', type: 'ref', required: true, lookup: 'roles', refTable: 'roles', refPk: 'role_id' },
    client_id: { label: 'Client company', type: 'ref', lookup: 'clients', refTable: 'clients', refPk: 'client_id', help: 'Required for the Client role' },
    is_active: { label: 'Active', type: 'bool', default: 1 }
  },
  extraColumns: ['password_hash'],
  dup: { email: { field: 'email', message: 'This email is already in use' }, username: { field: 'username', message: 'This username is already taken' } },
  inUseMessage: 'Cannot delete: this user has recorded data. Deactivate the account instead.',
  hooks: {
    async validateExtra(data, req, existing) {
      const errs = [];
      const [role] = await q('SELECT role_name FROM roles WHERE role_id = ?', [data.role_id]);
      if (role && role.role_name === R.CL && !data.client_id) errs.push({ field: 'client_id', message: 'Client company is required for the Client role' });
      if (role && role.role_name !== R.CL) data.client_id = null;
      if (existing) {
        const wasAdmin = existing.role_name === R.A && existing.is_active;
        const stillAdmin = role && role.role_name === R.A && data.is_active;
        if (wasAdmin && !stillAdmin && (await activeAdmins()) <= 1) errs.push({ field: 'role_id', message: 'Cannot change or deactivate the last active administrator' });
        if (existing.user_id === req.user.id && !data.is_active) errs.push({ field: 'is_active', message: 'You cannot deactivate your own account' });
      }
      return errs;
    },
    async beforeSave(data) { if (data.password) data.password_hash = await bcrypt.hash(data.password, 10); },
    async beforeDelete(req, row) {
      if (row.user_id === req.user.id) throw new HttpError(409, 'You cannot delete your own account');
      if (row.role_name === R.A && row.is_active && (await activeAdmins()) <= 1) throw new HttpError(409, 'Cannot delete the last administrator');
      const [{ n }] = await q(`SELECT COUNT(*) n FROM task_assignments ta JOIN tasks t ON t.task_id = ta.task_id WHERE ta.user_id = ? AND t.status <> 'Done'`, [row.user_id]);
      if (n) throw new HttpError(409, `Cannot delete: user owns ${n} active task(s). Deactivate the account instead.`);
    }
  },
  actions: [
    toggle('deactivate', 'Deactivate', { field: 'is_active', in: [1] }),
    toggle('activate', 'Activate', { field: 'is_active', in: [0] }),
    { key: 'reset_password', label: 'Reset password', roles: [R.A],
      fields: { password: { label: 'New password', type: 'string', input: 'password', required: true, max: 72, pattern: PASS, patternMsg: PASS_MSG } },
      run: async (conn, row, d) => { await conn.query('UPDATE users SET password_hash = ? WHERE user_id = ?', [await bcrypt.hash(d.password, 10), row.user_id]); } }
  ]
});
