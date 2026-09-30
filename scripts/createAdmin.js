/**
 * Creates (or promotes) an administrator account. There are no default admin credentials:
 * the operator supplies them interactively or through environment variables.
 *
 * Interactive:   npm run create-admin
 * Non-interactive (e.g. Render shell / CI):
 *   ADMIN_NAME="Jane Doe" ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='S3cure!Pass' npm run create-admin
 *   (PowerShell: $env:ADMIN_NAME="Jane Doe"; $env:ADMIN_EMAIL="..."; $env:ADMIN_PASSWORD="..."; npm run create-admin)
 */
const readline = require('readline');
const { assertRequiredEnv } = require('../config/env');
const { connectDB, disconnectDB } = require('../config/db');
const { STRONG_PASSWORD, STRONG_PASSWORD_MESSAGE } = require('../middleware/validationMiddleware');
const User = require('../models/User');

function ask(rl, question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    if (!hidden) return rl.question(question, (a) => resolve(a.trim()));
    // Mask password input
    const onData = (char) => {
      const c = char.toString();
      if (!['\n', '\r', '\u0004'].includes(c)) {
        readline.cursorTo(process.stdout, 0);
        process.stdout.write(question + '*'.repeat(rl.line.length));
      }
    };
    process.stdin.on('data', onData);
    rl.question(question, (a) => {
      process.stdin.removeListener('data', onData);
      process.stdout.write('\n');
      resolve(a);
    });
  });
}

async function main() {
  assertRequiredEnv();
  let { ADMIN_NAME: name, ADMIN_EMAIL: email, ADMIN_PASSWORD: password } = process.env;

  if (!name || !email || !password) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    console.log('Create a JobConnect Rwanda administrator\n');
    name = name || (await ask(rl, 'Full name: '));
    email = email || (await ask(rl, 'Email: '));
    if (!password) {
      password = await ask(rl, 'Password: ', { hidden: true });
      const confirm = await ask(rl, 'Confirm password: ', { hidden: true });
      if (password !== confirm) {
        rl.close();
        throw new Error('Passwords do not match.');
      }
    }
    rl.close();
  }

  email = String(email).trim().toLowerCase();
  if (!name || name.trim().length < 2) throw new Error('Name must be at least 2 characters.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Please provide a valid email address.');
  if (!STRONG_PASSWORD.test(password)) throw new Error(STRONG_PASSWORD_MESSAGE);

  await connectDB();
  const existing = await User.findOne({ email }).select('+password');
  if (existing) {
    if (existing.role === 'admin') {
      console.log(`An administrator with email ${email} already exists. Nothing changed.`);
    } else {
      throw new Error(
        `A ${existing.role} account already uses ${email}. Use a different email for the administrator account.`
      );
    }
  } else {
    await User.create({ name: name.trim(), email, password, role: 'admin', isVerified: true });
    console.log(`Administrator ${email} created. Sign in at /admin/login.`);
  }
  await disconnectDB();
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(`Could not create administrator: ${err.message}`);
    await disconnectDB().catch(() => {});
    process.exit(1);
  });
