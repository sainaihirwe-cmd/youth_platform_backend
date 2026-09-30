/**
 * Request sanitisation:
 *  - removes keys starting with "$" or containing "." (MongoDB operator injection)
 *  - strips HTML tags from string values (stored XSS); password fields are left untouched
 *  - trims strings
 * Express 5 parses query strings with the "simple" parser, so req.query values are strings
 * or arrays of strings; controllers still cast them explicitly.
 */
const SKIP_HTML_STRIP = new Set(['password', 'currentPassword', 'newPassword', 'confirmPassword', 'token']);
const TAG_RE = /<\/?[a-z][^>]*>/gi;
const SCRIPT_RE = /<(script|style)[^>]*>[\s\S]*?<\/\1>/gi;

function clean(value, key) {
  if (typeof value === 'string') {
    if (SKIP_HTML_STRIP.has(key)) return value;
    return value.replace(SCRIPT_RE, '').replace(TAG_RE, '').trim();
  }
  if (Array.isArray(value)) return value.map((v) => clean(v, key));
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith('$') || k.includes('.') || k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      out[k] = clean(v, k);
    }
    return out;
  }
  return value;
}

function sanitizeRequest(req, _res, next) {
  if (req.body && typeof req.body === 'object') req.body = clean(req.body);
  if (req.params && typeof req.params === 'object') {
    for (const k of Object.keys(req.params)) req.params[k] = clean(req.params[k], k);
  }
  next();
}

module.exports = { sanitizeRequest, clean };
