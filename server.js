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

// Helper function to get or create restaurant
async function getOrCreateRestaurant(restaurantName) {
  try {
    // Check if restaurant exists
    const existing = await pool.query(
      'SELECT id, name FROM restaurants WHERE LOWER(name) = LOWER($1)',
      [restaurantName]
    );
    
    if (existing.rows.length > 0) {
      return existing.rows[0];
    }

    // Create new restaurant
    const result = await pool.query(
      'INSERT INTO restaurants (name) VALUES ($1) RETURNING id, name',
      [restaurantName]
    );
    
    return result.rows[0];
  } catch (error) {
    console.error('Restaurant error:', error.message);
    throw error;
  }
}

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

    // Get or create restaurant
    const restaurant = await getOrCreateRestaurant(restaurantName);

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Insert new user
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, full_name, restaurant_id, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING id, email, full_name, restaurant_id',
      [email, passwordHash, fullName || 'Unknown User', restaurant.id]
    );

    const user = result.rows[0];

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, restaurantId: restaurant.id, restaurantName: restaurant.name, userType: 'restaurant' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.status(201).json({
      token,
      restaurantName: restaurant.name,
      restaurantId: restaurant.id,
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

    const result = await pool.query(`
      SELECT u.id, u.email, u.full_name, u.restaurant_id, r.name as restaurant_name 
      FROM users u 
      LEFT JOIN restaurants r ON u.restaurant_id = r.id 
      WHERE u.email = $1
    `, [email]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const isValid = await bcrypt.compare(password, user.password_hash);
    
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: user.id, restaurantId: user.restaurant_id, restaurantName: user.restaurant_name, userType: 'restaurant' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.json({
      token,
      restaurantName: user.restaurant_name,
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
    res.json({
      totalScans: result.rowCount,
      todayScans: 0, // TODO: Add real calculation
      weeklyScans: 0, // TODO: Add real calculation
      monthlyScans: 0, // TODO: Add real calculation
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
    const result = await pool.query('SELECT * FROM table_alerts WHERE restaurant_id = $1 ORDER BY created_at DESC LIMIT 20', [restaurantId]);
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
      'INSERT INTO qr_codes (restaurant_id, qr_type, table_number, url) VALUES ($1, $2, $3, $4) RETURNING id, qr_type, url',
      [restaurantId, qrType, tableNumber || null, url || '']
    );
    res.status(201).json({ qrId: result.rows[0].id, qrType: result.rows[0].qr_type, url: result.rows[0].url });
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

    // Clear existing tables for this restaurant
    await pool.query('DELETE FROM table_status WHERE restaurant_id = $1', [restaurantId]);

    // Insert new tables
    for (let i = 1; i <= numberOfTables; i++) {
      await pool.query(
        'INSERT INTO table_status (restaurant_id, table_number, status) VALUES ($1, $2, $3)',
        [restaurantId, i, 'inactive']
      );
    }

    res.status(201).json({ message: `Tables 1-${numberOfTables} set up successfully` });
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