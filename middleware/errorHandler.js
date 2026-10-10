const { HttpError } = require('../lib/errors');

module.exports = (err, req, res, next) => {
  let status = 500, body = { success: false, message: 'Something went wrong. Please try again.' };

  if (err instanceof HttpError) {
    status = err.status;
    body = { success: false, message: err.message };
    if (err.errors) body.errors = err.errors;
  } else if (err.code === 'ER_DUP_ENTRY') {
    status = 409;
    body.message = 'A record with the same unique value already exists';
    for (const [key, d] of Object.entries(err.dupMap || {})) {
      if ((err.sqlMessage || '').includes(key)) {
        body.message = d.message;
        if (d.field) body.errors = [{ field: d.field, message: d.message }];
        break;
      }
    }
  } else if (err.errno === 1451) {
    status = 409; body.message = err.inUse || 'Cannot delete: record is in use';
  } else if (err.errno === 1452) {
    status = 400; body.message = 'A selected value does not exist';
  } else if (err.errno === 3819 || err.errno === 4025) {
    status = 400; body.message = 'A value breaks a database rule (check ranges and dates)';
  } else if (err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_UNEXPECTED_FILE') {
    status = 400; body.message = 'File must be PDF, JPG, PNG or DOCX under 5 MB';
    body.errors = [{ field: 'file', message: body.message }];
  } else if (['ECONNREFUSED', 'PROTOCOL_CONNECTION_LOST', 'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR', 'ETIMEDOUT'].includes(err.code)) {
    status = 503; body.message = 'The database is unavailable. Please try again shortly.';
    console.error('[db]', err.code, err.message);
  } else if (err.type === 'entity.parse.failed') {
    status = 400; body.message = 'Malformed JSON body';
  } else {
    console.error('[error]', err); // details stay in the server log only
  }
  res.status(status).json(body);
};
