const { ROLES: R } = require('../config/constants');
// Clients only see rows that belong to their own company's projects.
exports.byClient = column => req =>
  req.user.role === R.CL ? { sql: `${column} = ?`, params: [req.user.client_id || 0] } : null;
exports.byProject = column => req =>
  req.user.role === R.CL
    ? { sql: `${column} IN (SELECT project_id FROM projects WHERE client_id = ?)`, params: [req.user.client_id || 0] }
    : null;
