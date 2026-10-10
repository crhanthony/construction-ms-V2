// Minor functions 4 and 10: PDF/CSV export and database backup.
const express = require('express');
const PDFDocument = require('pdfkit');
const { q } = require('../config/db');
const { wrap, HttpError } = require('../lib/errors');
const { budgetRows } = require('../lib/budget');
const { ROLES: R } = require('../config/constants');

const router = express.Router();

const SETS = {
  projects: async user => ({ title: 'Project budget summary', rows: await budgetRows(user), columns: [
    ['project_name', 'Project'], ['client_name', 'Client'], ['status', 'Status'], ['budget', 'Budget'], ['used', 'Used'], ['remaining', 'Remaining'], ['pct', '% used']] }),
  expenses: async () => ({ title: 'Expense list', columns: [['expense_date', 'Date'], ['project_name', 'Project'], ['category_name', 'Category'], ['amount', 'Amount'], ['description', 'Description'], ['approval_status', 'Approval']],
    rows: await q(`SELECT e.expense_date, p.project_name, cc.category_name, e.amount, e.description, e.approval_status FROM expenses e JOIN projects p ON p.project_id = e.project_id JOIN cost_categories cc ON cc.category_id = e.category_id ORDER BY e.expense_date DESC`) }),
  materials: async () => ({ title: 'Inventory', columns: [['item_name', 'Item'], ['item_type', 'Type'], ['quantity_in_stock', 'In stock'], ['unit', 'Unit'], ['reorder_level', 'Reorder level'], ['unit_cost', 'Unit cost'], ['supplier_name', 'Supplier']],
    rows: await q('SELECT m.*, s.supplier_name FROM materials m LEFT JOIN suppliers s ON s.supplier_id = m.supplier_id ORDER BY m.item_name') }),
  tasks: async () => ({ title: 'Task schedule', columns: [['project_name', 'Project'], ['title', 'Task'], ['status', 'Status'], ['progress_pct', '% done'], ['start_date', 'Start'], ['due_date', 'Due']],
    rows: await q('SELECT p.project_name, t.title, t.status, t.progress_pct, t.start_date, t.due_date FROM tasks t JOIN projects p ON p.project_id = t.project_id ORDER BY p.project_name, t.due_date') })
};

// Cells starting with = + - @ are prefixed so spreadsheets cannot run them as formulas.
const csvCell = v => { let s = v === null || v === undefined ? '' : String(v); if (/^[=+\-@]/.test(s) && isNaN(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };

router.get('/export/:type', wrap(async (req, res) => {
  if (![R.PM, R.FN, R.A].includes(req.user.role)) throw new HttpError(403, 'Access denied');
  const set = SETS[req.params.type];
  if (!set) throw new HttpError(404, 'Unknown report');
  const { title, columns, rows } = await set(req.user);
  const stamp = new Date().toISOString().slice(0, 10), name = `${req.params.type}-${stamp}`;

  if (req.query.format === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.pdf"`);
    const doc = new PDFDocument({ margin: 36, size: 'A4', layout: 'landscape' });
    doc.pipe(res);
    doc.fontSize(16).fillColor('#1F3A5F').text(title).fontSize(9).fillColor('#666').text(`Generated ${new Date().toLocaleString()} by ${req.user.full_name}`).moveDown();
    const w = (doc.page.width - 72) / columns.length;
    const row = (cells, bold) => {
      if (doc.y > doc.page.height - 60) doc.addPage();
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor('#000');
      cells.forEach((c, i) => doc.text(String(c ?? ''), 36 + i * w, y, { width: w - 6, height: 24, ellipsis: true }));
      doc.y = y + 18; doc.moveTo(36, doc.y - 3).lineTo(doc.page.width - 36, doc.y - 3).strokeColor('#ccc').stroke();
    };
    row(columns.map(c => c[1]), true);
    rows.forEach(r => row(columns.map(c => r[c[0]])));
    doc.end();
  } else {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
    res.send('\uFEFF' + [columns.map(c => csvCell(c[1])).join(','), ...rows.map(r => columns.map(c => csvCell(r[c[0]])).join(','))].join('\r\n'));
  }
}));

const TABLES = ['roles', 'clients', 'users', 'projects', 'tasks', 'task_assignments', 'cost_categories', 'expenses', 'suppliers', 'materials',
  'stock_transactions', 'site_reports', 'documents', 'audit_log', 'incidents'];
router.get('/backup', wrap(async (req, res) => {
  if (req.user.role !== R.A) throw new HttpError(403, 'Access denied');
  const dump = { created: new Date().toISOString(), tables: {} };
  for (const t of TABLES) dump.tables[t] = await q(`SELECT * FROM ${t}`);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.send(JSON.stringify(dump, null, 2));
}));

module.exports = router;
