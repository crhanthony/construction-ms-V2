/* BuildTrack front end: one small single-page app. Pages are built from /api/meta, so every module
   (list, search, filter, add/edit form, delete, row actions) shares the same code and the same validation rules. */
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const state = { user: null, csrf: '', meta: null, lookups: {} };

  const ICONS = { dashboard: '\u{1F4CA}', projects: '\u{1F3D7}\uFE0F', clients: '\u{1F91D}', tasks: '\u2705', timeline: '\u{1F4C5}', materials: '\u{1F9F1}', stock: '\u{1F4E6}',
    suppliers: '\u{1F69A}', expenses: '\u{1F4B3}', budget: '\u{1F4B0}', reports: '\u{1F4DD}', documents: '\u{1F4C1}', incidents: '\u26A0\uFE0F', users: '\u{1F465}', audit: '\u{1F50E}', backup: '\u{1F4BE}', profile: '\u{1F464}' };
  const DEMO = [['Admin', 'admin', 'Admin123'], ['Manager', 'manager', 'Manager123'], ['Engineer', 'engineer', 'Engineer123'], ['Finance', 'finance', 'Finance123'], ['Client', 'client', 'Client123']];

  // ---------- helpers ----------
  // h(tag, attrs, ...children): builds DOM nodes; text is always inserted as text (never HTML) so user data cannot inject markup.
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, '');
      else e.setAttribute(k, v);
    }
    kids.flat(Infinity).forEach(c => { if (c !== null && c !== undefined && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return e;
  }
  const ONE = { projects: 'project', clients: 'client', tasks: 'task', materials: 'material', stock: 'stock transaction', suppliers: 'supplier', expenses: 'expense', reports: 'site report', documents: 'document', incidents: 'incident', users: 'user' };
  const pad = n => String(n).padStart(2, '0');
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const money = n => 'LKR ' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const fmtDate = s => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '');
  const num = n => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

  function toast(msg, type = 'ok') {
    const t = h('div', { class: 'toast ' + (type === 'ok' ? '' : type), role: 'status' }, msg);
    $('#toasts').append(t);
    setTimeout(() => t.remove(), type === 'ok' ? 3500 : 7000);
  }

  async function api(method, url, body, isForm) {
    const headers = { 'X-CSRF-Token': state.csrf };
    if (body && !isForm) headers['Content-Type'] = 'application/json';
    let res;
    try { res = await fetch('/api' + url, { method, headers, credentials: 'same-origin', body: isForm ? body : body ? JSON.stringify(body) : undefined }); }
    catch (e) { throw { status: 0, message: 'Cannot reach the server. Check your connection.' }; }
    let json = {};
    try { json = await res.json(); } catch (e) { /* non-JSON */ }
    if (res.status === 401 && !url.startsWith('/auth/login')) { showLogin(state.user ? 'Your session has ended. Please log in again.' : ''); throw { status: 401, message: 'Please log in', silent: true }; }
    if (!res.ok) throw { status: res.status, message: json.message || 'Request failed', errors: json.errors };
    return json;
  }
  const lookup = name => (state.lookups[name] ||= api('GET', '/lookup/' + name).then(r => r.data).catch(e => { delete state.lookups[name]; throw e; }));

  function modal(content) {
    const dlg = $('#dialog'); dlg.replaceChildren(content); $('#modal').hidden = false;
    const first = dlg.querySelector('input:not([type=hidden]),select,textarea,button'); first && first.focus();
  }
  function setTheme(t) { document.documentElement.setAttribute('data-theme', t); try { localStorage.setItem('bt-theme', t); } catch (e) { /* ignore */ } $('#theme-btn').innerHTML = t === 'dark' ? '&#9728;' : '&#9790;'; }
  const closeModal = () => { $('#modal').hidden = true; $('#dialog').replaceChildren(); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });
  $('#modal').addEventListener('mousedown', e => { if (e.target.id === 'modal') closeModal(); });

  function confirmBox(title, text, okLabel = 'Confirm', danger = false) {
    return new Promise(resolve => {
      const done = v => { closeModal(); resolve(v); };
      modal(h('div', null, h('h3', null, title), h('p', null, text),
        h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: () => done(false) }, 'Cancel'),
          h('button', { class: 'btn ' + (danger ? 'danger solid' : 'primary'), onclick: () => done(true) }, okLabel))));
    });
  }

  // ---------- cell rendering ----------
  const BADGE = { green: ['Completed', 'Done', 'Approved', 'Active', 'IN', 'Low', 'Yes'], amber: ['On Hold', 'Pending', 'Medium', 'Minor', 'UPDATE', 'To Do'],
    red: ['High', 'Rejected', 'Major', 'DELETE', 'OUT', 'Inactive'], blue: ['In Progress', 'Planned', 'CREATE', 'LOGIN', 'Near miss'] };
  const badge = v => { const c = Object.keys(BADGE).find(k => BADGE[k].includes(v)) || 'grey'; return h('span', { class: 'badge b-' + c }, v); };
  const bar = (pct, level) => h('span', null, h('span', { class: 'bar ' + (level || '') }, h('i', { style: `width:${Math.min(100, pct)}%` })), pct + '%');

  function cell(c, row, m) {
    const v = row[c.key];
    switch (c.type) {
      case 'badge': return v ? badge(v) : '';
      case 'money': return money(v);
      case 'date': return fmtDate(v);
      case 'pct': return bar(Number(v) || 0);
      case 'active': return badge(v ? 'Active' : 'Inactive');
      case 'archived': return v ? h('span', { class: 'badge b-grey' }, 'Archived') : '';
      case 'yesno': return badge(v ? 'Yes' : 'No');
      case 'clip': return v && v.length > 60 ? v.slice(0, 60) + '…' : v || '';
      case 'size': return v > 1048576 ? (v / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(v / 1024)) + ' KB';
      case 'stock': return h('span', null, num(v), ' ', row.is_low ? h('span', { class: 'badge b-red' }, 'Low stock') : '');
      case 'download': return h('a', { href: `/api/${m.key}/${row.document_id}/download` }, v);
      case 'due': {
        const late = row.is_overdue;
        return h('span', { class: late ? 'txt-red' : '' }, fmtDate(v), late ? ' (overdue)' : '');
      }
      default: return v === null || v === undefined ? '' : String(v);
    }
  }

  // ---------- form builder (client-side validation mirrors the server rules) ----------
  function checkField(f, v, all) {
    const label = f.label || '';
    const empty = v === '' || v === null || v === undefined;
    if (empty) return f.required || (f.requiredOnCreate && !all.__edit) ? `${label} is required` : '';
    if (f.pattern && !new RegExp(f.pattern).test(v)) return f.patternMsg || `${label} has an invalid format`;
    switch (f.type) {
      case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? '' : 'Enter a valid email address';
      case 'int':
        if (!/^-?\d+$/.test(v)) return `${label} must be a whole number`;
        if ((f.min !== undefined && +v < f.min) || (f.maxVal !== undefined && +v > f.maxVal)) return `${label} must be between ${f.min ?? '-∞'} and ${f.maxVal ?? '∞'}`;
        return '';
      case 'decimal':
        if (!/^-?\d+(\.\d{1,2})?$/.test(v)) return `${label} must be a number with at most 2 decimals`;
        if (f.positive && +v <= 0) return `${label} must be a positive number`;
        if (f.nonNegative && +v < 0) return `${label} cannot be negative`;
        return '';
      case 'date':
        if (f.noFuture && v > todayStr()) return `${label} cannot be in the future`;
        if (f.after && all[f.after] && v < all[f.after]) return `${label} cannot be before the start date`;
        return '';
      case 'string': case 'text': return f.max && v.length > f.max ? `${label} must be at most ${f.max} characters` : '';
      default: return '';
    }
  }

  function buildForm(fields, values = {}, edit = false) {
    const inputs = {}, errs = {}, wrap = h('div');
    const banner = h('div', { class: 'banner error', hidden: true });
    wrap.append(banner);
    for (const [key, f] of Object.entries(fields)) {
      if ((f.createOnly && edit) || (f.editOnly && !edit)) continue;
      const id = 'f-' + key;
      let el;
      const val = values[key] ?? (edit ? '' : f.default ?? '');
      if (f.input === 'textarea') el = h('textarea', { id, maxlength: f.max || 5000 });
      else if (f.input === 'file') el = h('input', { id, type: 'file', accept: f.accept });
      else if (f.type === 'enum') el = h('select', { id }, f.required ? null : h('option', { value: '' }, '- none -'), f.options.map(o => h('option', { value: o }, o)));
      else if (f.type === 'ref') el = h('select', { id }, h('option', { value: '' }, '- select -'));
      else if (f.type === 'bool') el = h('input', { id, type: 'checkbox' });
      else {
        const t = f.input === 'password' ? 'password' : f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : f.type === 'int' || f.type === 'decimal' ? 'number' : 'text';
        el = h('input', { id, type: t, maxlength: f.max, min: f.type === 'int' ? f.min : f.positive ? 0.01 : f.nonNegative ? 0 : undefined,
          max: f.type === 'int' ? f.maxVal : f.noFuture ? todayStr() : undefined, step: f.type === 'decimal' ? '0.01' : f.type === 'int' ? '1' : undefined,
          autocomplete: f.input === 'password' ? 'new-password' : 'off' });
      }
      if (f.type === 'ref') lookup(f.lookup).then(items => {
        items.forEach(i => el.append(h('option', { value: i.id }, i.label)));
        el.value = values[key] ?? '';
      }).catch(() => { el.append(h('option', { value: '' }, '(list unavailable)')); });
      if (f.type === 'bool') el.checked = values[key] === undefined ? !!f.default : !!+values[key];
      else if (f.type !== 'ref' && f.input !== 'file') el.value = f.type === 'date' && !val && f.noFuture ? todayStr() : val;
      inputs[key] = el;
      errs[key] = h('span', { class: 'err', 'data-for': key });
      const req = f.required || (f.requiredOnCreate && !edit);
      wrap.append(h('div', { class: 'field' },
        f.type === 'bool' ? h('label', { for: id }, el, ' ', f.label) : h('label', { for: id }, f.label, req ? h('span', { class: 'req' }, ' *') : ''),
        f.type === 'bool' ? '' : el, f.help ? h('div', { class: 'help' }, f.help) : '', errs[key]));
      el.addEventListener('input', () => { el.classList.remove('invalid'); errs[key].textContent = ''; });
    }
    const read = () => {
      const o = {};
      for (const [k, el] of Object.entries(inputs)) o[k] = el.type === 'checkbox' ? (el.checked ? 1 : 0) : el.type === 'file' ? (el.files[0] || '') : String(el.value).trim();
      return o;
    };
    const showErr = (key, msg) => {
      if (!inputs[key]) return false;
      inputs[key].classList.add('invalid'); errs[key].textContent = msg; return true;
    };
    return {
      el: wrap, inputs, read,
      validate() {
        const vals = { ...read(), __edit: edit }; let first = null;
        for (const [k, el] of Object.entries(inputs)) {
          const f = fields[k]; el.classList.remove('invalid'); errs[k].textContent = '';
          const msg = f.type === 'bool' ? '' : f.input === 'file' ? (!vals[k] && f.required ? 'Choose a file to upload' : vals[k] && vals[k].size > 5242880 ? 'File must be under 5 MB' : '') : checkField(f, vals[k], vals);
          if (msg) { showErr(k, msg); first ||= el; }
        }
        banner.hidden = true;
        if (first) first.focus();
        return !first;
      },
      serverError(e) {
        let shown = false;
        (e.errors || []).forEach(x => { shown = showErr(x.field, x.message) || shown; });
        if (!shown || !(e.errors || []).length) { banner.textContent = e.message; banner.hidden = false; }
        else { const f = Object.values(inputs).find(i => i.classList.contains('invalid')); f && f.focus(); }
      }
    };
  }

  // Opens a modal with a form; onSubmit receives the raw values and returns the API promise.
  function formDialog({ title, fields, values, edit, submitLabel = 'Save', onSubmit, onDone }) {
    const form = buildForm(fields, values, edit);
    const save = h('button', { class: 'btn primary', type: 'submit' }, submitLabel);
    const f = h('form', { novalidate: true, onsubmit: async ev => {
      ev.preventDefault();
      if (!form.validate()) return;
      save.disabled = true; save.classList.add('busy');
      try { const r = await onSubmit(form.read()); closeModal(); state.lookups = {}; r && r.warning ? toast(r.warning, 'warn') : toast(r?.message || 'Saved'); onDone && onDone(r); }
      catch (e) { if (!e.silent) form.serverError(e); }
      finally { save.disabled = false; save.classList.remove('busy'); }
    } }, h('h3', null, title), form.el,
      h('div', { class: 'foot' }, h('button', { class: 'btn', type: 'button', onclick: closeModal }, 'Cancel'), save));
    modal(f);
  }

  // ---------- module page (list + CRUD) ----------
  function modulePage(key) {
    const m = state.meta.modules[key];
    if (!m) return unavailable();
    const st = { page: 1, search: '', sort: '', dir: 'asc', filters: {} };
    const tbody = h('tbody'), thead = h('thead'), pager = h('div', { class: 'pager' });
    const canExport = ['Project Manager', 'Finance Officer', 'Administrator'].includes(state.user.role);
    const exports = m.exportType && canExport ? ['csv', 'pdf'].map(f => h('a', { class: 'btn', href: `/api/export/${m.exportType}?format=${f}` }, 'Export ' + f.toUpperCase())) : [];
    const addBtn = m.perms.create ? h('button', { class: 'btn primary', onclick: () => openForm(null) }, '+ Add') : '';
    const toolbar = h('div', { class: 'toolbar' });
    let timer;
    const searchInput = h('input', { type: 'search', placeholder: 'Search…  (press / )', 'aria-label': 'Search', oninput: e => { clearTimeout(timer); timer = setTimeout(() => { st.search = e.target.value.trim(); st.page = 1; load(); }, 300); } });
    if (m.search) toolbar.append(h('div', { class: 'search-box' }, searchInput));
    const selects = [];
    const clearBtn = h('button', { class: 'btn sm', type: 'button', hidden: true, onclick: () => { st.filters = {}; st.search = ''; st.page = 1; searchInput.value = ''; selects.forEach(x => (x.value = '')); load(); } }, '✕ Clear filters');
    m.filters.forEach(fl => {
      const sel = h('select', { 'aria-label': fl.label, onchange: e => { st.filters[fl.key] = e.target.value; st.page = 1; load(); } }, h('option', { value: '' }, 'All ' + fl.label.toLowerCase()));
      if (fl.options) fl.options.forEach(([v, l]) => sel.append(h('option', { value: v }, l)));
      else lookup(fl.lookup).then(items => items.forEach(i => sel.append(h('option', { value: i.id }, i.label)))).catch(() => sel.remove());
      selects.push(sel); toolbar.append(sel);
    });
    toolbar.append(clearBtn);

    function renderHead() {
      thead.replaceChildren(h('tr', null, m.columns.map(c => {
        const sortable = m.sortable.includes(c.key);
        return h('th', { class: sortable ? 'sortable' : '', scope: 'col', tabindex: sortable ? 0 : undefined,
          'aria-sort': st.sort === c.key ? (st.dir === 'asc' ? 'ascending' : 'descending') : undefined,
          onclick: sortable ? () => { st.dir = st.sort === c.key && st.dir === 'asc' ? 'desc' : 'asc'; st.sort = c.key; load(); } : undefined,
          onkeydown: sortable ? e => { if (e.key === 'Enter') e.target.click(); } : undefined }, c.label + (st.sort === c.key ? (st.dir === 'asc' ? ' ▲' : ' ▼') : ''));
      }), h('th', { scope: 'col' }, 'Actions')));
    }

    function openForm(row) {
      const edit = !!row;
      formDialog({
        title: (edit ? 'Edit ' : 'Add ') + (ONE[key] || 'record'), fields: m.fields, values: row || {}, edit,
        onSubmit: vals => {
          if (m.multipart && !edit) { const fd = new FormData(); Object.entries(vals).forEach(([k, v]) => fd.append(k, v)); return api('POST', '/' + key, fd, true); }
          return edit ? api('PUT', `/${key}/${row[pk()]}`, vals) : api('POST', '/' + key, vals);
        }, onDone: load
      });
    }
    const pk = () => m.pk;

    function view(row) {
      const dl = h('dl', { class: 'dl' });
      m.columns.filter(c => c.label).forEach(c => dl.append(h('dt', null, c.label), h('dd', null, cell(c, row, m))));
      Object.entries(m.fields).filter(([k, f]) => f.type === 'text' && row[k]).forEach(([k, f]) => dl.append(h('dt', null, f.label), h('dd', null, row[k])));
      if (row.description && !m.fields.description) dl.append(h('dt', null, 'Description'), h('dd', null, row.description));
      modal(h('div', null, h('h3', null, m.title), dl, h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: closeModal }, 'Close'))));
    }

    async function remove(row) {
      const ok = await confirmBox('Delete this record?', m.deleteWarning || 'This cannot be undone.', 'Delete', true);
      if (!ok) return;
      try { await api('DELETE', `/${key}/${row[pk()]}`); state.lookups = {}; toast('Deleted'); load(); }
      catch (e) { if (!e.silent) toast(e.message, 'error'); }
    }

    async function runAction(a, row) {
      const url = `/${key}/${row[pk()]}/actions/${a.key}`;
      if (a.fields) return formDialog({ title: a.label, fields: a.fields, values: row, edit: false, submitLabel: a.label, onSubmit: v => api('POST', url, v), onDone: load });
      if (!(await confirmBox(a.label, a.confirm || 'Are you sure?', a.label, a.style === 'danger'))) return;
      try { await api('POST', url); state.lookups = {}; toast('Done'); load(); } catch (e) { if (!e.silent) toast(e.message, 'error'); }
    }

    async function load() {
      const q = new URLSearchParams({ page: st.page, pageSize: m.pageSize });
      if (st.search) q.set('search', st.search);
      if (st.sort) { q.set('sort', st.sort); q.set('dir', st.dir); }
      Object.entries(st.filters).forEach(([k, v]) => v && q.set(k, v));
      if (!tbody.children.length) tbody.replaceChildren(...Array.from({ length: 5 }, () => h('tr', { class: 'skel-row' }, h('td', { colspan: m.columns.length + 1 }, h('div', { class: 'skel' })))));
      let r;
      try { r = await api('GET', `/${key}?${q}`); } catch (e) { if (!e.silent) toast(e.message, 'error'); return; }
      const lastPage = Math.max(1, Math.ceil(r.total / r.pageSize));
      if (st.page > lastPage) { st.page = lastPage; return load(); }
      renderHead();
      tbody.replaceChildren();
      clearBtn.hidden = !(st.search || Object.values(st.filters).some(Boolean));
      if (!r.data.length) tbody.append(h('tr', null, h('td', { colspan: m.columns.length + 1, class: 'empty' }, h('span', { class: 'big' }, st.search || Object.values(st.filters).some(Boolean) ? '\u{1F50D}' : '\u{1F4ED}'), st.search || Object.values(st.filters).some(Boolean) ? 'Nothing matches your search or filters.' : 'No records yet.' + (m.perms.create ? ' Use “+ Add” to create the first one.' : ''))));
      r.data.forEach(row => {
        const acts = h('td', { class: 'actions' }, h('button', { class: 'btn sm', onclick: () => view(row) }, 'View'));
        if (m.perms.update) acts.append(h('button', { class: 'btn sm', onclick: () => openForm(row) }, 'Edit'));
        m.actions.filter(a => !a.when || a.when.in.includes(row[a.when.field])).forEach(a => acts.append(h('button', { class: 'btn sm ' + (a.style || ''), onclick: () => runAction(a, row) }, a.label)));
        if (m.perms.delete) acts.append(h('button', { class: 'btn sm danger', onclick: () => remove(row) }, 'Delete'));
        tbody.append(h('tr', null, m.columns.map(c => h('td', null, cell(c, row, m))), acts));
      });
      const pages = Math.max(1, Math.ceil(r.total / r.pageSize));
      pager.replaceChildren(h('span', { class: 'info' }, r.total ? `Showing ${(r.page - 1) * r.pageSize + 1}–${Math.min(r.total, r.page * r.pageSize)} of ${r.total}` : '0 records'),
        h('button', { class: 'btn sm', disabled: r.page <= 1, onclick: () => { st.page--; load(); } }, 'Previous'),
        ...Array.from({ length: pages }, (_, i) => i + 1).filter(p => Math.abs(p - r.page) <= 2 || p === 1 || p === pages).map(p =>
          h('button', { class: 'btn sm' + (p === r.page ? ' current' : ''), 'aria-current': p === r.page ? 'page' : undefined, onclick: () => { st.page = p; load(); } }, p)),
        h('button', { class: 'btn sm', disabled: r.page >= pages, onclick: () => { st.page++; load(); } }, 'Next'));
    }

    load();
    return h('div', null, h('div', { class: 'page-head' }, h('h2', null, m.title), exports, addBtn), toolbar,
      h('div', { class: 'table-wrap' }, h('table', null, thead, tbody)), pager);
  }

  // ---------- custom pages ----------
  const unavailable = () => h('div', { class: 'card' }, 'You do not have access to this page.');

  async function dashboardPage() {
    const d = (await api('GET', '/dashboard')).data;
    const stat = (icon, tone, label, value, red) => h('div', { class: 'stat' }, h('span', { class: 'ico ' + tone, 'aria-hidden': 'true' }, icon), h('div', null, h('small', null, label), h('b', { class: red ? 'red' : '' }, value)));
    const cards = h('div', { class: 'cards' },
      stat('\u{1F3D7}\uFE0F', '', 'Active projects', d.activeProjects),
      stat('\u23F0', d.overdueTasks ? 'r' : 'g', 'Overdue tasks', d.overdueTasks, d.overdueTasks),
      d.canStock ? stat('\u{1F4E6}', d.lowStock ? 'r' : 'g', 'Low-stock items', d.lowStock, d.lowStock) : '',
      d.showBudget ? stat('\u{1F4B0}', 'o', 'Budget used', d.budgetUsedPct + '%') : '');
    const hr = new Date().getHours(), greet = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
    const max = Math.max(1, ...d.budgets.map(b => Math.max(b.budget, b.used)));
    const budgetBox = d.budgets.length ? h('div', { class: 'card bars' }, h('h3', null, 'Budget vs actual by project'),
      h('div', { class: 'legend' }, 'Grey = approved budget, orange = spent (red when over budget)'),
      d.budgets.map(b => h('div', { class: 'item' }, h('div', { class: 'lbl' }, h('span', null, b.project_name), h('span', { class: 'txt-' + b.level }, b.pct + '% - ' + (b.level === 'red' ? 'over budget' : b.level === 'amber' ? 'warning' : 'on track'))),
        h('div', { class: 'track' }, h('i', { class: 'b', style: `width:${b.budget / max * 100}%` })),
        h('div', { class: 'track' }, h('i', { class: 'u ' + (b.level === 'red' ? 'red' : ''), style: `width:${Math.min(b.used, max) / max * 100}%` }))))) : '';
    const due = t => t.days_left < 0 ? h('span', { class: 'txt-red' }, 'Overdue') : t.days_left === 0 ? h('span', { class: 'txt-amber' }, 'Due today') : h('span', { class: t.days_left <= 3 ? 'txt-amber' : 'txt-green' }, `Due in ${t.days_left} day${t.days_left === 1 ? '' : 's'}`);
    const tasks = h('div', { class: 'card' }, h('h3', null, 'Upcoming and overdue tasks'),
      d.upcoming.length ? d.upcoming.map(t => h('div', { class: 'rowline' }, h('span', null, t.title, h('br'), h('small', { class: 'muted' }, t.project_name)), due(t))) : h('p', { class: 'muted' }, 'No open tasks.'));
    const alerts = h('div', { class: 'card' }, h('h3', null, 'Alerts'),
      d.alerts.length ? d.alerts.map(a => h('div', { class: 'alert ' + a.level }, a.text)) : h('p', { class: 'muted' }, 'No alerts. Everything is on track.'));
    return h('div', null, h('div', { class: 'page-head' }, h('h2', null, `${greet}, ${state.user.full_name.split(' ')[0]}`, h('span', { class: 'sub' }, `Here is what is happening on your sites today \u00B7 ${state.user.role}`))), cards,
      h('div', { class: 'grid2' }, budgetBox, tasks), h('div', { style: 'margin-top:1rem' }, alerts));
  }

  async function budgetPage() {
    const rows = (await api('GET', '/budget')).data;
    const canExport = ['Project Manager', 'Finance Officer', 'Administrator'].includes(state.user.role);
    const label = l => l === 'red' ? 'Over budget' : l === 'amber' ? 'Warning (80%+)' : 'On track';
    return h('div', null, h('div', { class: 'page-head' }, h('h2', null, 'Budget vs Actual'),
      canExport ? ['csv', 'pdf'].map(f => h('a', { class: 'btn', href: `/api/export/projects?format=${f}` }, 'Export ' + f.toUpperCase())) : ''),
      h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, ['Project', 'Client', 'Budget', 'Used', 'Remaining', '% used'].map(x => h('th', null, x)))),
        h('tbody', null, rows.length ? rows.map(b => h('tr', null, h('td', null, b.project_name), h('td', null, b.client_name), h('td', null, money(b.budget)), h('td', null, money(b.used)),
          h('td', { class: b.remaining < 0 ? 'txt-red' : '' }, money(b.remaining)), h('td', null, bar(b.pct, b.level), ' ', h('span', { class: 'txt-' + b.level }, label(b.level)))))
          : h('tr', null, h('td', { colspan: 6, class: 'empty' }, 'No projects yet.'))))),
      h('p', { class: 'muted small' }, 'Used = approved + pending expenses (rejected expenses are ignored).'));
  }

  async function timelinePage() {
    const sel = h('select', { 'aria-label': 'Project' }, h('option', { value: '' }, '- choose a project -'));
    const out = h('div', { class: 'card' }, h('p', { class: 'muted' }, 'Choose a project to see its task schedule.'));
    (await lookup('projects')).forEach(p => sel.append(h('option', { value: p.id }, p.label)));
    sel.addEventListener('change', async () => {
      if (!sel.value) return;
      const tasks = (await api('GET', `/tasks?project_id=${sel.value}&pageSize=100`)).data;
      if (!tasks.length) return out.replaceChildren(h('p', { class: 'muted' }, 'This project has no tasks yet.'));
      const day = s => Date.parse(s + 'T00:00:00Z') / 864e5;
      const lo = Math.min(...tasks.map(t => day(t.start_date))), hi = Math.max(...tasks.map(t => day(t.due_date)), lo + 1), span = hi - lo;
      const now = Date.parse(todayStr() + 'T00:00:00Z') / 864e5, inRange = now >= lo && now <= hi;
      out.replaceChildren(h('div', { class: 'legend' }, `${fmtDate(tasks.reduce((a, t) => (t.start_date < a ? t.start_date : a), tasks[0].start_date))} to ${fmtDate(tasks.reduce((a, t) => (t.due_date > a ? t.due_date : a), tasks[0].due_date))}. Dark line = today. Red = overdue, green = done.`),
        ...tasks.map(t => h('div', { class: 'tl-row' }, h('div', null, t.title, h('br'), h('small', { class: 'muted' }, `${fmtDate(t.start_date)} – ${fmtDate(t.due_date)} · ${t.assignees || ''}`)),
          h('div', { class: 'tl-track', role: 'img', 'aria-label': `${t.title}: ${t.progress_pct}% complete${t.is_overdue ? ', overdue' : ''}` },
            h('div', { class: 'tl-bar ' + (t.status === 'Done' ? 'done' : t.is_overdue ? 'late' : ''), style: `left:${(day(t.start_date) - lo) / span * 100}%;width:${Math.max(2, (day(t.due_date) - day(t.start_date)) / span * 100)}%` }, h('i', { style: `width:${t.progress_pct}%` })),
            inRange ? h('div', { class: 'tl-today', style: `left:${(now - lo) / span * 100}%` }) : ''))));
    });
    return h('div', null, h('div', { class: 'page-head' }, h('h2', null, 'Task Timeline')), h('div', { class: 'toolbar' }, sel), out);
  }

  function profilePage() {
    const u = state.user;
    const pf = buildForm({ full_name: { label: 'Full name', type: 'string', required: true, max: 100 }, email: { label: 'Email', type: 'email', required: true } }, u, true);
    const pwFields = { current_password: { label: 'Current password', type: 'string', input: 'password', required: true },
      new_password: { label: 'New password', type: 'string', input: 'password', required: true, max: 72, pattern: '^(?=.*[A-Za-z])(?=.*\\d).{8,72}$', patternMsg: 'Password must be at least 8 characters with letters and numbers' },
      confirm_password: { label: 'Confirm new password', type: 'string', input: 'password', required: true } };
    const pw = buildForm(pwFields, {}, true);
    const submit = (form, method, url, ok) => async ev => {
      ev.preventDefault(); if (!form.validate()) return;
      const v = form.read();
      if (v.confirm_password !== undefined && v.new_password !== v.confirm_password) return form.serverError({ errors: [{ field: 'confirm_password', message: 'Passwords do not match' }] });
      try { const r = await api(method, url, v); ok(r); toast('Saved'); } catch (e) { if (!e.silent) form.serverError(e); }
    };
    return h('div', null, h('div', { class: 'page-head' }, h('h2', null, 'My profile')),
      h('div', { class: 'grid2' },
        h('form', { class: 'card', novalidate: true, onsubmit: submit(pf, 'PUT', '/auth/profile', r => { state.user = r.data; renderWho(); }) }, h('h3', null, 'Details'), h('p', { class: 'muted' }, `Username: ${u.username} · Role: ${u.role}`), pf.el, h('button', { class: 'btn primary', type: 'submit' }, 'Save changes')),
        h('form', { class: 'card', novalidate: true, onsubmit: submit(pw, 'PUT', '/auth/password', () => { Object.values(pw.inputs).forEach(i => (i.value = '')); }) }, h('h3', null, 'Change password'), pw.el, h('button', { class: 'btn primary', type: 'submit' }, 'Change password'))));
  }

  // ---------- shell, routing, login ----------
  function renderWho() {
    const n = state.user.full_name, ini = n.split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase();
    $('#who').replaceChildren(h('span', null, n, h('small', null, state.user.role)), h('span', { class: 'avatar', 'aria-hidden': 'true' }, ini));
  }
  function showLogin(msg) {
    state.user = null; state.lookups = {}; $('#app').hidden = true; $('#login-view').hidden = false; closeModal();
    const b = $('#login-msg'); b.hidden = !msg; b.textContent = msg || '';
  }

  function renderNav() {
    const nav = $('#sidebar'); nav.replaceChildren();
    const ico = n => h('span', { class: 'ico', 'aria-hidden': 'true' }, ICONS[n.key] || (n.type === 'link' ? ICONS.backup : '\u2022'));
    state.meta.nav.forEach(n => {
      if (n.type === 'link' || n.key === 'profile') { if (!nav.querySelector('.sep')) nav.append(h('div', { class: 'sep' })); }
      nav.append(n.type === 'link'
        ? h('a', { href: n.href }, ico(n), n.title)
        : h('a', { href: n.type === 'page' ? '#/' + n.key : '#/m/' + n.key, 'data-route': n.type === 'page' ? n.key : 'm/' + n.key }, ico(n), n.title));
    });
  }

  async function route() {
    if (!state.meta) return;
    const hash = (location.hash || '#/dashboard').slice(2), main = $('#main');
    document.querySelectorAll('#sidebar a').forEach(a => a.classList.toggle('active', a.dataset.route === hash));
    $('#sidebar').classList.remove('open');
    const item = state.meta.nav.find(n => (n.type === 'page' ? n.key : 'm/' + n.key) === hash);
    $('#page-title').textContent = item ? item.title : '';
    document.title = (item ? item.title + ' - ' : '') + 'BuildTrack';
    main.replaceChildren(h('div', { class: 'cards' }, ...Array.from({ length: 3 }, () => h('div', { class: 'skel skel-card' }))));
    try {
      let view;
      if (!item) view = unavailable();
      else if (item.type === 'module') view = modulePage(item.key);
      else view = await ({ dashboard: dashboardPage, budget: budgetPage, timeline: timelinePage, profile: async () => profilePage() })[item.key]();
      main.replaceChildren(view); window.scrollTo(0, 0);
    } catch (e) { if (!e.silent) main.replaceChildren(h('div', { class: 'banner error' }, e.message || 'Could not load this page.')); }
  }

  async function boot() {
    const r = await api('GET', '/meta');
    state.user = r.user; state.csrf = r.csrf; state.meta = r;
    $('#login-view').hidden = true; $('#app').hidden = false;
    renderWho(); renderNav();
    if (!location.hash) location.hash = '#/dashboard'; else route();
  }

  $('#login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, user = $('#lg-user').value.trim(), pass = $('#lg-pass').value;
    f.querySelectorAll('.err').forEach(s => (s.textContent = ''));
    if (!user || !pass) {
      if (!user) f.querySelector('[data-for=username]').textContent = 'Username is required';
      if (!pass) f.querySelector('[data-for=password]').textContent = 'Password is required';
      return;
    }
    const btn = f.querySelector('button[type=submit]'); btn.disabled = true; btn.classList.add('busy');
    try { const r = await api('POST', '/auth/login', { username: user, password: pass }); state.csrf = r.csrf; f.reset(); await boot(); }
    catch (err) { const b = $('#login-msg'); b.hidden = false; b.textContent = err.message; }
    finally { btn.disabled = false; btn.classList.remove('busy'); }
  });
  DEMO.forEach(([label, u, p]) => $('#demo-chips').append(h('button', { type: 'button', class: 'chip', onclick: () => { $('#lg-user').value = u; $('#lg-pass').value = p; $('#lg-pass').focus(); } }, label)));
  $('#pw-toggle').addEventListener('click', e => { const i = $('#lg-pass'), show = i.type === 'password'; i.type = show ? 'text' : 'password'; e.target.textContent = show ? 'Hide' : 'Show'; e.target.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); });
  $('#theme-btn').addEventListener('click', () => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));
  $('#backdrop').addEventListener('click', () => $('#sidebar').classList.remove('open'));
  document.addEventListener('keydown', e => { if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && $('#modal').hidden) { const s = $('#main input[type=search]'); if (s) { e.preventDefault(); s.focus(); } } });
  setTheme(document.documentElement.getAttribute('data-theme') || 'light');
  $('#logout-btn').addEventListener('click', async () => { try { await api('POST', '/auth/logout'); } catch (e) {} state.meta = null; location.hash = ''; showLogin(); });
  $('#menu-btn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  window.addEventListener('hashchange', route);

  (async () => { try { await boot(); } catch (e) { showLogin(); } })();
})();
