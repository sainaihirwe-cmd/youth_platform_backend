const { app, request, PASSWORD, setupDatabase, teardownDatabase, registerAgent, createAdminAgent } = require('./helpers');
const User = require('../models/User');
const EmployerProfile = require('../models/EmployerProfile');

beforeAll(setupDatabase);
afterAll(teardownDatabase);

describe('Registration', () => {
  it('registers a job seeker, hashes the password and does not log the user in', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'Aline Uwase',
      email: 'Aline@Example.com',
      password: PASSWORD,
      role: 'job_seeker',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe('aline@example.com');
    expect(res.body.data.user.password).toBeUndefined();
    expect(res.body.data.token).toBeUndefined();
    expect(res.headers['set-cookie']).toBeUndefined();

    const stored = await User.findOne({ email: 'aline@example.com' }).select('+password');
    expect(stored.password).not.toBe(PASSWORD);
    expect(stored.password).toMatch(/^\$2[aby]\$/);
  });

  it('creates an employer profile for employers', async () => {
    const { user } = await registerAgent('employer', { companyName: 'Umurava Traders' });
    const profile = await EmployerProfile.findOne({ userId: user._id });
    expect(profile.companyName).toBe('Umurava Traders');
  });

  it('rejects duplicate emails', async () => {
    const body = { name: 'Dup User', email: 'dup@example.com', password: PASSWORD, role: 'job_seeker' };
    await request(app).post('/api/auth/register').send(body).expect(201);
    const res = await request(app).post('/api/auth/register').send(body);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already exists/i);
  });

  it('rejects weak passwords and invalid emails', async () => {
    const weak = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Weak', email: 'weak@example.com', password: 'password', role: 'job_seeker' });
    expect(weak.status).toBe(400);
    const bad = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Bad', email: 'not-an-email', password: PASSWORD, role: 'job_seeker' });
    expect(bad.status).toBe(400);
  });

  it('does not allow self-registration as administrator', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Sneaky', email: 'sneaky@example.com', password: PASSWORD, role: 'admin' });
    expect(res.status).toBe(400);
    expect(await User.exists({ email: 'sneaky@example.com' })).toBeNull();
  });

  it('ignores mass-assigned privileged fields', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'Mass Assign',
      email: 'mass@example.com',
      password: PASSWORD,
      role: 'job_seeker',
      isVerified: true,
      isSuspended: false,
      $where: 'sleep(1000)',
    });
    expect(res.status).toBe(201);
    const u = await User.findOne({ email: 'mass@example.com' });
    expect(u.isVerified).toBe(false);
  });
});

