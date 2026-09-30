const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/authController');
const { protect, optionalAuth } = require('../middleware/authMiddleware');
const { validate, STRONG_PASSWORD, STRONG_PASSWORD_MESSAGE } = require('../middleware/validationMiddleware');
const { loginLimiter, registerLimiter, passwordResetLimiter } = require('../middleware/rateLimitMiddleware');
const { LOCATIONS } = require('../config/constants');

const emailRule = body('email').trim().isEmail().withMessage('Please provide a valid email address').normalizeEmail({ gmail_remove_dots: false });
const strongPassword = (field) => body(field).isString().matches(STRONG_PASSWORD).withMessage(STRONG_PASSWORD_MESSAGE);

router.post(
  '/register',
  registerLimiter,
  [
    body('name').trim().isLength({ min: 2, max: 100 }).withMessage('Name must be between 2 and 100 characters'),
    emailRule,
    strongPassword('password'),
    body('role').isIn(['job_seeker', 'employer']).withMessage('Please choose job seeker or employer'),
    body('phone')
      .optional({ values: 'falsy' })
      .matches(/^\+?[0-9\s-]{9,20}$/)
      .withMessage('Please provide a valid phone number'),
    body('location').optional({ values: 'falsy' }).isIn(LOCATIONS).withMessage('Invalid location'),
    body('companyName')
      .if(body('role').equals('employer'))
      .trim()
      .isLength({ min: 2, max: 150 })
      .withMessage('Company or employer name is required'),
  ],
  validate,
  ctrl.register
);

const loginRules = [emailRule, body('password').isString().notEmpty().withMessage('Password is required')];
router.post('/login', loginLimiter, loginRules, validate, ctrl.login);
router.post('/admin/login', loginLimiter, loginRules, validate, ctrl.adminLogin);
router.post('/logout', ctrl.logout);
router.get('/me', protect, ctrl.me);
router.get('/session', optionalAuth, ctrl.session);

router.put(
  '/change-password',
  protect,
  [
    body('currentPassword').isString().notEmpty().withMessage('Current password is required'),
    strongPassword('newPassword'),
    body('newPassword')
      .custom((v, { req }) => v !== req.body.currentPassword)
      .withMessage('New password must be different from the current password'),
  ],
  validate,
  ctrl.changePassword
);

router.post('/forgot-password', passwordResetLimiter, [emailRule], validate, ctrl.forgotPassword);
router.post(
  '/reset-password',
  passwordResetLimiter,
  [body('token').isString().isLength({ min: 32, max: 128 }).withMessage('Invalid reset token'), strongPassword('password')],
  validate,
  ctrl.resetPassword
);

module.exports = router;
