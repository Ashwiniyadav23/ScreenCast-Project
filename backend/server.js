import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { resolveUploadDir } from './lib/uploads.js';

import authRoutes from './routes/auth.js';
import recordingRoutes from './routes/recordings.js';
import userRoutes from './routes/users.js';

import { initRedis, getRedisStatus } from './config/redis.js';
import { setupSocketHandler } from './socket/socketHandler.js';
import { requestMetricsMiddleware, getSystemMetrics } from './middleware/monitoring.js';

// Configuration
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5001;
const isProduction = process.env.NODE_ENV === 'production';

const uploadDir = resolveUploadDir({
  isProduction,
  projectRootDir: __dirname
});

const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.CLIENT_URL,
  'http://localhost:5173',
  'http://localhost:8080'
].filter(Boolean);

const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return true;
  return /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin);
};

const corsOptions = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }
    const corsError = new Error(`Not allowed by CORS: ${origin}`);
    corsError.status = 403;
    return callback(corsError);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization']
};

// Initialize Socket.IO with CORS & Transport settings
const io = new SocketIOServer(server, {
  cors: corsOptions,
  transports: ['websocket', 'polling'],
  pingTimeout: 20000,
  pingInterval: 10000
});

// Setup Redis Adapter for multi-instance scaling if Redis is present
const { pubClient, subClient } = initRedis();
if (pubClient && subClient) {
  pubClient.on('ready', () => {
    try {
      io.adapter(createAdapter(pubClient, subClient));
      console.log('✅ Socket.IO Redis adapter attached');
    } catch (adapterErr) {
      console.warn('⚠️ Could not attach Redis adapter:', adapterErr.message);
    }
  });
}

// Setup real-time WebRTC room signaling
setupSocketHandler(io);

// Rate limiting middleware
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX) || 10000, // configurable high-throughput limit
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, please try again later.' }
});

// Middleware stack
app.use(requestMetricsMiddleware);
app.use(compression());
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(limiter);
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static recordings
app.use('/uploads', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  next();
}, express.static(uploadDir));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/recordings', recordingRoutes);
app.use('/api/users', userRoutes);

// Enhanced Health check & System Monitoring endpoint
app.get('/api/health', (req, res) => {
  const metrics = getSystemMetrics(io);
  const redisInfo = getRedisStatus();
  const dbState = mongoose.connection.readyState;
  const dbStatus = dbState === 1 ? 'connected' : dbState === 2 ? 'connecting' : 'disconnected';

  res.json({
    status: dbState === 1 ? 'OK' : 'DEGRADED',
    timestamp: new Date().toISOString(),
    database: { status: dbStatus },
    redis: redisInfo,
    metrics
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'ScreenCast backend is running',
    health: '/api/health'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  const statusCode = err.status || (err.name === 'MulterError' ? 400 : 500);
  if (statusCode >= 500) {
    console.error('[Error]', err.stack || err.message);
  } else {
    console.warn('[Warning]', err.message);
  }

  const isClientError = statusCode >= 400 && statusCode < 500;
  let message = 'Something went wrong!';

  if (statusCode === 403) {
    message = 'CORS origin is not allowed';
  } else if (isClientError) {
    message = err.message || 'Bad request';
  }

  res.status(statusCode).json({
    message,
    error: process.env.NODE_ENV === 'development' ? err.message : {}
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// MongoDB connection with connection pool optimization
let isConnected = false;
let connectionPromise = null;

export const connectDB = async () => {
  if (isConnected || mongoose.connection.readyState === 1) {
    isConnected = true;
    return;
  }

  if (connectionPromise) {
    return connectionPromise;
  }

  try {
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI environment variable is not set');
    }

    connectionPromise = mongoose.connect(process.env.MONGODB_URI, {
      bufferCommands: false,
      maxPoolSize: 100, // High throughput connection pool
      minPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000
    });

    await connectionPromise;
    isConnected = true;
    console.log('✅ Connected to MongoDB with poolSize=100');
  } catch (error) {
    connectionPromise = null;
    isConnected = false;
    console.error('MongoDB connection error:', error.message);
    throw error;
  }
};

// Initialize DB connection when running standalone server
if (!process.env.VERCEL) {
  connectDB().catch((error) => {
    console.error('Initial DB connection failed:', error.message);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`❌ Error: Port ${PORT} is already in use by another process.`);
      console.error(`👉 You can free the port by running: fuser -k ${PORT}/tcp`);
      process.exit(1);
    } else {
      console.error('Server error:', err);
    }
  });

  server.listen(PORT, () => {
    console.log(`🚀 ScreenCast Server running on port ${PORT}`);
  });
}

export { app, server, io };
export default app;