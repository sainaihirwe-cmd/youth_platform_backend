const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/categoryController');
const { protect, optionalAuth } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/roleMiddleware');
const { validate, mongoIdParam } = require('../middleware/validationMiddleware');

const rules = (partial) => [
  (partial ? body('name').optional() : body('name'))
    .trim()
    .isLength({ min: 2, max: 80 })
    .withMessage('Category name must be between 2 and 80 characters'),
  body('description').optional().isString().isLength({ max: 500 }).withMessage('Description is too long'),
  body('icon').optional().isString().matches(/^[A-Za-z0-9]{1,50}$/).withMessage('Icon must be a Lucide icon name'),
  body('isActive').optional().isBoolean().withMessage('isActive must be true or false').toBoolean(),
];

router.get('/', optionalAuth, ctrl.getCategories);
router.post('/', protect, authorize('admin'), rules(false), validate, ctrl.createCategory);
router.put('/:id', protect, authorize('admin'), [mongoIdParam('id'), ...rules(true)], validate, ctrl.updateCategory);
router.delete('/:id', protect, authorize('admin'), [mongoIdParam('id')], validate, ctrl.deleteCategory);

module.exports = router;
