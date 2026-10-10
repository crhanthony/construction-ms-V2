// npm run setup  -> creates the database + tables and loads sample data (only when the DB is empty)
// npm run reset  -> drops the database first, then does the above
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const DB = process.env.DB_NAME || 'construction_ms';
const reset = process.argv.includes('--reset');

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1', port: +(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '',
    multipleStatements: true, dateStrings: true
  });
  if (reset) { await conn.query(`DROP DATABASE IF EXISTS \`${DB}\``); console.log('Dropped database', DB); }
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.query(`USE \`${DB}\``);
  await conn.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  console.log('Tables ready.');

  const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM roles');
  if (n > 0) { console.log('Sample data already present - skipping seed.'); return conn.end(); }

  const ins = async (sql, rows) => (await conn.query(sql, [rows]))[0];
  const day = off => { const d = new Date(); d.setDate(d.getDate() + off); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };   // local date (matches server validation)

  await ins('INSERT INTO roles (role_name, description) VALUES ?', [
    ['Administrator', 'Manages users, roles and the system'], ['Project Manager', 'Plans and delivers projects'],
    ['Site Engineer', 'Works on site and reports progress'], ['Finance Officer', 'Buys materials and tracks costs'],
    ['Client', 'Read-only view of own projects']]);
  await ins('INSERT INTO clients (client_name, contact_person, phone, email) VALUES ?', [
    ['Lanka Heights Developers', 'Nimal Perera', '0112345678', 'nimal@lankaheights.example'],
    ['Ocean View Resorts', 'Shalini Fernando', '0314567890', 'shalini@oceanview.example']]);

  const hash = p => bcrypt.hashSync(p, 10);
  await ins('INSERT INTO users (role_id, client_id, full_name, email, username, password_hash) VALUES ?', [
    [1, null, 'System Admin',      'admin@buildtrack.example',    'admin',    hash('Admin123')],
    [2, null, 'Kasun Manager',     'pm@buildtrack.example',       'manager',  hash('Manager123')],
    [3, null, 'Dilini Engineer',   'engineer@buildtrack.example', 'engineer', hash('Engineer123')],
    [4, null, 'Ruwan Finance',     'finance@buildtrack.example',  'finance',  hash('Finance123')],
    [5, 1,    'Nimal Perera',      'client@buildtrack.example',   'client',   hash('Client123')],
    [3, null, 'Chamara Supervisor','chamara@buildtrack.example',  'chamara',  hash('Engineer123')]]);

  await ins('INSERT INTO cost_categories (category_name) VALUES ?', [['Labour'], ['Materials'], ['Equipment'], ['Transport'], ['Other']]);
  await ins('INSERT INTO suppliers (supplier_name, phone, email) VALUES ?', [
    ['Ceylon Cement Depot', '0112223344', 'sales@cementdepot.example'], ['Steel & Rebar Traders', '0112556677', 'info@steelrebar.example'],
    ['Heavy Equipment Rentals', '0777123456', 'hire@heavyrent.example']]);
  await ins('INSERT INTO materials (supplier_id, item_name, item_type, unit, quantity_in_stock, unit_cost, reorder_level) VALUES ?', [
    [1, 'Portland Cement (50kg bag)', 'Material', 'bag', 400, 1950, 100],
    [2, 'Steel Rebar 12mm', 'Material', 'kg', 1200, 285, 500],
    [1, 'River Sand', 'Material', 'cube', 18, 14500, 20],
    [3, 'Concrete Mixer', 'Equipment', 'unit', 3, 8500, 1]]);

  await ins('INSERT INTO projects (client_id, manager_id, project_name, location, start_date, end_date, budget, status, description) VALUES ?', [
    [1, 2, 'Tower A', 'Colombo 03', day(-90), day(200), 12000000, 'In Progress', '12-storey residential tower'],
    [1, 2, 'Garden Villas', 'Negombo', day(10), day(300), 8000000, 'Planned', 'Eight detached villas'],
    [2, 2, 'Beachfront Hotel Wing', 'Galle', day(-150), day(60), 5000000, 'In Progress', 'New 40-room wing']]);

  await ins('INSERT INTO tasks (project_id, title, description, priority, status, progress_pct, start_date, due_date) VALUES ?', [
    [1, 'Pour slab - Block A', 'Level 4 slab pour', 'High', 'In Progress', 60, day(-20), day(-2)],
    [1, 'Order rebar', 'Rebar for levels 5-6', 'Medium', 'To Do', 0, day(-1), day(2)],
    [1, 'Electrical rough-in', 'Levels 1-3', 'Medium', 'In Progress', 30, day(-5), day(5)],
    [1, 'Site inspection', 'Municipal inspection', 'High', 'To Do', 0, day(3), day(7)],
    [3, 'Roofing submittal', 'Submit roofing samples', 'Low', 'To Do', 0, day(1), day(9)],
    [3, 'Plastering - ground floor', 'Internal plaster', 'Medium', 'Done', 100, day(-60), day(-30)]]);
  await ins('INSERT INTO task_assignments (task_id, user_id) VALUES ?', [[1, 3], [2, 3], [3, 3], [4, 6], [5, 3], [6, 6]]);

  await ins('INSERT INTO expenses (project_id, category_id, recorded_by, amount, expense_date, description, receipt_ref, approval_status) VALUES ?', [
    [1, 2, 4, 3200000, day(-60), 'Cement and sand - phase 1', 'INV-1001', 'Approved'],
    [1, 1, 4, 2400000, day(-30), 'Labour - February', 'PAY-0221', 'Approved'],
    [1, 3, 4, 1100000, day(-10), 'Crane hire', 'INV-1044', 'Pending'],
    [3, 2, 4, 3900000, day(-40), 'Fittings and finishes', 'INV-0932', 'Approved'],
    [3, 1, 4, 700000, day(-5), 'Labour - last month', 'PAY-0310', 'Pending']]);
  await ins('INSERT INTO stock_transactions (material_id, project_id, recorded_by, txn_type, quantity, txn_date) VALUES ?', [
    [1, null, 4, 'IN', 500, day(-45)], [1, 1, 3, 'OUT', 100, day(-20)], [3, 1, 3, 'OUT', 7, day(-10)], [3, null, 4, 'IN', 25, day(-50)]]);
  await ins('INSERT INTO site_reports (project_id, author_id, report_date, weather, workers_present, work_done, issues, is_approved) VALUES ?', [
    [1, 3, day(-2), 'Sunny', 24, 'Formwork completed for Level 4 slab; rebar fixing started.', 'Concrete pump delayed 2 hours.', 1],
    [1, 3, day(-1), 'Cloudy', 22, 'Slab pour completed for half of Block A.', null, 0]]);
  await ins('INSERT INTO incidents (project_id, reported_by, incident_date, severity, description, action_taken) VALUES ?', [
    [1, 3, day(-12), 'Near miss', 'Loose scaffold plank noticed on level 3.', 'Plank secured; toolbox talk held.']]);
  console.log('Sample data loaded. Demo logins: admin/Admin123, manager/Manager123, engineer/Engineer123, finance/Finance123, client/Client123');
  await conn.end();
})().catch(e => {
  const code = e.code || (e.errors && e.errors[0] && e.errors[0].code) || '';
  console.error('Setup failed:', e.message || code || e);
  if (code === 'ECONNREFUSED') console.error('-> MySQL is not running (or wrong DB_HOST/DB_PORT in .env). Start MySQL / XAMPP first, then run "npm run setup" again.');
  if (code === 'ER_ACCESS_DENIED_ERROR') console.error('-> Wrong DB_USER / DB_PASSWORD in .env.');
  process.exit(1);
});
