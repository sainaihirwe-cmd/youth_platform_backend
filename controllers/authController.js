const crypto = require('crypto');
const User = require('../models/User');
const EmployerProfile = require('../models/EmployerProfile');
const Setting = require('../models/Setting');
const ApiError = require('../utils/ApiError');
const sendEmail = require('../utils/sendEmail');
const { welcomeEmail } = require('../utils/emailTemplates');
const { sendSuccess } = require('../utils/apiResponse');
const { generateToken, setAuthCookie, clearAuthCookie } = require('../utils/generateToken');
const { ROLES } = require('../config/constants');
const { env } = require('../config/env');

async function buildSession(user) {
  const data = { user: user.toJSON() };
  if (user.role === ROLES.EMPLOYER) {
    data.employerProfile = await EmployerProfile.findOne({ userId: user._id });
  }
  return data;
}

function issueSession(res, user) {
  const token = generateToken(user);
  setAuthCookie(res, token);
  return token;
}

// POST /api/auth/register
exports.register = async (req, res) => {
  const { name, email, password, role, phone, location, companyName } = req.body;

  // Only job seekers and employers can self-register; admin accounts come from scripts/createAdmin.js
  if (![ROLES.JOB_SEEKER, ROLES.EMPLOYER].includes(role)) {
    throw ApiError.badRequest('Role must be job_seeker or employer.');
  }

  const settings = await Setting.getSettings();
  if (role === ROLES.JOB_SEEKER && !settings.allowSeekerRegistration) {
    throw ApiError.forbidden('Job seeker registration is currently disabled.');
  }
  if (role === ROLES.EMPLOYER && !settings.allowEmployerRegistration) {
    throw ApiError.forbidden('Employer registration is currently disabled.');
  }

  const exists = await User.exists({ email: email.toLowerCase() });
  if (exists) throw ApiError.conflict('An account with this email already exists.');

  const user = await User.create({ name, email, password, role, phone, location: location || '' });

  if (role === ROLES.EMPLOYER) {
    try {
      await EmployerProfile.create({
        userId: user._id,
        companyName: companyName || name,
        phone: phone || '',
        location: location || '',
        contactEmail: user.email,
      });
    } catch (err) {
      await User.deleteOne({ _id: user._id });
      throw err;
    }
  }

  // No session is issued here: new users are sent to the login page and sign in themselves
  // Fire-and-forget: a mail failure must not block registration
  sendEmail({ to: user.email, ...welcomeEmail(user) }).catch(() => {});

  return sendSuccess(res, { status: 201, message: 'Account created successfully. Please log in.', data: { user: user.toJSON() } });
};

async function authenticate(email, password) {
  const user = await User.findOne({ email: String(email).toLowerCase() }).select('+password');
  // Same message for unknown email and wrong password (prevents account enumeration)
  if (!user || !(await user.comparePassword(String(password)))) {
    throw ApiError.unauthorized('Invalid email or password.');
  }
  if (user.isSuspended) {
    throw ApiError.forbidden('Your account has been suspended. Please contact support.');
  }
  return user;
}

// POST /api/auth/login  (job seekers and employers)
exports.login = async (req, res) => {
  const user = await authenticate(req.body.email, req.body.password);
  if (user.role === ROLES.ADMIN) {
    throw ApiError.forbidden('Administrators must sign in through the administrator login page.');
  }
  user.lastLoginAt = new Date();
  await user.save({ validateModifiedOnly: true });
  issueSession(res, user);
  return sendSuccess(res, { message: 'Logged in successfully', data: await buildSession(user) });
};

// POST /api/auth/admin/login  (administrators only)
exports.adminLogin = async (req, res) => {
  const user = await authenticate(req.body.email, req.body.password);
  if (user.role !== ROLES.ADMIN) throw ApiError.unauthorized('Invalid email or password.');
  user.lastLoginAt = new Date();
  await user.save({ validateModifiedOnly: true });
  issueSession(res, user);
  return sendSuccess(res, { message: 'Logged in successfully', data: await buildSession(user) });
};

// POST /api/auth/logout
exports.logout = async (_req, res) => {
  clearAuthCookie(res);
  return sendSuccess(res, { message: 'Logged out successfully' });
};

// GET /api/auth/me
exports.me = async (req, res) => sendSuccess(res, { data: await buildSession(req.user) });

// GET /api/auth/session  (never 401: returns { user: null } for guests, used on page load)
exports.session = async (req, res) =>
  sendSuccess(res, { data: req.user ? await buildSession(req.user) : { user: null, employerProfile: null } });

// PUT /api/auth/change-password
exports.changePassword = async (req, res) => {
  const user = await User.findById(req.user._id).select('+password');
  if (!(await user.comparePassword(req.body.currentPassword))) {
    throw ApiError.badRequest('Current password is incorrect.');
  }
  user.password = req.body.newPassword;
  await user.save();
  issueSession(res, user);
  return sendSuccess(res, { message: 'Password updated successfully' });
};

// POST /api/auth/forgot-password
exports.forgotPassword = async (req, res) => {
  const genericMessage = 'If an account exists for this email, password reset instructions have been sent.';
  const user = await User.findOne({ email: String(req.body.email).toLowerCase() });
  if (!user || user.isSuspended) return sendSuccess(res, { message: genericMessage });

  const token = user.createPasswordResetToken();
  await user.save({ validateModifiedOnly: true });
  const resetUrl = `${env.clientUrls[0]}/reset-password?token=${token}&email=${encodeURIComponent(user.email)}`;

  const sent = await sendEmail({
    to: user.email,
    subject: 'Reset your JobConnect Rwanda password',
    text: `Hello ${user.name},\n\nUse the link below to reset your password. It expires in 30 minutes.\n\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
  });

  if (!sent && !env.isProduction) {
    // Development convenience only: email is not configured, so expose the link to the developer.
    return sendSuccess(res, {
      message: 'Email is not configured on this server. Use the development reset link below.',
      data: { devResetUrl: resetUrl },
    });
  }
  if (!sent) {
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save({ validateModifiedOnly: true });
    throw new ApiError(503, 'Password reset emails are currently unavailable. Please contact support.');
  }
  return sendSuccess(res, { message: genericMessage });
};

// POST /api/auth/reset-password
exports.resetPassword = async (req, res) => {
  const hashed = crypto.createHash('sha256').update(String(req.body.token)).digest('hex');
  const user = await User.findOne({
    passwordResetToken: hashed,
    passwordResetExpires: { $gt: new Date() },
  }).select('+passwordResetToken +passwordResetExpires');
  if (!user) throw ApiError.badRequest('This password reset link is invalid or has expired.');

  user.password = req.body.password;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  await user.save();
  clearAuthCookie(res);
  return sendSuccess(res, { message: 'Password has been reset. You can now log in.' });
};
