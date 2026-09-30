const mongoose = require('mongoose');
const Job = require('../models/Job');
const JobCategory = require('../models/JobCategory');
const EmployerProfile = require('../models/EmployerProfile');
const Application = require('../models/Application');
const SavedJob = require('../models/SavedJob');
const User = require('../models/User');
const Setting = require('../models/Setting');
const ApiError = require('../utils/ApiError');
const { sendSuccess, parsePagination, buildPagination, escapeRegex } = require('../utils/apiResponse');
const { pick } = require('../middleware/validationMiddleware');
const { deleteJobCascade } = require('../services/cleanupService');
const { notify } = require('../services/notificationService');
const { JOB_TYPES, ROLES, PROVINCES } = require('../config/constants');

const EDITABLE_FIELDS = [
  'title',
  'description',
  'category',
  'location',
  'address',
  'jobType',
  'salary',
  'paymentType',
  'paymentDetails',
  'requirements',
  'responsibilities',
  'skillsRequired',
  'vacancies',
  'applicationDeadline',
];
const OWNER_STATUSES = ['draft', 'published', 'closed'];

const { ObjectId } = mongoose.Types;

function toList(value) {
  if (value == null || value === '') return [];
  const arr = Array.isArray(value) ? value : String(value).split(',');
  return arr.map((v) => String(v).trim()).filter(Boolean);
}

async function suspendedEmployerIds() {
  return User.distinct('_id', { role: ROLES.EMPLOYER, isSuspended: true });
}

async function resolveCategoryId(value) {
  const v = String(value);
  if (mongoose.isValidObjectId(v)) return new ObjectId(v);
  const cat = await JobCategory.findOne({ slug: v.toLowerCase() }).select('_id');
  return cat ? cat._id : null;
}

/** Lookup stages that attach a lightweight employer and category object to each job. */
const ENRICH_STAGES = [
  {
    $lookup: {
      from: 'employerprofiles',
      localField: 'employerId',
      foreignField: 'userId',
      as: 'employer',
      pipeline: [{ $project: { _id: 0, userId: 1, companyName: 1, companyLogo: 1, verificationStatus: 1, industry: 1 } }],
    },
  },
  { $unwind: { path: '$employer', preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: 'jobcategories',
      localField: 'category',
      foreignField: '_id',
      as: 'category',
      pipeline: [{ $project: { name: 1, slug: 1, icon: 1 } }],
    },
  },
  { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
  { $project: { description: 0, responsibilities: 0, requirements: 0, __v: 0 } },
];

// GET /api/jobs
exports.getJobs = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 12, maxLimit: 50 });
  const now = new Date();
  const and = [Job.publicFilter(now), { employerId: { $nin: await suspendedEmployerIds() } }];

  if (req.query.category) {
    const ids = await Promise.all(toList(req.query.category).map(resolveCategoryId));
    and.push({ category: { $in: ids.filter(Boolean) } });
  }

  const locations = toList(req.query.location);
  if (locations.length) and.push({ $or: [{ location: { $in: locations } }, { province: { $in: locations } }] });

  const types = toList(req.query.jobType).filter((t) => JOB_TYPES.includes(t));
  if (types.length) and.push({ jobType: { $in: types } });

  const minSalary = Number(req.query.minSalary);
  const maxSalary = Number(req.query.maxSalary);
  if (Number.isFinite(minSalary) && minSalary > 0) {
    and.push({ $or: [{ 'salary.max': { $gte: minSalary } }, { 'salary.max': null, 'salary.min': { $gte: minSalary } }] });
  }
  if (Number.isFinite(maxSalary) && maxSalary > 0) and.push({ 'salary.min': { $lte: maxSalary } });

  const postedWithin = Number(req.query.postedWithin);
  if (Number.isFinite(postedWithin) && postedWithin > 0) {
    and.push({ createdAt: { $gte: new Date(now.getTime() - postedWithin * 86400000) } });
  }

  if (req.query.employer && mongoose.isValidObjectId(String(req.query.employer))) {
    and.push({ employerId: new ObjectId(String(req.query.employer)) });
  }

  const q = String(req.query.q || '').trim().slice(0, 100);
  let relevanceStage = null;
  if (q) {
    const pattern = escapeRegex(q);
    const rx = { $regex: pattern, $options: 'i' };
    const companyIds = await EmployerProfile.find({ companyName: rx }).distinct('userId');
    and.push({
      $or: [
        { title: rx },
        { description: rx },
        { skillsRequired: rx },
        { location: rx },
        { province: rx },
        { employerId: { $in: companyIds } },
      ],
    });
    const m = (field) => ({ $regexMatch: { input: { $ifNull: [field, ''] }, regex: pattern, options: 'i' } });
    relevanceStage = {
      $addFields: {
        relevance: {
          $add: [
            { $cond: [m('$title'), 10, 0] },
            {
              $cond: [
                { $anyElementTrue: [{ $map: { input: { $ifNull: ['$skillsRequired', []] }, as: 's', in: m('$$s') } }] },
                5,
                0,
              ],
            },
            { $cond: [{ $in: ['$employerId', companyIds] }, 4, 0] },
            { $cond: [{ $or: [m('$location'), m('$province')] }, 3, 0] },
            { $cond: [m('$description'), 1, 0] },
          ],
        },
      },
    };
  }

  let sort;
  switch (req.query.sort) {
    case 'oldest':
      sort = { createdAt: 1, _id: 1 };
      break;
    case 'deadline':
      sort = { applicationDeadline: 1, _id: 1 };
      break;
    case 'salary':
      sort = { 'salary.max': -1, 'salary.min': -1, _id: -1 };
      break;
    case 'relevance':
      sort = relevanceStage ? { relevance: -1, createdAt: -1, _id: -1 } : { isFeatured: -1, createdAt: -1, _id: -1 };
      break;
    default:
      sort = { createdAt: -1, _id: -1 };
  }

  const pipeline = [{ $match: { $and: and } }];
  if (relevanceStage) pipeline.push(relevanceStage);
  pipeline.push({
    $facet: {
      data: [{ $sort: sort }, { $skip: skip }, { $limit: limit }, ...ENRICH_STAGES],
      total: [{ $count: 'count' }],
    },
  });

  const [result] = await Job.aggregate(pipeline);
  const total = result.total[0]?.count || 0;
  return sendSuccess(res, { data: result.data, pagination: buildPagination(page, limit, total) });
};

