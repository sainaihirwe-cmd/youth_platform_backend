const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/jobController');
const { protect, optionalAuth } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/roleMiddleware');
const { validate, mongoIdParam } = require('../middleware/validationMiddleware');
const { JOB_TYPES, PAYMENT_TYPES, LOCATIONS } = require('../config/constants');

const list = (field, max, itemMax) => [
  body(field).optional().isArray({ max }).withMessage(`${field} must be a list of at most ${max} items`),
  body(`${field}.*`).optional().isString().isLength({ max: itemMax }).withMessage(`Each item in ${field} must be at most ${itemMax} characters`),
];

/** `partial` makes every field optional (used for updates). */
const jobRules = (partial = false) => {
  const req = (chain) => (partial ? chain.optional() : chain);
  return [
    req(body('title')).trim().isLength({ min: 3, max: 150 }).withMessage('Title must be between 3 and 150 characters'),
    req(body('description')).trim().isLength({ min: 20, max: 10000 }).withMessage('Description must be at least 20 characters'),
    req(body('category')).isMongoId().withMessage('Please choose a category'),
    req(body('location')).isIn(LOCATIONS).withMessage('Please choose a valid location'),
    req(body('jobType')).isIn(JOB_TYPES).withMessage('Please choose a valid job type'),
    req(body('applicationDeadline')).isISO8601().withMessage('Please provide a valid application deadline'),
    body('paymentType').optional().isIn(PAYMENT_TYPES).withMessage('Invalid payment type'),
    body('paymentDetails').optional().isString().isLength({ max: 500 }),
    body('address').optional().isString().isLength({ max: 200 }),
    body('salary').optional().isObject().withMessage('Salary must be an object'),
    body('salary.min').optional({ values: 'falsy' }).isFloat({ min: 0 }).withMessage('Minimum salary must be a positive number'),
    body('salary.max')
      .optional({ values: 'falsy' })
      .isFloat({ min: 0 })
      .withMessage('Maximum salary must be a positive number')
      .bail()
      .custom((max, { req: r }) => !r.body.salary?.min || Number(max) >= Number(r.body.salary.min))
      .withMessage('Maximum salary must be greater than or equal to minimum salary'),
    body('salary.currency').optional().isIn(['RWF', 'USD']).withMessage('Currency must be RWF or USD'),
    body('vacancies').optional().isInt({ min: 1, max: 1000 }).withMessage('Number of workers needed must be between 1 and 1000'),
    body('status').optional().isIn(['draft', 'published', 'closed']).withMessage('Invalid status'),
    ...list('requirements', 30, 300),
    ...list('responsibilities', 30, 300),
    ...list('skillsRequired', 30, 50),
  ];
};

router.get('/', ctrl.getJobs);
router.get('/featured', ctrl.getFeaturedJobs);
router.get('/stats', ctrl.getPublicStats);
router.get('/locations', ctrl.getLocations);
router.get('/:id', optionalAuth, [mongoIdParam('id')], validate, ctrl.getJobById);
router.get('/:id/related', [mongoIdParam('id')], validate, ctrl.getRelatedJobs);

router.post('/', protect, authorize('employer'), jobRules(false), validate, ctrl.createJob);
router.put('/:id', protect, authorize('employer'), [mongoIdParam('id'), ...jobRules(true)], validate, ctrl.updateJob);
router.patch(
  '/:id/status',
  protect,
  authorize('employer'),
  [mongoIdParam('id'), body('status').isIn(['draft', 'published', 'closed']).withMessage('Status must be draft, published or closed')],
  validate,
  ctrl.updateJobStatus
);
router.delete('/:id', protect, authorize('employer', 'admin'), [mongoIdParam('id')], validate, ctrl.deleteJob);

module.exports = router;
