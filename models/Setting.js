const mongoose = require('mongoose');

/** Singleton document holding platform-wide settings managed by administrators. */
const settingSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'platform', unique: true, immutable: true },
    siteName: { type: String, trim: true, maxlength: 100, default: 'JobConnect Rwanda' },
    tagline: { type: String, trim: true, maxlength: 200, default: 'Connecting job seekers with local employment opportunities' },
    contactEmail: { type: String, trim: true, lowercase: true, maxlength: 150, default: 'support@jobconnect.rw' },
    contactPhone: { type: String, trim: true, maxlength: 30, default: '+250 788 000 000' },
    contactAddress: { type: String, trim: true, maxlength: 200, default: 'KG 7 Ave, Kigali, Rwanda' },
    allowSeekerRegistration: { type: Boolean, default: true },
    allowEmployerRegistration: { type: Boolean, default: true },
    maxActiveJobsPerEmployer: { type: Number, min: 1, max: 1000, default: 50 },
    featuredJobsLimit: { type: Number, min: 1, max: 24, default: 6 },
    maintenanceMessage: { type: String, trim: true, maxlength: 300, default: '' },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

settingSchema.statics.getSettings = async function getSettings() {
  return this.findOneAndUpdate({ key: 'platform' }, { $setOnInsert: { key: 'platform' } }, { upsert: true, returnDocument: 'after' });
};

module.exports = mongoose.model('Setting', settingSchema);
