const { app, request, setupDatabase, teardownDatabase, registerAgent, createJob } = require('./helpers');
const Job = require('../models/Job');
const Application = require('../models/Application');
const Notification = require('../models/Notification');

beforeAll(setupDatabase);
afterAll(teardownDatabase);

const COVER = 'I am very interested in this role and have relevant experience working in Kigali.';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

describe('Application submission', () => {
  let employer;
  let seeker;
  let job;
  beforeAll(async () => {
    employer = await registerAgent('employer');
    seeker = await registerAgent('job_seeker');
    job = await createJob(employer.agent);
  });

  it('submits an application with a cover letter and PDF resume', async () => {
    const res = await seeker.agent
      .post('/api/applications')
      .field('jobId', job._id)
      .field('coverLetter', COVER)
      .attach('resume', PDF, { filename: 'cv.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(201);
    expect(res.body.data.application.status).toBe('pending');
    expect(res.body.data.application.resumeUrl).toMatch(/^\/api\/files\/resumes\/.+\.pdf$/);

    const n = await Notification.findOne({ userId: employer.user._id, type: 'new_application' });
    expect(n).not.toBeNull();
  });

  it('prevents duplicate applications', async () => {
    const res = await seeker.agent.post('/api/applications').send({ jobId: job._id, coverLetter: COVER });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already applied/i);
    expect(await Application.countDocuments({ jobId: job._id, applicantId: seeker.user._id })).toBe(1);
  });

  it('validates cover letter and file type', async () => {
    const other = await registerAgent('job_seeker');
    const short = await other.agent.post('/api/applications').send({ jobId: job._id, coverLetter: 'Hi' });
    expect(short.status).toBe(400);
    const exe = await other.agent
      .post('/api/applications')
      .field('jobId', job._id)
      .field('coverLetter', COVER)
      .attach('resume', Buffer.from('MZ fake'), { filename: 'virus.exe', contentType: 'application/octet-stream' });
    expect(exe.status).toBe(400);
    // Right extension, wrong content
    const spoofed = await other.agent
      .post('/api/applications')
      .field('jobId', job._id)
      .field('coverLetter', COVER)
      .attach('resume', Buffer.from('not really a pdf'), { filename: 'cv.pdf', contentType: 'application/pdf' });
    expect(spoofed.status).toBe(400);
  });

  it('rejects applications to closed, expired or removed jobs', async () => {
    const other = await registerAgent('job_seeker');
    const closed = await createJob(employer.agent, { title: 'Closed Role' });
    await employer.agent.patch(`/api/jobs/${closed._id}/status`).send({ status: 'closed' }).expect(200);
    await other.agent.post('/api/applications').send({ jobId: closed._id, coverLetter: COVER }).expect(400);

    const expired = await createJob(employer.agent, { title: 'Expired Role' });
    await Job.updateOne({ _id: expired._id }, { applicationDeadline: new Date(Date.now() - 1000) });
    const r = await other.agent.post('/api/applications').send({ jobId: expired._id, coverLetter: COVER });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/deadline/i);

    const removed = await createJob(employer.agent, { title: 'Removed Role' });
    await Job.updateOne({ _id: removed._id }, { status: 'removed' });
    await other.agent.post('/api/applications').send({ jobId: removed._id, coverLetter: COVER }).expect(400);
  });

  it('only allows job seekers to apply', async () => {
    await employer.agent.post('/api/applications').send({ jobId: job._id, coverLetter: COVER }).expect(403);
    await request(app).post('/api/applications').send({ jobId: job._id, coverLetter: COVER }).expect(401);
  });

  it('shows the seeker their own applications and stats', async () => {
    const mine = await seeker.agent.get('/api/applications/my-applications');
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].jobId.title).toBe('Junior Web Developer');
    const stats = await seeker.agent.get('/api/applications/stats');
    expect(stats.body.data.stats).toMatchObject({ totalApplications: 1, pendingApplications: 1 });
  });
});

