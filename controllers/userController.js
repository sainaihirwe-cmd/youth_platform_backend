const fs = require('fs');
const path = require('path');
const User = require('../models/User');
const Job = require('../models/Job');
const EmployerProfile = require('../models/EmployerProfile');
const Application = require('../models/Application');
const ApiError = require('../utils/ApiError');
const { sendSuccess } = require('../utils/apiResponse');
const { pick } = require('../middleware/validationMiddleware');
const { saveFile, deleteFile, localResumePath, LOCAL_PREFIX } = require('../services/storageService');
const { deleteUserCascade } = require('../services/cleanupService');
const { clearAuthCookie } = require('../utils/generateToken');
const { ROLES } = require('../config/constants');

const PROFILE_FIELDS = ['name', 'phone', 'location', 'skills', 'education', 'experience', 'professionalSummary'];

function normaliseSkills(skills) {
  if (!Array.isArray(skills)) return undefined;
  const seen = new Set();
  return skills
    .map((s) => String(s).trim())
    .filter((s) => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()));
}

/** Files that are still referenced by an application must not be deleted. */
async function deleteIfUnreferenced(url) {
  if (!url) return;
  const inUse = await Application.exists({ resumeUrl: url });
  if (!inUse) await deleteFile(url);
}

// GET /api/users/profile
exports.getProfile = async (req, res) => {
  const data = { user: req.user.toJSON() };
  if (req.user.role === ROLES.EMPLOYER) data.employerProfile = await EmployerProfile.findOne({ userId: req.user._id });
  return sendSuccess(res, { data });
};

// PUT /api/users/profile
exports.updateProfile = async (req, res) => {
  const updates = pick(req.body, PROFILE_FIELDS);
  if (updates.skills) updates.skills = normaliseSkills(updates.skills);
  if (req.user.role !== ROLES.JOB_SEEKER) {
    // Career fields only make sense for job seekers
    delete updates.skills;
    delete updates.education;
    delete updates.experience;
  }
  const user = await User.findById(req.user._id);
  user.set(updates);
  await user.save();
  return sendSuccess(res, { message: 'Profile updated successfully', data: { user: user.toJSON() } });
};

// POST /api/users/profile-image
exports.uploadProfileImage = async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Please choose an image to upload.');
  const url = await saveFile(req.file, 'images');
  const user = await User.findById(req.user._id);
  const old = user.profileImage;
  user.profileImage = url;
  await user.save({ validateModifiedOnly: true });
  await deleteFile(old);
  return sendSuccess(res, { message: 'Profile photo updated', data: { user: user.toJSON() } });
};

// POST /api/users/resume
exports.uploadResume = async (req, res) => {
  if (req.user.role !== ROLES.JOB_SEEKER) throw ApiError.forbidden('Only job seekers can upload a resume.');
  if (!req.file) throw ApiError.badRequest('Please choose a PDF, DOC or DOCX file to upload.');
  const url = await saveFile(req.file, 'resumes');
  const user = await User.findById(req.user._id);
  const old = user.resumeUrl;
  user.resumeUrl = url;
  user.resumeOriginalName = path.basename(req.file.originalname).slice(0, 200);
  user.resumeUploadedAt = new Date();
  await user.save({ validateModifiedOnly: true });
  await deleteIfUnreferenced(old);
  return sendSuccess(res, { message: 'Resume uploaded successfully', data: { user: user.toJSON() } });
};

// DELETE /api/users/resume
exports.deleteResume = async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user.resumeUrl) throw ApiError.notFound('You have not uploaded a resume.');
  const old = user.resumeUrl;
  user.resumeUrl = '';
  user.resumeOriginalName = '';
  user.resumeUploadedAt = undefined;
  await user.save({ validateModifiedOnly: true });
  await deleteIfUnreferenced(old);
  return sendSuccess(res, { message: 'Resume removed', data: { user: user.toJSON() } });
};

// DELETE /api/users/profile  (delete own account)
exports.deleteAccount = async (req, res) => {
  const user = await User.findById(req.user._id).select('+password');
  if (!(await user.comparePassword(String(req.body.password || '')))) {
    throw ApiError.badRequest('Password is incorrect.');
  }
  if (user.role === ROLES.ADMIN && (await User.countDocuments({ role: ROLES.ADMIN })) <= 1) {
    throw ApiError.badRequest('The last administrator account cannot be deleted.');
  }
  await deleteUserCascade(user);
  clearAuthCookie(res);
  return sendSuccess(res, { message: 'Your account has been deleted.' });
};

/**
 * Whether `viewer` may see private details (email, phone, resume) of job seeker `target`:
 * the seeker themself, an admin, or an employer who received an application from them.
 */
async function canViewPrivate(viewer, target) {
  if (!viewer) return false;
  if (viewer._id.equals(target._id) || viewer.role === ROLES.ADMIN) return true;
  if (viewer.role === ROLES.EMPLOYER && target.role === ROLES.JOB_SEEKER) {
    return Boolean(await Application.exists({ applicantId: target._id, employerId: viewer._id }));
  }
  return false;
}

// GET /api/users/:id  (public profile)
exports.getUserById = async (req, res) => {
  const target = await User.findById(req.params.id);
  if (!target || target.role === ROLES.ADMIN) throw ApiError.notFound('User not found.');
  if (target.isSuspended && req.user?.role !== ROLES.ADMIN) throw ApiError.notFound('User not found.');

  const isPrivate = await canViewPrivate(req.user, target);
  const base = pick(target.toJSON(), ['_id', 'name', 'role', 'location', 'profileImage', 'createdAt']);
  const data = { user: base, canViewPrivate: isPrivate };

  if (target.role === ROLES.JOB_SEEKER) {
    Object.assign(base, pick(target.toJSON(), ['skills', 'education', 'experience', 'professionalSummary']));
    if (isPrivate) Object.assign(base, pick(target.toJSON(), ['email', 'phone', 'resumeUrl', 'resumeOriginalName']));
  } else {
    data.employerProfile = await EmployerProfile.findOne({ userId: target._id });
    data.jobs = await Job.find({ employerId: target._id, ...Job.publicFilter() })
      .sort({ createdAt: -1 })
      .limit(20)
      .populate('category', 'name slug icon');
  }
  return sendSuccess(res, { data });
};

// GET /api/files/resumes/:filename  (access-controlled resume download)
exports.downloadResume = async (req, res) => {
  const filePath = localResumePath(req.params.filename);
  if (!filePath) throw ApiError.notFound('File not found.');
  const url = `${LOCAL_PREFIX.resumes}${path.basename(filePath)}`;
  const viewer = req.user;

  let allowed = viewer.role === ROLES.ADMIN || viewer.resumeUrl === url;
  if (!allowed) {
    const application = await Application.findOne({ resumeUrl: url }).select('applicantId employerId');
    if (application) {
      allowed = application.applicantId.equals(viewer._id) || application.employerId.equals(viewer._id);
    }
    if (!allowed && viewer.role === ROLES.EMPLOYER) {
      // Employers may open the profile resume of anyone who applied to one of their jobs
      const owner = await User.findOne({ resumeUrl: url }).select('_id');
      if (owner) allowed = Boolean(await Application.exists({ applicantId: owner._id, employerId: viewer._id }));
    }
  }
  if (!allowed) throw ApiError.forbidden('You do not have access to this file.');
  if (!fs.existsSync(filePath)) throw ApiError.notFound('The resume file could not be found.');

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  return res.sendFile(filePath, { headers: { 'Content-Disposition': 'inline' } });
};
