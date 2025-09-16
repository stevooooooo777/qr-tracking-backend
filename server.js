const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const app = express();

// Middleware - CORS first
app.use(cors({
  origin: ['https://insane.marketing', 'http://localhost:3000'], // Frontend and local dev
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(express.json());

// Postgres connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
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
      process.env.JWT_SECRET || 'fallback-secret-please-change-this',
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
    const result = await pool.query('SELECT * FROM scans WHERE restaurant_id = $1', [restaurantId]);
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
    const result = await pool.query('SELECT * FROM alerts WHERE restaurant_id = $1', [restaurantId]);
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
    const result = await pool.query('SELECT * FROM tables WHERE restaurant_id = $1', [restaurantId]);
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


// Start server
const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});