const { app, request, setupDatabase, teardownDatabase, registerAgent, createAdminAgent, createJob } = require('./helpers');
const Report = require('../models/Report');
const Job = require('../models/Job');
const User = require('../models/User');

beforeAll(setupDatabase);
afterAll(teardownDatabase);

describe('Reports', () => {
  let employer;
  let seeker;
  let job;
  beforeAll(async () => {
    employer = await registerAgent('employer');
    seeker = await registerAgent('job_seeker');
    job = await createJob(employer.agent, { title: 'Too Good To Be True' });
  });

  it('lets users report jobs and prevents duplicate open reports', async () => {
    const res = await seeker.agent
      .post('/api/reports')
      .send({ reportedJobId: job._id, reason: 'scam', description: 'Asks for an upfront registration fee.' });
    expect(res.status).toBe(201);
    expect(res.body.data.report.status).toBe('pending');
    expect(res.body.data.report.reportedUserId).toBe(employer.user._id);
    await seeker.agent.post('/api/reports').send({ reportedJobId: job._id, reason: 'scam' }).expect(409);
    const mine = await seeker.agent.get('/api/reports/my-reports');
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].adminNotes).toBeUndefined();
  });

  it('validates report input', async () => {
    await seeker.agent.post('/api/reports').send({ reason: 'scam' }).expect(400);
    await seeker.agent.post('/api/reports').send({ reportedJobId: job._id, reason: 'not-a-reason' }).expect(400);
    await request(app).post('/api/reports').send({ reportedJobId: job._id, reason: 'scam' }).expect(401);
    await seeker.agent.post('/api/reports').send({ reportedUserId: seeker.user._id, reason: 'spam' }).expect(400);
  });

  it('lets users report accounts', async () => {
    const res = await employer.agent.post('/api/reports').send({ reportedUserId: seeker.user._id, reason: 'suspicious_account' });
    expect(res.status).toBe(201);
  });

  it('enforces the reported-target rule at the model level', async () => {
    await expect(Report.create({ reporterId: seeker.user._id, reason: 'spam' })).rejects.toThrow(/reported job or user/);
  });
});

