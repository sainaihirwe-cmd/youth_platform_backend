const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { env } = require('../config/env');

// Tests write to a throwaway directory so they never touch real uploads
const UPLOAD_ROOT = env.isTest ? path.join(__dirname, '..', 'tests', 'tmp-uploads') : path.join(__dirname, '..', 'uploads');
const LOCAL_PREFIX = {
  resumes: '/api/files/resumes/',
  images: '/uploads/images/',
};

let cloudinary;
function getCloudinary() {
  if (!env.cloudinaryEnabled) return null;
  if (!cloudinary) {
    cloudinary = require('cloudinary').v2;
    cloudinary.config({
      cloud_name: env.cloudinary.cloudName,
      api_key: env.cloudinary.apiKey,
      api_secret: env.cloudinary.apiSecret,
      secure: true,
    });
  }
  return cloudinary;
}

function randomName(originalname) {
  const ext = path.extname(originalname).toLowerCase();
  return `${Date.now()}-${crypto.randomBytes(12).toString('hex')}${ext}`;
}

/**
 * Stores an uploaded file (multer memory file) and returns its public or protected URL.
 * @param {'resumes'|'images'} kind
 */
async function saveFile(file, kind) {
  const cld = getCloudinary();
  if (cld) {
    const result = await new Promise((resolve, reject) => {
      const stream = cld.uploader.upload_stream(
        {
          folder: `jobconnect/${kind}`,
          resource_type: kind === 'images' ? 'image' : 'raw',
          public_id: randomName(file.originalname).replace(/\.[^.]+$/, ''),
          use_filename: false,
        },
        (err, res) => (err ? reject(err) : resolve(res))
      );
      stream.end(file.buffer);
    });
    return result.secure_url;
  }

  const filename = randomName(file.originalname);
  const dir = path.join(UPLOAD_ROOT, kind);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), file.buffer);
  return `${LOCAL_PREFIX[kind]}${filename}`;
}

/** Deletes a previously stored file. Errors are logged, never thrown (cleanup is best effort). */
async function deleteFile(url) {
  if (!url) return;
  try {
    for (const [kind, prefix] of Object.entries(LOCAL_PREFIX)) {
      if (url.startsWith(prefix)) {
        const filename = path.basename(url);
        await fs.unlink(path.join(UPLOAD_ROOT, kind, filename)).catch((e) => {
          if (e.code !== 'ENOENT') throw e;
        });
        return;
      }
    }
    const cld = getCloudinary();
    if (cld && url.includes('res.cloudinary.com')) {
      const match = /\/(image|raw)\/upload\/(?:v\d+\/)?(.+)$/.exec(url);
      if (match) {
        const resourceType = match[1];
        const publicId = resourceType === 'raw' ? match[2] : match[2].replace(/\.[^.]+$/, '');
        await cld.uploader.destroy(publicId, { resource_type: resourceType });
      }
    }
  } catch (err) {
    console.error(`Failed to delete stored file: ${err.message}`);
  }
}

/** Resolves a protected local resume URL to an absolute path on disk, or null. */
function localResumePath(filename) {
  const safe = path.basename(filename);
  if (!/^[\w-]+\.(pdf|docx?)$/i.test(safe)) return null;
  return path.join(UPLOAD_ROOT, 'resumes', safe);
}

module.exports = { saveFile, deleteFile, localResumePath, LOCAL_PREFIX, UPLOAD_ROOT };
