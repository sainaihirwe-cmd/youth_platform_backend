const mongoose = require('mongoose');
const User = require('../models/User');
const EmployerProfile = require('../models/EmployerProfile');
const Job = require('../models/Job');
const Application = require('../models/Application');
const Report = require('../models/Report');
const JobCategory = require('../models/JobCategory');
const Setting = require('../models/Setting');
const ContactMessage = require('../models/ContactMessage');
const ApiError = require('../utils/ApiError');
const { sendSuccess, parsePagination, buildPagination, escapeRegex } = require('../utils/apiResponse');
const { EXPORT_FORMATS, renderReports } = require('../services/reportExportService');
const { pick } = require('../middleware/validationMiddleware');
const { notify } = require('../services/notificationService');
const { deleteUserCascade } = require('../services/cleanupService');
const { ROLES, REPORT_STATUSES, JOB_STATUSES, VERIFICATION_STATUSES } = require('../config/constants');

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Returns the last `n` months as [{ key: 'YYYY-MM', label: 'Mon YYYY' }] ending with the current month. */
function lastMonths(n) {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (n - 1 - i), 1));
    return {
      key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
      label: `${MONTH_LABELS[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
      start: d,
    };
  });
}

async function monthlyCounts(Model, dateField, months, match = {}) {
  const rows = await Model.aggregate([
    { $match: { ...match, [dateField]: { $gte: months[0].start } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m', date: `$${dateField}` } }, count: { $sum: 1 } } },
  ]);
  const map = Object.fromEntries(rows.map((r) => [r._id, r.count]));
  return months.map((m) => map[m.key] || 0);
}

// GET /api/admin/dashboard
exports.getDashboard = async (_req, res) => {
  const now = new Date();
  const [
    totalUsers,
    jobSeekers,
    employers,
    admins,
    suspendedAccounts,
    totalJobs,
    activeJobs,
    totalApplications,
    pendingReports,
    underReviewReports,
    pendingEmployerVerifications,
    newMessages,
    recentUsers,
    recentJobs,
    recentReports,
  ] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ role: ROLES.JOB_SEEKER }),
    User.countDocuments({ role: ROLES.EMPLOYER }),
    User.countDocuments({ role: ROLES.ADMIN }),
    User.countDocuments({ isSuspended: true }),
    Job.countDocuments(),
    Job.countDocuments(Job.publicFilter(now)),
    Application.countDocuments(),
    Report.countDocuments({ status: 'pending' }),
    Report.countDocuments({ status: 'under_review' }),
    EmployerProfile.countDocuments({ verificationStatus: 'pending' }),
    ContactMessage.countDocuments({ status: 'new' }),
    User.find().sort({ createdAt: -1 }).limit(5).select('name email role createdAt isSuspended profileImage'),
    Job.find().sort({ createdAt: -1 }).limit(5).select('title status location createdAt employerId').populate('employerId', 'name'),
    Report.find({ status: { $in: ['pending', 'under_review'] } })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('reporterId', 'name')
      .populate('reportedJobId', 'title')
      .populate('reportedUserId', 'name'),
  ]);

  return sendSuccess(res, {
    data: {
      stats: {
        totalUsers,
        jobSeekers,
        employers,
        admins,
        suspendedAccounts,
        totalJobs,
        activeJobs,
        totalApplications,
        pendingReports,
        underReviewReports,
        pendingEmployerVerifications,
        newMessages,
      },
      recentUsers,
      recentJobs,
      recentReports,
    },
  });
};

// GET /api/admin/analytics?months=6
exports.getAnalytics = async (req, res) => {
  const n = Math.min(24, Math.max(3, parseInt(req.query.months, 10) || 6));
  const months = lastMonths(n);

  const [seekers, employers, jobs, applications, categoryRows, jobTypeRows, appStatusRows, locationRows] = await Promise.all([
    monthlyCounts(User, 'createdAt', months, { role: ROLES.JOB_SEEKER }),
    monthlyCounts(User, 'createdAt', months, { role: ROLES.EMPLOYER }),
    monthlyCounts(Job, 'createdAt', months),
    monthlyCounts(Application, 'appliedAt', months),
    Job.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $lookup: { from: 'jobcategories', localField: '_id', foreignField: '_id', as: 'c' } },
      { $unwind: { path: '$c', preserveNullAndEmptyArrays: true } },
      { $project: { _id: 0, name: { $ifNull: ['$c.name', 'Uncategorised'] }, count: 1 } },
      { $sort: { count: -1 } },
    ]),
    Job.aggregate([{ $group: { _id: '$jobType', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    Application.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Job.aggregate([
      { $group: { _id: { $ifNull: ['$province', '$location'] }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
  ]);

  return sendSuccess(res, {
    data: {
      userRegistrations: months.map((m, i) => ({ month: m.label, jobSeekers: seekers[i], employers: employers[i] })),
      jobPostings: months.map((m, i) => ({ month: m.label, jobs: jobs[i], applications: applications[i] })),
      jobsByCategory: categoryRows,
      jobsByType: jobTypeRows.map((r) => ({ jobType: r._id, count: r.count })),
      applicationsByStatus: appStatusRows.map((r) => ({ status: r._id, count: r.count })),
      jobsByLocation: locationRows.map((r) => ({ location: r._id || 'Unknown', count: r.count })),
    },
  });
};

// GET /api/admin/users
exports.getUsers = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 15 });
  const filter = {};
  const role = String(req.query.role || '');
  if (Object.values(ROLES).includes(role)) filter.role = role;
  if (req.query.status === 'suspended') filter.isSuspended = true;
  if (req.query.status === 'active') filter.isSuspended = false;
  const q = String(req.query.q || '').trim();
  if (q) {
    const rx = { $regex: escapeRegex(q), $options: 'i' };
    const companyUserIds = await EmployerProfile.find({ companyName: rx }).distinct('userId');
    filter.$or = [{ name: rx }, { email: rx }, { phone: rx }, { _id: { $in: companyUserIds } }];
  }
  const verification = String(req.query.verification || '');
  if (VERIFICATION_STATUSES.includes(verification)) {
    filter.role = ROLES.EMPLOYER;
    filter._id = { $in: await EmployerProfile.find({ verificationStatus: verification }).distinct('userId') };
  }
  const sort = req.query.sort === 'oldest' ? { createdAt: 1 } : req.query.sort === 'name' ? { name: 1 } : { createdAt: -1 };

  const [users, total] = await Promise.all([
    User.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ]);

  const ids = users.map((u) => u._id);
  const [profiles, jobCounts, appCounts, reportCounts] = await Promise.all([
    EmployerProfile.find({ userId: { $in: ids } }).lean(),
    Job.aggregate([{ $match: { employerId: { $in: ids } } }, { $group: { _id: '$employerId', count: { $sum: 1 } } }]),
    Application.aggregate([{ $match: { applicantId: { $in: ids } } }, { $group: { _id: '$applicantId', count: { $sum: 1 } } }]),
    Report.aggregate([{ $match: { reportedUserId: { $in: ids } } }, { $group: { _id: '$reportedUserId', count: { $sum: 1 } } }]),
  ]);
  const toMap = (rows) => Object.fromEntries(rows.map((r) => [String(r._id), r.count]));
  const pm = Object.fromEntries(profiles.map((p) => [String(p.userId), p]));
  const jm = toMap(jobCounts);
  const am = toMap(appCounts);
  const rm = toMap(reportCounts);

  const data = users.map((u) => {
    const { password, passwordResetToken, passwordResetExpires, __v, ...safe } = u;
    return {
      ...safe,
      employerProfile: pm[String(u._id)] || null,
      jobCount: jm[String(u._id)] || 0,
      applicationCount: am[String(u._id)] || 0,
      reportCount: rm[String(u._id)] || 0,
    };
  });
  return sendSuccess(res, { data, pagination: buildPagination(page, limit, total) });
};

// GET /api/admin/users/:id
exports.getUserDetails = async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found.');
  const [employerProfile, jobs, applications, reportsAgainst, reportsFiled] = await Promise.all([
    EmployerProfile.findOne({ userId: user._id }),
    Job.find({ employerId: user._id }).sort({ createdAt: -1 }).limit(20).select('title status createdAt applicationDeadline'),
    Application.find({ applicantId: user._id }).sort({ appliedAt: -1 }).limit(20).populate('jobId', 'title'),
    Report.find({ reportedUserId: user._id }).sort({ createdAt: -1 }).limit(20).populate('reporterId', 'name email'),
    Report.countDocuments({ reporterId: user._id }),
  ]);
  return sendSuccess(res, { data: { user, employerProfile, jobs, applications, reportsAgainst, reportsFiled } });
};

async function setSuspension(target, admin, suspend, reason) {
  if (target._id.equals(admin._id)) throw ApiError.badRequest('You cannot suspend your own account.');
  if (target.role === ROLES.ADMIN) throw ApiError.forbidden('Administrator accounts cannot be suspended from the dashboard.');
  target.isSuspended = suspend;
  target.suspendedReason = suspend ? reason || '' : undefined;
  await target.save({ validateModifiedOnly: true });
  if (!suspend) {
    await notify({
      userId: target._id,
      title: 'Account reactivated',
      message: 'Your JobConnect Rwanda account has been reactivated. Welcome back!',
      type: 'account',
      email: true,
    });
  } else {
    await notify({
      userId: target._id,
      title: 'Account suspended',
      message: `Your account has been suspended${reason ? `: ${reason}` : ''}. Contact support if you believe this is a mistake.`,
      type: 'account',
      email: true,
    });
  }
}

// PATCH /api/admin/users/:id/status   { isSuspended, reason }
exports.updateUserStatus = async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found.');
  const suspend = req.body.isSuspended === true || req.body.isSuspended === 'true';
  await setSuspension(user, req.user, suspend, req.body.reason);
  return sendSuccess(res, { message: suspend ? 'Account suspended' : 'Account reactivated', data: { user } });
};

// PATCH /api/admin/users/:id/verification   { verificationStatus, notes }
exports.updateEmployerVerification = async (req, res) => {
  const profile = await EmployerProfile.findOne({ userId: req.params.id });
  if (!profile) throw ApiError.notFound('Employer profile not found.');
  profile.verificationStatus = req.body.verificationStatus;
  if (req.body.notes !== undefined) profile.verificationNotes = req.body.notes;
  await profile.save();
  if (profile.verificationStatus !== 'pending') {
    await notify({
      userId: profile.userId,
      title: profile.verificationStatus === 'verified' ? 'Employer profile verified' : 'Employer verification declined',
      message:
        profile.verificationStatus === 'verified'
          ? 'Your employer profile has been verified. A verified badge now appears on your job postings.'
          : `Your employer profile verification was declined${req.body.notes ? `: ${req.body.notes}` : ''}. Please update your profile.`,
      type: 'account',
      link: '/employer/profile',
    });
  }
  return sendSuccess(res, { message: 'Verification status updated', data: { employerProfile: profile } });
};

// DELETE /api/admin/users/:id
exports.deleteUser = async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found.');
  if (user._id.equals(req.user._id)) throw ApiError.badRequest('You cannot delete your own account here.');
  if (user.role === ROLES.ADMIN) throw ApiError.forbidden('Administrator accounts cannot be deleted from the dashboard.');
  await deleteUserCascade(user);
  return sendSuccess(res, { message: 'User and related records deleted' });
};

// GET /api/admin/jobs
exports.getJobs = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 15 });
  const filter = {};
  const status = String(req.query.status || '');
  if (status === 'expired') {
    filter.status = 'published';
    filter.applicationDeadline = { $lt: new Date() };
  } else if (JOB_STATUSES.includes(status)) filter.status = status;
  if (req.query.category && mongoose.isValidObjectId(String(req.query.category))) filter.category = String(req.query.category);
  if (req.query.featured === 'true') filter.isFeatured = true;
  if (req.query.reported === 'true') filter._id = { $in: await Report.distinct('reportedJobId', { reportedJobId: { $ne: null } }) };
  const q = String(req.query.q || '').trim();
  if (q) {
    const rx = { $regex: escapeRegex(q), $options: 'i' };
    const companyIds = await EmployerProfile.find({ companyName: rx }).distinct('userId');
    filter.$or = [{ title: rx }, { location: rx }, { employerId: { $in: companyIds } }];
  }
  const [jobs, total] = await Promise.all([
    Job.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('category', 'name')
      .populate('employerId', 'name email isSuspended')
      .lean(),
    Job.countDocuments(filter),
  ]);
  const ids = jobs.map((j) => j._id);
  const [profiles, appCounts, reportCounts] = await Promise.all([
    EmployerProfile.find({ userId: { $in: jobs.map((j) => j.employerId?._id).filter(Boolean) } })
      .select('userId companyName verificationStatus')
      .lean(),
    Application.aggregate([{ $match: { jobId: { $in: ids } } }, { $group: { _id: '$jobId', count: { $sum: 1 } } }]),
    Report.aggregate([{ $match: { reportedJobId: { $in: ids } } }, { $group: { _id: '$reportedJobId', count: { $sum: 1 } } }]),
  ]);
  const pm = Object.fromEntries(profiles.map((p) => [String(p.userId), p]));
  const am = Object.fromEntries(appCounts.map((r) => [String(r._id), r.count]));
  const rm = Object.fromEntries(reportCounts.map((r) => [String(r._id), r.count]));
  const now = new Date();
  jobs.forEach((j) => {
    j.employer = pm[String(j.employerId?._id)] || null;
    j.applicationCount = am[String(j._id)] || 0;
    j.reportCount = rm[String(j._id)] || 0;
    j.isExpired = j.applicationDeadline < now;
  });
  return sendSuccess(res, { data: jobs, pagination: buildPagination(page, limit, total) });
};

async function moderateJob(job, action, reason) {
  switch (action) {
    case 'remove':
      job.status = 'removed';
      job.removedReason = reason || 'Removed by administrator';
      job.isFeatured = false;
      break;
    case 'restore':
      job.status = 'published';
      job.removedReason = undefined;
      break;
    case 'close':
      job.status = 'closed';
      break;
    case 'feature':
      if (!job.isOpenForApplications()) throw ApiError.badRequest('Only open, published jobs can be featured.');
      job.isFeatured = true;
      break;
    case 'unfeature':
      job.isFeatured = false;
      break;
    default:
      throw ApiError.badRequest('Invalid moderation action.');
  }
  await job.save({ validateModifiedOnly: true });
  if (['remove', 'restore', 'close'].includes(action)) {
    const verb = { remove: 'removed', restore: 'restored', close: 'closed' }[action];
    await notify({
      userId: job.employerId,
      title: `Job ${verb} by administrator`,
      message: `Your job "${job.title}" was ${verb} by a platform administrator${reason ? `. Reason: ${reason}` : '.'}`,
      type: 'job_activity',
      relatedJobId: job._id,
      link: '/employer/jobs',
      email: action === 'remove',
    });
  }
}

// PATCH /api/admin/jobs/:id/moderate   { action: remove|restore|close|feature|unfeature, reason }
exports.moderateJob = async (req, res) => {
  const job = await Job.findById(req.params.id);
  if (!job) throw ApiError.notFound('Job not found.');
  await moderateJob(job, req.body.action, req.body.reason);
  return sendSuccess(res, { message: 'Job updated', data: { job } });
};

// GET /api/admin/reports
/** Report filter shared by the list and the export, so an export always matches what the admin sees. */
function reportFilter(query) {
  const filter = {};
  const status = String(query.status || '');
  if (REPORT_STATUSES.includes(status)) filter.status = status;
  if (query.type === 'job') filter.reportedJobId = { $ne: null };
  if (query.type === 'user') filter.reportedJobId = null;
  if (query.reason) filter.reason = String(query.reason);
  return filter;
}

exports.getReports = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 15 });
  const filter = reportFilter(req.query);

  const [reports, total, counts] = await Promise.all([
    Report.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('reporterId', 'name email')
      .populate('reportedJobId', 'title status employerId')
      .populate('reportedUserId', 'name email role isSuspended')
      .populate('reviewedBy', 'name'),
    Report.countDocuments(filter),
    Report.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
  ]);
  const statusCounts = Object.fromEntries(REPORT_STATUSES.map((s) => [s, 0]));
  counts.forEach((c) => (statusCounts[c._id] = c.count));
  return sendSuccess(res, { data: { reports, counts: statusCounts }, pagination: buildPagination(page, limit, total) });
};

const EXPORT_LIMIT = 5000;

// GET /api/admin/reports/export?format=csv|xlsx|pdf|json&status=&type=&reason=
// Downloads a file. `format=json` without `download=1` returns the rows as a normal API response
// (used by the printable report page).
exports.exportReports = async (req, res) => {
  const format = EXPORT_FORMATS.includes(req.query.format) ? req.query.format : 'csv';
  const filter = reportFilter(req.query);
  const [reports, total] = await Promise.all([
    Report.find(filter)
      .sort({ createdAt: -1 })
      .limit(EXPORT_LIMIT)
      .populate('reporterId', 'name email')
      .populate('reportedJobId', 'title status')
      .populate('reportedUserId', 'name email role')
      .populate('reviewedBy', 'name')
      .lean(),
    Report.countDocuments(filter),
  ]);

  const rows = reports.map((r) => ({
    id: String(r._id),
    createdAt: r.createdAt,
    status: r.status,
    reason: r.reason,
    // A populated-but-deleted job is null; a user report has no reportedJobId at all
    type: r.reportedJobId !== undefined ? 'job' : 'user',
    reportedJob: r.reportedJobId?.title || '',
    reportedUser: r.reportedUserId?.name || '',
    reportedUserEmail: r.reportedUserId?.email || '',
    reporter: r.reporterId?.name || '',
    reporterEmail: r.reporterId?.email || '',
    description: r.description || '',
    actionTaken: r.actionTaken || 'none',
    adminNotes: r.adminNotes || '',
    reviewedBy: r.reviewedBy?.name || '',
    reviewedAt: r.reviewedAt || null,
  }));
  const meta = {
    generatedAt: new Date(),
    total,
    truncated: total > rows.length,
    filters: { status: filter.status || '', type: ['job', 'user'].includes(req.query.type) ? req.query.type : '', reason: filter.reason || '' },
  };

  if (format === 'json' && req.query.download !== '1') {
    return sendSuccess(res, { data: { rows, total, truncated: meta.truncated, generatedAt: meta.generatedAt } });
  }

  const { body, contentType, extension } = await renderReports(format, rows, meta);
  const stamp = meta.generatedAt.toISOString().slice(0, 10);
  res.set({
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="jobconnect-reports-${stamp}.${extension}"`,
    'Cache-Control': 'no-store',
  });
  return res.send(body);
};

