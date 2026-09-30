const mongoose = require('mongoose');
const EmployerProfile = require('../models/EmployerProfile');
const Job = require('../models/Job');
const Application = require('../models/Application');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const { sendSuccess, parsePagination, buildPagination, escapeRegex } = require('../utils/apiResponse');
const { pick } = require('../middleware/validationMiddleware');
const { saveFile, deleteFile } = require('../services/storageService');
const { APPLICATION_STATUSES, JOB_STATUSES } = require('../config/constants');

const PROFILE_FIELDS = ['companyName', 'description', 'industry', 'location', 'phone', 'contactEmail', 'website'];

async function getOrCreateProfile(user) {
  let profile = await EmployerProfile.findOne({ userId: user._id });
  if (!profile) {
    profile = await EmployerProfile.create({ userId: user._id, companyName: user.name, contactEmail: user.email });
  }
  return profile;
}

// GET /api/employer/profile
exports.getProfile = async (req, res) => {
  const profile = await getOrCreateProfile(req.user);
  return sendSuccess(res, { data: { employerProfile: profile, user: req.user.toJSON() } });
};

// PUT /api/employer/profile
exports.updateProfile = async (req, res) => {
  const profile = await getOrCreateProfile(req.user);
  const updates = pick(req.body, PROFILE_FIELDS);
  const significantChange = updates.companyName && updates.companyName !== profile.companyName;
  profile.set(updates);
  // A verified employer who changes their company name is re-reviewed by an administrator
  if (significantChange && profile.verificationStatus === 'verified') profile.verificationStatus = 'pending';
  await profile.save();
  return sendSuccess(res, { message: 'Company profile updated', data: { employerProfile: profile } });
};

// POST /api/employer/profile/logo
exports.uploadLogo = async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Please choose a logo image to upload.');
  const profile = await getOrCreateProfile(req.user);
  const url = await saveFile(req.file, 'images');
  const old = profile.companyLogo;
  profile.companyLogo = url;
  await profile.save();
  await deleteFile(old);
  return sendSuccess(res, { message: 'Company logo updated', data: { employerProfile: profile } });
};

