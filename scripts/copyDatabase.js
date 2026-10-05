/**
 * Copies every collection (documents + indexes) from one MongoDB database to another,
 * e.g. from the local development database to MongoDB Atlas.
 *
 *   PowerShell:
 *     $env:TARGET_URI="mongodb+srv://user:pass@cluster0.xxxx.mongodb.net/jobconnect"; npm run copy-db
 *
 * SOURCE_URI defaults to MONGO_URI from backend/.env. Refuses to overwrite a target
 * collection that already has documents unless FORCE=1 is set.
 */
const mongoose = require('mongoose');
const { env } = require('../config/env');

const mask = (uri) => uri.replace(/\/\/[^@/]+@/, '//***@');

async function main() {
  const sourceUri = process.env.SOURCE_URI || env.mongoUri;
  const targetUri = process.env.TARGET_URI;
  const force = process.env.FORCE === '1';
  if (!targetUri) throw new Error('Set TARGET_URI to the destination connection string (see the comment at the top of this file).');
  if (!new URL(targetUri.replace('mongodb+srv://', 'mongodb://')).pathname.slice(1)) {
    throw new Error('TARGET_URI must include a database name, e.g. ...mongodb.net/jobconnect?retryWrites=true');
  }
  if (sourceUri === targetUri) throw new Error('SOURCE_URI and TARGET_URI are the same database.');

  const source = await mongoose.createConnection(sourceUri, { serverSelectionTimeoutMS: 10000 }).asPromise();
  const target = await mongoose.createConnection(targetUri, { serverSelectionTimeoutMS: 15000 }).asPromise();
  console.log(`Source: ${mask(sourceUri)}\nTarget: ${mask(targetUri)}\n`);

  const collections = (await source.db.listCollections({}, { nameOnly: true }).toArray())
    .map((c) => c.name)
    .filter((name) => !name.startsWith('system.'));

  for (const name of collections) {
    const dest = target.db.collection(name);
    const existing = await dest.countDocuments();
    if (existing && !force) {
      throw new Error(`Target collection "${name}" already has ${existing} documents. Re-run with FORCE=1 to replace it.`);
    }
    if (existing) await dest.drop();

    const docs = await source.db.collection(name).find().toArray();
    if (docs.length) await dest.insertMany(docs, { ordered: false });

    const indexes = (await source.db.collection(name).indexes()).filter((i) => i.name !== '_id_');
    for (const { key, v: _v, ns: _ns, ...options } of indexes) await dest.createIndex(key, options);

    console.log(`  ${name}: ${docs.length} documents, ${indexes.length} indexes`);
  }

  await source.close();
  await target.close();
  console.log('\nDone. Use the TARGET_URI as MONGO_URI on Render.');
}

main().catch(async (err) => {
  console.error(`Copy failed: ${err.message}`);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
