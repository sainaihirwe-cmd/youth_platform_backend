const jwt = require('jsonwebtoken');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const { COOKIE_NAME } = require('../utils/generateToken');
const { env } = require('../config/env');

function extractToken(req) {
  if (req.cookies && req.cookies[COOKIE_NAME]) return req.cookies[COOKIE_NAME];
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

async function resolveUser(token) {
  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch (err) {
    if (err.name === 'TokenExpiredError') throw new ApiError(401, 'Your session has expired. Please log in again.');
    throw new ApiError(401, 'Invalid authentication token. Please log in again.');
  }
  const user = await User.findById(payload.id);
  if (!user) throw new ApiError(401, 'The account for this session no longer exists.');
  if (user.changedPasswordAfter(payload.iat)) {
    throw new ApiError(401, 'Your password was changed recently. Please log in again.');
  }
  if (user.isSuspended) {
    throw new ApiError(403, 'Your account has been suspended. Please contact support.');
  }
  return user;
}

/** Requires a valid session; attaches req.user. */
async function protect(req, _res, next) {
  const token = extractToken(req);
  if (!token) return next(ApiError.unauthorized());
  req.user = await resolveUser(token);
  return next();
}

/** Attaches req.user when a valid session exists, but never rejects the request. */
async function optionalAuth(req, _res, next) {
  const token = extractToken(req);
  if (token) {
    try {
      req.user = await resolveUser(token);
    } catch {
      req.user = undefined;
    }
  }
  return next();
}

module.exports = { protect, optionalAuth };
