require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const Joi = require('joi');

const webpush = require('web-push')
webpush.setVapidDetails(
  'mailto:your-email@example.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);
const rateLimit = require('express-rate-limit');

// Log startup
console.log('DATABASE_URL:', process.env.DATABASE_URL);
console.log('Starting server initialization...');

// Create Express app
console.log('Creating Express app...');
const app = express();

// Updated CORS
// Middleware - CORS first
console.log('Setting up middleware...');
app.use(cors({
  origin: ['https://qr.insane.marketing', 'https://insane.marketing', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));


app.use(helmet());
// Log every request
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`); // Optional logging
  next();
});



// Root path health check
app.get('/', (req, res) => {
  console.log('[HEALTH] Root path checked');
  res.status(200).send('OK');
});



// SIMPLE HEALTH CHECK FOR RAILWAY (no database)
app.get('/api/health', (req, res) => {
  console.log('[HEALTH] /api/health called from:', req.ip);
  
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Length', '2');
  res.writeHead(200);
  res.end('OK');
  
  console.log('[HEALTH] Response sent');
});



// ======================================================
// DETAILED HEALTH CHECK WITH DATABASE (for monitoring)
// ======================================================
app.get('/api/health/detailed', async (req, res) => {
  console.log('[HEALTH] Detailed health check with database');
  try {
    const result = await pool.query('SELECT NOW()');
    const dbTime = result.rows[0].now;
    console.log('[HEALTH] Database query successful');
    
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected',
      dbTime: dbTime.toISOString()
    });
  } catch (error) {
    console.error('[HEALTH] Database error:', error.message);
    res.status(200).json({
      status: 'degraded',
      timestamp: new Date().toISOString(),
      database: 'error',
      error: error.message
    });
  }
});


app.use(express.json());

// Postgres connection
console.log('Creating database pool...');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

console.log('DATABASE_URL configured:', !!process.env.DATABASE_URL);

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set in environment variables!');
  process.exit(1);
}

// Test DB connection on startup (async)
console.log('Testing database connection...');
async function testDbConnection() {
  try {
    const result = await pool.query('SELECT NOW()');
    console.log(`Database connected! Time: ${result.rows[0].now}`);
  } catch (error) {
    console.error('Database connection failed:', error.message);
    console.log('Health checks will still work - just no DB data');
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
  console.log('New client connected to Postgres');
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  // Don't exit - keep server alive
});


  



// User Registration
app.post('/api/register', async (req, res) => {
  try {
    const schema = Joi.object({
      email: Joi.string().email().required(),
      password: Joi.string().min(6).required(),
      full_name: Joi.string().required(),
      company_name: Joi.string().required(),
      restaurant_id: Joi.string().required()
    });

    const { error } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { email, password, full_name, company_name, restaurant_id } = req.body;
    const saltRounds = 10;
    const password_hash = await bcrypt.hash(password, saltRounds);

    await ensureRestaurantExists(restaurant_id);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, full_name, company_name, restaurant_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [email, password_hash, full_name, company_name, restaurant_id]
    );

    res.status(201).json({ success: true, userId: result.rows[0].id });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Email already exists' });
    }
    console.error('Register error:', error);
    res.status(500).json({ error: 'Failed to register' });
  }
});


// User Login
app.post('/api/login', async (req, res) => {
  try {
    const schema = Joi.object({
      email: Joi.string().email().required(),
      password: Joi.string().required()
    });

    const { error } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { email, password } = req.body;
    const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = userResult.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, email: user.email, restaurant_id: user.restaurant_id }, JWT_SECRET, { expiresIn: '1h' });

    await pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

    res.json({ success: true, token, restaurant_id: user.restaurant_id, restaurant_name: user.company_name });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Failed to login' });
  }
});

app.use(express.json({ limit: '10mb' }));



// Rate limiting with production settings
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 1000 : 2000,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});
app.use(limiter);


// JWT Authentication Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];  // Bearer <token>
  if (!token) return res.status(401).json({ error: 'Unauthorized - No token provided' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Forbidden - Invalid token' });
    req.user = user;
    next();
  });
}


const vapidKeys = {
  publicKey: process.env.VAPID_PUBLIC_KEY,
  privateKey: process.env.VAPID_PRIVATE_KEY
};

if (!vapidKeys.publicKey || !vapidKeys.privateKey) {
  console.error('❌ VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY is not set in environment variables!');
  process.exit(1);
}

try {
  webpush.setVapidDetails(
    'mailto:support@insane.marketing',
    vapidKeys.publicKey,
    vapidKeys.privateKey
  );
  console.log('✅ Web push VAPID details set successfully');
} catch (error) {
  console.error('❌ Failed to set VAPID details:', error.message);
  process.exit(1);
}


// ======================================================
// PUSH NOTIFICATION SETUP




// DATABASE INITIALIZATION WITH PREDICTIVE ANALYTICS
// ======================================================

async function initializeDatabase() {
  try {
    
// Test database connection
    const client = await pool.connect();
    console.log('Database connected successfully');
    client.release();

    // Create restaurants table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS restaurants (
        restaurant_id VARCHAR(100) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
console.log('✅ Restaurants table initialized');

    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        company_name VARCHAR(255) NOT NULL,
        restaurant_id VARCHAR(100) NOT NULL,
        plan VARCHAR(50) DEFAULT 'professional',
        created_at TIMESTAMP DEFAULT NOW(),
        last_login TIMESTAMP,
        is_active BOOLEAN DEFAULT true,
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(restaurant_id) ON DELETE CASCADE
      )
    `);
console.log('✅ Users table initialized');


 
    // Create qr_codes table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS qr_codes (
        id SERIAL PRIMARY KEY,
        restaurant_id VARCHAR(100) NOT NULL,
        qr_type VARCHAR(50) NOT NULL,
        tracking_url TEXT NOT NULL,
        destination_url TEXT NOT NULL,
        table_number INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(restaurant_id) ON DELETE CASCADE
      )
    `);

    // Create qr_scans table
    await pool.query(`
  CREATE TABLE IF NOT EXISTS qr_scans (
    id SERIAL PRIMARY KEY,
    restaurant_id VARCHAR(100) NOT NULL,
    qr_id INTEGER,
    qr_type VARCHAR(50) NOT NULL,
    table_number INTEGER,
    scan_timestamp TIMESTAMP DEFAULT NOW(),
    user_agent TEXT,
    ip_address INET,
    referrer TEXT,
    session_duration INTEGER,
    converted BOOLEAN,
    FOREIGN KEY (restaurant_id) REFERENCES restaurants(restaurant_id) ON DELETE CASCADE,
    FOREIGN KEY (qr_id) REFERENCES qr_codes(id) ON DELETE CASCADE
  )
`);

    // Create table_sessions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS table_sessions (
        id SERIAL PRIMARY KEY,
        restaurant_id VARCHAR(100) NOT NULL,
        table_number INTEGER NOT NULL,
        session_id VARCHAR(100) UNIQUE NOT NULL,
        start_time TIMESTAMP NOT NULL,
        last_activity TIMESTAMP NOT NULL,
        customer_count INTEGER DEFAULT 1,
        status VARCHAR(20) DEFAULT 'active',
        total_scans INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        ended_at TIMESTAMP,
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(restaurant_id) ON DELETE CASCADE
      )
    `);

    // Create service_alerts table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS service_alerts (
        id SERIAL PRIMARY KEY,
        alert_id VARCHAR(100) UNIQUE NOT NULL,
        restaurant_id VARCHAR(100) NOT NULL,
        table_number INTEGER NOT NULL,
        alert_type VARCHAR(50) NOT NULL,
        service_type VARCHAR(50),
        message TEXT NOT NULL,
        action_required TEXT,
        priority VARCHAR(20) DEFAULT 'medium',
        source VARCHAR(30) DEFAULT 'behavioral',
        resolved BOOLEAN DEFAULT FALSE,
        resolved_at TIMESTAMP,
        resolved_by VARCHAR(100),
        acknowledged BOOLEAN DEFAULT FALSE,
        acknowledged_at TIMESTAMP,
        acknowledged_by VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW(),
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(restaurant_id) ON DELETE CASCADE
      )
    `);

    // Create table_activities table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS table_activities (
        id SERIAL PRIMARY KEY,
        restaurant_id VARCHAR(100) NOT NULL,
        table_number INTEGER NOT NULL,
        session_id VARCHAR(100),
        qr_type VARCHAR(50) NOT NULL,
        activity_data JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(restaurant_id) ON DELETE CASCADE
      )
    `);

    // Create performance_snapshots table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS performance_snapshots (
        id SERIAL PRIMARY KEY,
        restaurant_id VARCHAR(100) NOT NULL,
        snapshot_time TIMESTAMP NOT NULL,
        qr_scans_last_hour INTEGER DEFAULT 0,
        qr_scans_last_2hours INTEGER DEFAULT 0,
        customer_count INTEGER,
        revenue_actual DECIMAL(10,2),
        staff_count INTEGER,
        weather_condition VARCHAR(50),
        day_of_week INTEGER,
        hour_of_day INTEGER,
        is_holiday BOOLEAN DEFAULT FALSE,
        local_events TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(restaurant_id) ON DELETE CASCADE
      )
    `);

    // Create prediction_models table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS prediction_models (
        id SERIAL PRIMARY KEY,
        restaurant_id VARCHAR(100) NOT NULL,
        model_type VARCHAR(50) NOT NULL,
        model_data JSONB NOT NULL,
        accuracy_score DECIMAL(5,4),
        training_data_count INTEGER,
        last_trained TIMESTAMP DEFAULT NOW(),
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(restaurant_id) ON DELETE CASCADE
      )
    `);

    // Create live_predictions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS live_predictions (
        id SERIAL PRIMARY KEY,
        restaurant_id VARCHAR(100) NOT NULL,
        prediction_type VARCHAR(50) NOT NULL,
        prediction_time TIMESTAMP NOT NULL,
        predicted_value DECIMAL(10,2),
        confidence_score DECIMAL(5,4),
        recommended_action TEXT,
        actual_value DECIMAL(10,2),
        accuracy_score DECIMAL(5,4),
status VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW(),
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(restaurant_id) ON DELETE CASCADE
      )
    `);

    // Create staffing_recommendations table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS staffing_recommendations (
        id SERIAL PRIMARY KEY,
        restaurant_id VARCHAR(100) NOT NULL,
        recommendation_time TIMESTAMP NOT NULL,
        current_staff INTEGER,
        recommended_staff INTEGER,
        predicted_revenue DECIMAL(10,2),
        confidence_level VARCHAR(20),
        reasoning TEXT,
        implemented BOOLEAN DEFAULT FALSE,
        actual_outcome JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(restaurant_id) ON DELETE CASCADE
      )
    `);

    // Create table_alerts table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS table_alerts (
        id SERIAL PRIMARY KEY,
        restaurant_id VARCHAR(100) NOT NULL,
        table_number INTEGER NOT NULL,
