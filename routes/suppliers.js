const makeCrud = require('../lib/crud');
const { q } = require('../config/db');
const { HttpError } = require('../lib/errors');
const { ROLES: R } = require('../config/constants');

module.exports = makeCrud({
  key: 'suppliers', title: 'Suppliers', table: 'suppliers', pk: 'supplier_id', alias: 's',
  cols: 's.supplier_id, s.supplier_name, s.phone, s.email, (SELECT COUNT(*) FROM materials m WHERE m.supplier_id = s.supplier_id) AS item_count',
  from: 'FROM suppliers s', search: ['s.supplier_name', 's.email'],
  sort: { supplier_name: 's.supplier_name' }, defaultSort: 's.supplier_name',
  columns: [{ key: 'supplier_name', label: 'Supplier' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }, { key: 'item_count', label: 'Items' }],
  perms: { read: [R.FN, R.SE, R.PM, R.A], create: [R.FN, R.A], update: [R.FN, R.A], delete: [R.FN, R.A] },
  fields: {
    supplier_name: { label: 'Supplier name', type: 'string', required: true, max: 100 },
    phone: { label: 'Phone', type: 'string', max: 20, pattern: /^[0-9+()\- ]{7,20}$/, patternMsg: 'Enter a valid phone number' },
    email: { label: 'Email', type: 'email' }
  },
  hooks: {
    async beforeDelete(req, row) {
      const [{ n }] = await q('SELECT COUNT(*) n FROM materials WHERE supplier_id = ?', [row.supplier_id]);
      if (n) throw new HttpError(409, `Cannot delete: supplier is used by ${n} material(s)`);
    }
  }
});
