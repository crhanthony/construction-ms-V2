const { q } = require('../config/db');
const { ROLES: R } = require('../config/constants');

// Budget used = approved + pending expenses (rejected ones are ignored). One query shared by the
// budget page, dashboard, alerts and exports so the figures always agree.
exports.budgetRows = async (user, projectId) => {
  const where = ['p.is_archived = 0'], params = [];
  if (user.role === R.CL) { where.push('p.client_id = ?'); params.push(user.client_id || 0); }
  if (projectId) { where.push('p.project_id = ?'); params.push(projectId); }
  const rows = await q(
    `SELECT p.project_id, p.project_name, c.client_name, p.status, p.budget,
            COALESCE(SUM(CASE WHEN e.approval_status <> 'Rejected' THEN e.amount END), 0) AS used
       FROM projects p JOIN clients c ON c.client_id = p.client_id
       LEFT JOIN expenses e ON e.project_id = p.project_id
      WHERE ${where.join(' AND ')}
      GROUP BY p.project_id, p.project_name, c.client_name, p.status, p.budget
      ORDER BY p.project_name`, params);
  return rows.map(r => {
    const used = Number(r.used), budget = Number(r.budget);
    const pct = budget ? Math.round((used / budget) * 1000) / 10 : 0;
    return { ...r, used, budget, remaining: Math.round((budget - used) * 100) / 100, pct,
             level: pct > 100 ? 'red' : pct >= 80 ? 'amber' : 'green' };
  });
};
