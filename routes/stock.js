const makeCrud = require('../lib/crud');
const { q } = require('../config/db');
const { HttpError } = require('../lib/errors');
const { ROLES: R } = require('../config/constants');
const { today } = require('../lib/validate');
const cents = n => Math.round(Number(n) * 100);

module.exports = makeCrud({
  key: 'stock', title: 'Stock In / Out', table: 'stock_transactions', pk: 'txn_id', alias: 'st',
  cols: 'st.txn_id, st.material_id, st.project_id, st.txn_type, st.quantity, st.txn_date, m.item_name, m.unit, p.project_name, u.full_name AS recorded_by_name',
  from: 'FROM stock_transactions st JOIN materials m ON m.material_id = st.material_id LEFT JOIN projects p ON p.project_id = st.project_id JOIN users u ON u.user_id = st.recorded_by',
  search: ['m.item_name', 'p.project_name'],
  filters: { material: 'st.material_id', project: 'st.project_id', txn_type: 'st.txn_type' },
  filterUi: [{ key: 'material', label: 'Item', lookup: 'materials' }, { key: 'project', label: 'Project', lookup: 'projects' }, { key: 'txn_type', label: 'Type', options: [['IN', 'Stock in'], ['OUT', 'Stock out']] }],
  sort: { txn_date: 'st.txn_date', item_name: 'm.item_name', quantity: 'st.quantity' }, defaultSort: 'st.txn_id DESC',
  columns: [{ key: 'txn_date', label: 'Date', type: 'date' }, { key: 'txn_type', label: 'Type', type: 'badge' }, { key: 'item_name', label: 'Item' },
    { key: 'quantity', label: 'Quantity' }, { key: 'unit', label: 'Unit' }, { key: 'project_name', label: 'Project' }, { key: 'recorded_by_name', label: 'Recorded by' }],
  perms: { read: [R.FN, R.SE, R.PM, R.A], create: [R.FN, R.SE], update: [], delete: [R.FN] },
  deleteWarning: 'Deleting a transaction reverses its effect on the stock balance.',
  fields: {
    material_id: { label: 'Item', type: 'ref', required: true, lookup: 'materials', refTable: 'materials', refPk: 'material_id' },
    txn_type: { label: 'Transaction', type: 'enum', options: ['IN', 'OUT'], required: true, default: 'IN', help: 'IN = stock received, OUT = issued to a project' },
    project_id: { label: 'Project', type: 'ref', lookup: 'projects', refTable: 'projects', refPk: 'project_id', help: 'Required when issuing stock (OUT)' },
    quantity: { label: 'Quantity', type: 'decimal', required: true, positive: true },
    txn_date: { label: 'Date', type: 'date', required: true, noFuture: true, default: today }
  },
  hooks: {
    async validateExtra(d, req) {
      const errs = [];
      if (d.txn_type === 'OUT' && !d.project_id) errs.push({ field: 'project_id', message: 'Project is required when issuing stock' });
      if (req.user.role === R.SE && d.txn_type === 'IN') errs.push({ field: 'txn_type', message: 'Site engineers can only issue stock (OUT)' });
      const [m] = await q('SELECT is_active FROM materials WHERE material_id = ?', [d.material_id]);
      if (m && !m.is_active) errs.push({ field: 'material_id', message: 'This item is inactive' });
      return errs;
    },
    // Business logic 7.2: lock the row, check balance, insert transaction + update balance atomically.
    async create(conn, d, req) {
      const [[m]] = await conn.query('SELECT item_name, quantity_in_stock, reorder_level FROM materials WHERE material_id = ? FOR UPDATE', [d.material_id]);
      if (d.txn_type === 'OUT' && cents(d.quantity) > cents(m.quantity_in_stock))
        throw new HttpError(400, 'Insufficient stock', [{ field: 'quantity', message: `Only ${m.quantity_in_stock} units in stock` }]);
      const [ins] = await conn.query('INSERT INTO stock_transactions (material_id, project_id, recorded_by, txn_type, quantity, txn_date) VALUES (?)',
        [[d.material_id, d.txn_type === 'OUT' ? d.project_id : d.project_id || null, req.user.id, d.txn_type, d.quantity, d.txn_date]]);
      const delta = d.txn_type === 'IN' ? d.quantity : -d.quantity;
      await conn.query('UPDATE materials SET quantity_in_stock = quantity_in_stock + ? WHERE material_id = ?', [delta, d.material_id]);
      const balance = (cents(m.quantity_in_stock) + cents(delta)) / 100;
      const low = balance <= Number(m.reorder_level);
      return { id: ins.insertId, extra: { balance, lowStock: low, warning: low ? `Low stock: ${m.item_name} is now ${balance} (reorder level ${m.reorder_level})` : undefined } };
    },
    async remove(conn, row) {
      const [[m]] = await conn.query('SELECT quantity_in_stock FROM materials WHERE material_id = ? FOR UPDATE', [row.material_id]);
      const delta = row.txn_type === 'IN' ? -row.quantity : row.quantity;
      if (cents(m.quantity_in_stock) + cents(delta) < 0) throw new HttpError(409, 'Cannot delete: stock has already been used, the balance would go negative');
      await conn.query('DELETE FROM stock_transactions WHERE txn_id = ?', [row.txn_id]);
      await conn.query('UPDATE materials SET quantity_in_stock = quantity_in_stock + ? WHERE material_id = ?', [delta, row.material_id]);
    }
  }
});
