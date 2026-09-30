/**
 * Seeds the default job categories for the Rwandan market.
 * Usage: npm run seed:categories
 * Safe to run repeatedly: existing categories (matched by name) are left untouched.
 */
const JobCategory = require('../models/JobCategory');

const DEFAULT_CATEGORIES = [
  { name: 'Technology and IT', icon: 'Laptop', description: 'Software, IT support, networking, data and digital roles.' },
  { name: 'Sales and Marketing', icon: 'Megaphone', description: 'Sales agents, marketing, promotions and business development.' },
  { name: 'Hospitality and Tourism', icon: 'Hotel', description: 'Hotels, restaurants, tour guiding and travel services.' },
  { name: 'Construction', icon: 'HardHat', description: 'Masonry, carpentry, plumbing, electrical and site work.' },
  { name: 'Education and Tutoring', icon: 'GraduationCap', description: 'Teaching, private tutoring and training.' },
  { name: 'Agriculture', icon: 'Sprout', description: 'Farming, agribusiness, livestock and agro-processing.' },
  { name: 'Transport and Delivery', icon: 'Truck', description: 'Drivers, moto delivery, logistics and courier services.' },
  { name: 'Customer Service', icon: 'Headphones', description: 'Call centres, front desk, client support and reception.' },
  { name: 'Administration', icon: 'ClipboardList', description: 'Office administration, secretarial and data entry work.' },
  { name: 'Domestic Work', icon: 'Home', description: 'Housekeeping, childcare, cooking and gardening.' },
  { name: 'Events and Temporary Jobs', icon: 'CalendarDays', description: 'Event staff, ushers, promoters and short-term gigs.' },
  { name: 'Other', icon: 'Briefcase', description: 'Opportunities that do not fit another category.' },
];

async function ensureDefaultCategories() {
  let created = 0;
  for (const cat of DEFAULT_CATEGORIES) {
    const res = await JobCategory.updateOne({ name: cat.name }, { $setOnInsert: { ...cat, slug: JobCategory.slugify(cat.name), isActive: true } }, { upsert: true });
    if (res.upsertedCount) created += 1;
  }
  return created;
}

if (require.main === module) {
  const { assertRequiredEnv } = require('../config/env');
  const { connectDB, disconnectDB } = require('../config/db');
  (async () => {
    try {
      assertRequiredEnv();
      await connectDB();
      const created = await ensureDefaultCategories();
      console.log(`Categories ready (${created} created, ${DEFAULT_CATEGORIES.length - created} already existed).`);
      await disconnectDB();
      process.exit(0);
    } catch (err) {
      console.error(`Seeding failed: ${err.message}`);
      process.exit(1);
    }
  })();
}

module.exports = { ensureDefaultCategories, DEFAULT_CATEGORIES };
