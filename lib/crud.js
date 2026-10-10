// Generic CRUD module factory. Each module (projects, tasks, ...) supplies a config:
// table, SQL, field rules, role permissions and optional business-rule hooks.
// Models, controllers and routes are therefore declared once per module in /routes.
const express = require('express');
const fs = require('fs');
const { pool, q } = require('../config/db');
const audit = require('./audit');
const { validate } = require('./validate');
const { HttpError, wrap } = require('./errors');

const UI_KEYS = ['label', 'type', 'input', 'required', 'requiredOnCreate', 'max', 'min', 'maxVal', 'positive',
  'nonNegative', 'options', 'lookup', 'help', 'createOnly', 'editOnly', 'after', 'noFuture', 'default',
  'skipIfEmpty', 'patternMsg', 'accept'];

const publicField = f => {
  const o = {};
  UI_KEYS.forEach(k => { if (f[k] !== undefined) o[k] = f[k]; });
  if (typeof f.default === 'function') o.default = f.default();
  if (f.pattern) o.pattern = f.pattern.source;
  return o;
};

module.exports = function makeCrud(cfg) {
  const r = express.Router();
  const P = cfg.perms, hooks = cfg.hooks || {}, fields = cfg.fields || {};
  r.cfg = cfg;

  const allowed = list => (req, res, next) =>
    (list || []).includes(req.user.role) ? next() : next(new HttpError(403, 'Access denied'));

  const dbCols = new Set([
    ...Object.entries(fields).filter(([, f]) => !f.virtual && f.input !== 'file').map(([k]) => k),
    ...(cfg.extraColumns || [])
  ]);
  const colsOf = data => Object.keys(data).filter(k => dbCols.has(k));

  async function findOne(req, id) {
    const where = [`${cfg.alias}.${cfg.pk} = ?`], params = [id];
    const s = cfg.scope && cfg.scope(req);
    if (s) { where.push(s.sql); params.push(...s.params); }
    const rows = await q(`SELECT ${cfg.cols} ${cfg.from} WHERE ${where.join(' AND ')}`, params);
    return rows[0] || null;
  }
  async function mustFind(req) {
    const row = await findOne(req, req.params.id);
    if (!row) throw new HttpError(404, 'Record not found');
    return row;
  }
  async function runValidation(req, existing) {
    const { errors, data } = await validate(fields, req.body, { isUpdate: !!existing });
    if (!errors.length && hooks.validateExtra) errors.push(...((await hooks.validateExtra(data, req, existing)) || []));
    if (errors.length) throw new HttpError(400, 'Validation failed', errors);
    if (hooks.beforeSave) await hooks.beforeSave(data, req, existing);
    return data;
  }
  async function inTransaction(fn, onError) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (e) {
      await conn.rollback();
      onError && onError(e);
      throw e;
    } finally { conn.release(); }
  }

  // ---------- READ (list) ----------
  r.get('/', allowed(P.read), wrap(async (req, res) => {
    const where = [], params = [];
    const s = cfg.scope && cfg.scope(req);
    if (s) { where.push(s.sql); params.push(...s.params); }
    const search = String(req.query.search || '').trim();
    if (search && cfg.search) {
      where.push('(' + cfg.search.map(c => `${c} LIKE ?`).join(' OR ') + ')');
      cfg.search.forEach(() => params.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`));
    }
    for (const [k, col] of Object.entries(cfg.filters || {})) {
      const v = req.query[k];
      if (v !== undefined && v !== '') { where.push(col.includes('?') ? col : `${col} = ?`); params.push(String(v)); }
    }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const sortCol = (cfg.sort || {})[req.query.sort];   // whitelist: column names never come from the client
    const order = sortCol ? `${sortCol} ${req.query.dir === 'desc' ? 'DESC' : 'ASC'}` : cfg.defaultSort;
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 10));
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const [{ n }] = await q(`SELECT COUNT(*) AS n ${cfg.from} ${w}`, params);
    const rows = await q(`SELECT ${cfg.cols} ${cfg.from} ${w} ORDER BY ${order} LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]);
    res.json({ success: true, data: rows, total: n, page, pageSize });
  }));

  // ---------- READ (one) ----------
  r.get('/:id(\\d+)', allowed(P.read), wrap(async (req, res) => {
    res.json({ success: true, data: await mustFind(req) });
  }));

  // ---------- CREATE ----------
  const createMw = [allowed(P.create)];
  if (cfg.upload) createMw.push(cfg.upload);
  r.post('/', ...createMw, wrap(async (req, res) => {
    if (req.file) res.on('finish', () => { if (res.statusCode >= 400) fs.unlink(req.file.path, () => {}); });
    const data = await runValidation(req, null);
    const out = await inTransaction(async conn => {
      let id, extra = {};
      if (hooks.create) ({ id, extra = {} } = await hooks.create(conn, data, req));
      else {
        const cols = colsOf(data);
        const [ins] = await conn.query(`INSERT INTO ${cfg.table} (${cols.map(c => '`' + c + '`').join(',')}) VALUES (?)`,
          [cols.map(c => data[c])]);
        id = ins.insertId;
      }
      if (hooks.afterSave) Object.assign(extra, (await hooks.afterSave(conn, id, data, req, null)) || {});
      await audit.log(conn, req.user.id, 'CREATE', cfg.table, id);
      return { id, extra };
    }, e => { e.dupMap = cfg.dup; });
    res.status(201).json({ success: true, id: out.id, ...out.extra });
  }));

  // ---------- UPDATE ----------
  r.put('/:id(\\d+)', allowed(P.update), wrap(async (req, res) => {
    const existing = await mustFind(req);
    if (hooks.canModify) await hooks.canModify(req, existing, 'update');
    const data = await runValidation(req, existing);
    const extra = await inTransaction(async conn => {
      const cols = colsOf(data);
      if (cols.length)
        await conn.query(`UPDATE ${cfg.table} SET ${cols.map(c => '`' + c + '`=?').join(',')} WHERE ${cfg.pk} = ?`,
          [...cols.map(c => data[c]), existing[cfg.pk]]);
      const x = hooks.afterSave ? (await hooks.afterSave(conn, existing[cfg.pk], data, req, existing)) || {} : {};
      await audit.log(conn, req.user.id, 'UPDATE', cfg.table, existing[cfg.pk]);
      return x;
    }, e => { e.dupMap = cfg.dup; });
    res.json({ success: true, ...extra });
  }));

  // ---------- DELETE ----------
  r.delete('/:id(\\d+)', allowed(P.delete), wrap(async (req, res) => {
    const existing = await mustFind(req);
    if (hooks.canModify) await hooks.canModify(req, existing, 'delete');
    if (hooks.beforeDelete) await hooks.beforeDelete(req, existing);
    await inTransaction(async conn => {
      if (hooks.remove) await hooks.remove(conn, existing, req);
      else await conn.query(`DELETE FROM ${cfg.table} WHERE ${cfg.pk} = ?`, [existing[cfg.pk]]);
      await audit.log(conn, req.user.id, 'DELETE', cfg.table, existing[cfg.pk]);
    }, e => { e.inUse = cfg.inUseMessage; });
    if (hooks.afterDelete) await hooks.afterDelete(req, existing);
    res.json({ success: true });
  }));

  // ---------- CUSTOM ROW ACTIONS (approve, archive, update progress ...) ----------
  r.post('/:id(\\d+)/actions/:key', wrap(async (req, res) => {
    const a = (cfg.actions || []).find(x => x.key === req.params.key);
    if (!a) throw new HttpError(404, 'Unknown action');
    if (!a.roles.includes(req.user.role)) throw new HttpError(403, 'Access denied');
    const existing = await mustFind(req);
    let data = {};
    if (a.fields) {
      const v = await validate(a.fields, req.body);
      if (v.errors.length) throw new HttpError(400, 'Validation failed', v.errors);
      data = v.data;
    }
    const out = await inTransaction(async conn => {
      const x = (await a.run(conn, existing, data, req)) || {};
      await audit.log(conn, req.user.id, 'UPDATE', cfg.table, existing[cfg.pk]);
      return x;
    });
    res.json({ success: true, ...out });
  }));

  // ---------- Metadata the browser uses to build pages, forms and client-side validation ----------
  r.meta = user => {
    if (!P.read.includes(user.role)) return null;
    return {
      key: cfg.key, pk: cfg.pk, title: cfg.title, columns: cfg.columns, search: !!cfg.search,
      sortable: Object.keys(cfg.sort || {}), filters: cfg.filterUi || [], exportType: cfg.exportType,
      deleteWarning: cfg.deleteWarning, pageSize: cfg.pageSize || 10,
      perms: { create: P.create.includes(user.role), update: P.update.includes(user.role), delete: P.delete.includes(user.role) },
      fields: Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, publicField(f)])),
      multipart: Object.values(fields).some(f => f.input === 'file'),
      actions: (cfg.actions || []).filter(a => a.roles.includes(user.role)).map(a => ({
        key: a.key, label: a.label, confirm: a.confirm, when: a.when, style: a.style,
        fields: a.fields && Object.fromEntries(Object.entries(a.fields).map(([k, f]) => [k, publicField(f)]))
      }))
    };
  };
  return r;
};
