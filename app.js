const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const { env } = require('./config/env');
const { sanitizeRequest } = require('./middleware/sanitizeMiddleware');
const { apiLimiter } = require('./middleware/rateLimitMiddleware');
const { notFound, errorHandler } = require('./middleware/errorMiddleware');
const app = express();
// Render and most PaaS hosts run behind a reverse proxy (needed for secure cookies and rate limiting by IP)
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(
  helmet({
    // Allow the frontend (a different origin) to display uploaded images
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);
app.use(
  cors({
    origin(origin, cb) {
      // Allow same-origin / server-to-server requests (no Origin header) and configured clients
      if (!origin || env.clientUrls.includes(origin.replace(/\/$/, ''))) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept-Language'],
  })
);

if (!env.isTest) {
  // Log method, url, status and timing only - never bodies, cookies or auth headers
  app.use(morgan(env.isProduction ? 'combined' : 'dev'));
}

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(cookieParser());
app.use(sanitizeRequest);

// Public images (profile photos, company logos). Resumes are served via an authorised route.
app.use(
  '/uploads/images',
  express.static(path.join(__dirname, 'uploads', 'images'), {
    maxAge: '7d',
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
  })
);

app.get('/api/health', (_req, res) => {
  const dbState = ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState] || 'unknown';
  res.status(dbState === 'connected' ? 200 : 503).json({
    success: dbState === 'connected',
    data: { status: 'ok', database: dbState, time: new Date().toISOString() },
  });
});

app.use('/api', apiLimiter);
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/employer', require('./routes/employerRoutes'));
app.use('/api/jobs', require('./routes/jobRoutes'));
app.use('/api/applications', require('./routes/applicationRoutes'));
app.use('/api/saved-jobs', require('./routes/savedJobRoutes'));
app.use('/api/reports', require('./routes/reportRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/api/categories', require('./routes/categoryRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api', require('./routes/publicRoutes'));

app.use(notFound);
app.use(errorHandler);

module.exports = app;