// PATCH /api/admin/reports/:id   { status, adminNotes, action: none|suspend_user|remove_job }
exports.updateReport = async (req, res) => {
  const report = await Report.findById(req.params.id);
  if (!report) throw ApiError.notFound('Report not found.');
  const { status, adminNotes, action = 'none' } = req.body;

  if (action === 'suspend_user') {
    if (!report.reportedUserId) throw ApiError.badRequest('This report does not reference a user.');
    const target = await User.findById(report.reportedUserId);
    if (!target) throw ApiError.notFound('The reported user no longer exists.');
    await setSuspension(target, req.user, true, adminNotes || `Suspended following report (${report.reason})`);
    report.actionTaken = 'user_suspended';
  } else if (action === 'remove_job') {
    if (!report.reportedJobId) throw ApiError.badRequest('This report does not reference a job.');
    const job = await Job.findById(report.reportedJobId);
    if (!job) throw ApiError.notFound('The reported job no longer exists.');
    await moderateJob(job, 'remove', adminNotes || `Removed following report (${report.reason})`);
    report.actionTaken = 'job_removed';
  }

  if (status) report.status = status;
  if (adminNotes !== undefined) report.adminNotes = adminNotes;
  report.reviewedBy = req.user._id;
  report.reviewedAt = new Date();
  await report.save();

  if (['resolved', 'dismissed'].includes(report.status)) {
    await notify({
      userId: report.reporterId,
      title: 'Your report has been reviewed',
      message:
        report.status === 'resolved'
          ? 'Thank you. Our moderators reviewed your report and took appropriate action.'
          : 'Our moderators reviewed your report and found no violation of our terms.',
      type: 'report_update',
    });
  }
  await report.populate([
    { path: 'reporterId', select: 'name email' },
    { path: 'reportedJobId', select: 'title status employerId' },
    { path: 'reportedUserId', select: 'name email role isSuspended' },
    { path: 'reviewedBy', select: 'name' },
  ]);
  return sendSuccess(res, { message: 'Report updated', data: { report } });
};

