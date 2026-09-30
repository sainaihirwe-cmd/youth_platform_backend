const { app, request, setupDatabase, teardownDatabase, registerAgent, createAdminAgent, categoryId, jobPayload, createJob, futureDate } = require('./helpers');
const Job = require('../models/Job');
const User = require('../models/User');

beforeAll(setupDatabase);
afterAll(teardownDatabase);

describe('Job CRUD', () => {
  let employer;
  let otherEmployer;
  beforeAll(async () => {
    employer = await registerAgent('employer');
    otherEmployer = await registerAgent('employer');
  });

  it('allows employers to create jobs with validation', async () => {
    const res = await employer.agent.post('/api/jobs').send(await jobPayload());
    expect(res.status).toBe(201);
    expect(res.body.data.job.status).toBe('published');
    expect(res.body.data.job.province).toBe('Kigali');
    expect(res.body.data.job.employerId).toBe(employer.user._id);
  });

  it('rejects invalid job data', async () => {
    const res = await employer.agent.post('/api/jobs').send({ title: 'x', location: 'Atlantis' });
    expect(res.status).toBe(400);
    expect(res.body.errors.length).toBeGreaterThan(0);

    const past = await employer.agent.post('/api/jobs').send(await jobPayload({ applicationDeadline: '2020-01-01' }));
    expect(past.status).toBe(400);

    const salary = await employer.agent.post('/api/jobs').send(await jobPayload({ salary: { min: 500, max: 100 } }));
    expect(salary.status).toBe(400);
  });

  it('does not let job seekers post jobs', async () => {
    const seeker = await registerAgent('job_seeker');
    await seeker.agent.post('/api/jobs').send(await jobPayload()).expect(403);
  });

  it('ignores an employerId supplied in the body', async () => {
    const res = await employer.agent.post('/api/jobs').send(await jobPayload({ employerId: otherEmployer.user._id }));
    expect(res.body.data.job.employerId).toBe(employer.user._id);
  });

  it('lets the owner update, close and delete their job', async () => {
    const job = await createJob(employer.agent);
    const upd = await employer.agent.put(`/api/jobs/${job._id}`).send({ title: 'Senior Web Developer', vacancies: 3 });
    expect(upd.status).toBe(200);
    expect(upd.body.data.job.title).toBe('Senior Web Developer');
    expect(upd.body.data.job.vacancies).toBe(3);

    const closed = await employer.agent.patch(`/api/jobs/${job._id}/status`).send({ status: 'closed' });
    expect(closed.body.data.job.status).toBe('closed');

    await employer.agent.delete(`/api/jobs/${job._id}`).expect(200);
    expect(await Job.findById(job._id)).toBeNull();
  });

  it('prevents employers from modifying jobs they do not own', async () => {
    const job = await createJob(employer.agent);
    await otherEmployer.agent.put(`/api/jobs/${job._id}`).send({ title: 'Hijacked' }).expect(403);
    await otherEmployer.agent.patch(`/api/jobs/${job._id}/status`).send({ status: 'closed' }).expect(403);
    await otherEmployer.agent.delete(`/api/jobs/${job._id}`).expect(403);
    await otherEmployer.agent.get(`/api/employer/jobs/${job._id}/applications`).expect(403);
    const fresh = await Job.findById(job._id);
    expect(fresh.title).toBe('Junior Web Developer');
  });

  it('lists only the employer’s own jobs on the employer dashboard', async () => {
    const res = await otherEmployer.agent.get('/api/employer/jobs');
    expect(res.status).toBe(200);
    res.body.data.forEach((j) => expect(j.employerId).toBe(otherEmployer.user._id));
  });

  it('saves drafts that are not publicly visible', async () => {
    const job = await createJob(employer.agent, { status: 'draft', title: 'Hidden Draft Role' });
    expect(job.status).toBe('draft');
    await request(app).get(`/api/jobs/${job._id}`).expect(404);
    const list = await request(app).get('/api/jobs').query({ q: 'Hidden Draft' });
    expect(list.body.data).toHaveLength(0);
    // the owner can still view it
    await employer.agent.get(`/api/jobs/${job._id}`).expect(200);
  });
});

