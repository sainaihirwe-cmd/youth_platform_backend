const multer = require('multer');
const ApiError = require('../utils/ApiError');
const { env } = require('../config/env');

function notFound(req, _res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal server error';
  let errors = err.errors;

  if (err instanceof multer.MulterError) {
    statusCode = 400;
    message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large.' : `Upload error: ${err.message}`;
    errors = undefined;
  } else if (err.name === 'ValidationError' && err.errors && !(err instanceof ApiError)) {
    statusCode = 400;
    message = 'Validation failed';
    errors = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
  } else if (err.name === 'CastError') {
    statusCode = 400;
    message = `Invalid value for ${err.path}`;
    errors = undefined;
  } else if (err.code === 11000) {
    statusCode = 409;
    const field = Object.keys(err.keyPattern || err.keyValue || {})[0];
    message = field === 'email' ? 'An account with this email already exists.' : 'Duplicate record.';
    errors = undefined;
  } else if (err.type === 'entity.parse.failed') {
    statusCode = 400;
    message = 'Malformed JSON in request body.';
  } else if (err.type === 'entity.too.large') {
    statusCode = 413;
    message = 'Request body is too large.';
  } else if (err.name === 'MongooseServerSelectionError' || err.name === 'MongoNetworkError') {
    statusCode = 503;
    message = 'Database is temporarily unavailable. Please try again shortly.';
  } else if (!(err instanceof ApiError) && statusCode >= 500) {
    // Never leak internal details in production
    if (env.isProduction) message = 'Something went wrong on our side. Please try again later.';
  }

  if (statusCode >= 500 && !env.isTest) {
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ->`, err.stack || err.message);
  }

  const body = { success: false, message };
  if (Array.isArray(errors) && errors.length) body.errors = errors;
  if (!env.isProduction && statusCode >= 500) body.stack = err.stack;
  res.status(statusCode).json(body);
}

module.exports = { notFound, errorHandler };
