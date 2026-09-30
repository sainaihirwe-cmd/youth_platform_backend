const mongoose = require('mongoose');

const jobCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Category name is required'], trim: true, unique: true, maxlength: 80 },
    slug: { type: String, trim: true, lowercase: true, unique: true },
    description: { type: String, trim: true, maxlength: 500, default: '' },
    icon: { type: String, trim: true, maxlength: 50, default: 'Briefcase' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

function slugify(name = '') {
  return String(name)
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

jobCategorySchema.pre('validate', function setSlug() {
  if (this.isModified('name') || !this.slug) this.slug = slugify(this.name);
});

jobCategorySchema.statics.slugify = slugify;

jobCategorySchema.index({ isActive: 1, name: 1 });

module.exports = mongoose.model('JobCategory', jobCategorySchema);
