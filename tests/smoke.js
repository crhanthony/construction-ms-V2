// API smoke tests mapped to the design document's test cases (TC-xx).
// Usage: start the server (npm start) in one terminal, then run: npm test
const BASE = process.env.BASE_URL || 'http://localhost:3000';
let pass = 0, fail = 0;

class Client {
  constructor() { this.cookie = ''; this.csrf = ''; }
  async req(method, url, body, form) {
    const headers = { 'X-CSRF-Token': this.csrf, Cookie: this.cookie };
    if (body && !form) headers['Content-Type'] = 'application/json';
    const res = await fetch(BASE + '/api' + url, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
    const sc = res.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0];
    let json = {}; try { json = await res.json(); } catch (e) {}
    return { status: res.status, ...json };
  }
  async login(u, p) { const r = await this.req('POST', '/auth/login', { username: u, password: p }); if (r.csrf) this.csrf = r.csrf; return r; }
}
const check = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${cond ? '' : extra}`); };
const iso = off => { const d = new Date(); d.setDate(d.getDate() + off); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const uniq = Date.now().toString().slice(-6);

(async () => {
  const bad = await new Client().login('manager', 'wrong');
  check('TC-02 wrong password -> 401', bad.status === 401);
  const admin = new Client(), pm = new Client(), se = new Client(), fn = new Client(), cl = new Client();
  check('TC-01 valid login -> role session', (await admin.login('admin', 'Admin123')).data?.role === 'Administrator');
  await pm.login('manager', 'Manager123'); await se.login('engineer', 'Engineer123'); await fn.login('finance', 'Finance123'); await cl.login('client', 'Client123');
  check('no session -> 401', (await new Client().req('GET', '/projects')).status === 401);
  check('missing CSRF token -> 403', (await (async () => { const c = new Client(); c.cookie = pm.cookie; return c.req('POST', '/projects', {}); })()).status === 403);

  // F1
  const dupe = await admin.req('POST', '/users', { full_name: 'Dup', email: 'admin@buildtrack.example', username: 'dup' + uniq, password: 'Passw0rdX', role_id: 1 });
  check('TC-03 duplicate email -> 409 + field error', dupe.status === 409 && dupe.errors?.[0]?.field === 'email');
  check('weak password rejected', (await admin.req('POST', '/users', { full_name: 'W', email: `w${uniq}@x.com`, username: 'w' + uniq, password: 'short', role_id: 2 })).status === 400);
  const nu = await admin.req('POST', '/users', { full_name: 'Test User', email: `t${uniq}@x.com`, username: 't' + uniq, password: 'Passw0rd1', role_id: 3, is_active: 1 });
  check('F1 create user', nu.status === 201);
  check('F1 update user', (await admin.req('PUT', '/users/' + nu.id, { full_name: 'Test User 2', email: `t${uniq}@x.com`, username: 't' + uniq, role_id: 3, is_active: 1 })).status === 200);
  check('F1 delete user', (await admin.req('DELETE', '/users/' + nu.id)).status === 200);
  check('cannot delete the logged-in/last admin', (await admin.req('DELETE', '/users/1')).status === 409);
  check('non-admin cannot list users -> 403', (await pm.req('GET', '/users')).status === 403);

  // F2
  const proj = { project_name: 'Test Project ' + uniq, client_id: 1, manager_id: 2, location: 'Kandy', start_date: iso(0), end_date: iso(100), budget: 500000, status: 'Planned' };
  const p = await pm.req('POST', '/projects', proj);
  check('TC-04 create project -> 201', p.status === 201);
  check('TC-05 end before start -> 400 message', (await pm.req('POST', '/projects', { ...proj, project_name: 'X' + uniq, start_date: iso(10), end_date: iso(1) })).errors?.[0]?.message === 'End date cannot be before start date');
  check('negative budget -> 400', (await pm.req('POST', '/projects', { ...proj, project_name: 'Y' + uniq, budget: -5 })).status === 400);
  check('duplicate project name per client -> 409', (await pm.req('POST', '/projects', proj)).status === 409);
  check('F2 read list + search', (await pm.req('GET', '/projects?search=Test Project ' + uniq)).total === 1);
  check('F2 update', (await pm.req('PUT', '/projects/' + p.id, { ...proj, status: 'In Progress', budget: 600000 })).status === 200);
  check('invalid status transition -> 400', (await pm.req('PUT', '/projects/' + p.id, { ...proj, status: 'Planned', budget: 600000 })).status === 400);
  const climb = await cl.req('GET', '/projects');
  check('client sees only own projects', climb.data.every(x => x.client_id === 1) && climb.total >= 1);
  check('client cannot create project -> 403', (await cl.req('POST', '/projects', proj)).status === 403);

  // F3
  const task = { project_id: p.id, title: 'Test task', assignee_id: 3, priority: 'High', status: 'To Do', progress_pct: 0, start_date: iso(1), due_date: iso(20) };
  const t = await pm.req('POST', '/tasks', task);
  check('F3 create task', t.status === 201);
  check('TC-07 progress 120 -> 400', (await pm.req('PUT', '/tasks/' + t.id, { ...task, progress_pct: 120 })).status === 400);
  check('task outside project dates -> 400', (await pm.req('POST', '/tasks', { ...task, due_date: iso(500) })).status === 400);
  check('TC-08 site engineer cannot delete task -> 403', (await se.req('DELETE', '/tasks/' + t.id)).status === 403);
  check('SE updates progress on own task', (await se.req('POST', `/tasks/${t.id}/actions/progress`, { progress_pct: 100 })).status === 200);
  check('progress 100 sets status Done', (await pm.req('GET', '/tasks/' + t.id)).data.status === 'Done');
  check('F3 delete task', (await pm.req('DELETE', '/tasks/' + t.id)).status === 200);

  // F4
  const mat = await fn.req('POST', '/materials', { item_name: 'Test item ' + uniq, item_type: 'Material', unit: 'bag', unit_cost: 100, reorder_level: 5, is_active: 1 });
  check('F4 create material', mat.status === 201);
  check('F4 stock IN', (await fn.req('POST', '/stock', { material_id: mat.id, txn_type: 'IN', quantity: 40, txn_date: iso(0) })).status === 201);
  const over = await se.req('POST', '/stock', { material_id: mat.id, txn_type: 'OUT', project_id: p.id, quantity: 50, txn_date: iso(0) });
  check('TC-09 issue more than stock -> 400', over.status === 400 && over.message === 'Insufficient stock');
  const out = await se.req('POST', '/stock', { material_id: mat.id, txn_type: 'OUT', project_id: p.id, quantity: 36, txn_date: iso(0) });
  check('TC-10 OUT leaves 4 (reorder 5) -> low-stock alert', out.status === 201 && out.lowStock === true && out.balance === 4);
  check('stock balance updated atomically', (await fn.req('GET', '/materials/' + mat.id)).data.quantity_in_stock === 4);
  check('delete material with transactions -> 409', (await fn.req('DELETE', '/materials/' + mat.id)).status === 409);

  // F5
  const exp = { project_id: p.id, category_id: 1, amount: 100000, expense_date: iso(0), description: 'Test' };
  check('TC-11 negative amount -> 400', (await fn.req('POST', '/expenses', { ...exp, amount: -100 })).status === 400);
  check('future expense date -> 400', (await fn.req('POST', '/expenses', { ...exp, expense_date: iso(5) })).status === 400);
  const e1 = await fn.req('POST', '/expenses', exp);
  check('F5 create expense', e1.status === 201);
  const e2 = await fn.req('POST', '/expenses', { ...exp, amount: 550000 });
  check('TC-12 over budget -> saved with warning', e2.status === 201 && /over budget/.test(e2.warning || ''));
  check('finance cannot approve -> 403', (await fn.req('POST', `/expenses/${e1.id}/actions/approve`)).status === 403);
  check('PM approves expense', (await pm.req('POST', `/expenses/${e1.id}/actions/approve`)).status === 200);
  const bud = await pm.req('GET', `/projects/${p.id}/budget`);
  check('budget used / remaining / % computed', bud.data.used === 650000 && bud.data.level === 'red', JSON.stringify(bud.data));
  check('TC-06 delete project with expenses -> 409', (await pm.req('DELETE', '/projects/' + p.id)).status === 409);
  check('archive project instead', (await pm.req('POST', `/projects/${p.id}/actions/archive`)).status === 200);

  // F6
  const rep = { project_id: 1, report_date: iso(-30), weather: 'Sunny', workers_present: 12, work_done: 'Test work' };
  const r1 = await se.req('POST', '/reports', rep);
  check('F6 create report', r1.status === 201);
  check('TC-14 second report same day -> 409', (await se.req('POST', '/reports', rep)).status === 409);
  check('workers must be whole number', (await se.req('POST', '/reports', { ...rep, report_date: iso(-31), workers_present: 2.5 })).status === 400);
  const fd = ext => { const f = new FormData(); f.append('project_id', '1'); f.append('description', 'test'); f.append('file', new Blob([ext === '.pdf' ? '%PDF-hello' : 'hello']), 'a' + ext); return f; };
  check('TC-13 upload .exe -> 400', (await se.req('POST', '/documents', null, fd('.exe'))).status === 400);
  const fake = fd('.png');
  check('file content must match its extension -> 400', (await se.req('POST', '/documents', null, fake)).status === 400);
  const d1 = await se.req('POST', '/documents', null, fd('.pdf'));
  check('F6 upload pdf', d1.status === 201);
  const dl = await fetch(`${BASE}/api/documents/${d1.id}/download`, { headers: { Cookie: se.cookie } });
  check('download returns file', dl.status === 200 && (await dl.text()) === '%PDF-hello');
  check('F6 delete document', (await se.req('DELETE', '/documents/' + d1.id)).status === 200);
  check('F6 delete report', (await se.req('DELETE', '/reports/' + r1.id)).status === 200);

  // extra regression checks
  check('search treats % literally', (await pm.req('GET', '/projects?search=%25')).total === 0);
  const t2 = await pm.req('POST', '/tasks', { project_id: 1, title: 'Date guard ' + uniq, assignee_id: 3, priority: 'Low', status: 'To Do', progress_pct: 0, start_date: iso(1), due_date: iso(5) });
  const pr1 = (await pm.req('GET', '/projects/1')).data;
  check('project dates cannot exclude existing tasks', (await pm.req('PUT', '/projects/1', { ...pr1, end_date: iso(2) })).status === 400);
  await pm.req('DELETE', '/tasks/' + t2.id);
  const ex3 = await fn.req('POST', '/expenses', { project_id: 1, category_id: 1, amount: 10, expense_date: iso(0), description: 'regress' });
  await pm.req('POST', `/expenses/${ex3.id}/actions/approve`);
  await fn.req('PUT', '/expenses/' + ex3.id, { project_id: 1, category_id: 1, amount: 11, expense_date: iso(0), description: 'regress' });
  check('editing an approved expense resets it to Pending', (await fn.req('GET', '/expenses/' + ex3.id)).data.approval_status === 'Pending');
  await fn.req('DELETE', '/expenses/' + ex3.id);
  const tu = await admin.req('POST', '/users', { full_name: 'Temp U', email: `tu${uniq}@x.com`, username: 'tu' + uniq, password: 'Passw0rd1', role_id: 3, is_active: 1 });
  const tc = new Client(); await tc.login('tu' + uniq, 'Passw0rd1');
  check('new user can use the API', (await tc.req('GET', '/projects')).status === 200);
  await admin.req('POST', `/users/${tu.id}/actions/deactivate`);
  check('deactivated user is logged out immediately', (await tc.req('GET', '/projects')).status === 401);
  await admin.req('DELETE', '/users/' + tu.id);

  // misc
  check('TC-15 SQL injection in search is harmless', (await pm.req('GET', "/projects?search=' OR 1=1 --")).total === 0);
  check('sort column whitelisted', (await pm.req('GET', '/projects?sort=budget;DROP TABLE users')).status === 200);
  const dash = await pm.req('GET', '/dashboard');
  check('dashboard returns role-scoped data', dash.status === 200 && typeof dash.data.activeProjects === 'number');
  check('export CSV', (await fetch(BASE + '/api/export/expenses?format=csv', { headers: { Cookie: pm.cookie } })).status === 200);
  check('export PDF', (await fetch(BASE + '/api/export/projects?format=pdf', { headers: { Cookie: pm.cookie } })).headers.get('content-type') === 'application/pdf');
  check('audit log is admin-only and populated', (await pm.req('GET', '/audit')).status === 403 && (await admin.req('GET', '/audit')).total > 5);
  check('logout destroys session', (await se.req('POST', '/auth/logout')).status === 200 && (await se.req('GET', '/auth/me')).status === 401);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