status VARCHAR(20) DEFAULT 'created' NOT NULL,
        alert_type VARCHAR(50) NOT NULL,
        message TEXT,        
        created_at TIMESTAMP DEFAULT NOW(),
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(restaurant_id) ON DELETE CASCADE
      )
    `);

    // Create table_status table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS table_status (
        id SERIAL PRIMARY KEY,
        restaurant_id VARCHAR(100) NOT NULL,
        table_number INTEGER NOT NULL,
        status VARCHAR(50) NOT NULL,
        last_updated TIMESTAMP DEFAULT NOW(),
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(restaurant_id) ON DELETE CASCADE
      )
    `);

    // Create indexes for performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_qr_scans_restaurant_date 
      ON qr_scans(restaurant_id, scan_timestamp DESC)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_table_sessions_restaurant_active 
      ON table_sessions(restaurant_id, status, last_activity DESC)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_service_alerts_restaurant_unresolved 
      ON service_alerts(restaurant_id, resolved, priority, created_at DESC)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_performance_snapshots_restaurant_time 
      ON performance_snapshots(restaurant_id, snapshot_time DESC)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_live_predictions_restaurant_type 
      ON live_predictions(restaurant_id, prediction_type, created_at DESC)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_table_alerts_restaurant_status 
      ON table_alerts(restaurant_id, status, created_at DESC)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_table_status_restaurant 
      ON table_status(restaurant_id, last_updated DESC)
    `);

    // Create notification tables
    await createNotificationTables();

    console.log('Database tables initialized successfully with predictive analytics');
  } catch (error) {
    console.error('Database initialization failed:', error);
    throw error;
  }
}


// ======================================================
// NOTIFICATION TABLES CREATION
// ======================================================

async function createNotificationTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id SERIAL PRIMARY KEY,
        restaurant_id VARCHAR(100) NOT NULL,
        staff_type VARCHAR(50) NOT NULL,
        staff_name VARCHAR(100),
        phone_number VARCHAR(20),
        subscription_data JSONB NOT NULL,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(restaurant_id) ON DELETE CASCADE
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS notification_log (
        id SERIAL PRIMARY KEY,
        alert_id VARCHAR(100) NOT NULL,
        restaurant_id VARCHAR(100) NOT NULL,
        table_number INTEGER,
        notification_type VARCHAR(50),
        status VARCHAR(50) DEFAULT 'sent',
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        delivered_at TIMESTAMP,
        staff_notified JSONB,
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(restaurant_id) ON DELETE CASCADE
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_push_subscriptions_restaurant 
      ON push_subscriptions(restaurant_id, is_active)
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_notification_log_alert 
      ON notification_log(alert_id)
    `);

    console.log('Notification tables created successfully');
  } catch (error) {
    console.error('Error creating notification tables:', error);
    throw error;
  }
}

// ======================================================
// ENSURE DEMO DATA EXISTS
// ======================================================
async function ensureDemoData() {
  try {
    await pool.query(`
      INSERT INTO restaurants (restaurant_id, name)
      VALUES ('demo-restaurant', 'Demo Restaurant')
      ON CONFLICT (restaurant_id) DO NOTHING
    `);
    console.log('✅ Demo restaurant data inserted');
    
    await pool.query(`
      INSERT INTO users (email, password_hash, full_name, company_name, restaurant_id)
      VALUES ('test@example.com', 'hashedpassword', 'Test User', 'Demo Company', 'demo-restaurant')
      ON CONFLICT (email) DO NOTHING
    `);
    console.log('✅ Demo user data inserted');
    
    await pool.query(`
      INSERT INTO push_subscriptions (restaurant_id, staff_name, staff_type, subscription_data)
      VALUES ('demo-restaurant', 'Staff One', 'waiter', '{}')
      ON CONFLICT DO NOTHING
    `);
    console.log('✅ Demo push subscription inserted');
    
    await pool.query(`
      INSERT INTO notification_log (alert_id, restaurant_id, table_number, notification_type, status, staff_notified)
      VALUES ('demo-alert', 'demo-restaurant', 1, 'push', 'sent', '{}')
      ON CONFLICT DO NOTHING
    `);
    console.log('✅ Demo notification log inserted');
    
    await pool.query(`
      INSERT INTO live_predictions (restaurant_id, prediction_type, prediction_time, predicted_value, confidence_score, recommended_action, status)
      VALUES ('demo-restaurant', 'table_turnover', NOW(), 30.5, 0.95, 'Optimize table assignments', 'active')
      ON CONFLICT DO NOTHING
    `);
    console.log('✅ Demo live predictions inserted');
    
    await pool.query(`
      INSERT INTO qr_scans (restaurant_id, scan_timestamp, qr_type, table_number)
      VALUES ('demo-restaurant', NOW(), 'menu', 1)
      ON CONFLICT DO NOTHING
    `);
    console.log('✅ Demo QR scan inserted');
    
  } catch (error) {
    console.error('❌ Failed to ensure demo data:', error);
    throw error;
  }
}

// ======================================================
// UTILITY FUNCTION: ENSURE RESTAURANT EXISTS
// ======================================================

async function ensureRestaurantExists(restaurantId, restaurantName = null) {
  try {
    // Validate restaurant ID first
    if (!restaurantId || typeof restaurantId !== 'string') {
      throw new Error('Invalid restaurant ID provided');
    }

    const name = restaurantName || formatRestaurantName(restaurantId);
    
    console.log(`Ensuring restaurant exists: ${restaurantId} with name: ${name}`);

    const result = await pool.query(
      'INSERT INTO restaurants (restaurant_id, name) VALUES ($1, $2) ON CONFLICT (restaurant_id) DO UPDATE SET name = $2 RETURNING *',
      [restaurantId, name]
    );

    console.log(`Restaurant entry confirmed: ${result.rows[0].restaurant_id}`);
    return result.rows[0];

  } catch (error) {
    console.error(`Failed to ensure restaurant ${restaurantId} exists:`, error);
    throw error; // Re-throw to make registration fail if restaurant creation fails
  }
}

// ======================================================
// PUSH NOTIFICATION FUNCTIONS
// ======================================================

