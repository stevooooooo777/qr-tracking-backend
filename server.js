const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

console.log('🚀 Starting server initialization...');

// Create Express app
console.log('📦 Creating Express app...');
const app = express();

// Middleware - CORS first
console.log('🔧 Setting up middleware...');
app.use(cors({
  origin: ['https://insane.marketing', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(express.json());

// Postgres connection with enhanced SSL
console.log('🗄️ Creating database pool...');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
    minVersion: 'TLSv1.2',
    maxVersion: 'TLSv1.3'
  },
  max: 5,  // Reduced for startup speed
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,  // Increased timeout
});

// Test DB connection on startup (async)
console.log('🔄 Testing database connection...');
async function testDbConnection() {
  try {
    const result = await pool.query('SELECT NOW()');
    console.log(`✅ Database connected! Time: ${result.rows[0].now}`);
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    console.log('⚠️  Health checks will still work - just no DB data');
  }
}

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  pool.end(() => {
    console.log('Pool has been drained');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  pool.end(() => {
    console.log('Pool has been drained');
    process.exit(0);
  });
});

// Event listeners
pool.on('connect', (client) => {
  console.log('👤 New client connected to Postgres');
});

pool.on('error', (err) => {
  console.error('❌ Unexpected error on idle client', err);
  // Don't exit - keep server alive
});

// SIMPLE HEALTH CHECK FIRST - no DB
console.log('🏥 Setting up health endpoints...');
app.get('/health', (req, res) => {
  console.log('[HEALTH] Simple /health called - OK');
  res.status(200).send('OK');
});

// Enhanced health check (with DB test)
app.get('/api/health', async (req, res) => {
  console.log('[HEALTH] Detailed /api/health called');
  try {
    const result = await pool.query('SELECT NOW()');
    const dbTime = result.rows[0].now;
    console.log(`[HEALTH] Health check passed - DB time: ${dbTime}`);
    
    res.status(200).json({
      status: 'Server is healthy',
      timestamp: new Date().toISOString(),
      dbConnected: true,
      dbTime: dbTime.toISOString()
    });
  } catch (error) {
    console.error('[HEALTH] Health check failed:', error.message);
    // Always return 200 to keep container alive
    res.status(200).json({
      status: 'Server running but DB issue',
      timestamp: new Date().toISOString(),
      dbConnected: false,
      error: error.message
    });
  }
});

// Your existing routes (register, login, etc.) - all stay the same
// ... [keep all your existing route code] ...

// Global error handler
app.use((err, req, res, next) => {
  console.error('Global error:', err.message);
  res.status(500).json({ error: 'Server error' });
});

// 404 handler
app.use((req, res) => {
  console.log(`[404] Route not found: ${req.method} ${req.path}`);
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
const port = process.env.PORT || 8080;
console.log(`🎯 Starting server on port ${port}...`);

const server = app.listen(port, async () => {
  console.log(`✅ Server listening on port ${port}`);
  
  // Test DB after server starts
  await testDbConnection();
  
  // Keep-alive ping
  setInterval(() => {
    console.log('💓 Keep-alive ping - server alive');
  }, 300000); // 5 minutes
  
  console.log('🎉 Server fully initialized and ready!');
});

// Handle server errors
server.on('error', (err) => {
  console.error('❌ Server error:', err.message);
  process.exit(1);
});
H o b b y   p l a n   u p g r a d e   -   0 9 / 1 9 / 2 0 2 5   0 5 : 3 7 : 2 9 
 
 