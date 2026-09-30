const { validationResult, param } = require('express-validator');
const ApiError = require('../utils/ApiError');

/** Runs after express-validator chains and turns failures into a 400 response. */
function validate(req, _res, next) {
  const result = validationResult(req);
  if (result.isEmpty()) return next();
  const errors = result.array({ onlyFirstError: true }).map((e) => ({ field: e.path, message: e.msg }));
  return next(new ApiError(400, errors[0]?.message || 'Validation failed', errors));
}

const mongoIdParam = (name = 'id') => param(name).isMongoId().withMessage(`Invalid ${name}`);

const STRONG_PASSWORD = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,128}$/;
const STRONG_PASSWORD_MESSAGE =
  'Password must be at least 8 characters and include uppercase, lowercase, a number and a special character.';

/** Picks only the allowed keys from an object (prevents mass assignment). */
function pick(source, keys) {
  const out = {};
  for (const key of keys) {
    if (source && Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

module.exports = { validate, mongoIdParam, STRONG_PASSWORD, STRONG_PASSWORD_MESSAGE, pick };
