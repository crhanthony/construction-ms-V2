require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: +(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'construction_ms',
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true,      // DATE columns come back as 'YYYY-MM-DD'
  decimalNumbers: true    // DECIMAL columns come back as numbers
});

// q(sql, params, conn?) -> rows. All values go through "?" placeholders (no string concatenation).
const q = async (sql, params = [], conn = pool) => (await conn.query(sql, params))[0];

module.exports = { pool, q };
