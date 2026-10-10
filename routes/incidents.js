const makeCrud = require('../lib/crud');
const { HttpError } = require('../lib/errors');
const { ROLES: R } = require('../config/constants');
const { today } = require('../lib/validate');

module.exports = makeCrud({
  key: 'incidents', title: 'Safety Incidents', table: 'incidents', pk: 'incident_id', alias: 'i',
  cols: 'i.incident_id, i.project_id, i.reported_by, i.incident_date, i.severity, i.description, i.action_taken, p.project_name, u.full_name AS reported_by_name',
  from: 'FROM incidents i JOIN projects p ON p.project_id = i.project_id JOIN users u ON u.user_id = i.reported_by',
  search: ['p.project_name', 'i.description'],
  filters: { project_id: 'i.project_id', severity: 'i.severity' },
  filterUi: [{ key: 'project_id', label: 'Project', lookup: 'projects' }, { key: 'severity', label: 'Severity', options: [['Near miss', 'Near miss'], ['Minor', 'Minor'], ['Major', 'Major']] }],
  sort: { incident_date: 'i.incident_date', severity: 'i.severity' }, defaultSort: 'i.incident_date DESC',
  columns: [{ key: 'incident_date', label: 'Date', type: 'date' }, { key: 'project_name', label: 'Project' }, { key: 'severity', label: 'Severity', type: 'badge' },
    { key: 'description', label: 'What happened', type: 'clip' }, { key: 'reported_by_name', label: 'Reported by' }],
  perms: { read: [R.SE, R.PM, R.A], create: [R.SE, R.PM], update: [R.SE, R.PM], delete: [R.SE, R.PM] },
  fields: {
    project_id: { label: 'Project', type: 'ref', required: true, lookup: 'projects', refTable: 'projects', refPk: 'project_id' },
    incident_date: { label: 'Date', type: 'date', required: true, noFuture: true, default: today },
    severity: { label: 'Severity', type: 'enum', options: ['Near miss', 'Minor', 'Major'], required: true, default: 'Near miss' },
    description: { label: 'What happened', type: 'text', input: 'textarea', required: true },
    action_taken: { label: 'Action taken', type: 'text', input: 'textarea' }
  },
  extraColumns: ['reported_by'],
  hooks: {
    async canModify(req, row) { if (req.user.role === R.SE && row.reported_by !== req.user.id) throw new HttpError(403, 'Only the reporter or a manager can change this entry'); },
    async beforeSave(d, req, existing) { if (!existing) d.reported_by = req.user.id; }
  }
});
