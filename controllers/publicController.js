const Setting = require('../models/Setting');
const ContactMessage = require('../models/ContactMessage');
const sendEmail = require('../utils/sendEmail');
const { sendSuccess } = require('../utils/apiResponse');
const { pick } = require('../middleware/validationMiddleware');

const PUBLIC_SETTINGS = [
  'siteName',
  'tagline',
  'contactEmail',
  'contactPhone',
  'contactAddress',
  'allowSeekerRegistration',
  'allowEmployerRegistration',
  'maintenanceMessage',
];

// GET /api/settings/public
exports.getPublicSettings = async (_req, res) => {
  const settings = await Setting.getSettings();
  return sendSuccess(res, { data: pick(settings.toObject(), PUBLIC_SETTINGS) });
};

// POST /api/contact
exports.submitContact = async (req, res) => {
  const data = pick(req.body, ['name', 'email', 'subject', 'message']);
  if (req.user) data.userId = req.user._id;
  const message = await ContactMessage.create(data);

  const settings = await Setting.getSettings();
  sendEmail({
    to: settings.contactEmail,
    subject: `[Contact] ${data.subject}`,
    text: `From: ${data.name} <${data.email}>\n\n${data.message}`,
  }).catch(() => {});

  return sendSuccess(res, {
    status: 201,
    message: 'Thank you for contacting us. Our team will respond as soon as possible.',
    data: { id: message._id },
  });
};
