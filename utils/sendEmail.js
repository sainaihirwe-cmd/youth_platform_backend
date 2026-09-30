const nodemailer = require('nodemailer');
const { env } = require('../config/env');

let transporter;

function getTransporter() {
  if (!env.emailEnabled) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.email.host,
      port: env.email.port,
      secure: env.email.port === 465,
      auth: { user: env.email.user, pass: env.email.pass },
    });
  }
  return transporter;
}

/**
 * Sends an email when SMTP is configured. Returns true when sent, false when email is disabled.
 * Failures are logged (without credentials) and re-thrown only when `throwOnError` is set.
 */
async function sendEmail({ to, subject, text, html }, { throwOnError = false } = {}) {
  const t = getTransporter();
  if (!t) return false;
  try {
    await t.sendMail({ from: env.email.from, to, subject, text, html });
    return true;
  } catch (err) {
    console.error(`Email to ${to} failed: ${err.message}`);
    if (throwOnError) throw err;
    return false;
  }
}

module.exports = sendEmail;
