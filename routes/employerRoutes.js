const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/employerController');
const { protect } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/roleMiddleware');
const { validate, mongoIdParam } = require('../middleware/validationMiddleware');
const { uploadImage } = require('../middleware/uploadMiddleware');
const { LOCATIONS } = require('../config/constants');

router.use(protect, authorize('employer'));

router.get('/profile', ctrl.getProfile);
router.put(
  '/profile',
  [
    body('companyName').optional().trim().isLength({ min: 2, max: 150 }).withMessage('Company name must be 2-150 characters'),
    body('description').optional().isString().isLength({ max: 3000 }).withMessage('Description is too long (max 3000 characters)'),
    body('industry').optional().isString().isLength({ max: 100 }),
    body('location').optional().isIn([...LOCATIONS, '']).withMessage('Invalid location'),
    body('phone')
      .optional({ values: 'falsy' })
      .matches(/^\+?[0-9\s-]{9,20}$/)
      .withMessage('Please provide a valid phone number'),
    body('contactEmail').optional({ values: 'falsy' }).isEmail().withMessage('Please provide a valid contact email'),
    body('website')
      .optional({ values: 'falsy' })
      .isURL({ protocols: ['http', 'https'], require_protocol: true })
      .withMessage('Website must be a valid URL starting with http:// or https://'),
  ],
  validate,
  ctrl.updateProfile
);
router.post('/profile/logo', ...uploadImage('logo'), ctrl.uploadLogo);
router.get('/dashboard', ctrl.getDashboard);
router.get('/jobs', ctrl.getMyJobs);
router.get('/applications', ctrl.getAllApplications);
router.get('/jobs/:id/applications', [mongoIdParam('id')], validate, ctrl.getJobApplications);

module.exports = router;
