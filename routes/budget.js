const express = require('express');
const { wrap, HttpError } = require('../lib/errors');
const { budgetRows } = require('../lib/budget');
const { ROLES: R } = require('../config/constants');

const router = express.Router();
const OK = [R.FN, R.PM, R.A, R.CL];
const guard = (req, res, next) => (OK.includes(req.user.role) ? next() : next(new HttpError(403, 'Access denied')));

router.get('/budget', guard, wrap(async (req, res) => res.json({ success: true, data: await budgetRows(req.user) })));
router.get('/projects/:id(\\d+)/budget', guard, wrap(async (req, res) => {
  const [row] = await budgetRows(req.user, req.params.id);
  if (!row) throw new HttpError(404, 'Record not found');
  res.json({ success: true, data: row });
}));

module.exports = router;
