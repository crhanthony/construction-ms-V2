-- Web-Based Construction Management System - schema (MySQL 8 / InnoDB, 3NF)
-- Run via "npm run setup" (creates the database too). In Workbench: CREATE DATABASE construction_ms; USE construction_ms; then run this file.

CREATE TABLE IF NOT EXISTS roles (
  role_id     INT AUTO_INCREMENT PRIMARY KEY,
  role_name   VARCHAR(30) NOT NULL UNIQUE,
  description VARCHAR(150) NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS clients (
  client_id      INT AUTO_INCREMENT PRIMARY KEY,
  client_name    VARCHAR(100) NOT NULL,
  contact_person VARCHAR(100) NULL,
  phone          VARCHAR(20)  NULL,
  email          VARCHAR(120) NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
  user_id       INT AUTO_INCREMENT PRIMARY KEY,
  role_id       INT NOT NULL,
  client_id     INT NULL,                       -- only set for users with the Client role
  full_name     VARCHAR(100) NOT NULL,
  email         VARCHAR(120) NOT NULL UNIQUE,
  username      VARCHAR(40)  NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,          -- bcrypt
  is_active     BOOLEAN NOT NULL DEFAULT 1,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_role   FOREIGN KEY (role_id)   REFERENCES roles(role_id)     ON DELETE RESTRICT,
  CONSTRAINT fk_users_client FOREIGN KEY (client_id) REFERENCES clients(client_id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS projects (
  project_id   INT AUTO_INCREMENT PRIMARY KEY,
  client_id    INT NOT NULL,
  manager_id   INT NOT NULL,
  project_name VARCHAR(120) NOT NULL,
  location     VARCHAR(150) NULL,
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,
  budget       DECIMAL(12,2) NOT NULL,
  status       ENUM('Planned','In Progress','On Hold','Completed') NOT NULL DEFAULT 'Planned',
  description  TEXT NULL,
  is_archived  BOOLEAN NOT NULL DEFAULT 0,
  UNIQUE KEY uq_project_client_name (client_id, project_name),
  CONSTRAINT ck_project_dates  CHECK (end_date >= start_date),
  CONSTRAINT ck_project_budget CHECK (budget > 0),
  CONSTRAINT fk_projects_client  FOREIGN KEY (client_id)  REFERENCES clients(client_id) ON DELETE RESTRICT,
  CONSTRAINT fk_projects_manager FOREIGN KEY (manager_id) REFERENCES users(user_id)     ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tasks (
  task_id      INT AUTO_INCREMENT PRIMARY KEY,
  project_id   INT NOT NULL,
  title        VARCHAR(120) NOT NULL,
  description  TEXT NULL,
  priority     ENUM('Low','Medium','High') NOT NULL DEFAULT 'Medium',
  status       ENUM('To Do','In Progress','Done') NOT NULL DEFAULT 'To Do',
  progress_pct TINYINT NOT NULL DEFAULT 0,
  start_date   DATE NOT NULL,
  due_date     DATE NOT NULL,
  INDEX idx_tasks_due (due_date, status),
  CONSTRAINT ck_task_progress CHECK (progress_pct BETWEEN 0 AND 100),
  CONSTRAINT ck_task_dates    CHECK (due_date >= start_date),
  CONSTRAINT fk_tasks_project FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS task_assignments (
  assignment_id INT AUTO_INCREMENT PRIMARY KEY,
  task_id       INT NOT NULL,
  user_id       INT NOT NULL,
  assigned_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_task_user (task_id, user_id),
  CONSTRAINT fk_ta_task FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE CASCADE,
  CONSTRAINT fk_ta_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS cost_categories (
  category_id   INT AUTO_INCREMENT PRIMARY KEY,
  category_name VARCHAR(50) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS expenses (
  expense_id      INT AUTO_INCREMENT PRIMARY KEY,
  project_id      INT NOT NULL,
  category_id     INT NOT NULL,
  recorded_by     INT NOT NULL,
  amount          DECIMAL(12,2) NOT NULL,
  expense_date    DATE NOT NULL,
  description     VARCHAR(200) NULL,
  receipt_ref     VARCHAR(60)  NULL,
  approval_status ENUM('Pending','Approved','Rejected') NOT NULL DEFAULT 'Pending',
  INDEX idx_expenses_project (project_id, approval_status),
  CONSTRAINT ck_expense_amount CHECK (amount > 0),
  CONSTRAINT fk_exp_project  FOREIGN KEY (project_id)  REFERENCES projects(project_id)        ON DELETE RESTRICT,
  CONSTRAINT fk_exp_category FOREIGN KEY (category_id) REFERENCES cost_categories(category_id) ON DELETE RESTRICT,
  CONSTRAINT fk_exp_user     FOREIGN KEY (recorded_by) REFERENCES users(user_id)               ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS suppliers (
  supplier_id   INT AUTO_INCREMENT PRIMARY KEY,
  supplier_name VARCHAR(100) NOT NULL,
  phone         VARCHAR(20)  NULL,
  email         VARCHAR(120) NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS materials (
  material_id       INT AUTO_INCREMENT PRIMARY KEY,
  supplier_id       INT NULL,
  item_name         VARCHAR(100) NOT NULL UNIQUE,
  item_type         ENUM('Material','Equipment') NOT NULL DEFAULT 'Material',
  unit              VARCHAR(20) NOT NULL,
  quantity_in_stock DECIMAL(10,2) NOT NULL DEFAULT 0,   -- running balance, changed only by stock_transactions
  unit_cost         DECIMAL(10,2) NOT NULL DEFAULT 0,
  reorder_level     DECIMAL(10,2) NOT NULL DEFAULT 0,
  is_active         BOOLEAN NOT NULL DEFAULT 1,
  CONSTRAINT ck_mat_qty  CHECK (quantity_in_stock >= 0),
  CONSTRAINT ck_mat_cost CHECK (unit_cost >= 0),
  CONSTRAINT fk_mat_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(supplier_id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS stock_transactions (
  txn_id      INT AUTO_INCREMENT PRIMARY KEY,
  material_id INT NOT NULL,
  project_id  INT NULL,                       -- required for OUT (enforced in the API)
  recorded_by INT NOT NULL,
  txn_type    ENUM('IN','OUT') NOT NULL,
  quantity    DECIMAL(10,2) NOT NULL,
  txn_date    DATE NOT NULL,
  CONSTRAINT ck_txn_qty CHECK (quantity > 0),
  CONSTRAINT fk_txn_material FOREIGN KEY (material_id) REFERENCES materials(material_id) ON DELETE RESTRICT,
  CONSTRAINT fk_txn_project  FOREIGN KEY (project_id)  REFERENCES projects(project_id)   ON DELETE RESTRICT,
  CONSTRAINT fk_txn_user     FOREIGN KEY (recorded_by) REFERENCES users(user_id)         ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS site_reports (
  report_id       INT AUTO_INCREMENT PRIMARY KEY,
  project_id      INT NOT NULL,
  author_id       INT NOT NULL,
  report_date     DATE NOT NULL,
  weather         VARCHAR(40) NULL,
  workers_present INT NOT NULL DEFAULT 0,
  work_done       TEXT NOT NULL,
  issues          TEXT NULL,
  is_approved     BOOLEAN NOT NULL DEFAULT 0,
  UNIQUE KEY uq_report_project_day (project_id, report_date),
  CONSTRAINT ck_report_workers CHECK (workers_present >= 0),
  CONSTRAINT fk_report_project FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
  CONSTRAINT fk_report_author  FOREIGN KEY (author_id)  REFERENCES users(user_id)       ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS documents (
  document_id INT AUTO_INCREMENT PRIMARY KEY,
  project_id  INT NOT NULL,
  report_id   INT NULL,
  uploaded_by INT NOT NULL,
  file_name   VARCHAR(150) NOT NULL,          -- original name shown to users
  file_path   VARCHAR(255) NOT NULL,          -- random name inside /uploads
  file_size   INT NOT NULL DEFAULT 0,
  description VARCHAR(200) NULL,
  uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_doc_project FOREIGN KEY (project_id)  REFERENCES projects(project_id)     ON DELETE CASCADE,
  CONSTRAINT fk_doc_report  FOREIGN KEY (report_id)   REFERENCES site_reports(report_id)  ON DELETE SET NULL,
  CONSTRAINT fk_doc_user    FOREIGN KEY (uploaded_by) REFERENCES users(user_id)            ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_log (
  log_id     INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NULL,
  action     ENUM('CREATE','UPDATE','DELETE','LOGIN') NOT NULL,
  table_name VARCHAR(40) NOT NULL,
  record_id  INT NULL,
  log_time   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_time (log_time),
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Minor function 8: safety incident log (14 core tables + this extension table)
CREATE TABLE IF NOT EXISTS incidents (
  incident_id   INT AUTO_INCREMENT PRIMARY KEY,
  project_id    INT NOT NULL,
  reported_by   INT NOT NULL,
  incident_date DATE NOT NULL,
  severity      ENUM('Near miss','Minor','Major') NOT NULL DEFAULT 'Near miss',
  description   TEXT NOT NULL,
  action_taken  TEXT NULL,
  CONSTRAINT fk_inc_project FOREIGN KEY (project_id)  REFERENCES projects(project_id) ON DELETE CASCADE,
  CONSTRAINT fk_inc_user    FOREIGN KEY (reported_by) REFERENCES users(user_id)       ON DELETE RESTRICT
) ENGINE=InnoDB;
