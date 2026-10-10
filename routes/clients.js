const makeCrud = require('../lib/crud');
const { ROLES: R } = require('../config/constants');
const PHONE = /^[0-9+()\- ]{7,20}$/;

module.exports = makeCrud({
  key: 'clients', title: 'Clients', table: 'clients', pk: 'client_id', alias: 'c',
  cols: 'c.client_id, c.client_name, c.contact_person, c.phone, c.email, (SELECT COUNT(*) FROM projects p WHERE p.client_id = c.client_id) AS project_count',
  from: 'FROM clients c',
  search: ['c.client_name', 'c.contact_person', 'c.email'],
  sort: { client_name: 'c.client_name', contact_person: 'c.contact_person' }, defaultSort: 'c.client_name',
  columns: [{ key: 'client_name', label: 'Client' }, { key: 'contact_person', label: 'Contact' }, { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'Email' }, { key: 'project_count', label: 'Projects' }],
  perms: { read: [R.PM, R.A], create: [R.PM, R.A], update: [R.PM, R.A], delete: [R.PM, R.A] },
  fields: {
    client_name: { label: 'Client name', type: 'string', required: true, max: 100 },
    contact_person: { label: 'Contact person', type: 'string', max: 100 },
    phone: { label: 'Phone', type: 'string', max: 20, pattern: PHONE, patternMsg: 'Enter a valid phone number' },
    email: { label: 'Email', type: 'email' }
  },
  inUseMessage: 'Cannot delete: this client has projects'
});
