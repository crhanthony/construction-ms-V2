const makeCrud = require('../lib/crud');
const { ROLES: R } = require('../config/constants');

module.exports = makeCrud({
  key: 'audit', title: 'Audit Log', table: 'audit_log', pk: 'log_id', alias: 'a', pageSize: 25,
  cols: 'a.log_id, a.action, a.table_name, a.record_id, a.log_time, u.full_name, u.username',
  from: 'FROM audit_log a LEFT JOIN users u ON u.user_id = a.user_id',
  search: ['u.username', 'u.full_name', 'a.table_name'],
  filters: { action: 'a.action', table_name: 'a.table_name', user_id: 'a.user_id' },
  filterUi: [{ key: 'action', label: 'Action', options: ['CREATE', 'UPDATE', 'DELETE', 'LOGIN'].map(x => [x, x]) }, { key: 'user_id', label: 'User', lookup: 'allusers' }],
  sort: { log_time: 'a.log_time', action: 'a.action', table_name: 'a.table_name' }, defaultSort: 'a.log_id DESC',
  columns: [{ key: 'log_time', label: 'When' }, { key: 'full_name', label: 'User' }, { key: 'action', label: 'Action', type: 'badge' }, { key: 'table_name', label: 'Table' }, { key: 'record_id', label: 'Record #' }],
  perms: { read: [R.A], create: [], update: [], delete: [] },   // entries are written only by the server
  fields: {}
});
