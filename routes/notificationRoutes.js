const router = require('express').Router();
const ctrl = require('../controllers/notificationController');
const { protect } = require('../middleware/authMiddleware');
const { validate, mongoIdParam } = require('../middleware/validationMiddleware');

router.use(protect);

router.get('/', ctrl.getNotifications);
router.get('/unread-count', ctrl.getUnreadCount);
router.patch('/read-all', ctrl.markAllAsRead);
router.patch('/:id/read', [mongoIdParam('id')], validate, ctrl.markAsRead);
router.delete('/:id', [mongoIdParam('id')], validate, ctrl.deleteNotification);

module.exports = router;