// GET /api/jobs/featured
exports.getFeaturedJobs = async (req, res) => {
  const settings = await Setting.getSettings();
  const limit = Math.min(24, Math.max(1, parseInt(req.query.limit, 10) || settings.featuredJobsLimit));
  const base = { ...Job.publicFilter(), employerId: { $nin: await suspendedEmployerIds() } };
  const featured = await Job.aggregate([
    { $match: { ...base, isFeatured: true } },
    { $sort: { createdAt: -1 } },
    { $limit: limit },
    ...ENRICH_STAGES,
  ]);
  let jobs = featured;
  if (featured.length < limit) {
    const latest = await Job.aggregate([
      { $match: { ...base, _id: { $nin: featured.map((j) => j._id) } } },
      { $sort: { createdAt: -1 } },
      { $limit: limit - featured.length },
      ...ENRICH_STAGES,
    ]);
    jobs = featured.concat(latest);
  }
  return sendSuccess(res, { data: jobs });
};

// GET /api/jobs/stats  (public platform numbers for the landing page)
exports.getPublicStats = async (_req, res) => {
  const [activeJobs, employers, jobSeekers, applications, locations] = await Promise.all([
    Job.countDocuments(Job.publicFilter()),
    User.countDocuments({ role: ROLES.EMPLOYER, isSuspended: false }),
    User.countDocuments({ role: ROLES.JOB_SEEKER, isSuspended: false }),
    Application.estimatedDocumentCount(),
    Job.distinct('location', Job.publicFilter()),
  ]);
  return sendSuccess(res, { data: { activeJobs, employers, jobSeekers, applications, locations: locations.length } });
};

// GET /api/jobs/locations
exports.getLocations = async (_req, res) => sendSuccess(res, { data: { provinces: PROVINCES, remote: 'Remote' } });

