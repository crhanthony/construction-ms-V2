// Server-side validation driven by the same field definitions the browser uses to build forms.
const { q } = require('../config/db');

const pad = n => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const isEmpty = v => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;

async function validate(fields, body, { isUpdate = false } = {}) {
  const errors = [], out = {}, refs = [];
  for (const [key, f] of Object.entries(fields)) {
    if (f.readOnly || f.input === 'file') continue;
    if (f.createOnly && isUpdate) continue;
    if (f.editOnly && !isUpdate) continue;
    const label = f.label || key;
    const err = m => errors.push({ field: key, message: m });
    let v = body[key];

    const dflt = typeof f.default === 'function' ? f.default() : f.default;
    if (f.type === 'bool') {
      out[key] = v === undefined ? (dflt ?? 0) : (['1', 'true', 'on', 1, true].includes(v) ? 1 : 0);
      continue;
    }
    if (isEmpty(v)) {
      if (f.skipIfEmpty && isUpdate) continue;
      if (f.required || (f.requiredOnCreate && !isUpdate)) { err(`${label} is required`); continue; }
      out[key] = dflt !== undefined ? dflt : null;
      continue;
    }
    if (typeof v === 'string') v = v.trim();

    switch (f.type) {
      case 'string': case 'text': {
        const max = f.max || (f.type === 'text' ? 5000 : 255);
        if (String(v).length > max) { err(`${label} must be at most ${max} characters`); break; }
        if (f.pattern && !f.pattern.test(v)) { err(f.patternMsg || `${label} has an invalid format`); break; }
        out[key] = String(v); break;
      }
      case 'email':
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || String(v).length > 120) err('Enter a valid email address');
        else out[key] = String(v).toLowerCase();
        break;
      case 'int': {
        if (!/^-?\d+$/.test(String(v))) { err(`${label} must be a whole number`); break; }
        const n = Number(v);
        if ((f.min !== undefined && n < f.min) || (f.maxVal !== undefined && n > f.maxVal)) {
          err(`${label} must be between ${f.min ?? '-∞'} and ${f.maxVal ?? '∞'}`); break;
        }
        out[key] = n; break;
      }
      case 'decimal': {
        if (!/^-?\d+(\.\d{1,2})?$/.test(String(v))) { err(`${label} must be a number with at most 2 decimals`); break; }
        const n = Number(v);
        if (f.positive && n <= 0) { err(`${label} must be a positive number`); break; }
        if (f.nonNegative && n < 0) { err(`${label} cannot be negative`); break; }
        if (n > (f.maxVal || 9999999999.99)) { err(`${label} is too large`); break; }
        out[key] = n; break;
      }
      case 'date':
        if (!validDate(v)) err(`${label} must be a valid date`);
        else if (f.noFuture && v > today()) err(`${label} cannot be in the future`);
        else out[key] = v;
        break;
      case 'enum':
        if (!f.options.includes(v)) err(`Select a valid ${label.toLowerCase()}`); else out[key] = v;
        break;
      case 'ref':
        if (!/^\d+$/.test(String(v)) || Number(v) < 1) err(`Select a valid ${label.toLowerCase()}`);
        else { out[key] = Number(v); refs.push([key, f]); }
        break;
      default: out[key] = v;
    }
  }
  for (const [key, f] of refs) {
    if (errors.some(e => e.field === key)) continue;
    const rows = await q(`SELECT 1 FROM ${f.refTable} WHERE ${f.refPk} = ? LIMIT 1`, [out[key]]);
    if (!rows.length) errors.push({ field: key, message: `Select a valid ${(f.label || key).toLowerCase()}` });
  }
  return { errors, data: out };
}

module.exports = { validate, today };
