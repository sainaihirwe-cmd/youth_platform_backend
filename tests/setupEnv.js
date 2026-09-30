// Runs before every test file. Forces the test environment and refuses to touch non-test databases.
process.env.NODE_ENV = 'test';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });

if (!process.env.MONGO_URI_TEST) process.env.MONGO_URI_TEST = 'mongodb://127.0.0.1:27017/jobconnect_test';
if (!process.env.JWT_SECRET || /^replace_with/.test(process.env.JWT_SECRET)) {
  process.env.JWT_SECRET = 'test-only-secret-that-is-long-enough-for-jwt-signing-0123456789';
}

const dbName = new URL(process.env.MONGO_URI_TEST.replace('mongodb+srv://', 'mongodb://')).pathname.replace('/', '');
if (!/test/i.test(dbName)) {
  throw new Error(`Refusing to run tests: MONGO_URI_TEST database "${dbName}" must contain "test" in its name.`);
}
if (process.env.MONGO_URI && process.env.MONGO_URI === process.env.MONGO_URI_TEST) {
  throw new Error('Refusing to run tests: MONGO_URI_TEST must differ from MONGO_URI.');
}
