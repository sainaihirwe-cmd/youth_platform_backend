/**
 * Minimal RFC 4180 CSV writer.
 * Cells that start with = + - @ (or a tab/CR) are prefixed with ' so spreadsheet apps
 * never evaluate user-supplied text as a formula (CSV injection).
 */
function cell(value) {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** @param {string[]} headers @param {Array<Array<unknown>>} rows */
function toCsv(headers, rows) {
  // BOM so Excel opens UTF-8 (e.g. Kinyarwanda names) correctly
  return `﻿${[headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}

module.exports = { toCsv };
