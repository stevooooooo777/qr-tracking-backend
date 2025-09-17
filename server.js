const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
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
  }
});

// Initialize database tables and fix schema
async function initializeDatabase() {
  try {
    console.log('Initializing database tables and fixing schema...');

    // Create users table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        full_name VARCHAR(100),
        restaurant_id VARCHAR(50),
        restaurant_name VARCHAR(100),
        user_type VARCHAR(20) DEFAULT 'restaurant'
      );
    `);

    // Add missing columns to users table
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS full_name VARCHAR(100),
      ADD COLUMN IF NOT EXISTS restaurant_id VARCHAR(50),
      ADD COLUMN IF NOT EXISTS restaurant_name VARCHAR(100),
      ADD COLUMN IF NOT EXISTS user_type VARCHAR(20) DEFAULT 'restaurant';
    `);

    // Create qr_scans table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS qr_scans (
        id SERIAL PRIMARY KEY,
        restaurant_id VARCHAR(50),
        qr_type VARCHAR(20),
        table_number INTEGER,
        timestamp TIMESTAMP DEFAULT NOW()
      );
    `);

    // Create table_alerts table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS table_alerts (
        id SERIAL PRIMARY KEY,
        restaurant_id VARCHAR(50),
        table_number INTEGER,
        message TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Create table_status table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS table_status (
        id SERIAL PRIMARY KEY,
        restaurant_id VARCHAR(50),
        table_number INTEGER,
        status VARCHAR(20) DEFAULT 'inactive'
      );
    `);

    // Create qr_codes table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS qr_codes (
        id SERIAL PRIMARY KEY,
        restaurant_id VARCHAR(50),
        qr_type VARCHAR(50),
        table_number INTEGER,
        url TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Insert test data into users
    const passwordHash = await bcrypt.hash('testpassword', 10);
    await pool.query(`
      INSERT INTO users (email, password_hash, full_name, restaurant_id, restaurant_name, user_type)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (email) DO NOTHING;
    `, ['test@example.com', passwordHash, 'Test User', 'demo', 'Demo Restaurant', 'restaurant']);

    // Insert test data into qr_scans
    await pool.query(`
      INSERT INTO qr_scans (restaurant_id, qr_type, table_number, timestamp)
      VALUES ($1, $2, $3, NOW());
    `, ['demo', 'menu', 1]);

    // Insert test data into table_alerts
    await pool.query(`
      INSERT INTO table_alerts (restaurant_id, table_number, message, created_at)
      VALUES ($1, $2, $3, NOW());
    `, ['demo', 1, 'Ready to order']);

    // Insert test data into table_status
    await pool.query(`
      INSERT INTO table_status (restaurant_id, table_number, status)
      VALUES ($1, $2, $3);
    `, ['demo', 1, 'active']);

    // Insert test data into qr_codes
    await pool.query(`
      INSERT INTO qr_codes (restaurant_id, qr_type, table_number, url, created_at)
      VALUES ($1, $2, $3, $4, NOW());
    `, ['demo', 'menu', 1, 'https://example.com/menu']);

    console.log('Database tables initialized and schema fixed successfully');
  } catch (error) {
    console.error('Database initialization error:', error.message);
  }
}

// Run initialization
initializeDatabase().then(() => {
  console.log('Database initialization complete');
}).catch((err) => {
  console.error('Failed to initialize database:', err.message);
});

// Test DB connection
pool.connect((err, client, release) => {
  if (err) {
    console.error('DB connection error:', err.stack);
    return;
  }
  console.log('Connected to Postgres');
  release();
});

// Health check
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Register endpoint
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, restaurantName, fullName } = req.body;
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

    // Generate restaurant ID
    const restaurantId = restaurantName
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '')
      .substring(0, 20);

    // Insert new user
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, full_name, restaurant_id, restaurant_name, user_type) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, email, full_name, restaurant_id, restaurant_name, user_type',
      [email, passwordHash, fullName || 'Unknown', restaurantId, restaurantName, 'restaurant']
    );

    const user = result.rows[0];

    // Generate JWT
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