# BuildTrack - Web-Based Construction Management System (SE2030)

Node.js + Express + MySQL web application implementing the six major functions and the ten minor functions from the Project Proposal and System Design Document. Every module supports Create / Read / Update / Delete with client-side and server-side validation.

## Run it (5 steps)

1. Install **Node.js 18+** and **MySQL 8** (or XAMPP/MariaDB) and start the database server.
2. Open a terminal in this folder and install dependencies:
   ```
   npm install
   ```
3. Copy `.env.example` to `.env` and set `DB_USER` / `DB_PASSWORD` (XAMPP default: user `root`, empty password). `DB_HOST` is `127.0.0.1` on purpose: `localhost` can resolve to IPv6 on newer Node versions and be refused by XAMPP/MySQL.
4. Create the database, tables and sample data:
   ```
   npm run setup
   ```
   (`npm run reset` drops the database and rebuilds it.)
5. Start the app and open **http://localhost:3000**:
   ```
   npm start
   ```

## Demo logins

| Role | Username | Password |
|---|---|---|
| Administrator | admin | Admin123 |
| Project Manager | manager | Manager123 |
| Site Engineer | engineer | Engineer123 |
| Finance / Procurement | finance | Finance123 |
| Client (read-only, own projects) | client | Client123 |

## UI features

Modern responsive layout, light/dark theme toggle (remembered), sidebar icons, loading skeletons, click-to-fill demo logins, show/hide password, clear-filters button, press `/` to focus search, mobile slide-out menu, print-friendly pages.

## Functions

| Module | Page | CRUD + rules |
|---|---|---|
| F1 Users & Roles | Users & Roles | bcrypt hashes, unique email/username, activate/deactivate, reset password, last-admin protection |
| F2 Projects | Projects, Clients | dates, budget > 0, status transitions, archive instead of delete, search/filter |
| F3 Tasks & Schedule | Tasks, Timeline | dates inside project dates, progress 0-100, overdue highlighting, engineers update own progress |
| F4 Resources & Materials | Materials, Stock In/Out, Suppliers | transactional stock, no over-issue, low-stock alerts |
| F5 Budget & Expenses | Expenses, Budget vs Actual | amount > 0, no future dates, 80%/100% warnings, manager approval |
| F6 Reports & Documents | Site Reports, Documents | one report per project/day, PDF/JPG/PNG/DOCX <= 5 MB, authorised download |
| Minor | Dashboard, alerts, search/sort/filter/pagination, CSV/PDF export, audit log, profile/password, timeline, safety incidents, responsive layout, JSON backup | |

## Folder structure

```
server.js            app entry point (helmet, sessions, CSRF, routing)
config/              db pool, constants (roles, upload limits)
middleware/          auth + role + CSRF checks, central error handler
lib/                 crud.js (shared CRUD engine), validate.js, audit.js, budget.js, scope.js
routes/              one file per module (fields, SQL, role permissions, business rules)
public/              index.html, css/style.css, js/app.js (single-page front end)
database/            schema.sql, setup.js (creates DB + sample data)
uploads/             stored documents (outside the public web root)
tests/smoke.js       API tests mapped to the design's TC-01..TC-15
```

## Tests

With the server running: `npm test` (63 API checks covering login, RBAC 401/403, validation 400, conflicts 409, stock atomicity, budget warnings, uploads, SQL-injection attempt, exports, audit log).

## Notes / deviations from the design document

- Controller + model code for each module is declared in `routes/<module>.js` and executed by the shared `lib/crud.js` engine, instead of separate controller/model files. Same behaviour, much less repeated code.
- Front end is one single-page app (`public/`) rather than many `.html` files; forms and client-side validation are generated from the same field rules the server enforces.
- Validation uses a small built-in validator (`lib/validate.js`) instead of express-validator; `bcryptjs` (pure JS) is used instead of native `bcrypt` so installation never needs a compiler.
- Row actions use `POST /api/<module>/:id/actions/<name>` (e.g. expense approval) and the audit log is at `/api/audit`.
- Extra columns added: `users.client_id` (links Client users to their company), `projects.is_archived`, `materials.is_active`, `site_reports.is_approved`, `documents.description/file_size`, `expenses.receipt_ref`, and an `incidents` table (minor function 8).
- Backup downloads all tables as JSON (portable) rather than calling `mysqldump`.
- Sessions use the in-memory store - fine for the demo; use a persistent store for production. Set `COOKIE_SECURE=true` behind HTTPS.
