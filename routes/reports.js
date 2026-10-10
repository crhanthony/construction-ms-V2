const makeCrud = require('../lib/crud');
const { HttpError } = require('../lib/errors');
const { ROLES: R } = require('../config/constants');
const { byProject } = require('../lib/scope');
const { today } = require('../lib/validate');

module.exports = makeCrud({
  key: 'reports', title: 'Site Reports', table: 'site_reports', pk: 'report_id', alias: 'sr',
  cols: 'sr.report_id, sr.project_id, sr.author_id, sr.report_date, sr.weather, sr.workers_present, sr.work_done, sr.issues, sr.is_approved, p.project_name, u.full_name AS author_name',
  from: 'FROM site_reports sr JOIN projects p ON p.project_id = sr.project_id JOIN users u ON u.user_id = sr.author_id',
  search: ['p.project_name', 'sr.work_done', 'sr.issues', 'u.full_name'],
  filters: { project_id: 'sr.project_id', from: 'sr.report_date >= ?', to: 'sr.report_date <= ?', is_approved: 'sr.is_approved' },
  filterUi: [{ key: 'project_id', label: 'Project', lookup: 'projects' }, { key: 'is_approved', label: 'Approval', options: [['1', 'Approved'], ['0', 'Not approved']] }],
  sort: { report_date: 'sr.report_date', project_name: 'p.project_name', workers_present: 'sr.workers_present' }, defaultSort: 'sr.report_date DESC',
  columns: [{ key: 'report_date', label: 'Date', type: 'date' }, { key: 'project_name', label: 'Project' }, { key: 'weather', label: 'Weather' },
    { key: 'workers_present', label: 'Workers' }, { key: 'work_done', label: 'Work done', type: 'clip' }, { key: 'author_name', label: 'Author' }, { key: 'is_approved', label: 'Approved', type: 'yesno' }],
  perms: { read: [R.SE, R.PM, R.A, R.FN, R.CL], create: [R.SE, R.PM], update: [R.SE, R.PM], delete: [R.SE, R.PM] },
  scope: byProject('sr.project_id'),
  fields: {
    project_id: { label: 'Project', type: 'ref', required: true, lookup: 'projects', refTable: 'projects', refPk: 'project_id' },
    report_date: { label: 'Report date', type: 'date', required: true, noFuture: true, default: today },
    weather: { label: 'Weather', type: 'enum', options: ['Sunny', 'Cloudy', 'Rainy', 'Windy', 'Stormy'] },
    workers_present: { label: 'Workers present', type: 'int', required: true, min: 0, maxVal: 100000, default: 0 },
    work_done: { label: 'Work completed', type: 'text', input: 'textarea', required: true },
    issues: { label: 'Issues / delays', type: 'text', input: 'textarea' }
  },
  extraColumns: ['author_id'],
  dup: { uq_report_project_day: { field: 'report_date', message: 'A report already exists for this project on this date' }, report_date: { field: 'report_date', message: 'A report already exists for this project on this date' } },
  hooks: {
    async canModify(req, row, op) {
      if (req.user.role === R.SE) {
        if (row.author_id !== req.user.id) throw new HttpError(403, 'Only the author or a manager can change this report');
        if (row.is_approved) throw new HttpError(409, op === 'delete' ? 'Approved reports can no longer be deleted' : 'Approved reports can no longer be edited');
      }
    },
    async beforeSave(d, req, existing) { if (!existing) d.author_id = req.user.id; }
  },
  actions: [{
    key: 'approve', label: 'Approve', roles: [R.PM], style: 'ok', when: { field: 'is_approved', in: [0] }, confirm: 'Approve this report? It can no longer be edited by the site engineer.',
    run: async (conn, row) => { await conn.query('UPDATE site_reports SET is_approved = 1 WHERE report_id = ?', [row.report_id]); }
  }]
});
