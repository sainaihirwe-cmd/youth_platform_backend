const Report = require('../models/Report');
const Job = require('../models/Job');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const { sendSuccess, parsePagination, buildPagination } = require('../utils/apiResponse');
const { ROLES } = require('../config/constants');

// POST /api/reports
exports.createReport = async (req, res) => {
  const { reportedJobId, reportedUserId, reason, description } = req.body;
  if (!reportedJobId && !reportedUserId) throw ApiError.badRequest('Please specify the job or user you are reporting.');

  const report = { reporterId: req.user._id, reason, description: description || '' };

  if (reportedJobId) {
    const job = await Job.findById(reportedJobId).select('employerId');
    if (!job) throw ApiError.notFound('The reported job does not exist.');
    if (job.employerId.equals(req.user._id)) throw ApiError.badRequest('You cannot report your own job.');
    report.reportedJobId = job._id;
    report.reportedUserId = job.employerId;
  }
  if (reportedUserId && !reportedJobId) {
    const target = await User.findById(reportedUserId).select('role');
    if (!target || target.role === ROLES.ADMIN) throw ApiError.notFound('The reported user does not exist.');
    if (target._id.equals(req.user._id)) throw ApiError.badRequest('You cannot report yourself.');
    report.reportedUserId = target._id;
  }

  // One open report per reporter/target avoids spam and duplicate work for moderators
  const duplicate = await Report.exists({
    reporterId: req.user._id,
    status: { $in: ['pending', 'under_review'] },
    ...(report.reportedJobId ? { reportedJobId: report.reportedJobId } : { reportedUserId: report.reportedUserId, reportedJobId: null }),
  });
  if (duplicate) throw ApiError.conflict('You already have an open report for this item. Our team is reviewing it.');

  const created = await Report.create(report);
  return sendSuccess(res, {
    status: 201,
    message: 'Report submitted. Thank you for helping keep JobConnect Rwanda safe.',
    data: { report: created },
  });
};

// GET /api/reports/my-reports
exports.getMyReports = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 10 });
  const filter = { reporterId: req.user._id };
  const [reports, total] = await Promise.all([
    Report.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('-adminNotes -reviewedBy')
      .populate('reportedJobId', 'title')
      .populate('reportedUserId', 'name'),
    Report.countDocuments(filter),
  ]);
  return sendSuccess(res, { data: reports, pagination: buildPagination(page, limit, total) });
};
