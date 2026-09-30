/** Converts JWT-style durations ("1d", "12h", "30m", "3600") to milliseconds. */
const UNITS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

module.exports = function toMs(value) {
  const match = /^(\d+)\s*([smhdw])?$/i.exec(String(value).trim());
  if (!match) return UNITS.d;
  const n = Number(match[1]);
  return match[2] ? n * UNITS[match[2].toLowerCase()] : n * 1000;
};
