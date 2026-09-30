const JobCategory = require('../models/JobCategory');
const Job = require('../models/Job');
const ApiError = require('../utils/ApiError');
const { sendSuccess } = require('../utils/apiResponse');
const { pick } = require('../middleware/validationMiddleware');
const { ROLES } = require('../config/constants');

const FIELDS = ['name', 'description', 'icon', 'isActive'];

// GET /api/categories   (?all=true lets admins include inactive categories)
exports.getCategories = async (req, res) => {
  const includeInactive = req.query.all === 'true' && req.user?.role === ROLES.ADMIN;
  const filter = includeInactive ? {} : { isActive: true };
  const categories = await JobCategory.find(filter).sort({ name: 1 }).lean();

  // Attach live counts of public jobs (and total jobs for admins)
  const publicCounts = await Job.aggregate([
    { $match: Job.publicFilter() },
    { $group: { _id: '$category', count: { $sum: 1 } } },
  ]);
  const pc = Object.fromEntries(publicCounts.map((c) => [String(c._id), c.count]));
  let tc = {};
  if (includeInactive) {
    const totals = await Job.aggregate([{ $group: { _id: '$category', count: { $sum: 1 } } }]);
    tc = Object.fromEntries(totals.map((c) => [String(c._id), c.count]));
  }
  categories.forEach((c) => {
    c.jobCount = pc[String(c._id)] || 0;
    if (includeInactive) c.totalJobs = tc[String(c._id)] || 0;
  });
  return sendSuccess(res, { data: categories });
};

// POST /api/categories
exports.createCategory = async (req, res) => {
  const data = pick(req.body, FIELDS);
  if (await JobCategory.exists({ name: new RegExp(`^${data.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') })) {
    throw ApiError.conflict('A category with this name already exists.');
  }
  const category = await JobCategory.create(data);
  return sendSuccess(res, { status: 201, message: 'Category created', data: { category } });
};

// PUT /api/categories/:id
exports.updateCategory = async (req, res) => {
  const category = await JobCategory.findById(req.params.id);
  if (!category) throw ApiError.notFound('Category not found.');
  category.set(pick(req.body, FIELDS));
  try {
    await category.save();
  } catch (err) {
    if (err.code === 11000) throw ApiError.conflict('A category with this name already exists.');
    throw err;
  }
  return sendSuccess(res, { message: 'Category updated', data: { category } });
};

// DELETE /api/categories/:id
exports.deleteCategory = async (req, res) => {
  const category = await JobCategory.findById(req.params.id);
  if (!category) throw ApiError.notFound('Category not found.');
  const inUse = await Job.countDocuments({ category: category._id });
  if (inUse) {
    throw ApiError.conflict(
      `This category is used by ${inUse} job(s) and cannot be deleted. Deactivate it instead to hide it from new postings.`
    );
  }
  await category.deleteOne();
  return sendSuccess(res, { message: 'Category deleted' });
};
