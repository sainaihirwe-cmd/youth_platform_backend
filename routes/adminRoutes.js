const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/adminController');
const { protect } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/roleMiddleware');
const { validate, mongoIdParam } = require('../middleware/validationMiddleware');
const { REPORT_STATUSES, VERIFICATION_STATUSES } = require('../config/constants');

router.use(protect, authorize('admin'));

router.get('/dashboard', ctrl.getDashboard);
router.get('/analytics', ctrl.getAnalytics);

router.get('/users', ctrl.getUsers);
router.get('/users/:id', [mongoIdParam('id')], validate, ctrl.getUserDetails);
router.patch(
  '/users/:id/status',
  [
    mongoIdParam('id'),
    body('isSuspended').isBoolean().withMessage('isSuspended must be true or false'),
    body('reason').optional().isString().isLength({ max: 500 }).withMessage('Reason is too long'),
  ],
  validate,
  ctrl.updateUserStatus
);
router.patch(
  '/users/:id/verification',
  [
    mongoIdParam('id'),
    body('verificationStatus').isIn(VERIFICATION_STATUSES).withMessage('Invalid verification status'),
    body('notes').optional().isString().isLength({ max: 1000 }),
  ],
  validate,
  ctrl.updateEmployerVerification
);
router.delete('/users/:id', [mongoIdParam('id')], validate, ctrl.deleteUser);

router.get('/jobs', ctrl.getJobs);
router.patch(
  '/jobs/:id/moderate',
  [
    mongoIdParam('id'),
    body('action').isIn(['remove', 'restore', 'close', 'feature', 'unfeature']).withMessage('Invalid moderation action'),
    body('reason').optional().isString().isLength({ max: 500 }).withMessage('Reason is too long'),
  ],
  validate,
  ctrl.moderateJob
);

router.get('/reports', ctrl.getReports);
router.get('/reports/export', ctrl.exportReports);
router.patch(
  '/reports/:id',
  [
    mongoIdParam('id'),
    body('status').optional().isIn(REPORT_STATUSES).withMessage('Invalid report status'),
    body('adminNotes').optional().isString().isLength({ max: 2000 }).withMessage('Notes are too long'),
    body('action').optional().isIn(['none', 'suspend_user', 'remove_job']).withMessage('Invalid moderation action'),
  ],
  validate,
  ctrl.updateReport
);

router.get('/settings', ctrl.getSettings);
router.put(
  '/settings',
  [
    body('siteName').optional().trim().isLength({ min: 2, max: 100 }).withMessage('Site name must be 2-100 characters'),
    body('tagline').optional().isString().isLength({ max: 200 }),
    body('contactEmail').optional().isEmail().withMessage('Invalid contact email'),
    body('contactPhone').optional().isString().isLength({ max: 30 }),
    body('contactAddress').optional().isString().isLength({ max: 200 }),
    body('allowSeekerRegistration').optional().isBoolean().toBoolean(),
    body('allowEmployerRegistration').optional().isBoolean().toBoolean(),
    body('maxActiveJobsPerEmployer').optional().isInt({ min: 1, max: 1000 }).withMessage('Must be between 1 and 1000').toInt(),
    body('featuredJobsLimit').optional().isInt({ min: 1, max: 24 }).withMessage('Must be between 1 and 24').toInt(),
    body('maintenanceMessage').optional().isString().isLength({ max: 300 }),
  ],
  validate,
  ctrl.updateSettings
);

router.get('/messages', ctrl.getMessages);
router.patch(
  '/messages/:id',
  [mongoIdParam('id'), body('status').isIn(['new', 'read', 'archived']).withMessage('Invalid status')],
  validate,
  ctrl.updateMessage
);

module.exports = router;
