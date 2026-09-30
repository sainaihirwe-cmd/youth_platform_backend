const SavedJob = require('../models/SavedJob');
const Job = require('../models/Job');
const EmployerProfile = require('../models/EmployerProfile');
const ApiError = require('../utils/ApiError');
const { sendSuccess, parsePagination, buildPagination } = require('../utils/apiResponse');

// POST /api/saved-jobs/:jobId
exports.saveJob = async (req, res) => {
  const job = await Job.findById(req.params.jobId).select('status applicationDeadline');
  if (!job || job.status === 'removed') throw ApiError.notFound('Job not found.');
  if (!job.isOpenForApplications()) throw ApiError.badRequest('Only open jobs can be saved.');
  try {
    const saved = await SavedJob.create({ userId: req.user._id, jobId: job._id });
    return sendSuccess(res, { status: 201, message: 'Job saved', data: { savedJob: saved } });
  } catch (err) {
    if (err.code === 11000) throw ApiError.conflict('You have already saved this job.');
    throw err;
  }
};

// GET /api/saved-jobs
exports.getSavedJobs = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 12 });
  const filter = { userId: req.user._id };
  const [items, total] = await Promise.all([
    SavedJob.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate({ path: 'jobId', populate: { path: 'category', select: 'name slug icon' } })
      .lean(),
    SavedJob.countDocuments(filter),
  ]);

  const valid = items.filter((i) => i.jobId && i.jobId.status !== 'removed');
  const profiles = await EmployerProfile.find({ userId: { $in: valid.map((i) => i.jobId.employerId) } })
    .select('userId companyName companyLogo verificationStatus')
    .lean();
  const byUser = Object.fromEntries(profiles.map((p) => [p.userId.toString(), p]));
  const now = new Date();
  const data = valid.map((i) => ({
    _id: i._id,
    savedAt: i.createdAt,
    job: {
      ...i.jobId,
      employer: byUser[i.jobId.employerId.toString()] || null,
      isOpen: i.jobId.status === 'published' && new Date(i.jobId.applicationDeadline) >= now,
    },
  }));
  return sendSuccess(res, { data, pagination: buildPagination(page, limit, total) });
};

// GET /api/saved-jobs/ids  (lightweight list used to render bookmark state on job cards)
exports.getSavedJobIds = async (req, res) => {
  const ids = await SavedJob.find({ userId: req.user._id }).distinct('jobId');
  return sendSuccess(res, { data: ids });
};

// DELETE /api/saved-jobs/:jobId
exports.removeSavedJob = async (req, res) => {
  const result = await SavedJob.deleteOne({ userId: req.user._id, jobId: req.params.jobId });
  if (!result.deletedCount) throw ApiError.notFound('This job is not in your saved list.');
  return sendSuccess(res, { message: 'Job removed from saved list' });
};
