const os = require('os');
const mongoose = require('mongoose');
const { env } = require('./env');

// Unknown filter paths are dropped. Operator injection is handled by middleware/sanitizeMiddleware.js
// and by casting every client-supplied filter value to a string in the controllers.
mongoose.set('strictQuery', true);

async function connectDB(uri = env.mongoUri) {
  try {
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000,
      // The driver otherwise loads `os` via dynamic import(), which fails inside Jest's VM sandbox
      // and silently produces an empty handshake that MongoDB 8 rejects.
      runtimeAdapters: { os },
    });
    if (!env.isTest) console.log(`MongoDB connected: ${conn.connection.host}/${conn.connection.name}`);
    return conn;
  } catch (err) {
    // Never print the URI itself: it may contain credentials.
    console.error(`MongoDB connection failed: ${err.message}`);
    throw err;
  }
}

async function disconnectDB() {
  await mongoose.connection.close();
}

module.exports = { connectDB, disconnectDB };
