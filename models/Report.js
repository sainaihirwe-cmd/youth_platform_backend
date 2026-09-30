const mongoose = require('mongoose');
const { REPORT_STATUSES, REPORT_REASONS } = require('../config/constants');

const reportSchema = new mongoose.Schema(
  {
    reporterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reportedJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job' },
    reportedUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reason: { type: String, enum: REPORT_REASONS, required: [true, 'Reason is required'] },
    description: { type: String, trim: true, maxlength: 2000, default: '' },
    status: { type: String, enum: REPORT_STATUSES, default: 'pending' },
    adminNotes: { type: String, trim: true, maxlength: 2000, default: '' },
    actionTaken: { type: String, enum: ['none', 'user_suspended', 'job_removed'], default: 'none' },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

reportSchema.pre('validate', function requireTarget() {
  if (!this.reportedJobId && !this.reportedUserId) {
    this.invalidate('reportedJobId', 'A report must identify a reported job or user');
  }
});

reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ reporterId: 1, createdAt: -1 });
reportSchema.index({ reportedJobId: 1 });
reportSchema.index({ reportedUserId: 1 });

module.exports = mongoose.model('Report', reportSchema);