describe('Job search and filters', () => {
  let employer;
  beforeAll(async () => {
    employer = await registerAgent('employer', { companyName: 'Inzozi Hospitality' });
    await createJob(employer.agent, { title: 'Hotel Receptionist', location: 'Rubavu', jobType: 'full_time', category: await categoryId('Hospitality and Tourism'), salary: { min: 150000, max: 200000 }, skillsRequired: ['French'] });
    await createJob(employer.agent, { title: 'Weekend Waiter', location: 'Musanze', jobType: 'part_time', category: await categoryId('Hospitality and Tourism'), salary: { min: 5000, max: 8000 }, paymentType: 'daily' });
    await createJob(employer.agent, { title: 'Farm Assistant', location: 'Nyagatare', jobType: 'temporary', category: await categoryId('Agriculture'), salary: { min: 3000, max: 4000 }, paymentType: 'daily' });
    const expired = await createJob(employer.agent, { title: 'Expired Farm Job', category: await categoryId('Agriculture'), location: 'Nyagatare' });
    await Job.updateOne({ _id: expired._id }, { applicationDeadline: new Date(Date.now() - 86400000) });
    const removed = await createJob(employer.agent, { title: 'Removed Farm Job', category: await categoryId('Agriculture'), location: 'Nyagatare' });
    await Job.updateOne({ _id: removed._id }, { status: 'removed' });
  });

  it('searches by keyword across title, skills and employer name', async () => {
    const byTitle = await request(app).get('/api/jobs').query({ q: 'receptionist' });
    expect(byTitle.body.data.map((j) => j.title)).toEqual(['Hotel Receptionist']);
    const bySkill = await request(app).get('/api/jobs').query({ q: 'french' });
    expect(bySkill.body.data.map((j) => j.title)).toContain('Hotel Receptionist');
    const byCompany = await request(app).get('/api/jobs').query({ q: 'Inzozi' });
    expect(byCompany.body.data.length).toBe(3);
    expect(byCompany.body.data[0].employer.companyName).toBe('Inzozi Hospitality');
  });

  it('filters by location (district or province), category, type and salary', async () => {
    const district = await request(app).get('/api/jobs').query({ location: 'Rubavu' });
    expect(district.body.data.map((j) => j.title)).toEqual(['Hotel Receptionist']);
    const province = await request(app).get('/api/jobs').query({ location: 'Eastern Province' });
    expect(province.body.data.map((j) => j.title)).toEqual(['Farm Assistant']);
    const category = await request(app).get('/api/jobs').query({ category: 'hospitality-and-tourism' });
    expect(category.body.data).toHaveLength(2);
    const type = await request(app).get('/api/jobs').query({ jobType: 'part_time,temporary' });
    expect(type.body.data.map((j) => j.title).sort()).toEqual(['Farm Assistant', 'Weekend Waiter']);
    const salary = await request(app).get('/api/jobs').query({ minSalary: 100000, category: 'hospitality-and-tourism' });
    expect(salary.body.data.map((j) => j.title)).toEqual(['Hotel Receptionist']);
  });

  it('never returns expired or removed jobs publicly', async () => {
    const res = await request(app).get('/api/jobs').query({ q: 'Farm', limit: 50 });
    const titles = res.body.data.map((j) => j.title);
    expect(titles).toContain('Farm Assistant');
    expect(titles).not.toContain('Expired Farm Job');
    expect(titles).not.toContain('Removed Farm Job');
  });

  it('sorts and paginates', async () => {
    const newest = await request(app).get('/api/jobs').query({ q: 'Inzozi', sort: 'newest', limit: 2 });
    expect(newest.body.pagination).toMatchObject({ page: 1, limit: 2, total: 3, pages: 2 });
    expect(newest.body.data[0].title).toBe('Farm Assistant');
    const oldest = await request(app).get('/api/jobs').query({ q: 'Inzozi', sort: 'oldest' });
    expect(oldest.body.data[0].title).toBe('Hotel Receptionist');
    const page2 = await request(app).get('/api/jobs').query({ q: 'Inzozi', sort: 'newest', limit: 2, page: 2 });
    expect(page2.body.data).toHaveLength(1);
  });

  it('ranks title matches first when sorting by relevance', async () => {
    await createJob(employer.agent, { title: 'Cleaner', description: 'Cleaning duties at a busy receptionist area in a hotel lobby.' });
    const res = await request(app).get('/api/jobs').query({ q: 'receptionist', sort: 'relevance' });
    expect(res.body.data[0].title).toBe('Hotel Receptionist');
    expect(res.body.data[0].relevance).toBeGreaterThan(res.body.data[1].relevance);
  });

  it('hides jobs of suspended employers', async () => {
    const suspended = await registerAgent('employer');
    await createJob(suspended.agent, { title: 'Suspicious Opportunity' });
    await User.updateOne({ _id: suspended.user._id }, { isSuspended: true });
    const res = await request(app).get('/api/jobs').query({ q: 'Suspicious' });
    expect(res.body.data).toHaveLength(0);
  });

  it('returns featured and related jobs, and details with employer info', async () => {
    const featured = await request(app).get('/api/jobs/featured');
    expect(featured.status).toBe(200);
    expect(featured.body.data.length).toBeGreaterThan(0);

    const job = (await request(app).get('/api/jobs').query({ q: 'Weekend Waiter' })).body.data[0];
    const detail = await request(app).get(`/api/jobs/${job._id}`);
    expect(detail.body.data.job.description).toBeDefined();
    expect(detail.body.data.employer.companyName).toBe('Inzozi Hospitality');
    expect(detail.body.data.isOpen).toBe(true);

    const related = await request(app).get(`/api/jobs/${job._id}/related`);
    expect(related.body.data.map((j) => j.title)).toContain('Hotel Receptionist');
    expect(related.body.data.map((j) => j._id)).not.toContain(job._id);
  });

  it('handles invalid and missing job ids', async () => {
    await request(app).get('/api/jobs/not-an-id').expect(400);
    await request(app).get('/api/jobs/64b000000000000000000000').expect(404);
  });
});

describe('Categories', () => {
  it('lists active categories publicly and restricts management to admins', async () => {
    const res = await request(app).get('/api/categories');
    expect(res.body.data.length).toBeGreaterThanOrEqual(12);
    const { agent } = await createAdminAgent();
    const created = await agent.post('/api/categories').send({ name: 'Healthcare', icon: 'HeartPulse' });
    expect(created.status).toBe(201);
    await agent.post('/api/categories').send({ name: 'healthcare' }).expect(409);
    await agent.put(`/api/categories/${created.body.data.category._id}`).send({ isActive: false }).expect(200);
    const after = await request(app).get('/api/categories');
    expect(after.body.data.map((c) => c.name)).not.toContain('Healthcare');
    await agent.delete(`/api/categories/${created.body.data.category._id}`).expect(200);
  });

  it('refuses to delete a category that is in use', async () => {
    const employer = await registerAgent('employer');
    await createJob(employer.agent, { category: await categoryId('Construction'), applicationDeadline: futureDate(5) });
    const { agent } = await createAdminAgent();
    await agent.delete(`/api/categories/${await categoryId('Construction')}`).expect(409);
  });
});
