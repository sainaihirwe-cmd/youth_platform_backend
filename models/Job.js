const mongoose = require('mongoose');
const { JOB_TYPES, JOB_STATUSES, PAYMENT_TYPES, LOCATIONS, provinceOf } = require('../config/constants');

const jobSchema = new mongoose.Schema(
  {
    employerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: [true, 'Job title is required'], trim: true, minlength: 3, maxlength: 150 },
    description: { type: String, required: [true, 'Job description is required'], trim: true, minlength: 20, maxlength: 10000 },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'JobCategory', required: [true, 'Category is required'] },
    location: { type: String, required: [true, 'Location is required'], enum: { values: LOCATIONS, message: 'Invalid location' } },
    province: { type: String },
    address: { type: String, trim: true, maxlength: 200, default: '' },
    jobType: { type: String, required: [true, 'Job type is required'], enum: JOB_TYPES },
    salary: {
      min: { type: Number, min: 0 },
      max: { type: Number, min: 0 },
      currency: { type: String, default: 'RWF', enum: ['RWF', 'USD'] },
    },
    paymentType: { type: String, enum: PAYMENT_TYPES, default: 'monthly' },
    paymentDetails: { type: String, trim: true, maxlength: 500, default: '' },
    requirements: { type: [{ type: String, trim: true, maxlength: 300 }], default: [] },
    responsibilities: { type: [{ type: String, trim: true, maxlength: 300 }], default: [] },
    skillsRequired: { type: [{ type: String, trim: true, maxlength: 50 }], default: [] },
    vacancies: { type: Number, min: 1, max: 1000, default: 1 },
    applicationDeadline: { type: Date, required: [true, 'Application deadline is required'] },
    status: { type: String, enum: JOB_STATUSES, default: 'published' },
    isFeatured: { type: Boolean, default: false },
    views: { type: Number, default: 0 },
    publishedAt: { type: Date },
    removedReason: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

jobSchema.path('salary.max').validate(function validateMax(value) {
  const min = this.salary?.min ?? (typeof this.get === 'function' ? this.get('salary.min') : undefined);
  return value == null || min == null || value >= min;
}, 'Maximum salary must be greater than or equal to minimum salary');

jobSchema.pre('save', function setDerived() {
  if (this.isModified('location')) this.province = provinceOf(this.location);
  if (this.isModified('status') && this.status === 'published' && !this.publishedAt) this.publishedAt = new Date();
});

jobSchema.index({ status: 1, applicationDeadline: 1, createdAt: -1 });
jobSchema.index({ employerId: 1, status: 1, createdAt: -1 });
jobSchema.index({ category: 1, status: 1 });
jobSchema.index({ location: 1 });
jobSchema.index({ province: 1 });
jobSchema.index({ jobType: 1 });
jobSchema.index({ 'salary.min': 1, 'salary.max': 1 });
jobSchema.index({ createdAt: -1 });
jobSchema.index({ title: 'text', description: 'text', skillsRequired: 'text', location: 'text' });

/** Filter describing jobs that the public may see and apply to. */
jobSchema.statics.publicFilter = function publicFilter(now = new Date()) {
  return { status: 'published', applicationDeadline: { $gte: now } };
};

jobSchema.methods.isOpenForApplications = function isOpenForApplications(now = new Date()) {
  return this.status === 'published' && this.applicationDeadline >= now;
};

module.exports = mongoose.model('Job', jobSchema);
