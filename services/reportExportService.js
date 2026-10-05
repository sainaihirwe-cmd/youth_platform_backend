const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { toCsv } = require('../utils/csv');
const { REPORT_STATUSES } = require('../config/constants');

const EXPORT_FORMATS = ['csv', 'xlsx', 'pdf', 'json'];

const LABELS = {
  status: { pending: 'Pending', under_review: 'Under review', resolved: 'Resolved', dismissed: 'Dismissed' },
  reason: {
    scam: 'Scam or fraud',
    misleading: 'Misleading description',
    inappropriate: 'Inappropriate content',
    suspicious_account: 'Suspicious account',
    spam: 'Spam',
    other: 'Other',
  },
  action: { none: '', job_removed: 'Job removed', user_suspended: 'Account suspended' },
  type: { job: 'Job', user: 'Account' },
};

const COLUMNS = [
  { key: 'id', header: 'Report ID', width: 26 },
  { key: 'createdAt', header: 'Date', width: 20, date: true },
  { key: 'status', header: 'Status', width: 14, label: 'status' },
  { key: 'reason', header: 'Reason', width: 22, label: 'reason' },
  { key: 'type', header: 'Type', width: 10, label: 'type' },
  { key: 'reportedJob', header: 'Reported job', width: 30 },
  { key: 'reportedUser', header: 'Reported user', width: 24 },
  { key: 'reportedUserEmail', header: 'Reported user email', width: 28 },
  { key: 'reporter', header: 'Reporter', width: 22 },
  { key: 'reporterEmail', header: 'Reporter email', width: 28 },
  { key: 'description', header: 'Details', width: 40 },
  { key: 'actionTaken', header: 'Action taken', width: 18, label: 'action' },
  { key: 'adminNotes', header: 'Admin notes', width: 40 },
  { key: 'reviewedBy', header: 'Reviewed by', width: 20 },
  { key: 'reviewedAt', header: 'Reviewed at', width: 20, date: true },
];

const display = (col, row) => {
  const v = row[col.key];
  if (col.label) return LABELS[col.label][v] ?? v ?? '';
  return v ?? '';
};
const fmtDate = (d) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 16) : '');

/** Human-readable description of the active filters, e.g. "Pending, Job reports". */
function describeFilters(filters) {
  const parts = [
    filters.status && LABELS.status[filters.status],
    filters.type && (filters.type === 'job' ? 'Job reports' : 'Account reports'),
    filters.reason && LABELS.reason[filters.reason],
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'All reports';
}

function statusCounts(rows) {
  return Object.fromEntries(REPORT_STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length]));
}

function renderCsv(rows) {
  // CSV keeps raw codes (pending, scam, ...) so it stays easy to filter and re-import
  return Buffer.from(toCsv(COLUMNS.map((c) => c.header), rows.map((r) => COLUMNS.map((c) => r[c.key]))), 'utf8');
}

async function renderXlsx(rows, meta) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'JobConnect Rwanda';
  wb.created = meta.generatedAt;

  const sheet = wb.addWorksheet('Reports', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  rows.forEach((r) => {
    sheet.addRow(Object.fromEntries(COLUMNS.map((c) => [c.key, c.date ? (r[c.key] ? new Date(r[c.key]) : null) : display(c, r)])));
  });
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B1F3A' } };
  COLUMNS.forEach((c, i) => {
    if (c.date) sheet.getColumn(i + 1).numFmt = 'yyyy-mm-dd hh:mm';
  });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };
  sheet.eachRow((row, n) => n > 1 && (row.alignment = { vertical: 'top', wrapText: true }));

  const summary = wb.addWorksheet('Summary');
  summary.columns = [{ width: 24 }, { width: 40 }];
  const counts = statusCounts(rows);
  [
    ['JobConnect Rwanda - Moderation reports'],
    [],
    ['Generated', fmtDate(meta.generatedAt)],
    ['Filters', describeFilters(meta.filters)],
    ['Total reports', meta.total],
    ...REPORT_STATUSES.map((s) => [LABELS.status[s], counts[s]]),
    ...(meta.truncated ? [[], [`Only the newest ${rows.length} of ${meta.total} reports are included.`]] : []),
  ].forEach((r) => summary.addRow(r));
  summary.getRow(1).font = { bold: true, size: 14 };

  return Buffer.from(await wb.xlsx.writeBuffer());
}