// GET /api/jobs/:id
exports.getJobById = async (req, res) => {
  const job = await Job.findById(req.params.id).populate('category', 'name slug icon');
  if (!job) throw ApiError.notFound('Job not found.');

  const viewer = req.user;
  const isOwner = Boolean(viewer && job.employerId.equals(viewer._id));
  const isAdmin = viewer?.role === ROLES.ADMIN;
  const employerUser = await User.findById(job.employerId).select('isSuspended name');
  const isOpen = job.isOpenForApplications() && employerUser && !employerUser.isSuspended;

  let application = null;
  let isSaved = false;
  if (viewer && viewer.role === ROLES.JOB_SEEKER) {
    [application, isSaved] = await Promise.all([
      Application.findOne({ jobId: job._id, applicantId: viewer._id }).select('status appliedAt'),
      SavedJob.exists({ jobId: job._id, userId: viewer._id }).then(Boolean),
    ]);
  }

  // Non-public jobs are only visible to the owner, admins and seekers who applied or saved them.
  const visible = isOpen || isOwner || isAdmin || ((application || isSaved) && job.status !== 'removed');
  if (!visible) throw ApiError.notFound('This job is no longer available.');

  if (!isOwner && !isAdmin) await Job.updateOne({ _id: job._id }, { $inc: { views: 1 } });

  const employer = await EmployerProfile.findOne({ userId: job.employerId });
  const data = {
    job,
    employer,
    isOpen: Boolean(isOpen),
    isExpired: job.applicationDeadline < new Date(),
    isOwner,
    isSaved,
    application,
  };
  if (isOwner || isAdmin) data.applicationCount = await Application.countDocuments({ jobId: job._id });
  return sendSuccess(res, { data });
};

// GET /api/jobs/:id/related
exports.getRelatedJobs = async (req, res) => {
  const job = await Job.findById(req.params.id).select('category location province');
  if (!job) throw ApiError.notFound('Job not found.');
  const related = await Job.aggregate([
    {
      $match: {
        ...Job.publicFilter(),
        _id: { $ne: job._id },
        employerId: { $nin: await suspendedEmployerIds() },
        $or: [{ category: job.category }, { location: job.location }, { province: job.province }],
      },
    },
    {
      $addFields: {
        score: {
          $add: [
            { $cond: [{ $eq: ['$category', job.category] }, 3, 0] },
            { $cond: [{ $eq: ['$location', job.location] }, 2, 0] },
            { $cond: [{ $eq: ['$province', job.province] }, 1, 0] },
          ],
        },
      },
    },
    { $sort: { score: -1, createdAt: -1 } },
    { $limit: 4 },
    ...ENRICH_STAGES,
  ]);
  return sendSuccess(res, { data: related });
};

function assertFutureDeadline(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) throw ApiError.badRequest('Application deadline is not a valid date.');
  if (d < new Date()) throw ApiError.badRequest('Application deadline must be in the future.');
}

async function assertActiveCategory(categoryId) {
  const category = await JobCategory.findOne({ _id: categoryId, isActive: true });
  if (!category) throw ApiError.badRequest('Please choose a valid, active job category.');
}

async function assertJobQuota(employerId, excludeJobId) {
  const settings = await Setting.getSettings();
  const filter = { employerId, ...Job.publicFilter() };
  if (excludeJobId) filter._id = { $ne: excludeJobId };
  const active = await Job.countDocuments(filter);
  if (active >= settings.maxActiveJobsPerEmployer) {
    throw ApiError.badRequest(
      `You have reached the limit of ${settings.maxActiveJobsPerEmployer} active job postings. Close an existing job first.`
    );
  }
}

