const fs = require('fs');
const path = require('path');
const makeCrud = require('../lib/crud');
const { q } = require('../config/db');
const { HttpError } = require('../lib/errors');
const { ROLES: R } = require('../config/constants');
const { byClient } = require('../lib/scope');

const NEXT = { 'Planned': ['In Progress', 'On Hold'], 'In Progress': ['On Hold', 'Completed'], 'On Hold': ['Planned', 'In Progress'], 'Completed': [] };
const STATUSES = ['Planned', 'In Progress', 'On Hold', 'Completed'];
const archive = (key, label, to, when) => ({
  key, label, roles: [R.PM, R.A], when, confirm: `${label} this project?`,
  run: async (conn, row) => { await conn.query('UPDATE projects SET is_archived = ? WHERE project_id = ?', [to, row.project_id]); }
});

module.exports = makeCrud({
  key: 'projects', title: 'Projects', table: 'projects', pk: 'project_id', alias: 'p', exportType: 'projects',
  cols: `p.project_id, p.client_id, p.manager_id, p.project_name, p.location, p.start_date, p.end_date, p.budget, p.status, p.description, p.is_archived,
    c.client_name, u.full_name AS manager_name,
    (SELECT COALESCE(SUM(e.amount),0) FROM expenses e WHERE e.project_id = p.project_id AND e.approval_status <> 'Rejected') AS budget_used,
    (SELECT COALESCE(ROUND(AVG(t.progress_pct)),0) FROM tasks t WHERE t.project_id = p.project_id) AS progress`,
  from: 'FROM projects p JOIN clients c ON c.client_id = p.client_id JOIN users u ON u.user_id = p.manager_id',
  search: ['p.project_name', 'c.client_name', 'p.location'],
  filters: { status: 'p.status', client_id: 'p.client_id', from: 'p.end_date >= ?', to: 'p.start_date <= ?', archived: 'p.is_archived' },
  filterUi: [{ key: 'status', label: 'Status', options: STATUSES.map(s => [s, s]) }, { key: 'client_id', label: 'Client', lookup: 'clients' },
    { key: 'archived', label: 'Archive', options: [['0', 'Active'], ['1', 'Archived']] }],
  sort: { project_name: 'p.project_name', client_name: 'c.client_name', start_date: 'p.start_date', end_date: 'p.end_date', budget: 'p.budget', status: 'p.status' },
  defaultSort: 'p.project_id DESC',
  columns: [{ key: 'project_name', label: 'Project' }, { key: 'client_name', label: 'Client' }, { key: 'status', label: 'Status', type: 'badge' },
    { key: 'start_date', label: 'Start', type: 'date' }, { key: 'end_date', label: 'End', type: 'date' }, { key: 'budget', label: 'Budget', type: 'money' },
    { key: 'progress', label: 'Progress', type: 'pct' }, { key: 'is_archived', label: '', type: 'archived' }],
  perms: { read: [R.A, R.PM, R.SE, R.FN, R.CL], create: [R.PM, R.A], update: [R.PM, R.A], delete: [R.PM, R.A] },
  scope: byClient('p.client_id'),
  fields: {
    project_name: { label: 'Project name', type: 'string', required: true, max: 120 },
    client_id: { label: 'Client', type: 'ref', required: true, lookup: 'clients', refTable: 'clients', refPk: 'client_id' },
    manager_id: { label: 'Project manager', type: 'ref', required: true, lookup: 'managers', refTable: 'users', refPk: 'user_id' },
    location: { label: 'Site location', type: 'string', max: 150 },
    start_date: { label: 'Start date', type: 'date', required: true },
    end_date: { label: 'End date', type: 'date', required: true, after: 'start_date' },
    budget: { label: 'Budget (LKR)', type: 'decimal', required: true, positive: true },
    status: { label: 'Status', type: 'enum', options: STATUSES, required: true, default: 'Planned' },
    description: { label: 'Description', type: 'text', input: 'textarea' }
  },
  dup: { uq_project_client_name: { field: 'project_name', message: 'This client already has a project with that name' }, project_name: { field: 'project_name', message: 'This client already has a project with that name' } },
  deleteWarning: 'Deleting a project also deletes its tasks, site reports, documents and incidents. Projects with expenses or stock records cannot be deleted - archive them instead.',
  inUseMessage: 'Cannot delete: project has expenses or stock records. Archive it instead.',
  hooks: {
    async validateExtra(d, req, existing) {
      const errs = [];
      if (d.end_date < d.start_date) errs.push({ field: 'end_date', message: 'End date cannot be before start date' });
      const [m] = await q('SELECT r.role_name FROM users u JOIN roles r ON r.role_id = u.role_id WHERE u.user_id = ? AND u.is_active = 1', [d.manager_id]);
      if (!m || m.role_name !== R.PM) errs.push({ field: 'manager_id', message: 'Select an active user with the Project Manager role' });
      if (existing && d.start_date <= d.end_date) {
        const [{ n }] = await q('SELECT COUNT(*) n FROM tasks WHERE project_id = ? AND (start_date < ? OR due_date > ?)', [existing.project_id, d.start_date, d.end_date]);
        if (n) errs.push({ field: 'end_date', message: `${n} task(s) fall outside these dates. Change those tasks first.` });
      }
      if (existing && d.status !== existing.status && !NEXT[existing.status].includes(d.status))
        errs.push({ field: 'status', message: `A ${existing.status} project cannot move to ${d.status}` });
      return errs;
    },
    async beforeDelete(req, row) {
      const [{ n }] = await q('SELECT (SELECT COUNT(*) FROM expenses WHERE project_id = ?) + (SELECT COUNT(*) FROM stock_transactions WHERE project_id = ?) AS n', [row.project_id, row.project_id]);
      if (n) throw new HttpError(409, 'Cannot delete: project has expenses or stock records. Archive it instead.');
      req._files = (await q('SELECT file_path FROM documents WHERE project_id = ?', [row.project_id])).map(f => f.file_path);
    },
    async afterDelete(req) { (req._files || []).forEach(f => fs.unlink(path.join(__dirname, '..', 'uploads', f), () => {})); }
  },
  actions: [archive('archive', 'Archive', 1, { field: 'is_archived', in: [0] }), archive('unarchive', 'Restore', 0, { field: 'is_archived', in: [1] })]
});
