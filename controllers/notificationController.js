const Notification = require('../models/Notification');
const ApiError = require('../utils/ApiError');
const { sendSuccess, parsePagination, buildPagination } = require('../utils/apiResponse');

// GET /api/notifications
exports.getNotifications = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 20 });
  const filter = { userId: req.user._id };
  if (req.query.unread === 'true') filter.isRead = false;
  const [items, total, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Notification.countDocuments(filter),
    Notification.countDocuments({ userId: req.user._id, isRead: false }),
  ]);
  return sendSuccess(res, { data: { notifications: items, unreadCount }, pagination: buildPagination(page, limit, total) });
};

// GET /api/notifications/unread-count
exports.getUnreadCount = async (req, res) => {
  const unreadCount = await Notification.countDocuments({ userId: req.user._id, isRead: false });
  return sendSuccess(res, { data: { unreadCount } });
};

// PATCH /api/notifications/:id/read
exports.markAsRead = async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, userId: req.user._id },
    { isRead: true },
    { returnDocument: 'after' }
  );
  if (!notification) throw ApiError.notFound('Notification not found.');
  return sendSuccess(res, { data: { notification } });
};

// PATCH /api/notifications/read-all
exports.markAllAsRead = async (req, res) => {
  const result = await Notification.updateMany({ userId: req.user._id, isRead: false }, { isRead: true });
  return sendSuccess(res, { message: 'All notifications marked as read', data: { updated: result.modifiedCount } });
};

// DELETE /api/notifications/:id
exports.deleteNotification = async (req, res) => {
  const result = await Notification.deleteOne({ _id: req.params.id, userId: req.user._id });
  if (!result.deletedCount) throw ApiError.notFound('Notification not found.');
  return sendSuccess(res, { message: 'Notification deleted' });
};
