const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// Create Express app
const app = express();

// Middleware - CORS first
app.use(cors({
  origin: ['https://insane.marketing', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(express.json());

// Postgres connection with enhanced SSL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
    minVersion: 'TLSv1.2',
    maxVersion: 'TLSv1.3'
  },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

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

// Test DB connection
pool.on('connect', (client) => {
  console.log('Client connected to Postgres');
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// Health check
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Register endpoint
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, restaurantName } = req.body;
    
    if (!email || !password || !restaurantName) {
      return res.status(400).json({ error: 'Email, password, and restaurant name required' });
    }

    // Check if user exists
    const existingUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Find or create restaurant
    let restaurantId;
    try {
      const restaurantResult = await pool.query(
        'INSERT INTO restaurants (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id',
        [restaurantName]
      );
      restaurantId = restaurantResult.rows[0].id;
    } catch (restaurantError) {
      console.log('Restaurant creation/update error:', restaurantError.message);
      // Get existing restaurant ID
      const existingRestaurant = await pool.query('SELECT id FROM restaurants WHERE name = $1', [restaurantName]);
      if (existingRestaurant.rows.length > 0) {
        restaurantId = existingRestaurant.rows[0].id;
      } else {
        return res.status(500).json({ error: 'Failed to create or find restaurant' });
      }
    }

    // Insert new user
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, full_name, restaurant_id) VALUES ($1, $2, $3, $4) RETURNING id, email, full_name, restaurant_id',
      [email, passwordHash, restaurantName || 'New User', restaurantId]
    );

    const user = result.rows[0];

    // Generate JWT - ensure secret exists
    if (!process.env.JWT_SECRET) {
      console.error('JWT_SECRET environment variable not set');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const token = jwt.sign(
      { userId: user.id, restaurantId: user.restaurant_id, userType: 'restaurant' },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    console.log(`New user registered: ${email} for restaurant ${restaurantName}`);

    res.status(201).json({
      token,
      restaurantName,
      restaurantId: user.restaurant_id,
      userType: 'restaurant'
    });
  } catch (error) {
    console.error('Register error:', error.message);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login endpoint
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const isValid = await bcrypt.compare(password, user.password_hash);
    
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Get restaurant name
    const restaurantResult = await pool.query('SELECT name FROM restaurants WHERE id = $1', [user.restaurant_id]);
    const restaurantName = restaurantResult.rows[0]?.name || 'Unknown Restaurant';

    if (!process.env.JWT_SECRET) {
      console.error('JWT_SECRET environment variable not set');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const token = jwt.sign(
      { userId: user.id, restaurantId: user.restaurant_id, userType: 'restaurant' },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    console.log(`User logged in: ${email}`);

    res.json({
      token,
      restaurantName,
      restaurantId: user.restaurant_id,
      userType: 'restaurant'
    });
  } catch (error) {
    console.error('Login error:', error.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Analytics endpoint
app.get('/api/analytics/:restaurantId', async (req, res) => {
  try {
    const { restaurantId } = req.params;
    
    const result = await pool.query('SELECT * FROM qr_scans WHERE restaurant_id = $1 ORDER BY timestamp DESC LIMIT 100', [restaurantId]);
    
    // Basic aggregation
    const totalScans = result.rowCount;
    
    res.json({
      totalScans,
      todayScans: 0, // Add real logic later
      weeklyScans: 0,
      monthlyScans: 0,
      scansByType: {},
      recentScans: result.rows,
      hourlyData: [],
      tableData: [],
      conversionRate: 0,
      avgSessionTime: 0
    });
  } catch (error) {
    console.error(`Analytics error for ${req.params.restaurantId}:`, error.message);
    res.status(500).json({ error: 'Failed to load analytics' });
  }
});

// Alerts endpoint
app.get('/api/tables/:restaurantId/alerts', async (req, res) => {
  try {
    const { restaurantId } = req.params;
    
    const result = await pool.query('SELECT * FROM table_alerts WHERE restaurant_id = $1 ORDER BY created_at DESC LIMIT 50', [restaurantId]);
    
    res.json(result.rows);
  } catch (error) {
    console.error(`Alerts error for ${req.params.restaurantId}:`, error.message);
    res.status(500).json({ error: 'Failed to load alerts' });
  }
});

// Table status endpoint
app.get('/api/tables/:restaurantId/status', async (req, res) => {
  try {
    const { restaurantId } = req.params;
    
    const result = await pool.query('SELECT * FROM table_status WHERE restaurant_id = $1 ORDER BY table_number', [restaurantId]);
    
    res.json(result.rows);
  } catch (error) {
    console.error(`Table status error for ${req.params.restaurantId}:`, error.message);
    res.status(500).json({ error: 'Failed to load table status' });
  }
});

// QR Code Generation
app.post('/api/qr/generate', async (req, res) => {
  try {
    const { restaurantId, qrType, tableNumber, url } = req.body;
    
    if (!restaurantId || !qrType) {
      return res.status(400).json({ error: 'restaurantId and qrType required' });
    }

    const result = await pool.query(
      'INSERT INTO qr_codes (restaurant_id, qr_type, table_number, url) VALUES ($1, $2, $3, $4) RETURNING id',
      [restaurantId, qrType, tableNumber || null, url || '']
    );
    
    res.status(201).json({ 
      qrId: result.rows[0].id, 
      qrType, 
      url: url || `https://qr.insane.marketing/${qrType}/${result.rows[0