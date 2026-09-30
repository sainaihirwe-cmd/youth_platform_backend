/**
 * Sends a sample welcome email to check the SMTP settings in backend/.env.
 *
 *   npm run test-email -- you@example.com
 */
const nodemailer = require('nodemailer');
const { env } = require('../config/env');
const { welcomeEmail } = require('../utils/emailTemplates');

async function main() {
  const to = process.argv[2];
  if (!to) throw new Error('Usage: npm run test-email -- you@example.com');
  if (!env.emailEnabled) throw new Error('EMAIL_HOST, EMAIL_USER and EMAIL_PASS must be set in backend/.env.');

  const transporter = nodemailer.createTransport({
    host: env.email.host,
    port: env.email.port,
    secure: env.email.port === 465,
    auth: { user: env.email.user, pass: env.email.pass },
  });
  await transporter.verify();
  console.log(`Connected to ${env.email.host}:${env.email.port}`);

  const info = await transporter.sendMail({
    from: env.email.from,
    to,
    ...welcomeEmail({ name: 'Test User', email: to, role: 'job_seeker' }),
  });
  console.log(`Test welcome email sent to ${to} (${info.messageId})`);
}

main().catch((err) => {
  console.error(`Email test failed: ${err.message}`);
  process.exit(1);
});
