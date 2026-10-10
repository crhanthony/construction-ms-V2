class HttpError extends Error {
  constructor(status, message, errors) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
module.exports = { HttpError, wrap };
