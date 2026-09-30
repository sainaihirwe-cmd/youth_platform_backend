const path = require('path');
const multer = require('multer');
const ApiError = require('../utils/ApiError');
const { RESUME_MAX_BYTES, IMAGE_MAX_BYTES } = require('../config/constants');

const RESUME_TYPES = {
  '.pdf': ['application/pdf'],
  '.doc': ['application/msword'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
};
const IMAGE_TYPES = {
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.webp': ['image/webp'],
};

// File signatures ("magic numbers") - the declared type must match the real content.
const SIGNATURES = {
  '.pdf': (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
  '.doc': (b) => b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
  '.docx': (b) => b.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])),
  '.jpg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  '.jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  '.png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  '.webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};

function makeFilter(allowed, label) {
  return (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!allowed[ext] || !allowed[ext].includes(file.mimetype)) {
      return cb(new ApiError(400, `Invalid file type. Allowed ${label}: ${Object.keys(allowed).join(', ')}`));
    }
    return cb(null, true);
  };
}

const storage = multer.memoryStorage();

const resumeUploader = multer({
  storage,
  limits: { fileSize: RESUME_MAX_BYTES, files: 1 },
  fileFilter: makeFilter(RESUME_TYPES, 'resume formats'),
});

const imageUploader = multer({
  storage,
  limits: { fileSize: IMAGE_MAX_BYTES, files: 1 },
  fileFilter: makeFilter(IMAGE_TYPES, 'image formats'),
});

/** Verifies file content matches the extension after multer has buffered it. */
function verifySignature(req, _res, next) {
  if (!req.file) return next();
  const ext = path.extname(req.file.originalname).toLowerCase();
  const check = SIGNATURES[ext];
  if (!check || !check(req.file.buffer)) {
    return next(new ApiError(400, 'The uploaded file content does not match its file type.'));
  }
  return next();
}

const uploadResume = (field = 'resume') => [resumeUploader.single(field), verifySignature];
const uploadImage = (field = 'image') => [imageUploader.single(field), verifySignature];

module.exports = { uploadResume, uploadImage, RESUME_TYPES, IMAGE_TYPES };
