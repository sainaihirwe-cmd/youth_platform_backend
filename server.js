const { env, assertRequiredEnv } = require('./config/env');
const { connectDB, disconnectDB } = require('./config/db');
const { ensureDefaultCategories } = require('./scripts/seedCategories');
const app = require('./app');

async function start() {
  try {
    assertRequiredEnv();
    await connectDB();
    // Ensure categories exist on first boot so employers can post jobs immediately
    const created = await ensureDefaultCategories();
    if (created) console.log(`Seeded ${created} default job categories`);
  } catch (err) {
    console.error(`Startup failed: ${err.message}`);
    process.exit(1);
  }

  const server = app.listen(env.port, () => {
    console.log(`JobConnect Rwanda API running on port ${env.port} (${env.nodeEnv})`);
    console.log(`Email notifications: ${env.emailEnabled ? 'enabled' : 'disabled (EMAIL_* not configured)'}`);
    console.log(`File storage: ${env.cloudinaryEnabled ? 'Cloudinary' : 'local disk (backend/uploads)'}`);
  });

  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down gracefully`);
    server.close(async () => {
      await disconnectDB().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason instanceof Error ? reason.message : reason);
  });
}

start();
