const makeCrud = require('../lib/crud');
const { q } = require('../config/db');
const { HttpError } = require('../lib/errors');
const { ROLES: R } = require('../config/constants');
const { byProject } = require('../lib/scope');

module.exports = makeCrud({
  key: 'tasks', title: 'Tasks', table: 'tasks', pk: 'task_id', alias: 't', exportType: 'tasks',
  cols: `t.task_id, t.project_id, t.title, t.description, t.priority, t.status, t.progress_pct, t.start_date, t.due_date, p.project_name,
    (SELECT GROUP_CONCAT(u.full_name SEPARATOR ', ') FROM task_assignments ta JOIN users u ON u.user_id = ta.user_id WHERE ta.task_id = t.task_id) AS assignees,
    (SELECT ta.user_id FROM task_assignments ta WHERE ta.task_id = t.task_id ORDER BY ta.assignment_id LIMIT 1) AS assignee_id,
    (t.due_date < CURDATE() AND t.status <> 'Done') AS is_overdue`,
  from: 'FROM tasks t JOIN projects p ON p.project_id = t.project_id',
  search: ['t.title', 'p.project_name', 't.description'],
  filters: { project_id: 't.project_id', status: 't.status', priority: 't.priority',
    assignee_id: 'EXISTS (SELECT 1 FROM task_assignments x WHERE x.task_id = t.task_id AND x.user_id = ?)',
    overdue: '(t.due_date < CURDATE() AND t.status <> \'Done\') = ?' },
  filterUi: [{ key: 'project_id', label: 'Project', lookup: 'projects' }, { key: 'status', label: 'Status', options: [['To Do', 'To Do'], ['In Progress', 'In Progress'], ['Done', 'Done']] },
    { key: 'assignee_id', label: 'Assignee', lookup: 'staff' }, { key: 'overdue', label: 'Overdue', options: [['1', 'Overdue only']] }],
  sort: { title: 't.title', project_name: 'p.project_name', due_date: 't.due_date', priority: 't.priority', status: 't.status', progress_pct: 't.progress_pct' },
  defaultSort: 't.due_date ASC',
  columns: [{ key: 'title', label: 'Task' }, { key: 'project_name', label: 'Project' }, { key: 'assignees', label: 'Assignee' },
    { key: 'priority', label: 'Priority', type: 'badge' }, { key: 'status', label: 'Status', type: 'badge' },
    { key: 'progress_pct', label: 'Progress', type: 'pct' }, { key: 'due_date', label: 'Due', type: 'due' }],
  perms: { read: [R.A, R.PM, R.SE, R.FN, R.CL], create: [R.PM], update: [R.PM], delete: [R.PM] },
  scope: byProject('t.project_id'),
  fields: {
    project_id: { label: 'Project', type: 'ref', required: true, lookup: 'projects', refTable: 'projects', refPk: 'project_id' },
    title: { label: 'Title', type: 'string', required: true, max: 120 },
    description: { label: 'Description', type: 'text', input: 'textarea' },
    assignee_id: { label: 'Assignee', type: 'ref', required: true, virtual: true, lookup: 'staff', refTable: 'users', refPk: 'user_id' },
    priority: { label: 'Priority', type: 'enum', options: ['Low', 'Medium', 'High'], required: true, default: 'Medium' },
    status: { label: 'Status', type: 'enum', options: ['To Do', 'In Progress', 'Done'], required: true, default: 'To Do' },
    progress_pct: { label: 'Progress (%)', type: 'int', min: 0, maxVal: 100, required: true, default: 0 },
    start_date: { label: 'Planned start', type: 'date', required: true },
    due_date: { label: 'Due date', type: 'date', required: true, after: 'start_date' }
  },
  hooks: {
    async validateExtra(d) {
      const errs = [];
      const [p] = await q('SELECT start_date, end_date FROM projects WHERE project_id = ?', [d.project_id]);
      if (d.due_date < d.start_date) errs.push({ field: 'due_date', message: 'Due date cannot be before start date' });
      if (p && d.start_date < p.start_date) errs.push({ field: 'start_date', message: `Task must start within project dates (${p.start_date} to ${p.end_date})` });
      if (p && d.due_date > p.end_date) errs.push({ field: 'due_date', message: `Task must finish within project dates (${p.start_date} to ${p.end_date})` });
      const [u] = await q('SELECT r.role_name, u.is_active FROM users u JOIN roles r ON r.role_id = u.role_id WHERE u.user_id = ?', [d.assignee_id]);
      if (!u || !u.is_active || u.role_name === R.CL) errs.push({ field: 'assignee_id', message: 'Assignee must be an active staff member' });
      return errs;
    },
    async beforeSave(d) {
      if (d.status === 'Done') d.progress_pct = 100;
      else if (d.progress_pct === 100) d.status = 'Done';
      else if (d.progress_pct > 0 && d.status === 'To Do') d.status = 'In Progress';
    },
    async afterSave(conn, id, d) {
      await conn.query('DELETE FROM task_assignments WHERE task_id = ?', [id]);
      await conn.query('INSERT INTO task_assignments (task_id, user_id) VALUES (?, ?)', [id, d.assignee_id]);
    }
  },
  actions: [{
    key: 'progress', label: 'Update progress', roles: [R.PM, R.SE],
    fields: { progress_pct: { label: 'Progress (%)', type: 'int', min: 0, maxVal: 100, required: true } },
    run: async (conn, row, d, req) => {
      if (req.user.role === R.SE && row.assignee_id !== req.user.id) throw new HttpError(403, 'You can only update tasks assigned to you');
      const status = d.progress_pct === 100 ? 'Done' : d.progress_pct > 0 ? 'In Progress' : 'To Do';
      await conn.query('UPDATE tasks SET progress_pct = ?, status = ? WHERE task_id = ?', [d.progress_pct, status, row.task_id]);
    }
  }]
});
