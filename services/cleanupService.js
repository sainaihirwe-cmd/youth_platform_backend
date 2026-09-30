const Job = require('../models/Job');
const Application = require('../models/Application');
const SavedJob = require('../models/SavedJob');
const Notification = require('../models/Notification');
const Report = require('../models/Report');
const EmployerProfile = require('../models/EmployerProfile');
const User = require('../models/User');
const { deleteFile } = require('./storageService');

/**
 * Permanently deletes a job and its dependent records.
 * Reports about the job are kept for moderation history (the reference simply stops resolving).
 */
async function deleteJobCascade(jobId) {
  const applications = await Application.find({ jobId }).select('resumeUrl applicantId');
  // Only delete application-specific resume files, never the applicant's profile resume
  const profileResumes = new Set(
    (await User.find({ _id: { $in: applications.map((a) => a.applicantId) } }).select('resumeUrl')).map((u) => u.resumeUrl)
  );
  await Promise.all(applications.filter((a) => a.resumeUrl && !profileResumes.has(a.resumeUrl)).map((a) => deleteFile(a.resumeUrl)));
  await Promise.all([
    Application.deleteMany({ jobId }),
    SavedJob.deleteMany({ jobId }),
    Notification.deleteMany({ relatedJobId: jobId }),
  ]);
  await Job.deleteOne({ _id: jobId });
}

/** Permanently deletes a user account together with everything they own. */
async function deleteUserCascade(user) {
  const userId = user._id;
  if (user.role === 'employer') {
    const jobs = await Job.find({ employerId: userId }).select('_id');
    for (const job of jobs) await deleteJobCascade(job._id);
    const profile = await EmployerProfile.findOne({ userId });
    if (profile) {
      await deleteFile(profile.companyLogo);
      await profile.deleteOne();
    }
  }

  const applications = await Application.find({ applicantId: userId }).select('resumeUrl');
  await Promise.all(applications.map((a) => (a.resumeUrl !== user.resumeUrl ? deleteFile(a.resumeUrl) : null)));
  await deleteFile(user.resumeUrl);
  await deleteFile(user.profileImage);

  await Promise.all([
    Application.deleteMany({ applicantId: userId }),
    SavedJob.deleteMany({ userId }),
    Notification.deleteMany({ userId }),
    Report.deleteMany({ reporterId: userId }),
  ]);
  await User.deleteOne({ _id: userId });
}

module.exports = { deleteJobCascade, deleteUserCascade };
