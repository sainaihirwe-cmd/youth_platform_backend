const jwt = require('jsonwebtoken');
const ms = require('./duration');
const { env } = require('../config/env');

const COOKIE_NAME = 'jc_token';

function generateToken(user) {
  return jwt.sign({ id: user._id.toString(), role: user.role }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.isProduction,
    // Frontend and API are usually on different domains in production (e.g. two Render services).
    sameSite: env.isProduction ? 'none' : 'lax',
    maxAge: ms(env.jwtExpiresIn),
    path: '/',
  };
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, cookieOptions());
}

function clearAuthCookie(res) {
  const { maxAge, ...opts } = cookieOptions();
  res.clearCookie(COOKIE_NAME, opts);
}

module.exports = { generateToken, setAuthCookie, clearAuthCookie, COOKIE_NAME };