describe('Application access and status updates', () => {
  let employer;
  let otherEmployer;
  let seeker;
  let otherSeeker;
  let application;
  beforeAll(async () => {
    employer = await registerAgent('employer');
    otherEmployer = await registerAgent('employer');
    seeker = await registerAgent('job_seeker');
    otherSeeker = await registerAgent('job_seeker');
    const job = await createJob(employer.agent);
    const res = await seeker.agent
      .post('/api/applications')
      .field('jobId', job._id)
      .field('coverLetter', COVER)
      .attach('resume', PDF, { filename: 'cv.pdf', contentType: 'application/pdf' });
    application = res.body.data.application;
  });

  it('restricts who can view an application', async () => {
    await seeker.agent.get(`/api/applications/${application._id}`).expect(200);
    await employer.agent.get(`/api/applications/${application._id}`).expect(200);
    await otherSeeker.agent.get(`/api/applications/${application._id}`).expect(403);
    await otherEmployer.agent.get(`/api/applications/${application._id}`).expect(403);
  });

  it('restricts resume downloads', async () => {
    const url = application.resumeUrl;
    await seeker.agent.get(url).expect(200);
    await employer.agent.get(url).expect(200);
    await otherEmployer.agent.get(url).expect(403);
    await request(app).get(url).expect(401);
    await seeker.agent.get('/api/files/resumes/..%2F..%2F.env').expect(404);
  });

  it('lets only the owning employer accept or reject, and notifies the applicant', async () => {
    await otherEmployer.agent.patch(`/api/applications/${application._id}/status`).send({ status: 'accepted' }).expect(403);
    await seeker.agent.patch(`/api/applications/${application._id}/status`).send({ status: 'accepted' }).expect(403);
    await employer.agent.patch(`/api/applications/${application._id}/status`).send({ status: 'maybe' }).expect(400);

    const res = await employer.agent.patch(`/api/applications/${application._id}/status`).send({ status: 'accepted' });
    expect(res.status).toBe(200);
    expect(res.body.data.application.status).toBe('accepted');

    const notifications = await seeker.agent.get('/api/notifications');
    const n = notifications.body.data.notifications.find((x) => x.type === 'application_status');
    expect(n.message).toMatch(/accepted/);
    expect(notifications.body.data.unreadCount).toBeGreaterThan(0);

    const mine = await seeker.agent.get('/api/applications/my-applications');
    expect(mine.body.data[0].status).toBe('accepted');
  });

  it('shows applicants to the employer with search and status filters', async () => {
    const jobId = application.jobId._id || application.jobId;
    const all = await employer.agent.get(`/api/employer/jobs/${jobId}/applications`);
    expect(all.body.data.applications).toHaveLength(1);
    expect(all.body.data.counts.accepted).toBe(1);
    const filtered = await employer.agent.get(`/api/employer/jobs/${jobId}/applications`).query({ status: 'rejected' });
    expect(filtered.body.data.applications).toHaveLength(0);
    const searched = await employer.agent.get(`/api/employer/jobs/${jobId}/applications`).query({ q: seeker.user.name });
    expect(searched.body.data.applications).toHaveLength(1);

    const dash = await employer.agent.get('/api/employer/dashboard');
    expect(dash.body.data.stats).toMatchObject({ activeJobs: 1, totalApplications: 1, acceptedApplicants: 1 });
  });

  it('marks notifications as read', async () => {
    const list = await seeker.agent.get('/api/notifications');
    const id = list.body.data.notifications[0]._id;
    await otherSeeker.agent.patch(`/api/notifications/${id}/read`).expect(404);
    await seeker.agent.patch(`/api/notifications/${id}/read`).expect(200);
    await seeker.agent.patch('/api/notifications/read-all').expect(200);
    const count = await seeker.agent.get('/api/notifications/unread-count');
    expect(count.body.data.unreadCount).toBe(0);
    await seeker.agent.delete(`/api/notifications/${id}`).expect(200);
  });
});

describe('Saved jobs', () => {
  it('saves, lists and removes jobs without duplicates', async () => {
    const employer = await registerAgent('employer');
    const seeker = await registerAgent('job_seeker');
    const job = await createJob(employer.agent);
    await seeker.agent.post(`/api/saved-jobs/${job._id}`).expect(201);
    await seeker.agent.post(`/api/saved-jobs/${job._id}`).expect(409);
    const list = await seeker.agent.get('/api/saved-jobs');
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].job.title).toBe('Junior Web Developer');
    const ids = await seeker.agent.get('/api/saved-jobs/ids');
    expect(ids.body.data).toEqual([job._id]);
    await seeker.agent.delete(`/api/saved-jobs/${job._id}`).expect(200);
    await seeker.agent.delete(`/api/saved-jobs/${job._id}`).expect(404);
  });

  it('cleans up applications and saved jobs when a job is deleted', async () => {
    const employer = await registerAgent('employer');
    const seeker = await registerAgent('job_seeker');
    const job = await createJob(employer.agent);
    await seeker.agent.post(`/api/saved-jobs/${job._id}`).expect(201);
    await seeker.agent.post('/api/applications').send({ jobId: job._id, coverLetter: COVER }).expect(201);
    await employer.agent.delete(`/api/jobs/${job._id}`).expect(200);
    expect(await Application.countDocuments({ jobId: job._id })).toBe(0);
    const list = await seeker.agent.get('/api/saved-jobs');
    expect(list.body.data).toHaveLength(0);
  });
});
