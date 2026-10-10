const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const makeCrud = require('../lib/crud');
const { q } = require('../config/db');
const { HttpError, wrap } = require('../lib/errors');
const { ROLES: R, UPLOAD } = require('../config/constants');
const { byProject } = require('../lib/scope');

const DIR = path.join(__dirname, '..', 'uploads');   // outside /public: only reachable through the authorised download route
fs.mkdirSync(DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + path.extname(file.originalname).toLowerCase())
  }),
  limits: { fileSize: UPLOAD.maxBytes, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = UPLOAD.types.includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new HttpError(400, 'File must be PDF, JPG, PNG or DOCX under 5 MB', [{ field: 'file', message: 'File must be PDF, JPG, PNG or DOCX under 5 MB' }]), ok);
  }
}).single('file');

const router = makeCrud({
  key: 'documents', title: 'Documents & Photos', table: 'documents', pk: 'document_id', alias: 'd', upload,
  cols: 'd.document_id, d.project_id, d.report_id, d.uploaded_by, d.file_name, d.file_path, d.file_size, d.description, d.uploaded_at, p.project_name, u.full_name AS uploaded_by_name',
  from: 'FROM documents d JOIN projects p ON p.project_id = d.project_id JOIN users u ON u.user_id = d.uploaded_by',
  search: ['d.file_name', 'd.description', 'p.project_name'],
  filters: { project_id: 'd.project_id' },
  filterUi: [{ key: 'project_id', label: 'Project', lookup: 'projects' }],
  sort: { file_name: 'd.file_name', uploaded_at: 'd.uploaded_at', project_name: 'p.project_name' }, defaultSort: 'd.document_id DESC',
  columns: [{ key: 'file_name', label: 'File', type: 'download' }, { key: 'description', label: 'Description' }, { key: 'project_name', label: 'Project' },
    { key: 'file_size', label: 'Size', type: 'size' }, { key: 'uploaded_by_name', label: 'Uploaded by' }, { key: 'uploaded_at', label: 'Uploaded' }],
  perms: { read: [R.SE, R.PM, R.A, R.FN, R.CL], create: [R.SE, R.PM], update: [R.SE, R.PM], delete: [R.SE, R.PM] },
  scope: byProject('d.project_id'),
  fields: {
    project_id: { label: 'Project', type: 'ref', required: true, lookup: 'projects', refTable: 'projects', refPk: 'project_id' },
    report_id: { label: 'Attach to site report (optional)', type: 'ref', lookup: 'reports', refTable: 'site_reports', refPk: 'report_id' },
    description: { label: 'Description', type: 'string', max: 200 },
    file: { label: 'File (PDF, JPG, PNG, DOCX - max 5 MB)', type: 'string', input: 'file', createOnly: true, required: true, accept: '.pdf,.jpg,.jpeg,.png,.docx' }
  },
  extraColumns: ['uploaded_by', 'file_name', 'file_path', 'file_size'],
  hooks: {
    async canModify(req, row) {
      if (req.user.role === R.SE && row.uploaded_by !== req.user.id) throw new HttpError(403, 'Only the author or a manager can change this document');
    },
    async beforeSave(d, req, existing) {
      if (existing) return;
      if (!req.file) throw new HttpError(400, 'Validation failed', [{ field: 'file', message: 'Choose a file to upload' }]);
      const MAGIC = { '.pdf': [[0x25, 0x50, 0x44, 0x46]], '.png': [[0x89, 0x50, 0x4e, 0x47]], '.jpg': [[0xff, 0xd8, 0xff]], '.jpeg': [[0xff, 0xd8, 0xff]], '.docx': [[0x50, 0x4b, 0x03, 0x04]] };
      const buf = Buffer.alloc(4); const fd = fs.openSync(req.file.path, 'r'); fs.readSync(fd, buf, 0, 4, 0); fs.closeSync(fd);
      const ok = (MAGIC[path.extname(req.file.originalname).toLowerCase()] || []).some(sig => sig.every((b, i) => buf[i] === b));
      if (!ok) throw new HttpError(400, 'Validation failed', [{ field: 'file', message: 'The file content does not match its type (PDF, JPG, PNG or DOCX)' }]);
      Object.assign(d, { uploaded_by: req.user.id, file_name: req.file.originalname.slice(0, 150), file_path: req.file.filename, file_size: req.file.size });
    },
    async afterDelete(req, row) { fs.unlink(path.join(DIR, path.basename(row.file_path)), () => {}); }
  }
});

// Authorised download: files live outside the public web root and are streamed only after a role/scope check.
router.get('/:id(\\d+)/download', wrap(async (req, res) => {
  if (!router.cfg.perms.read.includes(req.user.role)) throw new HttpError(403, 'Access denied');
  const s = router.cfg.scope(req);
  const rows = await q(`SELECT d.file_name, d.file_path FROM documents d WHERE d.document_id = ? ${s ? 'AND ' + s.sql : ''}`, [req.params.id, ...(s ? s.params : [])]);
  if (!rows.length) throw new HttpError(404, 'Record not found');
  const file = path.join(DIR, path.basename(rows[0].file_path));
  if (!fs.existsSync(file)) throw new HttpError(404, 'File is missing on the server');
  res.download(file, rows[0].file_name);
}));

module.exports = router;
