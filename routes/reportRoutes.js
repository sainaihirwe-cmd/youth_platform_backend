const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/reportController');
const { protect } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/roleMiddleware');
const { validate } = require('../middleware/validationMiddleware');
const { REPORT_REASONS } = require('../config/constants');

router.use(protect, authorize('job_seeker', 'employer'));

router.post(
  '/',
  [
    body('reportedJobId').optional({ values: 'falsy' }).isMongoId().withMessage('Invalid job'),
    body('reportedUserId').optional({ values: 'falsy' }).isMongoId().withMessage('Invalid user'),
    body().custom((b) => Boolean(b.reportedJobId || b.reportedUserId)).withMessage('Please specify the job or user you are reporting'),
    body('reason').isIn(REPORT_REASONS).withMessage('Please choose a reason'),
    body('description')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 2000 })
      .withMessage('Description must be at most 2000 characters'),
  ],
  validate,
  ctrl.createReport
);
router.get('/my-reports', ctrl.getMyReports);

module.exports = router;
