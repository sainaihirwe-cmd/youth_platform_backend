/**
 * DEVELOPMENT ONLY - inserts clearly labelled sample data so the UI can be explored locally.
 * Every sample job title starts with "[SAMPLE]" and every sample company name ends with "(Sample)".
 * These are NOT real employers or real job opportunities.
 *
 * Usage:   npm run seed:sample            (adds sample data)
 *          npm run seed:sample -- --clean (removes all sample data)
 *
 * Sample account password: taken from SAMPLE_USER_PASSWORD, or a random one is generated and printed.
 * The script refuses to run when NODE_ENV=production.
 */
const crypto = require('crypto');
const { env, assertRequiredEnv } = require('../config/env');
const { connectDB, disconnectDB } = require('../config/db');
const { ensureDefaultCategories } = require('./seedCategories');
const { deleteUserCascade } = require('../services/cleanupService');
const User = require('../models/User');
const EmployerProfile = require('../models/EmployerProfile');
const JobCategory = require('../models/JobCategory');
const Job = require('../models/Job');
const Application = require('../models/Application');
const SavedJob = require('../models/SavedJob');
const Notification = require('../models/Notification');

const SAMPLE_DOMAIN = 'sample.jobconnect.test';

const EMPLOYERS = [
  { name: 'Sample Employer One', email: `employer1@${SAMPLE_DOMAIN}`, company: 'Kigali Tech Hub (Sample)', industry: 'Technology', location: 'Gasabo' },
  { name: 'Sample Employer Two', email: `employer2@${SAMPLE_DOMAIN}`, company: 'Lake Kivu Hospitality (Sample)', industry: 'Hospitality', location: 'Rubavu' },
  { name: 'Sample Employer Three', email: `employer3@${SAMPLE_DOMAIN}`, company: 'Green Hills Farms (Sample)', industry: 'Agriculture', location: 'Musanze' },
];

const SEEKERS = [
  { name: 'Sample Seeker One', email: `seeker1@${SAMPLE_DOMAIN}`, location: 'Kicukiro', skills: ['JavaScript', 'React', 'Customer Service'] },
  { name: 'Sample Seeker Two', email: `seeker2@${SAMPLE_DOMAIN}`, location: 'Huye', skills: ['Teaching', 'Mathematics', 'Kinyarwanda'] },
];

const JOBS = [
  ['Technology and IT', 0, 'Junior Web Developer', 'Gasabo', 'full_time', 300000, 500000, 'monthly', ['JavaScript', 'React', 'Git']],
  ['Technology and IT', 0, 'IT Support Intern', 'Nyarugenge', 'internship', 80000, 120000, 'monthly', ['Networking', 'Windows', 'Troubleshooting']],
  ['Customer Service', 0, 'Part-time Call Centre Agent', 'Kicukiro', 'part_time', 3000, 4000, 'hourly', ['Communication', 'Kinyarwanda', 'English']],
  ['Hospitality and Tourism', 1, 'Weekend Waiter / Waitress', 'Rubavu', 'part_time', 8000, 10000, 'daily', ['Customer Service', 'French']],
  ['Hospitality and Tourism', 1, 'Hotel Receptionist', 'Rubavu', 'full_time', 200000, 250000, 'monthly', ['English', 'French', 'Customer Service']],
  ['Events and Temporary Jobs', 1, 'Event Ushers for Conference', 'Kigali', 'temporary', 15000, 20000, 'daily', ['Punctuality', 'Communication']],
  ['Agriculture', 2, 'Seasonal Farm Workers', 'Musanze', 'temporary', 3000, 3500, 'daily', ['Farming', 'Teamwork']],
  ['Agriculture', 2, 'Agronomist Assistant', 'Northern Province', 'contract', 250000, 350000, 'monthly', ['Agronomy', 'Data Collection']],
  ['Transport and Delivery', 2, 'Moto Delivery Rider', 'Gasabo', 'freelance', 2000, 5000, 'fixed', ['Driving Licence A', 'Navigation']],
  ['Education and Tutoring', 0, 'Mathematics Tutor (Evenings)', 'Huye', 'part_time', 5000, 7000, 'hourly', ['Mathematics', 'Teaching']],
];

async function clean() {
  const users = await User.find({ email: new RegExp(`@${SAMPLE_DOMAIN.replace(/\./g, '\\.')}$`) });
  for (const u of users) await deleteUserCascade(u);
  console.log(`Removed ${users.length} sample accounts and their related data.`);
}

