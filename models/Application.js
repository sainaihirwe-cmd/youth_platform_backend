const mongoose = require('mongoose');
const { APPLICATION_STATUSES } = require('../config/constants');

const applicationSchema = new mongoose.Schema(
  {
    jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true },
    applicantId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    employerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    coverLetter: {
      type: String,
      required: [true, 'Cover letter is required'],
      trim: true,
      minlength: [30, 'Cover letter must be at least 30 characters'],
      maxlength: 5000,
    },
    resumeUrl: { type: String, default: '' },
    resumeOriginalName: { type: String, default: '' },
    status: { type: String, enum: APPLICATION_STATUSES, default: 'pending' },
    employerNotes: { type: String, trim: true, maxlength: 1000, default: '' },
    statusChangedAt: { type: Date },
  },
  { timestamps: { createdAt: 'appliedAt', updatedAt: 'updatedAt' }, toJSON: { versionKey: false } }
);

applicationSchema.index({ jobId: 1, applicantId: 1 }, { unique: true });
applicationSchema.index({ applicantId: 1, appliedAt: -1 });
applicationSchema.index({ employerId: 1, status: 1, appliedAt: -1 });
applicationSchema.index({ jobId: 1, status: 1 });

module.exports = mongoose.model('Application', applicationSchema);
