import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { config } from '../config/env';
import { Request } from 'express';

// Ensure upload directory exists
const uploadDir = config.upload.directory;
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer storage
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    // Generate unique filename: timestamp-originalname
    const timestamp = Date.now();
    const originalName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${timestamp}-${originalName}`);
  },
});

// File filter - allow CSV and Excel files
const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedExtensions = ['.csv', '.CSV', '.xlsx', '.XLSX', '.xls', '.XLS'];
  const ext = path.extname(file.originalname);

  if (allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Only CSV and Excel files (.csv, .xlsx, .xls) are allowed'));
  }
};

// Create multer upload instance
export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: config.upload.maxFileSizeMB * 1024 * 1024, // Convert MB to bytes
  },
});

// Middleware to handle multer errors
export const handleUploadErrors = (err: any, _req: Request, res: any, next: any) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: 'File too large',
        message: `Maximum file size is ${config.upload.maxFileSizeMB}MB`,
      });
    }
    return res.status(400).json({
      error: 'Upload error',
      message: err.message,
    });
  } else if (err) {
    return res.status(400).json({
      error: 'Upload error',
      message: err.message,
    });
  }
  next();
};
