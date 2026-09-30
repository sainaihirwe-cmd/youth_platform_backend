const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/applicationController');
const { protect } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/roleMiddleware');
const { validate, mongoIdParam } = require('../middleware/validationMiddleware');
const { uploadResume } = require('../middleware/uploadMiddleware');
const { sanitizeRequest } = require('../middleware/sanitizeMiddleware');

router.use(protect);

router.post(
  '/',
  authorize('job_seeker'),
  ...uploadResume('resume'),
  sanitizeRequest, // multipart bodies are parsed by multer, after the global sanitiser has run
  [
    body('jobId').isMongoId().withMessage('A valid job is required'),
    body('coverLetter')
      .isString()
      .trim()
      .isLength({ min: 30, max: 5000 })
      .withMessage('Cover letter must be between 30 and 5000 characters'),
  ],
  validate,
  ctrl.createApplication
);
router.get('/my-applications', authorize('job_seeker'), ctrl.getMyApplications);
router.get('/stats', authorize('job_seeker'), ctrl.getMyStats);
router.get('/:id', [mongoIdParam('id')], validate, ctrl.getApplicationById);
router.patch(
  '/:id/status',
  authorize('employer'),
  [
    mongoIdParam('id'),
    body('status').isIn(['pending', 'accepted', 'rejected']).withMessage('Status must be pending, accepted or rejected'),
    body('employerNotes').optional().isString().isLength({ max: 1000 }).withMessage('Notes are too long'),
  ],
  validate,
  ctrl.updateApplicationStatus
);
router.delete('/:id', authorize('job_seeker'), [mongoIdParam('id')], validate, ctrl.withdrawApplication);

module.exports = router;
