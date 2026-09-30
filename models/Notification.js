const mongoose = require('mongoose');
const { NOTIFICATION_TYPES } = require('../config/constants');

const notificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    message: { type: String, required: true, trim: true, maxlength: 1000 },
    type: { type: String, enum: NOTIFICATION_TYPES, default: 'system' },
    link: { type: String, trim: true, maxlength: 300, default: '' },
    relatedJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job' },
    relatedApplicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application' },
    isRead: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false }, toJSON: { versionKey: false } }
);

notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
