const makeCrud = require('../lib/crud');
const { q } = require('../config/db');
const { ROLES: R } = require('../config/constants');
const { today } = require('../lib/validate');

const decide = (key, label, to, style) => ({
  key, label, style, roles: [R.PM], when: { field: 'approval_status', in: ['Pending'] }, confirm: `${label} this expense?`,
  run: async (conn, row) => { await conn.query('UPDATE expenses SET approval_status = ? WHERE expense_id = ?', [to, row.expense_id]); }
});

module.exports = makeCrud({
  key: 'expenses', title: 'Expenses', table: 'expenses', pk: 'expense_id', alias: 'e', exportType: 'expenses',
  cols: 'e.expense_id, e.project_id, e.category_id, e.amount, e.expense_date, e.description, e.receipt_ref, e.approval_status, p.project_name, cc.category_name, u.full_name AS recorded_by_name',
  from: 'FROM expenses e JOIN projects p ON p.project_id = e.project_id JOIN cost_categories cc ON cc.category_id = e.category_id JOIN users u ON u.user_id = e.recorded_by',
  search: ['p.project_name', 'cc.category_name', 'e.description', 'e.receipt_ref'],
  filters: { project_id: 'e.project_id', category_id: 'e.category_id', approval_status: 'e.approval_status', from: 'e.expense_date >= ?', to: 'e.expense_date <= ?' },
  filterUi: [{ key: 'project_id', label: 'Project', lookup: 'projects' }, { key: 'category_id', label: 'Category', lookup: 'categories' },
    { key: 'approval_status', label: 'Approval', options: [['Pending', 'Pending'], ['Approved', 'Approved'], ['Rejected', 'Rejected']] }],
  sort: { expense_date: 'e.expense_date', amount: 'e.amount', project_name: 'p.project_name', category_name: 'cc.category_name' }, defaultSort: 'e.expense_date DESC, e.expense_id DESC',
  columns: [{ key: 'expense_date', label: 'Date', type: 'date' }, { key: 'project_name', label: 'Project' }, { key: 'category_name', label: 'Category' },
    { key: 'amount', label: 'Amount', type: 'money' }, { key: 'description', label: 'Description' }, { key: 'approval_status', label: 'Approval', type: 'badge' }],
  perms: { read: [R.FN, R.PM, R.A], create: [R.FN], update: [R.FN], delete: [R.FN] },
  deleteWarning: 'The deletion will be recorded in the audit log.',
  fields: {
    project_id: { label: 'Project', type: 'ref', required: true, lookup: 'projects', refTable: 'projects', refPk: 'project_id' },
    category_id: { label: 'Cost category', type: 'ref', required: true, lookup: 'categories', refTable: 'cost_categories', refPk: 'category_id' },
    amount: { label: 'Amount (LKR)', type: 'decimal', required: true, positive: true },
    expense_date: { label: 'Date', type: 'date', required: true, noFuture: true, default: today },
    description: { label: 'Description', type: 'string', max: 200 },
    receipt_ref: { label: 'Receipt reference', type: 'string', max: 60 }
  },
  extraColumns: ['recorded_by', 'approval_status'],
  hooks: {
    async beforeSave(d, req, existing) {
      if (!existing) { d.recorded_by = req.user.id; d.approval_status = 'Pending'; }
      else if (existing.approval_status !== 'Pending') d.approval_status = 'Pending';   // corrected or changed -> needs approval again
    },
    // Warn (but still save) when the project's total would exceed 80% / 100% of budget.
    async afterSave(conn, id, d) {
      const [[b]] = await conn.query(`SELECT p.budget, (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE project_id = p.project_id AND approval_status <> 'Rejected') AS used FROM projects p WHERE p.project_id = ?`, [d.project_id]);
      const pct = Math.round((Number(b.used) / Number(b.budget)) * 1000) / 10;
      if (pct > 100) return { warning: `Saved, but expenses are now ${pct}% of the project budget (over budget).` };
      if (pct >= 80) return { warning: `Saved. ${pct}% of the project budget is now used.` };
    }
  },
  actions: [decide('approve', 'Approve', 'Approved', 'ok'), decide('reject', 'Reject', 'Rejected', 'danger')]
});
