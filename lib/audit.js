const { pool } = require('../config/db');
// Records who did what. Pass a transaction connection so the log commits/rolls back with the change.
exports.log = async (conn, userId, action, table, recordId) => {
  await (conn || pool).query(
    'INSERT INTO audit_log (user_id, action, table_name, record_id) VALUES (?, ?, ?, ?)',
    [userId || null, action, table, recordId || null]
  );
};
