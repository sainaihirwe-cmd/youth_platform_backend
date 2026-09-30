const router = require('express').Router();
const { body } = require('express-validator');
const publicCtrl = require('../controllers/publicController');
const userCtrl = require('../controllers/userController');
const { protect, optionalAuth } = require('../middleware/authMiddleware');
const { validate } = require('../middleware/validationMiddleware');
const { contactLimiter } = require('../middleware/rateLimitMiddleware');

router.get('/settings/public', publicCtrl.getPublicSettings);
router.post(
  '/contact',
  contactLimiter,
  optionalAuth,
  [
    body('name').trim().isLength({ min: 2, max: 100 }).withMessage('Please enter your name'),
    body('email').trim().isEmail().withMessage('Please provide a valid email address'),
    body('subject').trim().isLength({ min: 3, max: 200 }).withMessage('Subject must be between 3 and 200 characters'),
    body('message').trim().isLength({ min: 10, max: 5000 }).withMessage('Message must be between 10 and 5000 characters'),
  ],
  validate,
  publicCtrl.submitContact
);

// Resumes stored on local disk are never served statically; every download is authorised.
router.get('/files/resumes/:filename', protect, userCtrl.downloadResume);

module.exports = router;