describe('Login, session and logout', () => {
  it('logs in with valid credentials and returns the current user', async () => {
    const { credentials } = await registerAgent('job_seeker');
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').send(credentials);
    expect(login.status).toBe(200);
    const cookie = login.headers['set-cookie'].join(';');
    expect(cookie).toMatch(/jc_token=/);
    expect(cookie).toMatch(/HttpOnly/i);
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe(credentials.email);
  });

  it('rejects invalid credentials with a generic message', async () => {
    const { credentials } = await registerAgent('job_seeker');
    const wrong = await request(app).post('/api/auth/login').send({ ...credentials, password: 'Wrong!Pass1' });
    expect(wrong.status).toBe(401);
    const unknown = await request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: PASSWORD });
    expect(unknown.status).toBe(401);
    expect(wrong.body.message).toBe(unknown.body.message);
  });

  it('rejects NoSQL operator injection in login', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: { $gt: '' }, password: { $gt: '' } });
    expect(res.status).toBe(400);
  });

  it('requires authentication for /me and clears the session on logout', async () => {
    await request(app).get('/api/auth/me').expect(401);
    const { agent } = await registerAgent('job_seeker');
    await agent.get('/api/auth/me').expect(200);
    await agent.post('/api/auth/logout').expect(200);
    await agent.get('/api/auth/me').expect(401);
  });

  it('reports the session state without failing for guests', async () => {
    const guest = await request(app).get('/api/auth/session');
    expect(guest.status).toBe(200);
    expect(guest.body.data.user).toBeNull();
    const { agent, user } = await registerAgent('employer');
    const res = await agent.get('/api/auth/session');
    expect(res.body.data.user._id).toBe(user._id);
    expect(res.body.data.employerProfile.companyName).toBeDefined();
  });

  it('rejects tampered tokens', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer abc.def.ghi');
    expect(res.status).toBe(401);
  });

  it('blocks suspended accounts', async () => {
    const { agent, user, credentials } = await registerAgent('job_seeker');
    await User.updateOne({ _id: user._id }, { isSuspended: true });
    await agent.get('/api/auth/me').expect(403);
    const res = await request(app).post('/api/auth/login').send(credentials);
    expect(res.status).toBe(403);
  });

  it('keeps administrator login separate', async () => {
    const { credentials } = await registerAgent('job_seeker');
    const res = await request(app).post('/api/auth/admin/login').send(credentials);
    expect(res.status).toBe(401);

    await User.create({ name: 'Admin', email: 'root-admin@example.com', password: PASSWORD, role: 'admin' });
    const normal = await request(app).post('/api/auth/login').send({ email: 'root-admin@example.com', password: PASSWORD });
    expect(normal.status).toBe(403);
    const admin = await request(app).post('/api/auth/admin/login').send({ email: 'root-admin@example.com', password: PASSWORD });
    expect(admin.status).toBe(200);
    expect(admin.body.data.user.role).toBe('admin');
  });
});

describe('Password management', () => {
  it('changes password and invalidates the old one', async () => {
    const { agent, credentials } = await registerAgent('job_seeker');
    await agent
      .put('/api/auth/change-password')
      .send({ currentPassword: credentials.password, newPassword: 'N3w!Password' })
      .expect(200);
    await request(app).post('/api/auth/login').send(credentials).expect(401);
    await request(app).post('/api/auth/login').send({ email: credentials.email, password: 'N3w!Password' }).expect(200);
  });

  it('supports forgot/reset password with single-use tokens', async () => {
    const { credentials } = await registerAgent('job_seeker');
    const forgot = await request(app).post('/api/auth/forgot-password').send({ email: credentials.email });
    expect(forgot.status).toBe(200);
    // Email is not configured in tests, so the dev reset link is returned
    const token = new URL(forgot.body.data.devResetUrl).searchParams.get('token');
    await request(app).post('/api/auth/reset-password').send({ token, password: 'Reset!Pass9' }).expect(200);
    await request(app).post('/api/auth/reset-password').send({ token, password: 'Reset!Pass9' }).expect(400);
    await request(app).post('/api/auth/login').send({ email: credentials.email, password: 'Reset!Pass9' }).expect(200);
  });

  it('does not reveal whether an email exists', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'ghost@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });
});

describe('Role permissions', () => {
  it('prevents job seekers from using employer and admin routes', async () => {
    const { agent } = await registerAgent('job_seeker');
    await agent.get('/api/employer/dashboard').expect(403);
    await agent.get('/api/admin/dashboard').expect(403);
    await agent.post('/api/categories').send({ name: 'Hack' }).expect(403);
  });

  it('prevents employers from using seeker and admin routes', async () => {
    const { agent } = await registerAgent('employer');
    await agent.get('/api/applications/my-applications').expect(403);
    await agent.get('/api/saved-jobs').expect(403);
    await agent.get('/api/admin/users').expect(403);
  });

  it('prevents users from promoting themselves via profile updates', async () => {
    const { agent, user } = await registerAgent('job_seeker');
    await agent.put('/api/users/profile').send({ role: 'admin', isSuspended: false, name: 'Still Seeker' }).expect(200);
    const u = await User.findById(user._id);
    expect(u.role).toBe('job_seeker');
    expect(u.name).toBe('Still Seeker');
  });

  it('lets administrators access admin routes', async () => {
    const { agent } = await createAdminAgent();
    const res = await agent.get('/api/admin/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.data.stats).toHaveProperty('totalUsers');
  });
});
