const express = require('express');
const { q } = require('../config/db');
const { HttpError, wrap } = require('../lib/errors');
const { ROLES: R } = require('../config/constants');

const router = express.Router();
const ALL = [R.A, R.PM, R.SE, R.FN, R.CL];
const STAFF = [R.A, R.PM, R.SE, R.FN];

// Small {id, label} lists that feed the <select> boxes in forms and filters.
const LOOKUPS = {
  roles: { roles: [R.A], sql: 'SELECT role_id id, role_name label FROM roles ORDER BY role_id' },
  clients: { roles: [R.A, R.PM], sql: 'SELECT client_id id, client_name label FROM clients ORDER BY client_name' },
  managers: { roles: [R.A, R.PM], sql: `SELECT u.user_id id, u.full_name label FROM users u JOIN roles r ON r.role_id = u.role_id WHERE r.role_name = '${R.PM}' AND u.is_active = 1 ORDER BY u.full_name` },
  staff: { roles: [R.A, R.PM, R.SE], sql: `SELECT u.user_id id, CONCAT(u.full_name, ' (', r.role_name, ')') label FROM users u JOIN roles r ON r.role_id = u.role_id WHERE r.role_name <> '${R.CL}' AND u.is_active = 1 ORDER BY u.full_name` },
  allusers: { roles: [R.A], sql: 'SELECT user_id id, full_name label FROM users ORDER BY full_name' },
  projects: { roles: ALL, sql: 'SELECT project_id id, project_name label FROM projects p WHERE p.is_archived = 0 {scope} ORDER BY project_name', scoped: 'p.client_id' },
  categories: { roles: [R.FN, R.PM, R.A], sql: 'SELECT category_id id, category_name label FROM cost_categories ORDER BY category_name' },
  suppliers: { roles: STAFF, sql: 'SELECT supplier_id id, supplier_name label FROM suppliers ORDER BY supplier_name' },
  materials: { roles: STAFF, sql: 'SELECT material_id id, CONCAT(item_name, \' [\', quantity_in_stock, \' \', unit, \']\') label FROM materials WHERE is_active = 1 ORDER BY item_name' },
  reports: { roles: [R.SE, R.PM, R.A], sql: `SELECT sr.report_id id, CONCAT(sr.report_date, ' - ', p.project_name) label FROM site_reports sr JOIN projects p ON p.project_id = sr.project_id ORDER BY sr.report_date DESC LIMIT 200` }
};

router.get('/:name', wrap(async (req, res) => {
  const l = LOOKUPS[req.params.name];
  if (!l) throw new HttpError(404, 'Unknown list');
  if (!l.roles.includes(req.user.role)) throw new HttpError(403, 'Access denied');
  let sql = l.sql, params = [];
  if (l.scoped) {
    const isCL = req.user.role === R.CL;
    sql = sql.replace('{scope}', isCL ? `AND ${l.scoped} = ?` : '');
    if (isCL) params = [req.user.client_id || 0];
  }
  res.json({ success: true, data: await q(sql, params) });
}));

module.exports = router;