function renderPdf(rows, meta) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: true, info: { Title: 'JobConnect Rwanda - Moderation reports', Author: 'JobConnect Rwanda' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const usable = doc.page.width - left - doc.page.margins.right;
    const bottom = doc.page.height - doc.page.margins.bottom;

    // Header
    doc.fillColor('#1d4ed8').font('Helvetica-Bold').fontSize(9).text('JOBCONNECT RWANDA', left, 36, { characterSpacing: 1.5 });
    doc.fillColor('#0f172a').fontSize(18).text('Moderation reports');
    doc.font('Helvetica').fontSize(9).fillColor('#475569').text(`Generated ${fmtDate(meta.generatedAt)} UTC  |  Filters: ${describeFilters(meta.filters)}`);
    doc.moveDown(0.6);

    // Summary boxes
    const counts = statusCounts(rows);
    const boxes = [['Total', meta.total], ...REPORT_STATUSES.map((s) => [LABELS.status[s], counts[s]])];
    const boxW = (usable - 8 * (boxes.length - 1)) / boxes.length;
    const boxY = doc.y;
    boxes.forEach(([label, value], i) => {
      const x = left + i * (boxW + 8);
      doc.roundedRect(x, boxY, boxW, 38, 4).strokeColor('#cbd5e1').lineWidth(0.8).stroke();
      doc.fillColor('#64748b').font('Helvetica').fontSize(8).text(label, x + 8, boxY + 6, { width: boxW - 16 });
      doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(14).text(String(value), x + 8, boxY + 18, { width: boxW - 16 });
    });
    doc.y = boxY + 50;
    if (meta.truncated) {
      doc.fillColor('#b45309').font('Helvetica').fontSize(8).text(`Only the newest ${rows.length} of ${meta.total} reports are included. Narrow the filters to include the rest.`, left);
      doc.moveDown(0.5);
    }

    // Table
    const cols = [
      { title: 'Date', w: 0.1, get: (r) => fmtDate(r.createdAt).slice(0, 10) },
      { title: 'Reported item', w: 0.27, get: (r) => [r.type === 'job' ? r.reportedJob || 'Deleted job' : r.reportedUser || 'Deleted account', LABELS.type[r.type], r.description].filter(Boolean).join('\n') },
      { title: 'Reason', w: 0.13, get: (r) => LABELS.reason[r.reason] || r.reason },
      { title: 'Reported by', w: 0.16, get: (r) => [r.reporter || '-', r.reporterEmail].filter(Boolean).join('\n') },
      { title: 'Status', w: 0.09, get: (r) => LABELS.status[r.status] || r.status },
      { title: 'Outcome', w: 0.25, get: (r) => [LABELS.action[r.actionTaken], r.adminNotes, r.reviewedBy && `Reviewed by ${r.reviewedBy}${r.reviewedAt ? `, ${fmtDate(r.reviewedAt).slice(0, 10)}` : ''}`].filter(Boolean).join('\n') },
    ].map((c) => ({ ...c, width: c.w * usable }));
    const pad = 4;

    const drawHeader = () => {
      const y = doc.y;
      doc.rect(left, y, usable, 18).fill('#0b1f3a');
      let x = left;
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);
      cols.forEach((c) => {
        doc.text(c.title, x + pad, y + 5, { width: c.width - pad * 2 });
        x += c.width;
      });
      doc.y = y + 18;
    };

    if (!rows.length) {
      doc.fillColor('#64748b').font('Helvetica').fontSize(10).text('No reports match these filters.', left, doc.y + 20, { width: usable, align: 'center' });
    } else {
      drawHeader();
      doc.font('Helvetica').fontSize(8);
      rows.forEach((r, i) => {
        const values = cols.map((c) => String(c.get(r) ?? ''));
        const h = Math.max(...values.map((v, j) => doc.heightOfString(v, { width: cols[j].width - pad * 2 }))) + pad * 2;
        if (doc.y + h > bottom - 14) {
          doc.addPage();
          doc.y = doc.page.margins.top;
          drawHeader();
          doc.font('Helvetica').fontSize(8);
        }
        const y = doc.y;
        if (i % 2) doc.rect(left, y, usable, h).fill('#f1f5f9');
        let x = left;
        doc.fillColor('#0f172a');
        values.forEach((v, j) => {
          doc.text(v, x + pad, y + pad, { width: cols[j].width - pad * 2 });
          x += cols[j].width;
        });
        doc.y = y + h;
      });
    }

    // Footer on every page
    const range = doc.bufferedPageRange();
    for (let p = range.start; p < range.start + range.count; p += 1) {
      doc.switchToPage(p);
      doc.page.margins.bottom = 0; // writing inside the bottom margin must not trigger a new page
      doc.fillColor('#94a3b8').font('Helvetica').fontSize(7);
      doc.text(`Confidential - for JobConnect Rwanda administrators only  |  Page ${p + 1} of ${range.count}`, left, doc.page.height - 26, {
        width: usable,
        align: 'center',
        lineBreak: false,
      });
    }
    doc.end();
  });
}

/**
 * Renders report rows in the requested format.
 * @returns {Promise<{ body: Buffer, contentType: string, extension: string }>}
 */
async function renderReports(format, rows, meta) {
  switch (format) {
    case 'xlsx':
      return { body: await renderXlsx(rows, meta), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: 'xlsx' };
    case 'pdf':
      return { body: await renderPdf(rows, meta), contentType: 'application/pdf', extension: 'pdf' };
    case 'json':
      return {
        body: Buffer.from(JSON.stringify({ generatedAt: meta.generatedAt, filters: meta.filters, total: meta.total, truncated: meta.truncated, reports: rows }, null, 2)),
        contentType: 'application/json; charset=utf-8',
        extension: 'json',
      };
    default:
      return { body: renderCsv(rows), contentType: 'text/csv; charset=utf-8', extension: 'csv' };
  }
}

module.exports = { EXPORT_FORMATS, renderReports };