/** Deadlines given as a date (YYYY-MM-DD) apply until the end of that day. */
function normaliseDeadline(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T23:59:59.999Z`);
  return new Date(value);
}

function prepareUpdates(body) {
  const updates = pick(body, EDITABLE_FIELDS);
  if (updates.applicationDeadline) updates.applicationDeadline = normaliseDeadline(updates.applicationDeadline);
  if (updates.salary) {
    updates.salary = pick(updates.salary, ['min', 'max', 'currency']);
    for (const k of ['min', 'max']) {
      if (updates.salary[k] === '' || updates.salary[k] === null) updates.salary[k] = undefined;
      else if (updates.salary[k] !== undefined) updates.salary[k] = Number(updates.salary[k]);
    }
  }
  for (const k of ['requirements', 'responsibilities', 'skillsRequired']) {
    if (updates[k]) updates[k] = updates[k].map((s) => String(s).trim()).filter(Boolean);
  }
  return updates;
}

async function loadOwnedJob(req) {
  const job = await Job.findById(req.params.id);
  if (!job) throw ApiError.notFound('Job not found.');
  if (!job.employerId.equals(req.user._id)) throw ApiError.forbidden('You can only manage your own job postings.');
  return job;
}

// POST /api/jobs
exports.createJob = async (req, res) => {
  const updates = prepareUpdates(req.body);
  const status = OWNER_STATUSES.includes(req.body.status) && req.body.status !== 'closed' ? req.body.status : 'published';
  assertFutureDeadline(updates.applicationDeadline);
  await assertActiveCategory(updates.category);
  if (status === 'published') await assertJobQuota(req.user._id);

  const job = await Job.create({ ...updates, status, employerId: req.user._id });
  await job.populate('category', 'name slug icon');
  return sendSuccess(res, {
    status: 201,
    message: status === 'draft' ? 'Job saved as draft' : 'Job published successfully',
    data: { job },
  });
};

// PUT /api/jobs/:id
exports.updateJob = async (req, res) => {
  const job = await loadOwnedJob(req);
  if (job.status === 'removed') throw ApiError.forbidden('This job was removed by an administrator and cannot be edited.');

  const updates = prepareUpdates(req.body);
  if (updates.applicationDeadline && updates.applicationDeadline.getTime() !== job.applicationDeadline.getTime()) {
    assertFutureDeadline(updates.applicationDeadline);
  }
  if (updates.category && String(updates.category) !== String(job.category)) await assertActiveCategory(updates.category);

  if (req.body.status !== undefined) {
    if (!OWNER_STATUSES.includes(req.body.status)) throw ApiError.badRequest('Invalid job status.');
    if (req.body.status === 'published' && job.status !== 'published') await assertJobQuota(req.user._id, job._id);
    job.status = req.body.status;
  }
  // The client always sends the complete salary object, so it replaces the stored one (allows clearing values)
  job.set(updates);
  if (job.status === 'published') assertFutureDeadline(job.applicationDeadline);
  await job.save();
  await job.populate('category', 'name slug icon');
  return sendSuccess(res, { message: 'Job updated successfully', data: { job } });
};

// PATCH /api/jobs/:id/status
exports.updateJobStatus = async (req, res) => {
  const job = await loadOwnedJob(req);
  const { status } = req.body;
  if (job.status === 'removed') throw ApiError.forbidden('This job was removed by an administrator.');
  if (!OWNER_STATUSES.includes(status)) throw ApiError.badRequest('Status must be draft, published or closed.');
  if (status === 'published') {
    assertFutureDeadline(job.applicationDeadline);
    if (job.status !== 'published') await assertJobQuota(req.user._id, job._id);
  }
  job.status = status;
  await job.save();

  if (status === 'closed') {
    // Let pending applicants know the job is no longer accepting applications
    const pending = await Application.find({ jobId: job._id, status: 'pending' }).select('applicantId');
    await Promise.all(
      pending.map((a) =>
        notify({
          userId: a.applicantId,
          title: 'Job closed',
          message: `The job "${job.title}" has been closed by the employer. Your application is still on record.`,
          type: 'job_activity',
          relatedJobId: job._id,
          relatedApplicationId: a._id,
          link: '/seeker/applications',
        })
      )
    );
  }
  const messages = { draft: 'Job moved to drafts', published: 'Job published', closed: 'Job closed' };
  return sendSuccess(res, { message: messages[status], data: { job } });
};

// DELETE /api/jobs/:id  (owner or admin)
exports.deleteJob = async (req, res) => {
  const job = await Job.findById(req.params.id);
  if (!job) throw ApiError.notFound('Job not found.');
  const isAdmin = req.user.role === ROLES.ADMIN;
  if (!isAdmin && !job.employerId.equals(req.user._id)) {
    throw ApiError.forbidden('You can only delete your own job postings.');
  }
  await deleteJobCascade(job._id);
  if (isAdmin && !job.employerId.equals(req.user._id)) {
    await notify({
      userId: job.employerId,
      title: 'Job deleted by administrator',
      message: `Your job "${job.title}" was permanently deleted by a platform administrator.`,
      type: 'job_activity',
    });
  }
  return sendSuccess(res, { message: 'Job deleted successfully' });
};
