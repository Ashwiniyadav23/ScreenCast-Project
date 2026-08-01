import express from 'express';
import cors from 'cors';

const app = express();

// Basic CORS for debugging
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

app.use(express.json());

// Simple debug endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Basic debug endpoint working',
    timestamp: new Date().toISOString(),
    env: {
      NODE_ENV: process.env.NODE_ENV,
      hasMongoURI: !!process.env.MONGODB_URI,
      hasJWTSecret: !!process.env.JWT_SECRET,
      hasFrontendURL: !!process.env.FRONTEND_URL,
      mongoURI: process.env.MONGODB_URI ? 'Set but hidden' : 'Not set'
    }
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Debug health check working',
    timestamp: new Date().toISOString()
  });
});

// Test endpoint without imports
app.get('/api/test', (req, res) => {
  res.json({
    message: 'Test endpoint working',
    environment: process.env.NODE_ENV,
    timestamp: new Date().toISOString()
  });
});

export default app;