async function seed() {
  await ensureDefaultCategories();
  const password = process.env.SAMPLE_USER_PASSWORD || `Sample!${crypto.randomBytes(6).toString('hex')}A1`;
  const categories = Object.fromEntries((await JobCategory.find()).map((c) => [c.name, c._id]));

  await clean();

  const employerUsers = [];
  for (const e of EMPLOYERS) {
    const user = await User.create({ name: e.name, email: e.email, password, role: 'employer', location: e.location, phone: '+250 788 000 001' });
    await EmployerProfile.create({
      userId: user._id,
      companyName: e.company,
      industry: e.industry,
      location: e.location,
      contactEmail: e.email,
      description: `${e.company} is SAMPLE DATA created for local development and testing. It is not a real business.`,
      verificationStatus: 'verified',
    });
    employerUsers.push(user);
  }

  const seekerUsers = [];
  for (const s of SEEKERS) {
    seekerUsers.push(
      await User.create({
        name: s.name,
        email: s.email,
        password,
        role: 'job_seeker',
        location: s.location,
        skills: s.skills,
        phone: '+250 788 000 002',
        professionalSummary: 'Sample job seeker profile used for development and testing only.',
        education: [{ institution: 'University of Rwanda (sample entry)', qualification: 'Bachelor', fieldOfStudy: 'General Studies', startYear: 2019, endYear: 2023 }],
      })
    );
  }

  const jobs = [];
  for (const [i, [cat, empIdx, title, location, jobType, min, max, paymentType, skills]] of JOBS.entries()) {
    const job = await Job.create({
      employerId: employerUsers[empIdx]._id,
      title: `[SAMPLE] ${title}`,
      description: `This is a SAMPLE job posting for development and testing. It is not a real opportunity.\n\nThe ${title.toLowerCase()} role involves day-to-day duties typical for this kind of work in ${location}.`,
      category: categories[cat],
      location,
      jobType,
      salary: { min, max, currency: 'RWF' },
      paymentType,
      requirements: ['Sample requirement: relevant experience or willingness to learn', 'Sample requirement: good communication skills'],
      responsibilities: ['Sample responsibility: perform assigned tasks', 'Sample responsibility: report to the supervisor'],
      skillsRequired: skills,
      vacancies: 1 + (i % 4),
      applicationDeadline: new Date(Date.now() + (10 + i * 3) * 86400000),
      status: 'published',
      isFeatured: i < 3,
    });
    jobs.push(job);
  }

  const app1 = await Application.create({
    jobId: jobs[0]._id,
    applicantId: seekerUsers[0]._id,
    employerId: jobs[0].employerId,
    coverLetter: 'This is a sample cover letter created by the development seed script for testing purposes.',
  });
  await Application.create({
    jobId: jobs[2]._id,
    applicantId: seekerUsers[0]._id,
    employerId: jobs[2].employerId,
    coverLetter: 'Another sample cover letter created by the development seed script for testing purposes.',
    status: 'accepted',
    statusChangedAt: new Date(),
  });
  await SavedJob.create({ userId: seekerUsers[0]._id, jobId: jobs[3]._id });
  await Notification.create({
    userId: employerUsers[0]._id,
    title: 'New application received',
    message: `${seekerUsers[0].name} applied for "${jobs[0].title}".`,
    type: 'new_application',
    relatedJobId: jobs[0]._id,
    relatedApplicationId: app1._id,
    link: `/employer/jobs/${jobs[0]._id}/applications`,
  });

  console.log('\nSample data created (development only):');
  console.log(`  Employers: ${EMPLOYERS.map((e) => e.email).join(', ')}`);
  console.log(`  Job seekers: ${SEEKERS.map((s) => s.email).join(', ')}`);
  console.log(`  Password for all sample accounts: ${password}`);
  console.log(`  Jobs: ${jobs.length} (titles prefixed with [SAMPLE])`);
  console.log('Remove it at any time with: npm run seed:sample -- --clean\n');
}

(async () => {
  try {
    if (env.isProduction) throw new Error('Refusing to insert sample data when NODE_ENV=production.');
    assertRequiredEnv();
    await connectDB();
    if (process.argv.includes('--clean')) await clean();
    else await seed();
    await disconnectDB();
    process.exit(0);
  } catch (err) {
    console.error(`Sample data script failed: ${err.message}`);
    await disconnectDB().catch(() => {});
    process.exit(1);
  }
})();