const SETTINGS_FIELDS = [
  'siteName',
  'tagline',
  'contactEmail',
  'contactPhone',
  'contactAddress',
  'allowSeekerRegistration',
  'allowEmployerRegistration',
  'maxActiveJobsPerEmployer',
  'featuredJobsLimit',
  'maintenanceMessage',
];

// GET /api/admin/settings
exports.getSettings = async (_req, res) => {
  const [settings, categories] = await Promise.all([Setting.getSettings(), JobCategory.countDocuments()]);
  return sendSuccess(res, { data: { settings, meta: { categories } } });
};

// PUT /api/admin/settings
exports.updateSettings = async (req, res) => {
  const settings = await Setting.getSettings();
  settings.set(pick(req.body, SETTINGS_FIELDS));
  await settings.save();
  return sendSuccess(res, { message: 'Settings saved', data: { settings } });
};

// GET /api/admin/messages
exports.getMessages = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 10 });
  const filter = {};
  if (['new', 'read', 'archived'].includes(String(req.query.status))) filter.status = String(req.query.status);
  const [messages, total] = await Promise.all([
    ContactMessage.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    ContactMessage.countDocuments(filter),
  ]);
  return sendSuccess(res, { data: messages, pagination: buildPagination(page, limit, total) });
};

// PATCH /api/admin/messages/:id   { status }
exports.updateMessage = async (req, res) => {
  const message = await ContactMessage.findByIdAndUpdate(
    req.params.id,
    { status: req.body.status },
    { returnDocument: 'after', runValidators: true }
  );
  if (!message) throw ApiError.notFound('Message not found.');
  return sendSuccess(res, { message: 'Message updated', data: { message } });
};
