const rateLimit = require('express-rate-limit');
const { env } = require('../config/env');

const skip = () => env.isTest;
const handler = (message) => (_req, res) => res.status(429).json({ success: false, message });

/** Brute-force protection for login endpoints: 10 failed attempts per 15 minutes per IP. */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip,
  handler: handler('Too many login attempts. Please wait 15 minutes and try again.'),
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip,
  handler: handler('Too many accounts created from this network. Please try again later.'),
});

const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip,
  handler: handler('Too many password reset requests. Please try again later.'),
});

const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip,
  handler: handler('Too many messages sent. Please try again later.'),
});

/** General API limiter as a safety net against abuse. */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip,
  handler: handler('Too many requests. Please slow down.'),
});

module.exports = { loginLimiter, registerLimiter, passwordResetLimiter, contactLimiter, apiLimiter };
