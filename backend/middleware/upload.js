import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { resolveUploadDir } from '../lib/uploads.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProduction = process.env.NODE_ENV === 'production';
const uploadDir = resolveUploadDir({
  isProduction,
  projectRootDir: path.dirname(__dirname)
});

const ensureDir = (dirPath) => {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    return true;
  } catch (error) {
    console.error(`Failed to create upload directory: ${dirPath}`, error.message);
    return false;
  }
};

// Check if Cloudinary credentials exist
const hasCloudinaryAuth = 
  process.env.CLOUDINARY_CLOUD_NAME && 
  process.env.CLOUDINARY_CLOUD_NAME !== 'your_cloudinary_cloud_name';

let storage;

if (hasCloudinaryAuth) {
  // Configure Cloudinary
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });

  storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
      folder: 'screencast_recordings',
      resource_type: 'video',
      allowed_formats: ['mp4', 'webm', 'mov', 'mkv', 'ogg'],
    },
  });
} else {
  // Fallback to local storage
  storage = multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        const userDir = path.join(uploadDir, req.user._id.toString());
        const baseDirReady = ensureDir(uploadDir);
        const userDirReady = baseDirReady && ensureDir(userDir);

        if (!userDirReady) {
          return cb(new Error('Upload storage is not available'));
        }

        cb(null, userDir);
      } catch (error) {
        cb(error);
      }
    },
    filename: (req, file, cb) => {
      const timestamp = Date.now();
      const extension = path.extname(file.originalname) || '.webm';
      const filename = `recording_${timestamp}${extension}`;
      cb(null, filename);
    }
  });
}

// File filter
const fileFilter = (req, file, cb) => {
  const mimeType = (file.mimetype || '').toLowerCase();
  const extension = path.extname(file.originalname || '').toLowerCase();
  const originalName = (file.originalname || '').toLowerCase();
  const allowedExtensions = new Set(['.webm', '.mp4', '.mov', '.mkv', '.ogg']);

  const isVideoMime = mimeType.startsWith('video/');
  const isLikelyRecorderBlobName = originalName === 'blob' || originalName === 'recording';
  const hasKnownVideoExtension = allowedExtensions.has(extension);

  const isRecorderBlobUpload =
    file.fieldname === 'recording' &&
    (hasKnownVideoExtension || isLikelyRecorderBlobName || !extension);

  if (isVideoMime || hasKnownVideoExtension || isRecorderBlobUpload) {
    cb(null, true);
  } else {
    const error = new Error('Only video files are allowed');
    error.status = 400;
    cb(error, false);
  }
};

// Multer configuration
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit
  }
});

export default upload;