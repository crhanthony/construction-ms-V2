const makeCrud = require('../lib/crud');
const { q } = require('../config/db');
const { HttpError } = require('../lib/errors');
const { ROLES: R } = require('../config/constants');

module.exports = makeCrud({
  key: 'materials', title: 'Materials & Equipment', table: 'materials', pk: 'material_id', alias: 'm', exportType: 'materials',
  cols: 'm.material_id, m.supplier_id, m.item_name, m.item_type, m.unit, m.quantity_in_stock, m.unit_cost, m.reorder_level, m.is_active, s.supplier_name, (m.quantity_in_stock <= m.reorder_level) AS is_low',
  from: 'FROM materials m LEFT JOIN suppliers s ON s.supplier_id = m.supplier_id',
  search: ['m.item_name', 's.supplier_name'],
  filters: { item_type: 'm.item_type', supplier_id: 'm.supplier_id', low: '(m.quantity_in_stock <= m.reorder_level) = ?', is_active: 'm.is_active' },
  filterUi: [{ key: 'item_type', label: 'Type', options: [['Material', 'Material'], ['Equipment', 'Equipment']] },
    { key: 'low', label: 'Stock', options: [['1', 'Low stock only']] }, { key: 'is_active', label: 'Status', options: [['1', 'Active'], ['0', 'Inactive']] }],
  sort: { item_name: 'm.item_name', quantity_in_stock: 'm.quantity_in_stock', unit_cost: 'm.unit_cost', supplier_name: 's.supplier_name' },
  defaultSort: 'm.item_name',
  columns: [{ key: 'item_name', label: 'Item' }, { key: 'item_type', label: 'Type' }, { key: 'quantity_in_stock', label: 'In stock', type: 'stock' },
    { key: 'reorder_level', label: 'Reorder at' }, { key: 'unit_cost', label: 'Unit cost', type: 'money' }, { key: 'supplier_name', label: 'Supplier' },
    { key: 'is_active', label: 'Status', type: 'active' }],
  perms: { read: [R.FN, R.SE, R.PM, R.A], create: [R.FN, R.A], update: [R.FN, R.A], delete: [R.FN, R.A] },
  fields: {
    item_name: { label: 'Item name', type: 'string', required: true, max: 100 },
    item_type: { label: 'Type', type: 'enum', options: ['Material', 'Equipment'], required: true, default: 'Material' },
    unit: { label: 'Unit (bag, kg, m3 ...)', type: 'string', required: true, max: 20 },
    supplier_id: { label: 'Supplier', type: 'ref', lookup: 'suppliers', refTable: 'suppliers', refPk: 'supplier_id' },
    unit_cost: { label: 'Unit cost (LKR)', type: 'decimal', required: true, nonNegative: true, default: 0 },
    reorder_level: { label: 'Reorder level', type: 'decimal', required: true, nonNegative: true, default: 0, help: 'A low-stock alert appears at or below this quantity' },
    is_active: { label: 'Active', type: 'bool', default: 1 }
  },
  dup: { item_name: { field: 'item_name', message: 'An item with this name already exists' } },
  inUseMessage: 'Cannot delete: item has stock transactions. Mark it inactive instead.',
  hooks: {
    async beforeDelete(req, row) {
      const [{ n }] = await q('SELECT COUNT(*) n FROM stock_transactions WHERE material_id = ?', [row.material_id]);
      if (n) throw new HttpError(409, 'Cannot delete: item has stock transactions. Mark it inactive instead.');
    }
  }
});
