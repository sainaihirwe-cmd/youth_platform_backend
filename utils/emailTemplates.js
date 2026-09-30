const { env } = require('../config/env');
const { ROLES } = require('../config/constants');

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const ROLE_CONTENT = {
  [ROLES.JOB_SEEKER]: {
    intro: 'Your job seeker account is ready. You can now discover local opportunities and apply in a few clicks.',
    steps: ['Complete your profile and add your skills', 'Upload your resume', 'Browse jobs and save the ones you like', 'Apply and track your applications'],
    cta: 'Go to my dashboard',
    path: '/seeker/dashboard',
  },
  [ROLES.EMPLOYER]: {
    intro: 'Your employer account is ready. You can now post jobs and connect with talented people across Rwanda.',
    steps: ['Complete your company profile', 'Post your first job', 'Review applicants', 'Accept or reject applications'],
    cta: 'Go to my dashboard',
    path: '/employer/dashboard',
  },
};

/** Welcome email sent after registration. Returns { subject, text, html } for sendEmail. */
function welcomeEmail(user) {
  const content = ROLE_CONTENT[user.role] || ROLE_CONTENT[ROLES.JOB_SEEKER];
  const url = `${env.clientUrls[0]}${content.path}`;
  const firstName = user.name.split(' ')[0];
  const subject = 'Welcome to JobConnect Rwanda';

  const text = [
    `Hello ${firstName},`,
    '',
    content.intro,
    '',
    'Next steps:',
    ...content.steps.map((s, i) => `${i + 1}. ${s}`),
    '',
    `${content.cta}: ${url}`,
    '',
    '- JobConnect Rwanda',
  ].join('\n');

  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;">
        <tr><td style="background:#0f2a4a;padding:24px 32px;color:#ffffff;font-size:20px;font-weight:bold;">JobConnect Rwanda</td></tr>
        <tr><td style="padding:32px;">
          <h1 style="margin:0 0 16px;font-size:22px;">Welcome, ${escapeHtml(firstName)}!</h1>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#334155;">${escapeHtml(content.intro)}</p>
          <p style="margin:0 0 8px;font-size:15px;font-weight:bold;">Next steps</p>
          <ol style="margin:0 0 28px;padding-left:20px;font-size:15px;line-height:1.8;color:#334155;">
            ${content.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}
          </ol>
          <a href="${escapeHtml(url)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:8px;font-size:15px;">${escapeHtml(content.cta)}</a>
          <p style="margin:28px 0 0;font-size:13px;color:#64748b;">You received this email because an account was created with ${escapeHtml(user.email)}. If this wasn't you, please contact us.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}

module.exports = { welcomeEmail };