describe('Administrator permissions and moderation', () => {
  let admin;
  let employer;
  let seeker;
  beforeAll(async () => {
    admin = await createAdminAgent();
    employer = await registerAgent('employer');
    seeker = await registerAgent('job_seeker');
  });

  it('denies non-admins access to every admin endpoint', async () => {
    const endpoints = [
      ['get', '/api/admin/dashboard'],
      ['get', '/api/admin/analytics'],
      ['get', '/api/admin/users'],
      ['patch', `/api/admin/users/${seeker.user._id}/status`],
      ['get', '/api/admin/jobs'],
      ['get', '/api/admin/reports'],
      ['get', '/api/admin/reports/export'],
      ['get', '/api/admin/settings'],
      ['put', '/api/admin/settings'],
    ];
    for (const [method, url] of endpoints) {
      await request(app)[method](url).send({ isSuspended: true }).expect(401);
      await seeker.agent[method](url).send({ isSuspended: true }).expect(403);
      await employer.agent[method](url).send({ isSuspended: true }).expect(403);
    }
    expect((await User.findById(seeker.user._id)).isSuspended).toBe(false);
  });

  it('returns real dashboard statistics and analytics', async () => {
    const dash = await admin.agent.get('/api/admin/dashboard');
    expect(dash.status).toBe(200);
    expect(dash.body.data.stats.jobSeekers).toBe(await User.countDocuments({ role: 'job_seeker' }));
    expect(dash.body.data.stats.employers).toBe(await User.countDocuments({ role: 'employer' }));
    const analytics = await admin.agent.get('/api/admin/analytics').query({ months: 6 });
    expect(analytics.body.data.userRegistrations).toHaveLength(6);
    expect(analytics.body.data.userRegistrations[5].jobSeekers).toBeGreaterThan(0);
  });

  it('searches and filters users', async () => {
    const res = await admin.agent.get('/api/admin/users').query({ role: 'employer' });
    res.body.data.forEach((u) => expect(u.role).toBe('employer'));
    expect(res.body.data[0].password).toBeUndefined();
    const search = await admin.agent.get('/api/admin/users').query({ q: seeker.credentials.email });
    expect(search.body.data).toHaveLength(1);
  });

  it('suspends and reactivates accounts', async () => {
    await admin.agent.patch(`/api/admin/users/${seeker.user._id}/status`).send({ isSuspended: true, reason: 'Spam' }).expect(200);
    await seeker.agent.get('/api/auth/me').expect(403);
    await admin.agent.patch(`/api/admin/users/${seeker.user._id}/status`).send({ isSuspended: false }).expect(200);
    await seeker.agent.get('/api/auth/me').expect(200);
    await admin.agent.patch(`/api/admin/users/${admin.user._id}/status`).send({ isSuspended: true }).expect(400);
  });

  it('verifies employer profiles', async () => {
    const res = await admin.agent.patch(`/api/admin/users/${employer.user._id}/verification`).send({ verificationStatus: 'verified' });
    expect(res.body.data.employerProfile.verificationStatus).toBe('verified');
  });

  it('removes, restores and features jobs', async () => {
    const job = await createJob(employer.agent);
    await admin.agent.patch(`/api/admin/jobs/${job._id}/moderate`).send({ action: 'feature' }).expect(200);
    expect((await Job.findById(job._id)).isFeatured).toBe(true);
    await admin.agent.patch(`/api/admin/jobs/${job._id}/moderate`).send({ action: 'remove', reason: 'Misleading' }).expect(200);
    await request(app).get(`/api/jobs/${job._id}`).expect(404);
    await employer.agent.put(`/api/jobs/${job._id}`).send({ title: 'Try to edit' }).expect(403);
    await admin.agent.patch(`/api/admin/jobs/${job._id}/moderate`).send({ action: 'restore' }).expect(200);
    await request(app).get(`/api/jobs/${job._id}`).expect(200);
    await admin.agent.patch(`/api/admin/jobs/${job._id}/moderate`).send({ action: 'explode' }).expect(400);
  });

  it('reviews reports and takes moderation actions', async () => {
    const job = await createJob(employer.agent, { title: 'Fake Scholarship Offer' });
    const created = await seeker.agent.post('/api/reports').send({ reportedJobId: job._id, reason: 'scam' });
    const id = created.body.data.report._id;

    const list = await admin.agent.get('/api/admin/reports').query({ status: 'pending' });
    expect(list.body.data.reports.map((r) => r._id)).toContain(id);

    await admin.agent.patch(`/api/admin/reports/${id}`).send({ status: 'under_review' }).expect(200);
    const resolved = await admin.agent
      .patch(`/api/admin/reports/${id}`)
      .send({ status: 'resolved', adminNotes: 'Confirmed scam', action: 'remove_job' });
    expect(resolved.body.data.report.status).toBe('resolved');
    expect(resolved.body.data.report.actionTaken).toBe('job_removed');
    expect((await Job.findById(job._id)).status).toBe('removed');

    const second = await seeker.agent.post('/api/reports').send({ reportedUserId: employer.user._id, reason: 'suspicious_account' });
    await admin.agent
      .patch(`/api/admin/reports/${second.body.data.report._id}`)
      .send({ status: 'resolved', action: 'suspend_user' })
      .expect(200);
    expect((await User.findById(employer.user._id)).isSuspended).toBe(true);

    await admin.agent.patch(`/api/admin/reports/${id}`).send({ status: 'bogus' }).expect(400);
  });

  it('exports reports as CSV and JSON, honouring filters', async () => {
    const reporter = await registerAgent('job_seeker');
    const owner = await registerAgent('employer');
    const target = await createJob(owner.agent, { title: 'Export, "Quoted" Job' });
    await reporter.agent
      .post('/api/reports')
      .send({ reportedJobId: target._id, reason: 'misleading', description: '=HYPERLINK("http://evil")' })
      .expect(201);
    await reporter.agent.post('/api/reports').send({ reportedUserId: owner.user._id, reason: 'spam' }).expect(201);

    const csv = await admin.agent.get('/api/admin/reports/export');
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.headers['content-disposition']).toMatch(/attachment; filename="jobconnect-reports-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(csv.text.charCodeAt(0)).toBe(0xfeff);
    expect(csv.text).toContain('Report ID,Date,Status,Reason,Type');
    expect(csv.text).toContain('"Export, ""Quoted"" Job"');
    // Formula injection is neutralised
    expect(csv.text).toContain(`"'=HYPERLINK(""http://evil"")"`);

    const jobsOnly = await admin.agent.get('/api/admin/reports/export?format=json&type=job&reason=misleading');
    expect(jobsOnly.status).toBe(200);
    expect(jobsOnly.body.data.rows.every((r) => r.type === 'job' && r.reason === 'misleading')).toBe(true);
    expect(jobsOnly.body.data.rows.some((r) => r.reportedJob === 'Export, "Quoted" Job')).toBe(true);
    expect(jobsOnly.body.data.truncated).toBe(false);

    const usersOnly = await admin.agent.get('/api/admin/reports/export?format=json&type=user');
    expect(usersOnly.body.data.rows.length).toBeGreaterThan(0);
    expect(usersOnly.body.data.rows.every((r) => r.type === 'user')).toBe(true);
  });

  it('prevents non-admins from modifying reports', async () => {
    const r = await Report.findOne();
    await seeker.agent.patch(`/api/admin/reports/${r._id}`).send({ status: 'dismissed' }).expect(403);
  });

  it('manages platform settings', async () => {
    const res = await admin.agent.put('/api/admin/settings').send({ allowEmployerRegistration: false, contactPhone: '+250 788 111 222' });
    expect(res.body.data.settings.allowEmployerRegistration).toBe(false);
    const blocked = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Late Employer', email: 'late@example.com', password: 'Str0ng!Pass', role: 'employer', companyName: 'Late Co' });
    expect(blocked.status).toBe(403);
    const pub = await request(app).get('/api/settings/public');
    expect(pub.body.data.contactPhone).toBe('+250 788 111 222');
    await admin.agent.put('/api/admin/settings').send({ allowEmployerRegistration: true }).expect(200);
  });

  it('stores contact messages for administrators', async () => {
    await request(app)
      .post('/api/contact')
      .send({ name: 'Visitor', email: 'visitor@example.com', subject: 'Partnership', message: 'We would like to partner with you.' })
      .expect(201);
    const res = await admin.agent.get('/api/admin/messages');
    expect(res.body.data[0].subject).toBe('Partnership');
  });
});
