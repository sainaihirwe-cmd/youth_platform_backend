const path = require('path');
const Application = require('../models/Application');
const Job = require('../models/Job');
const User = require('../models/User');
const EmployerProfile = require('../models/EmployerProfile');
const SavedJob = require('../models/SavedJob');
const Notification = require('../models/Notification');
const ApiError = require('../utils/ApiError');
const { sendSuccess, parsePagination, buildPagination } = require('../utils/apiResponse');
const { saveFile, deleteFile } = require('../services/storageService');
const { notify } = require('../services/notificationService');
const { APPLICATION_STATUSES, ROLES } = require('../config/constants');

// POST /api/applications   (multipart: jobId, coverLetter, resume?, useProfileResume?)
exports.createApplication = async (req, res) => {
  const { jobId, coverLetter } = req.body;
  const job = await Job.findById(jobId);
  if (!job) throw ApiError.notFound('Job not found.');
  if (job.status === 'removed') throw ApiError.badRequest('This job has been removed and no longer accepts applications.');
  if (job.status !== 'published') throw ApiError.badRequest('This job is closed and no longer accepts applications.');
  if (job.applicationDeadline < new Date()) throw ApiError.badRequest('The application deadline for this job has passed.');

  const employer = await User.findById(job.employerId).select('isSuspended');
  if (!employer || employer.isSuspended) throw ApiError.badRequest('This job is not currently accepting applications.');

  if (await Application.exists({ jobId: job._id, applicantId: req.user._id })) {
    throw ApiError.conflict('You have already applied for this job.');
  }

  let resumeUrl = '';
  let resumeOriginalName = '';
  if (req.file) {
    resumeUrl = await saveFile(req.file, 'resumes');
    resumeOriginalName = path.basename(req.file.originalname).slice(0, 200);
  } else if (String(req.body.useProfileResume) !== 'false' && req.user.resumeUrl) {
    resumeUrl = req.user.resumeUrl;
    resumeOriginalName = req.user.resumeOriginalName;
  }

  let application;
  try {
    application = await Application.create({
      jobId: job._id,
      applicantId: req.user._id,
      employerId: job.employerId,
      coverLetter,
      resumeUrl,
      resumeOriginalName,
    });
  } catch (err) {
    if (req.file) await deleteFile(resumeUrl);
    if (err.code === 11000) throw ApiError.conflict('You have already applied for this job.');
    throw err;
  }

  await notify({
    userId: job.employerId,
    title: 'New application received',
    message: `${req.user.name} applied for "${job.title}".`,
    type: 'new_application',
    relatedJobId: job._id,
    relatedApplicationId: application._id,
    link: `/employer/jobs/${job._id}/applications`,
  });

  await application.populate('jobId', 'title location jobType');
  return sendSuccess(res, { status: 201, message: 'Application submitted successfully', data: { application } });
};

