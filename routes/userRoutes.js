const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/userController');
const { protect, optionalAuth } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/roleMiddleware');
const { validate, mongoIdParam } = require('../middleware/validationMiddleware');
const { uploadResume, uploadImage } = require('../middleware/uploadMiddleware');
const { LOCATIONS } = require('../config/constants');

const profileRules = [
  body('name').optional().trim().isLength({ min: 2, max: 100 }).withMessage('Name must be between 2 and 100 characters'),
  body('phone')
    .optional({ values: 'falsy' })
    .matches(/^\+?[0-9\s-]{9,20}$/)
    .withMessage('Please provide a valid phone number'),
  body('location').optional().isIn([...LOCATIONS, '']).withMessage('Invalid location'),
  body('professionalSummary').optional().isString().isLength({ max: 2000 }).withMessage('Summary is too long (max 2000 characters)'),
  body('skills').optional().isArray({ max: 50 }).withMessage('Skills must be a list of at most 50 items'),
  body('skills.*').optional().isString().trim().isLength({ min: 1, max: 50 }).withMessage('Each skill must be 1-50 characters'),
  body('education').optional().isArray({ max: 20 }).withMessage('Education must be a list'),
  body('education.*.institution').optional().isString().trim().notEmpty().withMessage('Institution is required'),
  body('education.*.startYear').optional({ values: 'falsy' }).isInt({ min: 1950, max: 2100 }).withMessage('Invalid start year'),
  body('education.*.endYear').optional({ values: 'falsy' }).isInt({ min: 1950, max: 2100 }).withMessage('Invalid end year'),
  body('experience').optional().isArray({ max: 30 }).withMessage('Experience must be a list'),
  body('experience.*.title').optional().isString().trim().notEmpty().withMessage('Job title is required'),
  body('experience.*.startDate').optional({ values: 'falsy' }).isISO8601().withMessage('Invalid start date'),
  body('experience.*.endDate').optional({ values: 'falsy' }).isISO8601().withMessage('Invalid end date'),
];

router.get('/profile', protect, ctrl.getProfile);
router.put('/profile', protect, profileRules, validate, ctrl.updateProfile);
router.delete(
  '/profile',
  protect,
  [body('password').isString().notEmpty().withMessage('Please confirm with your password')],
  validate,
  ctrl.deleteAccount
);
router.post('/profile-image', protect, ...uploadImage('image'), ctrl.uploadProfileImage);
router.post('/resume', protect, authorize('job_seeker'), ...uploadResume('resume'), ctrl.uploadResume);
router.delete('/resume', protect, authorize('job_seeker'), ctrl.deleteResume);
router.get('/:id', optionalAuth, [mongoIdParam('id')], validate, ctrl.getUserById);

module.exports = router;
