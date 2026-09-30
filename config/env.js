const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const PLACEHOLDER = /^(your_|replace_with)/i;
const isSet = (v) => Boolean(v && v.trim() && !PLACEHOLDER.test(v.trim()));

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 5000,
  mongoUri: process.env.NODE_ENV === 'test' ? process.env.MONGO_URI_TEST : process.env.MONGO_URI,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1d',
  clientUrls: (process.env.CLIENT_URL || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean),
  email: {
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT) || 587,
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
    from: process.env.EMAIL_FROM || 'JobConnect Rwanda <no-reply@jobconnect.rw>',
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  },
};

env.isProduction = env.nodeEnv === 'production';
env.isTest = env.nodeEnv === 'test';
env.emailEnabled = isSet(env.email.host) && isSet(env.email.user) && isSet(env.email.pass);
env.cloudinaryEnabled =
  isSet(env.cloudinary.cloudName) && isSet(env.cloudinary.apiKey) && isSet(env.cloudinary.apiSecret);

function assertRequiredEnv() {
  const missing = [];
  if (!isSet(env.mongoUri)) missing.push(env.isTest ? 'MONGO_URI_TEST' : 'MONGO_URI');
  if (!isSet(env.jwtSecret)) missing.push('JWT_SECRET');
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}. See backend/.env.example.`);
  }
  if (env.isProduction && env.jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters in production.');
  }
}

module.exports = { env, assertRequiredEnv, isSet };