// GET /api/applications/my-applications
exports.getMyApplications = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 10 });
  const filter = { applicantId: req.user._id };
  const status = String(req.query.status || '');
  if (APPLICATION_STATUSES.includes(status)) filter.status = status;

  const [applications, total] = await Promise.all([
    Application.find(filter)
      .sort({ appliedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate({
        path: 'jobId',
        select: 'title location jobType salary paymentType status applicationDeadline employerId category',
        populate: { path: 'category', select: 'name' },
      })
      .lean(),
    Application.countDocuments(filter),
  ]);

  // Attach company names in one query
  const employerIds = applications.map((a) => a.employerId);
  const profiles = await EmployerProfile.find({ userId: { $in: employerIds } }).select('userId companyName companyLogo').lean();
  const byUser = Object.fromEntries(profiles.map((p) => [p.userId.toString(), p]));
  applications.forEach((a) => {
    a.employer = byUser[a.employerId.toString()] || null;
  });

  return sendSuccess(res, { data: applications, pagination: buildPagination(page, limit, total) });
};

// GET /api/applications/stats  (job seeker dashboard)
exports.getMyStats = async (req, res) => {
  const [counts, savedJobs, unread, recent] = await Promise.all([
    Application.aggregate([{ $match: { applicantId: req.user._id } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    SavedJob.countDocuments({ userId: req.user._id }),
    Notification.countDocuments({ userId: req.user._id, isRead: false }),
    Application.find({ applicantId: req.user._id })
      .sort({ appliedAt: -1 })
      .limit(5)
      .populate('jobId', 'title location jobType status'),
  ]);
  const stats = { pending: 0, accepted: 0, rejected: 0 };
  counts.forEach((c) => (stats[c._id] = c.count));
  return sendSuccess(res, {
    data: {
      stats: {
        totalApplications: stats.pending + stats.accepted + stats.rejected,
        pendingApplications: stats.pending,
        acceptedApplications: stats.accepted,
        rejectedApplications: stats.rejected,
        savedJobs,
        unreadNotifications: unread,
      },
      recentApplications: recent,
    },
  });
};

async function loadAuthorisedApplication(req) {
  const application = await Application.findById(req.params.id);
  if (!application) throw ApiError.notFound('Application not found.');
  const uid = req.user._id;
  const allowed =
    req.user.role === ROLES.ADMIN || application.applicantId.equals(uid) || application.employerId.equals(uid);
  if (!allowed) throw ApiError.forbidden('You do not have access to this application.');
  return application;
}

// GET /api/applications/:id
exports.getApplicationById = async (req, res) => {
  const application = await loadAuthorisedApplication(req);
  await application.populate([
    { path: 'jobId', select: 'title location jobType salary paymentType status applicationDeadline employerId' },
    {
      path: 'applicantId',
      select: 'name email phone location skills education experience professionalSummary profileImage resumeUrl resumeOriginalName',
    },
  ]);
  const data = application.toJSON();
  // Private employer notes are not shown to the applicant
  if (req.user._id.equals(application.applicantId._id) && req.user.role !== ROLES.ADMIN) delete data.employerNotes;
  return sendSuccess(res, { data: { application: data } });
};

// PATCH /api/applications/:id/status   (employer who owns the job)
exports.updateApplicationStatus = async (req, res) => {
  const application = await Application.findById(req.params.id).populate('jobId', 'title employerId');
  if (!application) throw ApiError.notFound('Application not found.');
  if (!application.employerId.equals(req.user._id)) {
    throw ApiError.forbidden('You can only manage applications for your own jobs.');
  }
  const { status, employerNotes } = req.body;
  const changed = application.status !== status;
  application.status = status;
  if (employerNotes !== undefined) application.employerNotes = employerNotes;
  if (changed) application.statusChangedAt = new Date();
  await application.save();

  if (changed) {
    const label = { accepted: 'accepted', rejected: 'not selected', pending: 'moved back to pending' }[status];
    await notify({
      userId: application.applicantId,
      title: 'Application status updated',
      message: `Your application for "${application.jobId.title}" was ${label}.`,
      type: 'application_status',
      relatedJobId: application.jobId._id,
      relatedApplicationId: application._id,
      link: '/seeker/applications',
      email: status !== 'pending',
    });
  }
  return sendSuccess(res, { message: `Application marked as ${status}`, data: { application } });
};

// DELETE /api/applications/:id  (applicant withdraws a pending application)
exports.withdrawApplication = async (req, res) => {
  const application = await Application.findById(req.params.id).populate('jobId', 'title');
  if (!application) throw ApiError.notFound('Application not found.');
  if (!application.applicantId.equals(req.user._id)) throw ApiError.forbidden('You can only withdraw your own applications.');
  if (application.status !== 'pending') throw ApiError.badRequest('Only pending applications can be withdrawn.');

  const resumeUrl = application.resumeUrl;
  await application.deleteOne();
  if (resumeUrl && resumeUrl !== req.user.resumeUrl && !(await Application.exists({ resumeUrl }))) {
    await deleteFile(resumeUrl);
  }
  return sendSuccess(res, { message: 'Application withdrawn' });
};
