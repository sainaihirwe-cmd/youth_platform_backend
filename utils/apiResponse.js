/** Consistent success envelope: { success, message?, data, pagination? } */
function sendSuccess(res, { status = 200, message, data = null, pagination } = {}) {
  const body = { success: true };
  if (message) body.message = message;
  body.data = data;
  if (pagination) body.pagination = pagination;
  return res.status(status).json(body);
}

function parsePagination(query, { defaultLimit = 10, maxLimit = 50 } = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

function buildPagination(page, limit, total) {
  return { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) };
}

function escapeRegex(str = '') {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { sendSuccess, parsePagination, buildPagination, escapeRegex };