async function sendNotificationToStaff(restaurantId, notificationData, targetStaffType = null) {
  try {
    const staffQuery = targetStaffType
      ? `SELECT * FROM push_subscriptions 
         WHERE restaurant_id = $1 AND is_active = true AND staff_type = $2`
      : `SELECT * FROM push_subscriptions 
         WHERE restaurant_id = $1 AND is_active = true`;
    
    const params = targetStaffType ? [restaurantId, targetStaffType] : [restaurantId];
    const subscriptions = await pool.query(staffQuery, params);

    if (subscriptions.rows.length === 0) {
      console.log(`No active subscriptions found for ${restaurantId}`);
      return { sent: 0, failed: 0 };
    }

    let sent = 0, failed = 0;
    const staffNotified = [];

    for (const sub of subscriptions.rows) {
      const subscription = sub.subscription_data;
      const payload = JSON.stringify({
        title: notificationData.title,
        body: notificationData.body,
        tableNumber: notificationData.tableNumber,
        alertId: notificationData.alertId,
        type: notificationData.type,
        tag: `table-${notificationData.tableNumber}`,
        url: '/table-control-center.html?mobile=true'
      });

      try {
        await webpush.sendNotification(subscription, payload);
        sent++;
        staffNotified.push({
          id: sub.id,
          name: sub.staff_name,
          type: sub.staff_type,
          method: 'push'
        });
        console.log(`✅ Push sent to ${sub.staff_name} (${sub.staff_type})`);
      } catch (error) {
        failed++;
        console.error(`❌ Push failed to ${sub.staff_name}:`, error.message);
        // TODO: Implement SMS backup if needed
      }
    }

    // Log notification attempt
    await pool.query(
      `INSERT INTO notification_log 
       (alert_id, restaurant_id, table_number, notification_type, status, staff_notified) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        notificationData.alertId,
        restaurantId,
        notificationData.tableNumber,
        'push',
        sent > 0 ? 'sent' : 'failed',
        JSON.stringify(staffNotified)
      ]
    );

    return { sent, failed, staffNotified };
  } catch (error) {
    console.error('Error sending notifications:', error);
    return { sent: 0, failed: 1, error: error.message };
  }
}

// ======================================================
// PREDICTIVE ANALYTICS ENGINE
// ======================================================

class PredictiveAnalyticsEngine {
  constructor() {
    this.activeRestaurants = new Set();
    this.intervals = new Map();
  }

  // Start continuous data collection for a restaurant
  startDataCollection(restaurantId) {
    if (this.activeRestaurants.has(restaurantId)) {
      console.log(`Predictive analytics already running for ${restaurantId}`);
      return;
    }

    const interval = setInterval(async () => {
      try {
        await this.collectPerformanceSnapshot(restaurantId);
        await this.generatePredictions(restaurantId);
      } catch (error) {
        console.error(`Predictive analytics error for ${restaurantId}:`, error);
      }
    }, 15 * 60 * 1000); // Every 15 minutes

    this.intervals.set(restaurantId, interval);
    this.activeRestaurants.add(restaurantId);

    console.log(`Predictive analytics started for ${restaurantId}`);
  }

  // Stop data collection for a restaurant
  stopDataCollection(restaurantId) {
    const interval = this.intervals.get(restaurantId);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(restaurantId);
      this.activeRestaurants.delete(restaurantId);
      console.log(`Predictive analytics stopped for ${restaurantId}`);
    }
  }

  // Collect current performance snapshot
  async collectPerformanceSnapshot(restaurantId) {
    try {
      const now = new Date();
      const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      // Get QR scan counts
      const scansLastHour = await pool.query(`
        SELECT COUNT(*) as count FROM qr_scans 
        WHERE restaurant_id = $1 AND scan_timestamp > $2
      `, [restaurantId, hourAgo]);

      const scansLast2Hours = await pool.query(`
        SELECT COUNT(*) as count FROM qr_scans 
        WHERE restaurant_id = $1 AND scan_timestamp > $2
      `, [restaurantId, twoHoursAgo]);

      // Get active table count as proxy for customer count
      const activeTablesResult = await pool.query(`
        SELECT COUNT(*) as count FROM table_sessions 
        WHERE restaurant_id = $1 AND status = 'active' AND last_activity > $2
      `, [restaurantId, hourAgo]);

      const snapshot = {
        restaurant_id: restaurantId,
        snapshot_time: now,
        qr_scans_last_hour: parseInt(scansLastHour.rows[0].count),
        qr_scans_last_2hours: parseInt(scansLast2Hours.rows[0].count),
        customer_count: parseInt(activeTablesResult.rows[0].count) * 2.3, // Estimate customers per table
        day_of_week: now.getDay(),
        hour_of_day: now.getHours(),
        is_holiday: this.isHoliday(now)
      };

      // Store snapshot
      await pool.query(`
        INSERT INTO performance_snapshots 
        (restaurant_id, snapshot_time, qr_scans_last_hour, qr_scans_last_2hours, 
         customer_count, day_of_week, hour_of_day, is_holiday)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        snapshot.restaurant_id, snapshot.snapshot_time, snapshot.qr_scans_last_hour,
        snapshot.qr_scans_last_2hours, snapshot.customer_count, snapshot.day_of_week,
        snapshot.hour_of_day, snapshot.is_holiday
      ]);

      return snapshot;
    } catch (error) {
      console.error('Performance snapshot collection failed:', error);
      return null;
    }
  }

  // Generate predictions based on historical data
  async generatePredictions(restaurantId) {
    try {
      const predictions = await Promise.all([
        this.predictCustomerVolume(restaurantId),
        this.predictStaffingNeeds(restaurantId),
        this.predictRevenue(restaurantId)
      ]);

      // Store predictions
      for (const prediction of predictions) {
        if (prediction) {
          await this.storePrediction(restaurantId, prediction);
        }
      }

      return predictions.filter(p => p !== null);
    } catch (error) {
      console.error('Prediction generation failed:', error);
      return [];
    }
  }

  // Predict customer volume for next 2 hours
  async predictCustomerVolume(restaurantId) {
    try {
      const now = new Date();
      const currentHour = now.getHours();
      const currentDay = now.getDay();

      // Get historical data for same day/time
      const historicalData = await pool.query(`
        SELECT customer_count, qr_scans_last_hour, qr_scans_last_2hours
        FROM performance_snapshots 
        WHERE restaurant_id = $1 
          AND day_of_week = $2 
          AND hour_of_day BETWEEN $3 AND $4
          AND snapshot_time > NOW() - INTERVAL '8 weeks'
        ORDER BY snapshot_time DESC
        LIMIT 50
      `, [restaurantId, currentDay, currentHour - 1, currentHour + 1]);

      if (historicalData.rows.length < 5) {
        return null; // Not enough data for prediction
      }

      // Get current QR scan activity
      const currentActivity = await this.getCurrentActivity(restaurantId);

      // Calculate prediction based on QR scan patterns
      const prediction = this.calculateVolumePredicton(
        historicalData.rows,
        currentActivity
      );

      return {
        type: 'customer_volume',
        predicted_value: prediction.volume,
        confidence_score: prediction.confidence,
        recommended_action: this.generateVolumeRecommendation(prediction.volume, currentActivity)
      };
    } catch (error) {
      console.error('Customer volume prediction failed:', error);
      return null;
    }
  }

  // Predict optimal staffing for next 2 hours
  async predictStaffingNeeds(restaurantId) {
    try {
      const volumePrediction = await this.predictCustomerVolume(restaurantId);
      if (!volumePrediction) return null;

      const predictedCustomers = volumePrediction.predicted_value;
      
      // Staffing model: 1 server per 12-15 customers, minimum 2 staff
      const optimalStaff = Math.max(2, Math.ceil(predictedCustomers / 13));
      const currentStaff = await this.getCurrentStaffCount(restaurantId);
      
      const staffingDifference = optimalStaff - currentStaff;
      let recommendation = '';
      let confidence = volumePrediction.confidence_score;

      if (staffingDifference > 0) {
        recommendation = `Add ${staffingDifference} staff - predicted ${Math.round(predictedCustomers)} customers`;
      } else if (staffingDifference < 0) {
        const potentialSavings = Math.abs(staffingDifference) * 12; // £12/hour per staff
        recommendation = `Reduce by ${Math.abs(staffingDifference)} staff - save £${potentialSavings}/hour`;
      } else {
        recommendation = 'Current staffing is optimal for predicted demand';
      }

      // Store staffing recommendation
      await pool.query(`
        INSERT INTO staffing_recommendations 
        (restaurant_id, recommendation_time, current_staff, recommended_staff, predicted_revenue, confidence_level, reasoning)
        VALUES ($1, NOW(), $2, $3, $4, $5, $6)
      `, [
        restaurantId, currentStaff, optimalStaff, 
        predictedCustomers * 18.50, // Average spend per customer
        confidence > 0.7 ? 'high' : confidence > 0.5 ? 'medium' : 'low',
        recommendation
      ]);

      return {
        type: 'staffing_needs',
        predicted_value: optimalStaff,
        confidence_score: confidence,
        recommended_action: recommendation
      };
    } catch (error) {
      console.error('Staffing prediction failed:', error);
      return null;
    }
  }

  // Predict revenue for next 2 hours
  async predictRevenue(restaurantId) {
    try {
      const volumePrediction = await this.predictCustomerVolume(restaurantId);
      if (!volumePrediction) return null;

      // Get average spend per customer from historical data or use default
      const avgSpend = await this.getAverageSpendPerCustomer(restaurantId);
      const predictedRevenue = volumePrediction.predicted_value * avgSpend;

      return {
        type: 'revenue_forecast',
        predicted_value: predictedRevenue,
        confidence_score: volumePrediction.confidence_score,
        recommended_action: `Expected revenue: £${predictedRevenue.toFixed(2)} next 2 hours`
      };
    } catch (error) {
      console.error('Revenue prediction failed:', error);
      return null;
    }
  }

  // Helper methods
  async getCurrentActivity(restaurantId) {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const result = await pool.query(`
      SELECT COUNT(*) as scans FROM qr_scans 
      WHERE restaurant_id = $1 AND scan_timestamp > $2
    `, [restaurantId, hourAgo]);

    return {
      scans_last_hour: parseInt(result.rows[0].scans),
      timestamp: new Date()
    };
  }

  calculateVolumePredicton(historicalData, currentActivity) {
    // Correlation-based prediction
    const correlations = historicalData.map(row => ({
      customer_count: row.customer_count,
      scan_activity: row.qr_scans_last_hour
    }));

    // Find similar scan activity patterns
    const similarPatterns = correlations.filter(pattern => 
      Math.abs(pattern.scan_activity - currentActivity.scans_last_hour) <= 3
    );

    if (similarPatterns.length === 0) {
      // Fallback to overall average with low confidence
      const avgCustomers = correlations.reduce((sum, p) => sum + p.customer_count, 0) / correlations.length;
      return { volume: Math.max(0, avgCustomers), confidence: 0.3 };
    }

    // Average customer count for similar scan patterns
    const predictedVolume = similarPatterns.reduce((sum, p) => sum + p.customer_count, 0) / similarPatterns.length;
    const confidence = Math.min(0.95, 0.4 + (similarPatterns.length * 0.1));

    return { volume: Math.max(0, predictedVolume), confidence };
  }

  generateVolumeRecommendation(predictedVolume, currentActivity) {
    const rounded = Math.round(predictedVolume);
    
    if (predictedVolume > 20) {
      return `High volume predicted (${rounded} customers) - prepare for busy period`;
    } else if (predictedVolume < 5) {
      return `Low volume predicted (${rounded} customers) - consider cost optimization`;
    } else {
      return `Moderate volume predicted (${rounded} customers) - maintain current operations`;
    }
  }

  async getCurrentStaffCount(restaurantId) {
    // Estimate based on day/time (would integrate with actual staffing system)
    const hour = new Date().getHours();
    const day = new Date().getDay();
    const isWeekend = day === 0 || day === 6;
    
    if (hour >= 11 && hour <= 14) return Math.round(4 * (isWeekend ? 1.2 : 1)); // Lunch rush
    if (hour >= 18 && hour <= 21) return Math.round(5 * (isWeekend ? 1.2 : 1)); // Dinner rush
    return Math.round(2 * (isWeekend ? 1.2 : 1)); // Off-peak
  }

  async getAverageSpendPerCustomer(restaurantId) {
    // Would integrate with POS system - using industry average for now
    return 18.50;
  }

  async storePrediction(restaurantId, prediction) {
    await pool.query(`
      INSERT INTO live_predictions 
      (restaurant_id, prediction_type, prediction_time, predicted_value, confidence_score, recommended_action)
      VALUES ($1, $2, NOW(), $3, $4, $5)
    `, [
      restaurantId, prediction.type, prediction.predicted_value,
      prediction.confidence_score, prediction.recommended_action
    ]);
  }

  isHoliday(date) {
    // Simple UK holiday detection
    const month = date.getMonth();
    const day = date.getDate();
    
    const holidays = [
      [11, 25], [11, 26], [0, 1], [4, 1], [4, 8] // Christmas, Boxing Day, New Year, May Days
    ];
    
    return holidays.some(([m, d]) => month === m && day === d);
  }
}

// Initialize predictive analytics engine
const predictiveEngine = {
  sendNotificationToStaff: async ({ restaurantId, tableNumber, alertId, title, body, type }) => {
    try {
      const subscriptions = await pool.query(
        'SELECT * FROM push_subscriptions WHERE restaurant_id = $1',
        [restaurantId]
      );
      for (const subscription of subscriptions.rows) {
        await webpush.sendNotification(
          subscription.subscription,
          JSON.stringify({ title, body, alertId, type })
        );
      }
    } catch (error) {
      console.error('Error sending push notification:', error);
    }
  }
};


// ======================================================
// HEALTH CHECK & STATUS
// ======================================================

app.get('/api/status', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    
    res.json({ 
      status: 'online',
      timestamp: new Date().toISOString(),
      service: 'Restaurant Intelligence Tracking Server',
      database: 'connected',
      uptime: process.uptime(),
      version: '2.1.0',
      environment: process.env.NODE_ENV || 'development',
      features: [
        'QR Tracking',
        'Table Intelligence', 
        'Service Alerts',
        'Predictive Analytics',
        'Push Notifications'
      ],
      predictive_analytics: {
        active_restaurants: predictiveEngine.activeRestaurants.size,
        status: 'operational'
      },
      notifications: {
        vapid_configured: !!vapidKeys.publicKey && vapidKeys.publicKey !== 'YOUR_VAPID_PUBLIC_KEY',
        sms_configured: !!smsClient
      }
    });
  } catch (error) {
    console.error('Status check failed:', error);
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      service: 'Restaurant Intelligence Tracking Server',
      database: 'disconnected',
      error: error.message
    });
  }
});

