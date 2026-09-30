const mongoose = require('mongoose');
const { VERIFICATION_STATUSES, LOCATIONS } = require('../config/constants');

const employerProfileSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    companyName: { type: String, required: [true, 'Company or employer name is required'], trim: true, maxlength: 150 },
    companyLogo: { type: String, default: '' },
    description: { type: String, trim: true, maxlength: 3000, default: '' },
    industry: { type: String, trim: true, maxlength: 100, default: '' },
    location: { type: String, trim: true, enum: { values: [...LOCATIONS, ''], message: 'Invalid location' }, default: '' },
    phone: { type: String, trim: true, maxlength: 20, default: '' },
    contactEmail: {
      type: String,
      trim: true,
      lowercase: true,
      match: [/^$|^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid contact email'],
      default: '',
    },
    website: {
      type: String,
      trim: true,
      match: [/^$|^https?:\/\/[^\s]+$/i, 'Website must start with http:// or https://'],
      default: '',
    },
    verificationStatus: { type: String, enum: VERIFICATION_STATUSES, default: 'pending' },
    verificationNotes: { type: String, trim: true, maxlength: 1000 },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

employerProfileSchema.index({ companyName: 1 });
employerProfileSchema.index({ verificationStatus: 1 });

module.exports = mongoose.model('EmployerProfile', employerProfileSchema);
