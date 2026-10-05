const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const PLACEHOLDER = /^(your_|replace_with)/i;
const isSet = (v) => Boolean(v && v.trim() && !PLACEHOLDER.test(v.trim()));

/** Forgives common copy-paste mistakes in dashboard env vars: whitespace, wrapping quotes, a "MONGO_URI=" prefix. */
function cleanUri(v) {
  if (!v) return v;
  let s = v.trim().replace(/^MONGO_URI(_TEST)?\s*=\s*/, '');
  if (/^(['"]).*\1$/.test(s)) s = s.slice(1, -1).trim();
  return s;
}

/** Explains why a MongoDB URI is malformed, without echoing credentials. Returns null when it looks valid. */
function describeMongoUriProblem(uri) {
  if (!/^mongodb(\+srv)?:\/\//.test(uri)) return 'it must start with mongodb+srv:// (Atlas) or mongodb://';
  if (/\s/.test(uri)) return 'it contains a space or line break';
  if (/[<>]/.test(uri)) return 'it still contains < or > - replace <db_password> with the real password, without the brackets';
  const authority = uri.replace(/^mongodb(\+srv)?:\/\//, '').split('/')[0];
  if ((authority.match(/@/g) || []).length > 1) {
    return 'the password contains a special character such as @ - URL-encode it (@ -> %40, # -> %23, / -> %2F, : -> %3A) or use a password with only letters and numbers';
  }
  if (/[#?]/.test(authority)) return 'the password contains # or ? - URL-encode it (# -> %23, ? -> %3F) or use only letters and numbers';
  if (uri.startsWith('mongodb+srv://') && authority.split('@').pop().includes(':')) {
    return 'mongodb+srv:// addresses cannot include a port number';
  }
  return null;
}

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 5000,
  mongoUri: cleanUri(process.env.NODE_ENV === 'test' ? process.env.MONGO_URI_TEST : process.env.MONGO_URI),
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
  const uriProblem = describeMongoUriProblem(env.mongoUri);
  if (uriProblem) throw new Error(`MONGO_URI is not a valid MongoDB connection string: ${uriProblem}.`);
  if (env.isProduction && /\/\/(127\.0\.0\.1|localhost)[:/]/.test(env.mongoUri)) {
    throw new Error(
      'MONGO_URI points to a local database (127.0.0.1/localhost), which does not exist on the server. Use a MongoDB Atlas connection string (mongodb+srv://...).'
    );
  }
  if (env.isProduction && env.jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters in production.');
  }
}

module.exports = { env, assertRequiredEnv, isSet };