// ======================================================
// NOTIFICATION API ROUTES
// ======================================================

// Get VAPID public key for client
app.get('/api/notifications/vapid-public-key', (req, res) => {
  res.json({
    publicKey: vapidKeys.publicKey
  });
});

// Register push subscription
app.post('/api/notifications/subscribe', authenticateToken, async (req, res) => {
  try {
    const schema = Joi.object({
      subscription: Joi.object().required(),
      restaurantId: Joi.string().required(),
      staffType: Joi.string().optional(),
      staffName: Joi.string().optional(),
      phoneNumber: Joi.string().optional()
    });

    const { error } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { subscription, restaurantId, staffType, staffName, phoneNumber } = req.body; 

   
    if (!subscription || !restaurantId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const result = await pool.query(
      `INSERT INTO push_subscriptions 
       (restaurant_id, staff_type, staff_name, phone_number, subscription_data) 
       VALUES ($1, $2, $3, $4, $5) 
       ON CONFLICT (restaurant_id, subscription_data) 
       DO UPDATE SET 
         staff_type = $2, 
         staff_name = $3, 
         phone_number = $4,
         is_active = true, 
         last_used = CURRENT_TIMESTAMP
       RETURNING id`,
      [restaurantId, staffType, staffName, phoneNumber, JSON.stringify(subscription)]
    );

    console.log(`✅ Push subscription registered: ${staffName} (${staffType})`);
    
    res.json({
      success: true,
      subscriptionId: result.rows[0].id,
      message: 'Push notifications enabled'
    });

  } catch (error) {
    console.error('Error registering push subscription:', error);
    res.status(500).json({ error: 'Failed to register subscription' });
  }
});

// Unregister push subscription
app.post('/api/notifications/unsubscribe', authenticateToken, async (req, res) => {
  try {
    const { subscriptionEndpoint, restaurantId } = req.body;
    
    await pool.query(
      `UPDATE push_subscriptions 
       SET is_active = false 
       WHERE restaurant_id = $1 
       AND subscription_data->>'endpoint' = $2`,
      [restaurantId, subscriptionEndpoint]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error unregistering subscription:', error);
    res.status(500).json({ error: 'Failed to unregister subscription' });
  }
});

// Notification delivery confirmation
app.post('/api/notifications/delivered', authenticateToken, async (req, res) => {
  try {
    const { alertId } = req.body;
    
    await pool.query(
      `UPDATE notification_log 
       SET status = 'delivered', delivered_at = CURRENT_TIMESTAMP 
       WHERE alert_id = $1`,
      [alertId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error confirming delivery:', error);
    res.status(500).json({ error: 'Failed to confirm delivery' });
  }
});

// Get notification stats for dashboard
app.get('/api/notifications/stats/:restaurantId', authenticateToken, async (req, res) => {
  try {
    const { restaurantId } = req.params;
    
    const stats = await pool.query(
      `SELECT 
         COUNT(*) as total_sent,
         COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered,
         COUNT(CASE WHEN notification_type = 'push' THEN 1 END) as push_notifications,
         COUNT(CASE WHEN staff_notified::text LIKE '%sms_backup%' THEN 1 END) as sms_backups
       FROM notification_log 
       WHERE restaurant_id = $1 
       AND sent_at > NOW() - INTERVAL '24 hours'`,
      [restaurantId]
    );

    const activeSubscriptions = await pool.query(
      `SELECT COUNT(*) as active_staff, staff_type 
       FROM push_subscriptions 
       WHERE restaurant_id = $1 AND is_active = true 
       GROUP BY staff_type`,
      [restaurantId]
    );

    res.json({
      last24Hours: stats.rows[0],
      activeSubscriptions: activeSubscriptions.rows
    });
  } catch (error) {
    console.error('Error fetching notification stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ======================================================
// QR GENERATION RECORDING
// ======================================================

app.post('/api/qr/generated', async (req, res) => {
  try {
    const { restaurantId, qrType, trackingUrl, destinationUrl, restaurantData } = req.body;

    if (!restaurantId || !qrType) {
      return res.status(400).json({ error: 'Missing required fields: restaurantId, qrType' });
    }

    // Ensure restaurant exists
    await ensureRestaurantExists(restaurantId, restaurantData?.name);

    // Record QR code
    await pool.query(
      'INSERT INTO qr_codes (restaurant_id, qr_type, tracking_url, destination_url) VALUES ($1, $2, $3, $4)',
      [restaurantId, qrType, trackingUrl, destinationUrl]
    );

    console.log(`QR Generated: ${qrType} for ${restaurantId}`);
    res.json({ success: true, message: 'QR generation recorded' });

  } catch (error) {
    console.error('QR generation recording failed:', error);
    res.status(500).json({ error: 'Failed to record QR generation' });
  }
});

// ======================================================
// QR TRACKING ROUTES (FIXED)
// ======================================================

// Regular QR tracking
app.get('/qr/:restaurantId/:qrType', async (req, res) => {
  try {
    const { restaurantId, qrType } = req.params;
    const { dest, ssid, pass } = req.query;
    const userAgent = req.headers['user-agent'];
    const ipAddress = req.ip || req.connection.remoteAddress;

    // ENSURE RESTAURANT EXISTS BEFORE SCAN INSERT
    await ensureRestaurantExists(restaurantId);

    await pool.query(
      'INSERT INTO qr_scans (restaurant_id, qr_type, user_agent, ip_address, destination_url) VALUES ($1, $2, $3, $4, $5)',
      [restaurantId, qrType, userAgent, ipAddress, dest]
    );

    console.log(`Scan recorded: ${qrType} for ${restaurantId}`);
    handleQRResponse(res, restaurantId, qrType, { dest, ssid, pass });

  } catch (error) {
    console.error('QR scan tracking failed:', error);
    handleQRFallback(res, req.query.dest);
  }
});

// Table-specific QR tracking
app.get('/qr/:restaurantId/table/:tableNumber/:qrType', async (req, res) => {
  try {
    const { restaurantId, tableNumber, qrType } = req.params;
    const { dest, ssid, pass } = req.query;
    const userAgent = req.headers['user-agent'];
    const ipAddress = req.ip || req.connection.remoteAddress;
    const tableNum = parseInt(tableNumber);

    // ENSURE RESTAURANT EXISTS BEFORE SCAN INSERT
    await ensureRestaurantExists(restaurantId);

    await pool.query(
      'INSERT INTO qr_scans (restaurant_id, qr_type, table_number, user_agent, ip_address, destination_url) VALUES ($1, $2, $3, $4, $5, $6)',
      [restaurantId, qrType, tableNum, userAgent, ipAddress, dest]
    );

    await updateTableSession(restaurantId, tableNum, qrType, userAgent);
    await generateTableServiceAlerts(restaurantId, tableNum);

    console.log(`Table ${tableNumber} ${qrType} scan recorded for ${restaurantId}`);
    handleQRResponse(res, restaurantId, qrType, { dest, ssid, pass, tableNumber });

  } catch (error) {
    console.error('Table QR tracking failed:', error);
    handleQRFallback(res, req.query.dest);
  }
});

// ======================================================
// PREDICTIVE ANALYTICS API ENDPOINTS
// ======================================================

// Get live predictions for restaurant
app.get('/api/predictions/:restaurantId', authenticateToken, async (req, res) => {
  try {
    const { restaurantId } = req.params;

    const predictions = await pool.query(`
      SELECT prediction_type, predicted_value, confidence_score, recommended_action, created_at
      FROM live_predictions 
      WHERE restaurant_id = $1 
        AND created_at > NOW() - INTERVAL '2 hours'
      ORDER BY created_at DESC
    `, [restaurantId]);

    const staffingRecommendations = await pool.query(`
      SELECT current_staff, recommended_staff, predicted_revenue, confidence_level, reasoning, created_at
      FROM staffing_recommendations 
      WHERE restaurant_id = $1 
        AND created_at > NOW() - INTERVAL '4 hours'
      ORDER BY created_at DESC 
      LIMIT 5
    `, [restaurantId]);

    // Calculate accuracy and savings metrics
    const accuracyData = await calculatePredictionAccuracy(restaurantId);

    res.json({
      restaurantId,
      predictions: predictions.rows,
      staffingRecommendations: staffingRecommendations.rows,
      accuracy: accuracyData,
      lastUpdated: new Date().toISOString()
    });

  } catch (error) {
    console.error('Predictions API error:', error);
    res.status(500).json({ error: 'Failed to load predictions' });
  }
});

// Manual prediction trigger
app.post('/api/predictions/:restaurantId/generate', authenticateToken, async (req, res) => {
  try {
    const { restaurantId } = req.params;
    
    const predictions = await predictiveEngine.generatePredictions(restaurantId);
    
    res.json({
      success: true,
      predictions,
      message: 'Predictions generated successfully'
    });

  } catch (error) {
    console.error('Manual prediction generation failed:', error);
    res.status(500).json({ error: 'Failed to generate predictions' });
  }
});

// Start predictive analytics for restaurant
app.post('/api/predictions/:restaurantId/start', authenticateToken, async (req, res) => {
  try {
    const { restaurantId } = req.params;
    
    predictiveEngine.startDataCollection(restaurantId);
    
    res.json({
      success: true,
      message: `Predictive analytics started for ${restaurantId}`
    });

  } catch (error) {
    console.error('Failed to start predictive analytics:', error);
    res.status(500).json({ error: 'Failed to start predictive analytics' });
  }
});


// 3D - ADD THESE API ENDPOINTS TO YOUR server.js

// Get restaurant data
// Enhanced restaurant endpoint with auto-demo data creation
app.get('/api/restaurant/:restaurantId', async (req, res) => {
  try {
    const { restaurantId } = req.params;
    
    let result = await pool.query(
      'SELECT * FROM restaurants WHERE restaurant_id = $1',
      [restaurantId]
    );
    
    // If restaurant doesn't exist, create demo data automatically
    if (result.rows.length === 0 && restaurantId === 'demo-restaurant') {
      console.log('Creating demo restaurant data...');
      
      await pool.query(
        'INSERT INTO restaurants (restaurant_id, name) VALUES ($1, $2)',
        ['demo-restaurant', 'Demo Restaurant']
      );
      
      // Create some demo scan data for live stats
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      
      await pool.query(
        'INSERT INTO qr_scans (restaurant_id, qr_type, table_number, scan_timestamp) VALUES ($1, $2, $3, $4)',
        ['demo-restaurant', 'menu', 1, today]
      );
      
      await pool.query(
        'INSERT INTO qr_scans (restaurant_id, qr_type, table_number, scan_timestamp, actual_wait_time) VALUES ($1, $2, $3, $4, $5)',
        ['demo-restaurant', 'service', 2, yesterday, 12]
      );
      
      console.log('✅ Demo restaurant data created');
      
      // Fetch the newly created data
      result = await pool.query(
        'SELECT * FROM restaurants WHERE restaurant_id = $1',
        ['demo-restaurant']
      );
    }
    
    if (result.rows.length > 0) {
      res.json(result.rows[0]);
    } else {
      res.status(404).json({ error: 'Restaurant not found' });
    }
  } catch (error) {
    console.error('Error fetching restaurant:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get today's scan count
app.get('/api/analytics/:restaurantId/scans-today', async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const today = new Date().toISOString().split('T')[0];
    
    const result = await pool.query(
      'SELECT COUNT(*) as count FROM qr_scans WHERE restaurant_id = $1 AND DATE(scan_timestamp) = $2',
      [restaurantId, today]
    );
    
    res.json({ count: parseInt(result.rows[0].count) || 0 });
  } catch (error) {
    console.error('Error fetching scan count:', error);
    res.json({ count: 0 });
  }
});

// Get average wait time
app.get('/api/analytics/:restaurantId/avg-wait', async (req, res) => {
  try {
    const { restaurantId } = req.params;
    
    const result = await pool.query(
      'SELECT AVG(actual_wait_time) as avg_wait FROM qr_scans WHERE restaurant_id = $1 AND actual_wait_time IS NOT NULL',
      [restaurantId]
    );
    
    const avgWait = result.rows[0].avg_wait;
    res.json({ minutes: avgWait ? Math.round(avgWait) : 15 });
  } catch (error) {
    console.error('Error fetching avg wait:', error);
    res.json({ minutes: 15 });
  }
});

// Track interaction analytics
app.post('/api/analytics/interaction', async (req, res) => {
  try {
    const { restaurant_id, table_number, interaction_type, qr_type, timestamp } = req.body;
    
    await pool.query(
      'INSERT INTO table_activities (restaurant_id, table_number, qr_type, activity_data, created_at) VALUES ($1, $2, $3, $4, $5)',
      [restaurant_id, table_number, qr_type, JSON.stringify({ interaction_type, timestamp }), new Date()]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error tracking interaction:', error);
    res.status(500).json({ error: 'Failed to track interaction' });
  }
});

// Generate QR codes for 3D experience
app.post('/api/qr/generate', async (req, res) => {
  try {
    const { restaurant_id, qr_type, table_number, destination_url } = req.body;
    
    // Create tracking URL
    const trackingUrl = `${req.protocol}://${req.get('host')}/qr/${restaurant_id}/table/${table_number}/${qr_type}`;
    
    // Store in database
    await pool.query(
      'INSERT INTO qr_codes (restaurant_id, qr_type, tracking_url, destination_url, table_number) VALUES ($1, $2, $3, $4, $5)',
      [restaurant_id, qr_type, trackingUrl, destination_url, table_number]
    );
    
    res.json({
      tracking_url: trackingUrl,
      destination_url: destination_url,
      qr_type: qr_type
    });
  } catch (error) {
    console.error('Error generating QR code:', error);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// ======================================================
// ANALYTICS API (ENHANCED WITH PREDICTIONS)
// ======================================================

app.get('/api/analytics/:restaurantId', async (req, res) => {
  try {
    const { restaurantId } = req.params;

    // Get total scans
    const totalScansResult = await pool.query(
      'SELECT COUNT(*) as total FROM qr_scans WHERE restaurant_id = $1',
      [restaurantId]
    );

    // Get scans by QR type
    const qrScansResult = await pool.query(
      'SELECT qr_type, COUNT(*) as scans FROM qr_scans WHERE restaurant_id = $1 GROUP BY qr_type',
      [restaurantId]
    );

    // Get daily scans for last 7 days
    const dailyScansResult = await pool.query(`
      SELECT DATE(scan_timestamp) as scan_date, COUNT(*) as scans 
      FROM qr_scans 
      WHERE restaurant_id = $1 AND scan_timestamp >= NOW() - INTERVAL '7 days'
      GROUP BY DATE(scan_timestamp) 
      ORDER BY scan_date
    `, [restaurantId]);

    // Get recent activity
    const recentActivityResult = await pool.query(`
      SELECT qr_type, table_number, scan_timestamp, ip_address, destination_url
      FROM qr_scans 
      WHERE restaurant_id = $1 
      ORDER BY scan_timestamp DESC 
      LIMIT 10
    `, [restaurantId]);

    // Get table intelligence summary
    const tableStatsResult = await pool.query(`
      SELECT 
        COUNT(DISTINCT CASE WHEN status = 'active' THEN table_number END) as active_tables,
        COUNT(DISTINCT table_number) as total_tables,
        AVG(EXTRACT(EPOCH FROM (last_activity - start_time))/60) as avg_session_minutes
      FROM table_sessions 
      WHERE restaurant_id = $1 AND DATE(start_time) = CURRENT_DATE
    `, [restaurantId]);

    // Get prediction savings (if available)
    const predictiveSavings = await calculatePredictiveSavings(restaurantId);

    // Format data
    const totalScans = parseInt(totalScansResult.rows[0]?.total || 0);
    
    const qrCodes = {};
    qrScansResult.rows.forEach(row => {
      qrCodes[row.qr_type] = { scans: parseInt(row.scans) };
    });

    const dailyScans = Array(7).fill(0);
    dailyScansResult.rows.forEach(row => {
      const dayIndex = new Date(row.scan_date).getDay();
      dailyScans[dayIndex] = parseInt(row.scans);
    });

    const recentActivity = recentActivityResult.rows.map(row => ({
      qrType: row.qr_type,
      tableNumber: row.table_number,
      timestamp: row.scan_timestamp,
      ip: row.ip_address?.toString().replace(/\.\d+$/, '.xxx'),
      destination: row.destination_url
    }));

    const tableStats = tableStatsResult.rows[0] || {};

    const analytics = {
      restaurantId: restaurantId,
      restaurantName: formatRestaurantName(restaurantId),
      totalScans: totalScans,
      totalSavings: 12847 + Math.floor(totalScans / 100) * 50 + predictiveSavings.weeklySavings,
      qrCodes: qrCodes,
      dailyScans: dailyScans,
      recentActivity: recentActivity,
      engagementRate: totalScans > 0 ? Math.min(95, (totalScans / 10) + 30) : 0,
      scansToday: dailyScans[new Date().getDay()] || 0,
      tableIntelligence: {
        activeTables: parseInt(tableStats.active_tables || 0),
        totalTables: parseInt(tableStats.total_tables || 0),
        avgSessionTime: Math.floor(parseFloat(tableStats.avg_session_minutes || 0))
      },
      predictiveAnalytics: {
        enabled: predictiveEngine.activeRestaurants.has(restaurantId),
        weeklySavings: predictiveSavings.weeklySavings,
        accuracy: predictiveSavings.accuracy
      }
    };

    res.json(analytics);

  } catch (error) {
    console.error('Analytics query failed:', error);
    res.status(500).json({ 
      error: 'Analytics unavailable',
      restaurantId: req.params.restaurantId,
      totalScans: 0
    });
  }
});

// ======================================================
// TABLE INTELLIGENCE FUNCTIONS
// ======================================================

async function updateTableSession(restaurantId, tableNumber, qrType, userAgent) {
  try {
    const sessionTimeout = 30; // minutes
    const now = new Date();
    const cutoffTime = new Date(now.getTime() - sessionTimeout * 60000);

    const sessionResult = await pool.query(`
      SELECT * FROM table_sessions 
      WHERE restaurant_id = $1 AND table_number = $2 AND status = 'active' AND last_activity > $3
      ORDER BY last_activity DESC LIMIT 1
    `, [restaurantId, tableNumber, cutoffTime]);

    let sessionId;

    if (sessionResult.rows.length === 0) {
      sessionId = `${restaurantId}_${tableNumber}_${Date.now()}`;
      
      await pool.query(`
        INSERT INTO table_sessions (restaurant_id, table_number, session_id, start_time, last_activity, customer_count)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [restaurantId, tableNumber, sessionId, now, now, Math.floor(Math.random() * 3) + 1]);

      console.log(`New session started: Table ${tableNumber}`);
    } else {
      sessionId = sessionResult.rows[0].session_id;
      
      await pool.query(`
        UPDATE table_sessions 
        SET last_activity = $1, total_scans = total_scans + 1
        WHERE session_id = $2
      `, [now, sessionId]);
    }

    await pool.query(`
      INSERT INTO table_activities (restaurant_id, table_number, session_id, qr_type, activity_data)
      VALUES ($1, $2, $3, $4, $5)
    `, [restaurantId, tableNumber, sessionId, qrType, JSON.stringify({ userAgent, timestamp: now })]);

  } catch (error) {
    console.error('Table session update failed:', error);
  }
}

async function generateTableServiceAlerts(restaurantId, tableNumber) {
  try {
    const sessionResult = await pool.query(`
      SELECT s.*, 
             COUNT(a.id) as menu_scans_recent,
             EXTRACT(EPOCH FROM (NOW() - s.start_time))/60 as session_duration_minutes,
             EXTRACT(EPOCH FROM (NOW() - s.last_activity))/60 as idle_minutes
      FROM table_sessions s
      LEFT JOIN table_activities a ON s.session_id = a.session_id 
                                   AND a.qr_type = 'menu' 
                                   AND a.created_at > NOW() - INTERVAL '5 minutes'
      WHERE s.restaurant_id = $1 AND s.table_number = $2 AND s.status = 'active'
      GROUP BY s.id, s.session_id, s.start_time, s.last_activity
      ORDER BY s.last_activity DESC LIMIT 1
    `, [restaurantId, tableNumber]);

    if (sessionResult.rows.length === 0) return;

    const session = sessionResult.rows[0];
    const sessionDuration = parseFloat(session.session_duration_minutes);
    const idleTime = parseFloat(session.idle_minutes);
    const menuScansRecent = parseInt(session.menu_scans_recent);

    // Clear existing alerts for this table
    await pool.query(`
      UPDATE service_alerts 
      SET resolved = TRUE, resolved_at = NOW(), resolved_by = 'system_auto'
      WHERE restaurant_id = $1 AND table_number = $2 AND resolved = FALSE
    `, [restaurantId, tableNumber]);

    const alerts = [];

    if (idleTime > 8) {
      alerts.push({
        type: 'idle',
        message: `Table ${tableNumber} idle for ${Math.floor(idleTime)} minutes`,
        action: 'Check if they need assistance',
        priority: 'medium'
      });
    }

    if (sessionDuration > 90) {
      alerts.push({
        type: 'long_session',
        message: `Table ${tableNumber} session over 90 minutes`,
        action: 'Check satisfaction, offer bill',
        priority: 'high'
      });
    }

    if (menuScansRecent >= 2) {
      alerts.push({
        type: 'ready_to_order',
        message: `Table ${tableNumber} viewed menu ${menuScansRecent} times recently`,
        action: 'Likely ready to order - send server',
        priority: 'urgent'
      });
    }

    for (const alert of alerts) {
      const alertId = `${restaurantId}_${tableNumber}_${alert.type}_${Date.now()}`;
      
      await pool.query(`
        INSERT INTO service_alerts (alert_id, restaurant_id, table_number, alert_type, message, action_required, priority, source)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'behavioral')
      `, [alertId, restaurantId, tableNumber, alert.type, alert.message, alert.action, alert.priority]);

      // Send notification for urgent behavioral alerts
      if (alert.priority === 'urgent') {
        await sendNotificationToStaff(restaurantId, {
          title: `📋 Table ${tableNumber} Ready to Order`,
          body: `${menuScansRecent} menu scans in 5 minutes - Customer likely ready to order`,
          tableNumber,
          alertId,
          type: 'behavioral_alert'
        }, 'server');
      }
    }

    if (alerts.length > 0) {
      console.log(`Generated ${alerts.length} service alerts for Table ${tableNumber}`);
    }

  } catch (error) {
    console.error('Service alert generation failed:', error);
  }
}

// ======================================================
// LIVE TABLE DATA API
// ======================================================

app.get('/api/tables/:restaurantId/live', authenticateToken, async (req, res) => {
  try {
    const { restaurantId } = req.params;

    await cleanupOldSessions(restaurantId);

    const sessionsResult = await pool.query(`
      SELECT s.*, 
             EXTRACT(EPOCH FROM (NOW() - s.start_time))/60 as session_duration,
             EXTRACT(EPOCH FROM (NOW() - s.last_activity))/60 as idle_time
      FROM table_sessions s
      WHERE s.restaurant_id = $1 AND s.status = 'active'
      ORDER BY s.table_number
    `, [restaurantId]);

    const tablesResult = await pool.query(`
      SELECT table_number, 
             COUNT(*) as total_scans,
             MAX(scan_timestamp) as last_activity
      FROM qr_scans 
      WHERE restaurant_id = $1 AND table_number IS NOT NULL
      GROUP BY table_number
      ORDER BY table_number
    `, [restaurantId]);

    const alertsResult = await pool.query(`
      SELECT alert_id as id, table_number, alert_type as type, service_type, message, 
             action_required as action, priority, source, created_at as timestamp
      FROM service_alerts
      WHERE restaurant_id = $1 AND resolved = FALSE
      ORDER BY 
        CASE priority 
          WHEN 'urgent' THEN 1 
          WHEN 'high' THEN 2 
          WHEN 'medium' THEN 3 
          ELSE 4 
        END,
        created_at DESC
      LIMIT 20
    `, [restaurantId]);

    const todayScansResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM qr_scans 
      WHERE restaurant_id = $1 AND DATE(scan_timestamp) = CURRENT_DATE
    `, [restaurantId]);

    const tables = {};
    tablesResult.rows.forEach(row => {
      tables[row.table_number] = {
        tableNumber: row.table_number,
        totalScans: parseInt(row.total_scans),
        lastActivity: row.last_activity,
        topActivities: {}
      };
    });

    const sessions = {};
    sessionsResult.rows.forEach(row => {
      sessions[row.table_number] = {
        tableNumber: row.table_number,
        sessionId: row.session_id,
        startTime: row.start_time,
        lastActivity: row.last_activity,
        customerCount: row.customer_count,
        status: row.status,
        totalScans: row.total_scans,
        sessionDuration: Math.floor(row.session_duration),
        idleTime: Math.floor(row.idle_time)
      };
    });

    const summary = {
      activeTables: sessionsResult.rows.length,
      totalTables: tablesResult.rows.length,
      pendingAlerts: alertsResult.rows.length,
      totalScansToday: parseInt(todayScansResult.rows[0]?.count || 0)
    };

    res.json({
      tables,
      sessions,
      alerts: alertsResult.rows,
      summary,
      lastUpdated: new Date().toISOString()
    });

  } catch (error) {
    console.error('Live table data query failed:', error);
    res.status(500).json({
      error: 'Live data unavailable',
      tables: {},
      sessions: {},
      alerts: [],
      summary: { activeTables: 0, totalTables: 0, pendingAlerts: 0, totalScansToday: 0 }
    });
  }
});

async function cleanupOldSessions(restaurantId) {
  try {
    const sessionTimeout = 45; // minutes
    const cutoffTime = new Date(Date.now() - sessionTimeout * 60000);

    await pool.query(`
      UPDATE table_sessions 
      SET status = 'ended', ended_at = NOW()
      WHERE restaurant_id = $1 AND status = 'active' AND last_activity < $2
    `, [restaurantId, cutoffTime]);

    const alertCutoff = new Date(Date.now() - 60 * 60000);
    await pool.query(`
      UPDATE service_alerts 
      SET resolved = TRUE, resolved_at = NOW(), resolved_by = 'system_cleanup'
      WHERE restaurant_id = $1 AND resolved = FALSE AND created_at < $2
    `, [restaurantId, alertCutoff]);

  } catch (error) {
    console.error('Session cleanup failed:', error);
  }
}

// ======================================================
// SERVICE REQUEST HANDLING WITH NOTIFICATIONS
// ======================================================

app.post('/api/service/request', async (req, res) => {
  try {
    const { restaurantId, tableNumber, serviceType, timestamp, urgent } = req.body;

    if (!restaurantId || !tableNumber || !serviceType) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    await ensureRestaurantExists(restaurantId);

    const alertId = `${restaurantId}_${tableNumber}_request_${Date.now()}`;
    const priority = urgent ? 'urgent' : 'high';
    const message = `Table ${tableNumber}: ${serviceType.replace('_', ' ')}`;
    const action = getServiceAction(serviceType);

    await pool.query(`
      INSERT INTO service_alerts (alert_id, restaurant_id, table_number, alert_type, service_type, message, action_required, priority, source)
      VALUES ($1, $2, $3, 'customer_request', $4, $5, $6, $7, 'customer_request')
    `, [alertId, restaurantId, tableNumber, serviceType, message, action, priority]);

    // Send push notifications to staff
    const notificationResult = await sendNotificationToStaff(restaurantId, {
      title: `🔔 Table ${tableNumber} Service Request`,
      body: `${serviceType.replace('_', ' ').toUpperCase()} requested - Customer needs immediate assistance`,
      tableNumber,
      alertId,
      type: 'customer_request'
    }, 'server');

    console.log(`SERVICE REQUEST: Table ${tableNumber} - ${serviceType} - ${notificationResult.sent} staff notified`);

    res.json({ 
      success: true, 
      message: 'Service request recorded and staff notified', 
      alertId,
      notificationsSent: notificationResult.sent
    });

  } catch (error) {
    console.error('Service request error:', error);
    res.status(500).json({ error: 'Failed to process service request' });
  }
});

app.patch('/api/service/resolve/:requestId', async (req, res) => {
  try {
    const { requestId } = req.params;
    const { restaurantId, resolvedBy } = req.body;

    const result = await pool.query(`
      UPDATE service_alerts 
      SET resolved = TRUE, resolved_at = NOW(), resolved_by = $1
      WHERE alert_id = $2 AND restaurant_id = $3 AND resolved = FALSE
      RETURNING *
    `, [resolvedBy || 'staff', requestId, restaurantId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Service request not found' });
    }

    const alert = result.rows[0];
    console.log(`Service request resolved: Table ${alert.table_number} by ${resolvedBy}`);

    res.json({ 
      success: true, 
      message: 'Service request resolved',
      alert: alert
    });

  } catch (error) {
    console.error('Service resolution error:', error);
    res.status(500).json({ error: 'Failed to resolve service request' });
  }
});

// Authentication endpoints 
// Real Authentication System with PostgreSQL

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('❌ JWT_SECRET is not set in environment variables!');
  process.exit(1);
}


// Helper functions
function generateToken(user) {
  return jwt.sign(
    { 
      id: user.id,
      email: user.email,
      restaurantId: user.restaurant_id,
      companyName: user.company_name
    },
    JWT_SECRET
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

// User Registration
app.post('/api/auth/register', async (req, res) => {
  try {
    const { companyName, restaurantId, fullName, email, password } = req.body;

    if (!companyName || !restaurantId || !fullName || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    // Check if email already exists
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'An account with this email already exists'
      });
    }

    // Ensure restaurant exists
    await ensureRestaurantExists(restaurantId, companyName);

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user
    const userResult = await pool.query(`
      INSERT INTO users (email, password_hash, full_name, company_name, restaurant_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, email, full_name, company_name, restaurant_id, created_at
    `, [email.toLowerCase(), passwordHash, fullName, companyName, restaurantId]);

    const user = userResult.rows[0];
    const token = generateToken(user);

    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      token: token,
      user: {
        id: user.id,
        email: user.email,
        name: user.full_name,
        companyName: user.company_name,
        restaurantId: user.restaurant_id
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed. Please try again.'
    });
  }
});

// User Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    // Find user
    const userResult = await pool.query(`
      SELECT id, email, password_hash, full_name, company_name, restaurant_id
      FROM users 
      WHERE email = $1
    `, [email.toLowerCase()]);

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const user = userResult.rows[0];

    // Verify password
    const passwordValid = await bcrypt.compare(password, user.password_hash);
    
    if (!passwordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const token = generateToken(user);

    res.json({
      success: true,
      message: 'Login successful',
      token: token,
      user: {
        id: user.id,
        email: user.email,
        name: user.full_name,
        companyName: user.company_name,
        restaurantId: user.restaurant_id
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed. Please try again.'
    });
  }
});

// Token Verification
app.post('/api/auth/verify', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Token is required'
      });
    }

    const decoded = verifyToken(token);
    
    if (!decoded) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }

    // Get fresh user data
    const userResult = await pool.query(`
      SELECT id, email, full_name, company_name, restaurant_id
      FROM users 
      WHERE id = $1
    `, [decoded.id]);

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = userResult.rows[0];

    res.json({
      success: true,
      message: 'Token is valid',
      user: {
        id: user.id,
        email: user.email,
        name: user.full_name,
        companyName: user.company_name,
        restaurantId: user.restaurant_id
      }
    });

  } catch (error) {
    console.error('Token verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Token verification failed'
    });
  }
});





// ======================================================
// HELPER FUNCTIONS
// ======================================================

async function calculatePredictionAccuracy(restaurantId) {
  try {
    const accuracyResult = await pool.query(`
      SELECT AVG(confidence_score) as avg_confidence
      FROM live_predictions 
      WHERE restaurant_id = $1 AND created_at > NOW() - INTERVAL '7 days'
    `, [restaurantId]);

    return {
      accuracy: (accuracyResult.rows[0]?.avg_confidence * 100) || 75,
      dataPoints: 50 + Math.floor(Math.random() * 100)
    };
  } catch (error) {
    console.error('Prediction accuracy calculation failed:', error);
    return { accuracy: 75, dataPoints: 50 };
  }
}

async function calculatePredictiveSavings(restaurantId) {
  try {
    const savingsResult = await pool.query(`
      SELECT 
        COUNT(*) as total_recommendations,
        COUNT(CASE WHEN implemented = TRUE THEN 1 END) as implemented_count
      FROM staffing_recommendations 
      WHERE restaurant_id = $1 AND created_at > NOW() - INTERVAL '7 days'
    `, [restaurantId]);

    const implementedCount = parseInt(savingsResult.rows[0]?.implemented_count || 0);
    const weeklySavings = implementedCount * 45; // Average £45 savings per implemented recommendation

    return {
      weeklySavings,
      accuracy: 78 + Math.random() * 15
    };
  } catch (error) {
    console.error('Predictive savings calculation failed:', error);
    return { weeklySavings: 0, accuracy: 75 };
  }
}

function handleQRResponse(res, restaurantId, qrType, options) {
  const { dest, ssid, pass, tableNumber } = options;
  
  switch(qrType) {
    case 'menu':
      if (dest && dest !== 'https://defaultmenu.com') {
        res.redirect(dest);
      } else {
        res.send(createMenuPage(restaurantId, tableNumber));
      }
      break;

    case 'wifi':
      res.send(createWiFiPage(restaurantId, ssid, pass, tableNumber));
      break;

    case 'service':
      res.send(createServiceRequestPage(restaurantId, tableNumber));
      break;

    case 'review':
      if (dest) {
        res.redirect(dest);
      } else {
        res.redirect(`https://www.google.com/search?q=${encodeURIComponent(formatRestaurantName(restaurantId) + ' reviews')}`);
      }
      break;

    case 'booking':
      if (dest) {
        res.redirect(dest);
      } else {
        res.redirect(`https://www.opentable.com/s?term=${encodeURIComponent(formatRestaurantName(restaurantId))}`);
      }
      break;

    case 'specials':
      if (dest) {
        res.redirect(dest);
      } else {
        res.send(createSpecialsPage(restaurantId, tableNumber));
      }
      break;

    default:
      res.status(404).send('QR code type not found');
  }
}

function handleQRFallback(res, dest) {
  if (dest) {
    res.redirect(dest);
  } else {
    res.status(500).send('Tracking error occurred');
  }
}

function createServiceRequestPage(restaurantId, tableNumber) {
  const restaurantName = formatRestaurantName(restaurantId);
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Service Request - Table ${tableNumber}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
            min-height: 100vh;
            padding: 20px;
            color: white;
        }

        .container {
            max-width: 400px;
            margin: 0 auto;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 20px;
            padding: 30px;
            backdrop-filter: blur(15px);
            border: 2px solid rgba(255, 255, 255, 0.2);
            text-align: center;
        }

        .restaurant-header {
            margin-bottom: 30px;
        }

        .restaurant-name {
            font-size: 1.5em;
            font-weight: bold;
            margin-bottom: 10px;
        }

        .table-info {
            background: rgba(251, 191, 36, 0.2);
            border: 2px solid #fbbf24;
            padding: 15px;
            border-radius: 12px;
            margin-bottom: 30px;
        }

        .table-number {
            font-size: 2.5em;
            font-weight: bold;
            color: #fbbf24;
            margin-bottom: 5px;
        }

        .table-label {
            font-size: 1.1em;
            opacity: 0.9;
        }

        .service-title {
            font-size: 1.3em;
            margin-bottom: 25px;
            opacity: 0.95;
        }

        .service-buttons {
            display: flex;
            flex-direction: column;
            gap: 15px;
            margin-bottom: 30px;
        }

        .service-btn {
            padding: 20px;
            border: none;
            border-radius: 15px;
            font-size: 1.1em;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            text-decoration: none;
            color: white;
            min-height: 70px;
        }

        .service-btn:hover {
            transform: translateY(-3px);
            box-shadow: 0 10px 20px rgba(0, 0, 0, 0.3);
        }

        .btn-ready {
            background: linear-gradient(135deg, #22c55e, #16a34a);
        }

        .btn-help {
            background: linear-gradient(135deg, #3b82f6, #2563eb);
        }

        .btn-bill {
            background: linear-gradient(135deg, #f59e0b, #d97706);
        }

        .btn-urgent {
            background: linear-gradient(135deg, #ef4444, #dc2626);
            animation: urgentPulse 2s infinite;
        }

        @keyframes urgentPulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.02); }
        }

        .status-message {
            display: none;
            background: rgba(34, 197, 94, 0.2);
            border: 2px solid #22c55e;
            padding: 20px;
            border-radius: 12px;
            margin-top: 20px;
        }

        .status-message.show {
            display: block;
            animation: slideIn 0.5s ease;
        }

        @keyframes slideIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .processing {
            opacity: 0.7;
            pointer-events: none;
        }

        .footer-info {
            margin-top: 25px;
            font-size: 0.9em;
            opacity: 0.8;
            line-height: 1.4;
        }

        .spinner {
            display: none;
            width: 20px;
            height: 20px;
            border: 2px solid #ffffff40;
            border-top: 2px solid #ffffff;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .back-link {
            margin-top: 20px;
        }

        .back-link a {
            color: rgba(255, 255, 255, 0.8);
            text-decoration: none;
            font-size: 0.9em;
        }

        .back-link a:hover {
            color: white;
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="restaurant-header">
            <div class="restaurant-name">${restaurantName}</div>
        </div>

        <div class="table-info">
            <div class="table-number">${tableNumber}</div>
            <div class="table-label">Table Number</div>
        </div>

        <div class="service-title">How can we help you?</div>

        <div class="service-buttons" id="service-buttons">
            <button class="service-btn btn-ready" onclick="requestService('ready_to_order')">
                <span>🍽️</span>
                <span>Ready to Order</span>
                <div class="spinner"></div>
            </button>

            <button class="service-btn btn-help" onclick="requestService('need_help')">
                <span>🙋</span>
                <span>Need Assistance</span>
                <div class="spinner"></div>
            </button>

            <button class="service-btn btn-bill" onclick="requestService('request_bill')">
                <span>💳</span>
                <span>Request Bill</span>
                <div class="spinner"></div>
            </button>

            <button class="service-btn btn-urgent" onclick="requestService('urgent_help', true)">
                <span>🚨</span>
                <span>Urgent Help</span>
                <div class="spinner"></div>
            </button>
        </div>

        <div class="status-message" id="status-message">
            <h3>Request Sent!</h3>
            <p>A member of our team will be with you shortly.</p>
        </div>

        <div class="footer-info">
            Staff will be notified immediately via our live dashboard system.
        </div>

        <div class="back-link">
            <a href="javascript:history.back()">← Back to menu</a>
        </div>
    </div>

    <script>
        const restaurantId = '${restaurantId}';
        const tableNumber = ${tableNumber};

        async function requestService(serviceType, urgent = false) {
            const button = event.target.closest('.service-btn');
            const buttonsContainer = document.getElementById('service-buttons');
            const statusMessage = document.getElementById('status-message');
            const spinner = button.querySelector('.spinner');

            // Show loading state
            buttonsContainer.classList.add('processing');
            spinner.style.display = 'inline-block';

            try {
                const response = await fetch('/api/service/request', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        restaurantId: restaurantId,
                        tableNumber: tableNumber,
                        serviceType: serviceType,
                        urgent: urgent,
                        timestamp: new Date().toISOString()
                    })
                });

                const data = await response.json();

                if (data.success) {
                    // Show success message
                    statusMessage.classList.add('show');
                    buttonsContainer.style.display = 'none';

                    // Update success message based on service type
                    const messages = {
                        ready_to_order: 'A server will take your order shortly!',
                        need_help: 'Someone will assist you right away!',
                        request_bill: 'Your bill will be prepared and brought to you!',
                        urgent_help: 'Manager has been notified and will be right over!'
                    };

                    statusMessage.innerHTML = \`
                        <h3>Request Sent!</h3>
                        <p>\${messages[serviceType] || 'A member of our team will be with you shortly.'}</p>
                        <div style="margin-top: 15px; font-size: 0.9em; opacity: 0.8;">
                            \${data.notificationsSent ? \`✅ \${data.notificationsSent} staff member(s) notified\` : 'Staff notified'}
                        </div>
                    \`;

                    // Optional: Vibrate phone if supported
                    if (navigator.vibrate) {
                        navigator.vibrate(urgent ? [200, 100, 200] : [200]);
                    }

                    console.log(\`Service request sent: \${serviceType} for Table \${tableNumber}\`);

                } else {
                    throw new Error(data.error || 'Failed to send request');
                }

            } catch (error) {
                console.error('Service request failed:', error);
                
                // Show error message
                alert('Sorry, we could not send your request. Please ask a staff member directly or try again.');
                
                // Reset UI
                buttonsContainer.classList.remove('processing');
                spinner.style.display = 'none';
            }
        }

        console.log(\`Service request page loaded for ${restaurantName} - Table \${tableNumber}\`);
    </script>
</body>
</html>`;
}

function createMenuPage(restaurantId, tableNumber) {
  const tableInfo = tableNumber ? ` - Table ${tableNumber}` : '';
  return `
    <html>
    <head><title>Menu - ${formatRestaurantName(restaurantId)}${tableInfo}</title></head>
    <body style="font-family: Arial; text-align: center; padding: 50px; background: #f8fafc;">
      <h2>Menu - ${formatRestaurantName(restaurantId)}</h2>
      ${tableNumber ? `<p><strong>Table ${tableNumber}</strong></p>` : ''}
      <p>Loading menu...</p>
      <p style="color: #666; margin-top: 20px;">Menu link not configured yet.</p>
      <p><a href="javascript:history.back()">Back</a></p>
    </body>
    </html>
  `;
}

function createWiFiPage(restaurantId, ssid, pass, tableNumber) {
  const tableInfo = tableNumber ? ` - Table ${tableNumber}` : '';
  return `
    <html>
    <head><title>WiFi - ${formatRestaurantName(restaurantId)}${tableInfo}</title></head>
    <body style="font-family: Arial; text-align: center; padding: 50px; background: #f0f9ff;">
      <h2>Welcome to ${formatRestaurantName(restaurantId)}</h2>
      ${tableNumber ? `<h3>Free WiFi - Table ${tableNumber}</h3>` : `<h3>Free WiFi Access</h3>`}
      <div style="background: white; padding: 20px; border-radius: 10px; margin: 20px auto; max-width: 300px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
        <p><strong>Network:</strong> ${ssid || 'Restaurant_WiFi'}</p>
        <p><strong>Password:</strong> ${pass || 'Ask staff'}</p>
      </div>
      <p style="color: #666;">Connect manually or tap below for auto-connect</p>
      <button onclick="autoConnect()" style="background: #3b82f6; color: white; padding: 15px 30px; border: none; border-radius: 8px; font-size: 16px; cursor: pointer;">
        Auto Connect
      </button>
      <script>
        function autoConnect() {
          if (navigator.userAgent.match(/iPhone|iPad|iPod/)) {
            window.location.href = 'WIFI:T:WPA;S:${ssid};P:${pass};;';
          } else {
            alert('WiFi: ${ssid}\\nPassword: ${pass}\\n\\nPlease connect manually.');
          }
        }
      </script>
    </body>
    </html>
  `;
}

function createSpecialsPage(restaurantId, tableNumber) {
  const tableInfo = tableNumber ? ` - Table ${tableNumber}` : '';
  return `
    <html>
    <head><title>Specials - ${formatRestaurantName(restaurantId)}${tableInfo}</title></head>
    <body style="font-family: Arial; text-align: center; padding: 50px;">
      <h2>${formatRestaurantName(restaurantId)} Specials</h2>
      ${tableNumber ? `<p>Table ${tableNumber}</p>` : ''}
      <p>Check back soon for our latest offers!</p>
      <p><a href="javascript:history.back()">Back</a></p>
    </body>
    </html>
  `;
}

function formatRestaurantName(restaurantId) {
  return restaurantId
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .trim() || 'Restaurant';
}

function getServiceAction(serviceType) {
  const actions = {
    ready_to_order: 'Send server to take order immediately',
    need_help: 'Check what customer needs',
    request_bill: 'Prepare and deliver bill',
    urgent_help: 'Manager attention required now'
  };
  return actions[serviceType] || 'Assist customer';
}



// QR Code Generation
app.post('/api/qr-codes/:restaurantId/generate', authenticateToken, async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const { qr_type, destination_url, table_number } = req.body;

    const schema = Joi.object({
      qr_type: Joi.string().valid('menu', 'service', 'wifi', 'review', 'booking', 'specials').required(),
      destination_url: Joi.string().uri().required(),
      table_number: Joi.number().integer().optional()
    });
    const { error } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const tracking_url = `https://qr.insane.marketing/qr/${restaurantId}/${qr_type}/${Date.now()}`;
    const result = await pool.query(
      'INSERT INTO qr_codes (restaurant_id, qr_type, tracking_url, destination_url, table_number) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [restaurantId, qr_type, tracking_url, destination_url, table_number]
    );

    res.json({ success: true, qrId: result.rows[0].id, tracking_url });
  } catch (error) {
    console.error('Generate QR code error:', error);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// Log QR Scan (public for customers)
app.post('/api/qr-scans', async (req, res) => {
  try {
    const { qr_id, restaurant_id, qr_type, table_number, user_agent, ip_address, destination_url } = req.body;

    const schema = Joi.object({
      qr_id: Joi.number().integer().optional(),
      restaurant_id: Joi.string().required(),
      qr_type: Joi.string().valid('menu', 'service', 'wifi', 'review', 'booking', 'specials').required(),
      table_number: Joi.number().integer().optional(),
      user_agent: Joi.string().optional(),
      ip_address: Joi.string().optional(),
      destination_url: Joi.string().uri().optional()
    });
    const { error } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    await pool.query(
      'INSERT INTO qr_scans (restaurant_id, qr_id, qr_type, table_number, user_agent, ip_address, destination_url, scan_timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())',
      [restaurant_id, qr_id, qr_type, table_number, user_agent, ip_address, destination_url]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Log QR scan error:', error);
    res.status(500).json({ error: 'Failed to log QR scan' });
  }
});

// Get Table Alerts
app.get('/api/tables/:restaurantId/alerts', authenticateToken, async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const alerts = await pool.query(
      'SELECT * FROM table_alerts WHERE restaurant_id = $1 AND status = $2 ORDER BY created_at DESC',
      [restaurantId, 'active']
    );
    res.json(alerts.rows);
  } catch (error) {
    console.error('Get table alerts error:', error);
    res.status(500).json({ error: 'Failed to get alerts' });
  }
});

// Create Service Alert (public for service-request.html)
app.post('/api/service-alerts/:restaurantId', async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const { table_number, alert_type, service_type, message, action_required, priority, source } = req.body;

    const schema = Joi.object({
      table_number: Joi.number().integer().required(),
      alert_type: Joi.string().valid('order', 'assistance', 'bill', 'urgent').required(),
      service_type: Joi.string().optional(),
      message: Joi.string().required(),
      action_required: Joi.string().optional(),
      priority: Joi.string().valid('low', 'medium', 'high').optional().default('medium'),
      source: Joi.string().optional().default('behavioral')
    });
    const { error } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const alert_id = `alert_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const result = await pool.query(
      'INSERT INTO service_alerts (alert_id, restaurant_id, table_number, alert_type, service_type, message, action_required, priority, source, resolved, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()) RETURNING id, alert_id',
      [alert_id, restaurantId, table_number, alert_type, service_type, message, action_required, priority, source, false]
    );

    await predictiveEngine.sendNotificationToStaff({
      restaurantId,
      tableNumber: table_number,
      alertId: result.rows[0].alert_id,
      title: `Table ${table_number} Alert`,
      body: message || `${alert_type} request from Table ${table_number}`,
      type: alert_type
    });

    res.json({ success: true, alertId: result.rows[0].alert_id });
  } catch (error) {
    console.error('Create service alert error:', error);
    res.status(500).json({ error: 'Failed to create alert' });
  }
});

// Resolve Service Alert
app.patch('/api/service/resolve/:alertId', authenticateToken, async (req, res) => {
  try {
    const { alertId } = req.params;
    const { resolvedBy } = req.body;

    const schema = Joi.object({
      resolvedBy: Joi.string().required()
    });
    const { error } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const result = await pool.query(
      'UPDATE service_alerts SET resolved = $1, resolved_at = NOW(), resolved_by = $2 WHERE alert_id = $3 RETURNING id',
      [true, resolvedBy, alertId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Resolve service alert error:', error);
    res.status(500).json({ error: 'Failed to resolve alert' });
  }
});

// Get Table Status
app.get('/api/tables/:restaurantId/status', authenticateToken, async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const status = await pool.query(
      'SELECT * FROM table_status WHERE restaurant_id = $1 ORDER BY table_number',
      [restaurantId]
    );
    res.json(status.rows);
  } catch (error) {
    console.error('Get table status error:', error);
    res.status(500).json({ error: 'Failed to get table status' });
  }
});

// Log Table Activity
app.post('/api/tables/:restaurantId/activity', authenticateToken, async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const { table_number, session_id, qr_type, activity_data } = req.body;

    const schema = Joi.object({
      table_number: Joi.number().integer().required(),
      session_id: Joi.string().optional(),
      qr_type: Joi.string().valid('menu', 'service', 'wifi', 'review', 'booking', 'specials').required(),
      activity_data: Joi.object().optional()
    });
    const { error } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    await pool.query(
      'INSERT INTO table_activities (restaurant_id, table_number, session_id, qr_type, activity_data, created_at) VALUES ($1, $2, $3, $4, $5, NOW())',
      [restaurantId, table_number, session_id, qr_type, activity_data]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Log table activity error:', error);
    res.status(500).json({ error: 'Failed to log activity' });
  }
});

// Get Staffing Recommendations
app.get('/api/staffing/:restaurantId', authenticateToken, async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const recommendations = await pool.query(
      'SELECT * FROM staffing_recommendations WHERE restaurant_id = $1 ORDER BY created_at DESC LIMIT 10',
      [restaurantId]
    );
    res.json(recommendations.rows);
  } catch (error) {
    console.error('Get staffing recommendations error:', error);
    res.status(500).json({ error: 'Failed to get recommendations' });
  }
});



// ======================================================
// ERROR HANDLING MIDDLEWARE
// ======================================================

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    timestamp: new Date().toISOString(),
    ...(process.env.NODE_ENV !== 'production' && { details: err.message })
  });
});


// ======================================================
// SERVER STARTUP WITH PREDICTIVE ANALYTICS
// ======================================================

async function startServer() {
  try {
    console.log('Initializing database...');
    await initializeDatabase();
    console.log('✅ Database initialization complete');

    await ensureDemoData(); // Ensure demo restaurants exist
    console.log('✅ Demo data ensured');

    const server = app.listen(process.env.PORT || 8080, '0.0.0.0', () => {
  console.log(`🚀 Restaurant Intelligence Server running on port ${process.env.PORT || 8080}`);

      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`Analytics API: /api/analytics/[restaurantId]`);
      console.log(`QR Tracking: /qr/[restaurantId]/[qrType]`);
      console.log(`TABLE INTELLIGENCE: /qr/[restaurantId]/table/[number]/[qrType]`);
      console.log(`SERVICE REQUEST: /qr/[restaurantId]/table/[number]/service`);
      console.log(`Live Dashboard: /api/tables/[restaurantId]/live`);
      console.log(`SERVICE API: /api/service/request`);
      console.log(`PREDICTIVE ANALYTICS: /api/predictions/[restaurantId]`);
      console.log(`🔔 PUSH NOTIFICATIONS: /api/notifications/*`);
      console.log(`Production-ready with PostgreSQL + Predictive Intelligence + Service Calls + Push Notifications`);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('SIGTERM received, shutting down gracefully');
      server.close(() => {
        console.log('Process terminated');
        pool.end();
        process.exit(0);
      });
    });

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();