// GET /api/employer/dashboard
exports.getDashboard = async (req, res) => {
  const employerId = req.user._id;
  const now = new Date();

  const [jobStatusCounts, expiredCount, appStatusCounts, recentApplications, recentJobs, perJob, trend] = await Promise.all([
    Job.aggregate([{ $match: { employerId } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Job.countDocuments({ employerId, status: 'published', applicationDeadline: { $lt: now } }),
    Application.aggregate([{ $match: { employerId } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Application.find({ employerId })
      .sort({ appliedAt: -1 })
      .limit(5)
      .populate('applicantId', 'name email profileImage location')
      .populate('jobId', 'title'),
    Job.find({ employerId }).sort({ createdAt: -1 }).limit(5).populate('category', 'name'),
    Application.aggregate([
      { $match: { employerId } },
      { $group: { _id: '$jobId', total: { $sum: 1 }, pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } } } },
      { $sort: { total: -1 } },
      { $limit: 8 },
      { $lookup: { from: 'jobs', localField: '_id', foreignField: '_id', as: 'job' } },
      { $unwind: '$job' },
      { $project: { _id: 0, jobId: '$_id', title: '$job.title', total: 1, pending: 1 } },
    ]),
    Application.aggregate([
      { $match: { employerId, appliedAt: { $gte: new Date(now.getTime() - 29 * 86400000) } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$appliedAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  const jobs = Object.fromEntries(JOB_STATUSES.map((s) => [s, 0]));
  jobStatusCounts.forEach((c) => (jobs[c._id] = c.count));
  const apps = Object.fromEntries(APPLICATION_STATUSES.map((s) => [s, 0]));
  appStatusCounts.forEach((c) => (apps[c._id] = c.count));

  // Fill every day of the last 30 days so the chart has a continuous axis
  const byDay = Object.fromEntries(trend.map((t) => [t._id, t.count]));
  const applicationsTrend = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(now.getTime() - (29 - i) * 86400000).toISOString().slice(0, 10);
    return { date: d, count: byDay[d] || 0 };
  });

  return sendSuccess(res, {
    data: {
      stats: {
        activeJobs: Math.max(0, jobs.published - expiredCount),
        expiredJobs: expiredCount,
        closedJobs: jobs.closed,
        draftJobs: jobs.draft,
        removedJobs: jobs.removed,
        totalJobs: Object.values(jobs).reduce((a, b) => a + b, 0),
        totalApplications: apps.pending + apps.accepted + apps.rejected,
        pendingApplications: apps.pending,
        acceptedApplicants: apps.accepted,
        rejectedApplications: apps.rejected,
      },
      applicationsByStatus: APPLICATION_STATUSES.map((s) => ({ status: s, count: apps[s] })),
      applicationsPerJob: perJob,
      applicationsTrend,
      recentApplications,
      recentJobs,
    },
  });
};

// GET /api/employer/jobs
exports.getMyJobs = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 10 });
  const filter = { employerId: req.user._id };
  const status = String(req.query.status || '');
  if (status === 'expired') {
    filter.status = 'published';
    filter.applicationDeadline = { $lt: new Date() };
  } else if (status === 'active') {
    filter.status = 'published';
    filter.applicationDeadline = { $gte: new Date() };
  } else if (JOB_STATUSES.includes(status)) {
    filter.status = status;
  }
  if (req.query.q) filter.title = { $regex: escapeRegex(String(req.query.q)), $options: 'i' };

  const [jobs, total] = await Promise.all([
    Job.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('category', 'name slug icon').lean(),
    Job.countDocuments(filter),
  ]);

  const counts = await Application.aggregate([
    { $match: { jobId: { $in: jobs.map((j) => j._id) } } },
    { $group: { _id: '$jobId', total: { $sum: 1 }, pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } } } },
  ]);
  const map = Object.fromEntries(counts.map((c) => [c._id.toString(), c]));
  const now = new Date();
  jobs.forEach((j) => {
    j.applicationCount = map[j._id.toString()]?.total || 0;
    j.pendingCount = map[j._id.toString()]?.pending || 0;
    j.isExpired = j.applicationDeadline < now;
  });

  return sendSuccess(res, { data: jobs, pagination: buildPagination(page, limit, total) });
};

// GET /api/employer/jobs/:id/applications
exports.getJobApplications = async (req, res) => {
  const job = await Job.findById(req.params.id).populate('category', 'name');
  if (!job) throw ApiError.notFound('Job not found.');
  if (!job.employerId.equals(req.user._id)) throw ApiError.forbidden('You can only view applications for your own jobs.');

  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 20 });
  const match = { jobId: job._id };
  const status = String(req.query.status || '');
  if (APPLICATION_STATUSES.includes(status)) match.status = status;

  const q = String(req.query.q || '').trim();
  if (q) {
    const rx = { $regex: escapeRegex(q), $options: 'i' };
    const applicantIds = await Application.distinct('applicantId', { jobId: job._id });
    const matching = await User.find({
      _id: { $in: applicantIds },
      $or: [{ name: rx }, { email: rx }, { skills: rx }, { location: rx }],
    }).distinct('_id');
    match.applicantId = { $in: matching };
  }

  const sort = req.query.sort === 'oldest' ? { appliedAt: 1 } : { appliedAt: -1 };
  const [applications, total, statusCounts] = await Promise.all([
    Application.find(match)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('applicantId', 'name email phone location skills profileImage professionalSummary resumeUrl resumeOriginalName experience education'),
    Application.countDocuments(match),
    Application.aggregate([{ $match: { jobId: job._id } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
  ]);

  const counts = Object.fromEntries(APPLICATION_STATUSES.map((s) => [s, 0]));
  statusCounts.forEach((c) => (counts[c._id] = c.count));

  return sendSuccess(res, {
    data: { job, applications, counts },
    pagination: buildPagination(page, limit, total),
  });
};

// GET /api/employer/applications  (all applications across the employer's jobs)
exports.getAllApplications = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 20 });
  const match = { employerId: req.user._id };
  const status = String(req.query.status || '');
  if (APPLICATION_STATUSES.includes(status)) match.status = status;
  if (req.query.jobId && mongoose.isValidObjectId(String(req.query.jobId))) match.jobId = String(req.query.jobId);

  const [applications, total] = await Promise.all([
    Application.find(match)
      .sort({ appliedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('applicantId', 'name email location profileImage skills')
      .populate('jobId', 'title status'),
    Application.countDocuments(match),
  ]);
  return sendSuccess(res, { data: applications, pagination: buildPagination(page, limit, total) });
};
