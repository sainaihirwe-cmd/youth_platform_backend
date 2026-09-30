const ROLES = Object.freeze({ JOB_SEEKER: 'job_seeker', EMPLOYER: 'employer', ADMIN: 'admin' });

const JOB_TYPES = ['full_time', 'part_time', 'temporary', 'freelance', 'internship', 'contract'];
const JOB_STATUSES = ['draft', 'published', 'closed', 'removed'];
const PAYMENT_TYPES = ['hourly', 'daily', 'weekly', 'monthly', 'fixed', 'negotiable'];
const APPLICATION_STATUSES = ['pending', 'accepted', 'rejected'];
const REPORT_STATUSES = ['pending', 'under_review', 'resolved', 'dismissed'];
const REPORT_REASONS = ['scam', 'misleading', 'inappropriate', 'suspicious_account', 'spam', 'other'];
const VERIFICATION_STATUSES = ['pending', 'verified', 'rejected'];
const NOTIFICATION_TYPES = ['application_status', 'new_application', 'job_activity', 'report_update', 'account', 'system'];

// Rwanda administrative structure: province -> districts
const PROVINCES = {
  Kigali: ['Gasabo', 'Kicukiro', 'Nyarugenge'],
  'Northern Province': ['Burera', 'Gakenke', 'Gicumbi', 'Musanze', 'Rulindo'],
  'Southern Province': ['Gisagara', 'Huye', 'Kamonyi', 'Muhanga', 'Nyamagabe', 'Nyanza', 'Nyaruguru', 'Ruhango'],
  'Eastern Province': ['Bugesera', 'Gatsibo', 'Kayonza', 'Kirehe', 'Ngoma', 'Nyagatare', 'Rwamagana'],
  'Western Province': ['Karongi', 'Ngororero', 'Nyabihu', 'Nyamasheke', 'Rubavu', 'Rusizi', 'Rutsiro'],
};
const REMOTE = 'Remote';
const LOCATIONS = [...Object.keys(PROVINCES), ...Object.values(PROVINCES).flat(), REMOTE];

function provinceOf(location) {
  if (!location) return undefined;
  if (PROVINCES[location]) return location;
  if (location === REMOTE) return REMOTE;
  return Object.keys(PROVINCES).find((p) => PROVINCES[p].includes(location));
}

const RESUME_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_MAX_BYTES = 2 * 1024 * 1024;

module.exports = {
  ROLES,
  JOB_TYPES,
  JOB_STATUSES,
  PAYMENT_TYPES,
  APPLICATION_STATUSES,
  REPORT_STATUSES,
  REPORT_REASONS,
  VERIFICATION_STATUSES,
  NOTIFICATION_TYPES,
  PROVINCES,
  LOCATIONS,
  REMOTE,
  provinceOf,
  RESUME_MAX_BYTES,
  IMAGE_MAX_BYTES,
};
