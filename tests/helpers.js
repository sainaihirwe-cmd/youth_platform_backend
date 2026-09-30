const fs = require('fs/promises');
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../app');
const { connectDB } = require('../config/db');
const { ensureDefaultCategories } = require('../scripts/seedCategories');
const User = require('../models/User');
const JobCategory = require('../models/JobCategory');
const { UPLOAD_ROOT } = require('../services/storageService');

const PASSWORD = 'Str0ng!Pass';

async function setupDatabase() {
  // Each test file gets its own database so files can never interfere with each other
  const base = process.env.MONGO_URI_TEST;
  const suffix = `_${process.env.JEST_WORKER_ID || 1}_${Math.random().toString(36).slice(2, 8)}`;
  const url = new URL(base.replace('mongodb+srv://', 'mongodb://'));
  const dbName = url.pathname.replace('/', '') + suffix;
  const uri = base.replace(/\/([^/?]+)(\?|$)/, `/${dbName}$2`);
  await connectDB(uri);
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  await ensureDefaultCategories();
}

async function teardownDatabase() {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await fs.rm(UPLOAD_ROOT, { recursive: true, force: true });
}

let counter = 0;
/** Registers a user through the API and returns a logged-in supertest agent. */
async function registerAgent(role = 'job_seeker', overrides = {}) {
  counter += 1;
  const agent = request.agent(app);
  const body = {
    name: `${role} user ${counter}`,
    email: `${role}${counter}_${Date.now()}@example.com`,
    password: PASSWORD,
    role,
    ...(role === 'employer' ? { companyName: `Company ${counter}` } : {}),
    ...overrides,
  };
  const res = await agent.post('/api/auth/register').send(body);
  if (res.status !== 201) throw new Error(`Registration failed: ${res.status} ${JSON.stringify(res.body)}`);
  const login = await agent.post('/api/auth/login').send({ email: body.email, password: body.password });
  if (login.status !== 200) throw new Error(`Login failed: ${login.status} ${JSON.stringify(login.body)}`);
  return { agent, user: res.body.data.user, credentials: { email: body.email, password: body.password } };
}

async function createAdminAgent() {
  counter += 1;
  const email = `admin${counter}_${Date.now()}@example.com`;
  await User.create({ name: 'Test Admin', email, password: PASSWORD, role: 'admin' });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/admin/login').send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`Admin login failed: ${res.status}`);
  return { agent, user: res.body.data.user };
}

async function categoryId(name = 'Technology and IT') {
  const c = await JobCategory.findOne({ name });
  return c._id.toString();
}

function futureDate(days = 14) {
  return new Date(Date.now() + days * 86400000).toISOString();
}

async function jobPayload(overrides = {}) {
  return {
    title: 'Junior Web Developer',
    description: 'Build and maintain web applications for local clients in Kigali.',
    category: await categoryId(),
    location: 'Gasabo',
    jobType: 'full_time',
    salary: { min: 300000, max: 500000, currency: 'RWF' },
    paymentType: 'monthly',
    requirements: ['Knowledge of JavaScript'],
    responsibilities: ['Write clean code'],
    skillsRequired: ['JavaScript', 'React'],
    vacancies: 2,
    applicationDeadline: futureDate(),
    ...overrides,
  };
}

async function createJob(employerAgent, overrides = {}) {
  const res = await employerAgent.post('/api/jobs').send(await jobPayload(overrides));
  if (res.status !== 201) throw new Error(`Job creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.job;
}

module.exports = {
  app,
  request,
  PASSWORD,
  setupDatabase,
  teardownDatabase,
  registerAgent,
  createAdminAgent,
  categoryId,
  futureDate,
  jobPayload,
  createJob,
};
