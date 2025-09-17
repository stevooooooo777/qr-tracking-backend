const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const app = express();

// Middleware - CORS first (anticipates origin mismatches)
app.use(cors({
  origin: ['https://insane.marketing', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(express.json());

// Postgres connection with enhanced SSL (anticipates SSL protocol/cipher errors)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
    minVersion: 'TLSv1.2',
    maxVersion: 'TLSv1.3'
  },
  connectionTimeoutMillis: 10000, // Anticipates timeouts
  idleTimeoutMillis: 10000
});

// Test DB connection with retry (anticipates transient connection errors)
async function testDbConnection() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const client = await pool.connect();
      console.log('Connected to Postgres on attempt', attempt);
      client.release();
      return;
    } catch (err) {
      console.error('DB connection error on attempt', attempt, ':', err.stack);
      if (attempt === 3) throw err;
      await new Promise(resolve => setTimeout(resolve, 5000)); // Retry delay
    }
  }
}

testDbConnection().catch(err => {
  console.error('Failed to connect to Postgres after retries:', err);
  process.exit(1); // Anticipates unrecoverable DB issues
});

// Health check
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Register endpoint with validation (anticipates missing data, duplicates)
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, restaurantName } = req.body;
    if (!email || !password || !restaurantName) {
      return res.status(400).json({ error: 'Email, password, and restaurant name required' });
    }

    // Check if user exists (anticipates unique constraint)
    const existingUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Hash password (anticipates bcrypt errors)
    let passwordHash;
    try {
      passwordHash = await bcrypt.hash(password, 10);
    } catch (hashErr) {
      console.error('Hashing error:', hashErr.message);
      throw new Error('Failed to hash password');
    }

    // Generate restaurant ID
    const restaurantId = restaurantName
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '')
      .substring(0, 20);

    // Insert new user
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, restaurant_id, restaurant_name, user_type) VALUES ($1, $2, $3, $4, $5) RETURNING id, email, restaurant_id, restaurant_name, user_type',
      [email, passwordHash, restaurantId, restaurantName, 'restaurant']
    );

    const user = result.rows[0];

    // Generate JWT (anticipates missing secret)
    if (!process.env.JWT_SECRET) {
      console.error('JWT_SECRET is not set');
      throw new Error('JWT secret not configured');
    }
    const token = jwt.sign(
      { userId: user.id, restaurantId: user.restaurant_id, userType: user.user_type },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.status(201).json({
      token,
      restaurantName: user.restaurant_name,
      restaurantId: user.restaurant_id,
      userType: user.user_type
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
    const token = jwt.sign(
      { userId: user.id, restaurantId: user.restaurant_id, userType: user.user_type },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    res.json({
      token,
      restaurantName: user.restaurant_name,
      restaurantId: user.restaurant_id,
      userType: user.user_type || 'restaurant'
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
    const result = await pool.query('SELECT * FROM qr_scans WHERE restaurant_id = $1', [restaurantId]);
    res.json({
      totalScans: result.rowCount,
      todayScans: 0,
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
    const result = await pool.query('SELECT * FROM table_alerts WHERE restaurant_id = $1', [restaurantId]);
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
    const result = await pool.query('SELECT * FROM table_status WHERE restaurant_id = $1', [restaurantId]);
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
    res.status(201).json({ qrId: result.rows[0].id, qrType, url });
  } catch (error) {
    console.error('QR generation error:', error.message);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// Table Setup
app.post('/api/tables/setup', async (req, res) => {
  try {
    const { restaurantId, numberOfTables } = req.body;
    if (!restaurantId || !numberOfTables) {
      return res.status(400).json({ error: 'restaurantId and numberOfTables required' });
    }
    await pool.query('DELETE FROM table_status WHERE restaurant_id = $1', [restaurantId]);
    for (let i = 1; i <= numberOfTables; i++) {
      await pool.query(
        'INSERT INTO table_status (restaurant_id, table_number, status) VALUES ($1, $2, $3)',
        [restaurantId, i, 'inactive']
      );
    }
    res.status(201).json({ message: 'Tables set up successfully' });
  } catch (error) {
    console.error('Table setup error:', error.message);
    res.status(500).json({ error: 'Failed to set up tables' });
  }
});

// Service Request
app.post('/api/service/request', async (req, res) => {
  try {
    const { restaurantId, tableNumber, requestType } = req.body;
    if (!restaurantId || !tableNumber || !requestType) {
      return res.status(400).json({ error: 'restaurantId, tableNumber, and requestType required' });
    }
    await pool.query(
      'INSERT INTO table_alerts (restaurant_id, table_number, message, created_at) VALUES ($1, $2, $3, NOW())',
      [restaurantId, tableNumber, requestType]
    );
    res.status(201).json({ message: 'Request sent successfully' });
  } catch (error) {
    console.error('Service request error:', error.message);
    res.status(500).json({ error: 'Failed to send request' });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Global error:', err.message);
  res.status(500).json({ error: 'Server error' });
});

// Start server
const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});