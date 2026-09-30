const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { ROLES, LOCATIONS } = require('../config/constants');

const educationSchema = new mongoose.Schema(
  {
    institution: { type: String, trim: true, required: true, maxlength: 150 },
    qualification: { type: String, trim: true, maxlength: 150 },
    fieldOfStudy: { type: String, trim: true, maxlength: 150 },
    startYear: { type: Number, min: 1950, max: 2100 },
    endYear: { type: Number, min: 1950, max: 2100 },
  },
  { _id: true }
);

const experienceSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true, required: true, maxlength: 150 },
    company: { type: String, trim: true, maxlength: 150 },
    location: { type: String, trim: true, maxlength: 100 },
    startDate: { type: Date },
    endDate: { type: Date },
    current: { type: Boolean, default: false },
    description: { type: String, trim: true, maxlength: 1500 },
  },
  { _id: true }
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Name is required'], trim: true, minlength: 2, maxlength: 100 },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid email address'],
    },
    password: { type: String, required: true, minlength: 8, select: false },
    phone: { type: String, trim: true, maxlength: 20 },
    location: { type: String, trim: true, enum: { values: [...LOCATIONS, ''], message: 'Invalid location' } },
    role: {
      type: String,
      enum: Object.values(ROLES),
      default: ROLES.JOB_SEEKER,
      required: true,
    },
    profileImage: { type: String, default: '' },
    skills: {
      type: [{ type: String, trim: true, maxlength: 50 }],
      validate: [(v) => v.length <= 50, 'A maximum of 50 skills is allowed'],
    },
    education: { type: [educationSchema], default: [] },
    experience: { type: [experienceSchema], default: [] },
    professionalSummary: { type: String, trim: true, maxlength: 2000, default: '' },
    resumeUrl: { type: String, default: '' },
    resumeOriginalName: { type: String, default: '' },
    resumeUploadedAt: { type: Date },
    isVerified: { type: Boolean, default: false },
    isSuspended: { type: Boolean, default: false },
    suspendedReason: { type: String, trim: true, maxlength: 500 },
    lastLoginAt: { type: Date },
    passwordChangedAt: { type: Date },
    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        delete ret.password;
        delete ret.passwordResetToken;
        delete ret.passwordResetExpires;
        delete ret.__v;
        return ret;
      },
    },
  }
);

userSchema.index({ role: 1, createdAt: -1 });
userSchema.index({ isSuspended: 1 });
userSchema.index({ name: 'text', email: 'text' });

userSchema.pre('save', async function hashPassword() {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 12);
  if (!this.isNew) this.passwordChangedAt = new Date(Date.now() - 1000);
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

/** True if the password was changed after the JWT was issued (iat in seconds). */
userSchema.methods.changedPasswordAfter = function changedPasswordAfter(jwtIat) {
  if (!this.passwordChangedAt) return false;
  return Math.floor(this.passwordChangedAt.getTime() / 1000) > jwtIat;
};

userSchema.methods.createPasswordResetToken = function createPasswordResetToken() {
  const token = crypto.randomBytes(32).toString('hex');
  this.passwordResetToken = crypto.createHash('sha256').update(token).digest('hex');
  this.passwordResetExpires = new Date(Date.now() + 30 * 60 * 1000);
  return token;
};

module.exports = mongoose.model('User', userSchema);
