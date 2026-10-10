const express = require('express');
const { q } = require('../config/db');
const { wrap } = require('../lib/errors');
const { budgetRows } = require('../lib/budget');
const { ROLES: R } = require('../config/constants');

const router = express.Router();

// One role-scoped endpoint feeds the dashboard cards, charts and the notification list.
router.get('/', wrap(async (req, res) => {
  const u = req.user, isCL = u.role === R.CL, canStock = u.role !== R.CL;
  const sc = isCL ? 'AND p.client_id = ?' : '', sp = isCL ? [u.client_id || 0] : [];
  const mine = u.role === R.SE ? 'AND EXISTS (SELECT 1 FROM task_assignments x WHERE x.task_id = t.task_id AND x.user_id = ?)' : '';
  const mp = u.role === R.SE ? [u.id] : [];

  const [{ n: activeProjects }] = await q(`SELECT COUNT(*) n FROM projects p WHERE p.status = 'In Progress' AND p.is_archived = 0 ${sc}`, sp);
  const [{ n: overdueTasks }] = await q(`SELECT COUNT(*) n FROM tasks t JOIN projects p ON p.project_id = t.project_id WHERE t.due_date < CURDATE() AND t.status <> 'Done' ${sc} ${mine}`, [...sp, ...mp]);
  const lowStockItems = canStock ? await q('SELECT item_name, quantity_in_stock, reorder_level, unit FROM materials WHERE is_active = 1 AND quantity_in_stock <= reorder_level ORDER BY item_name') : [];
  const budgets = ([R.FN, R.PM, R.A, R.CL].includes(u.role)) ? await budgetRows(u) : [];
  const totalBudget = budgets.reduce((s, b) => s + b.budget, 0), totalUsed = budgets.reduce((s, b) => s + b.used, 0);

  const upcoming = await q(
    `SELECT t.task_id, t.title, t.due_date, t.status, p.project_name, DATEDIFF(t.due_date, CURDATE()) AS days_left
       FROM tasks t JOIN projects p ON p.project_id = t.project_id
      WHERE t.status <> 'Done' ${sc} ${mine} ORDER BY t.due_date LIMIT 8`, [...sp, ...mp]);
  const byStatus = await q(`SELECT p.status, COUNT(*) n FROM projects p WHERE p.is_archived = 0 ${sc} GROUP BY p.status`, sp);

  const overdueList = await q(
    `SELECT t.title, t.due_date, p.project_name FROM tasks t JOIN projects p ON p.project_id = t.project_id
      WHERE t.due_date < CURDATE() AND t.status <> 'Done' ${sc} ${mine} ORDER BY t.due_date LIMIT 10`, [...sp, ...mp]);
  const alerts = [];
  overdueList.forEach(t => alerts.push({ level: 'red', text: `Overdue: "${t.title}" (${t.project_name}) was due ${t.due_date}` }));
  lowStockItems.forEach(m => alerts.push({ level: 'amber', text: `Low stock: ${m.item_name} - ${m.quantity_in_stock} ${m.unit} left (reorder at ${m.reorder_level})` }));
  budgets.filter(b => b.pct >= 80).forEach(b => alerts.push({ level: b.pct > 100 ? 'red' : 'amber', text: `Budget: ${b.project_name} has used ${b.pct}% of its budget` }));

  res.json({ success: true, data: {
    activeProjects, overdueTasks, lowStock: lowStockItems.length, canStock,
    budgetUsedPct: totalBudget ? Math.round((totalUsed / totalBudget) * 1000) / 10 : 0, showBudget: budgets.length > 0 || isCL,
    budgets, upcoming, byStatus, alerts
  } });
}));

module.exports = router;
