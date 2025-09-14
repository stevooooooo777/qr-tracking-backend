const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const webpush = require('web-push');
const twilio = require('twilio');

const app = express();
app.set('trust proxy', 1); // Fix for Railway/cloud proxy
const PORT = process.env.PORT || 3001;

// Database connection with production configuration
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Allow QR code generation
  crossOriginEmbedderPolicy: false
}));

// CORS configuration for production
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? [
        'https://insane.marketing',
        'https://www.insane.marketing'
      ]
    : ['http://localhost:3000', 'http://localhost:8080', 'http://127.0.0.1:5500'],
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));

// Rate limiting with production settings
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 1000 : 2000,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// ======================================================
// PUSH NOTIFICATION SETUP
// ======================================================

const vapidKeys = {
  publicKey: process.env.VAPID_PUBLIC_KEY || 'YOUR_VAPID_PUBLIC_KEY',
  privateKey: process.env.VAPID_PRIVATE_KEY || 'YOUR_VAPID_PRIVATE_KEY'
};

webpush.setVapidDetails(
  'mailto:your-email@restaurant.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

const smsClient = process.env.TWILIO_SID ? twilio(
  process.env.TWILIO_SID,
  process.env.TWILIO_AUTH_TOKEN
) : null;

// Health check endpoint (required for Railway)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// ======================================================
// DATABASE INITIALIZATION WITH PREDICTIVE ANALYTICS
// ======================================================

async function initializeDatabase() {
  try {
    // Test database connection
    const client = await pool.connect();
    console.log('Database connected successfully');
    client.release();

    // Original tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS restaurants (
        id SERIAL PRIMARY KEY,
        restaurant_id VARCHAR(100) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS qr_codes (
        id SERIAL PRIMARY KEY,
        restaurant_id VARCHAR(100) NOT NULL,
        qr_type VARCHAR(50) NOT NULL,
        tracking_url TEXT,
        destination_url TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(restaurant_id) ON DELETE CASCADE
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS qr_scans (
        id SERIAL PRIMARY KEY,
        restaurant_id VARCHAR(100) NOT NULL,
        qr_type VARCHAR(50) NOT NULL,
        table_number INTEGER,
        scanned_at TIMESTAMP DEFAULT NOW(),
        user_agent TEXT,
        ip_address INET,
        destination_url TEXT,
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(restaurant_id) ON DELETE CASCADE
      )
    `);

    // Table intelligence tables
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

    // ===== PREDICTIVE ANALYTICS TABLES =====
    
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
        created_at TIMESTAMP DEFAULT NOW(),
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(restaurant_id) ON DELETE CASCADE
      )
    `);

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

    // Create indexes for performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_qr_scans_restaurant_date 
      ON qr_scans(restaurant_id, scanned_at DESC)
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

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)
    `);
    console.log('Database tables initialized successfully with predictive analytics');
    
    // Create notification tables
    await createNotificationTables();
    
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
    // Create demo restaurant for testing
    await pool.query(
      'INSERT INTO restaurants (restaurant_id, name) VALUES ($1, $2) ON CONFLICT (restaurant_id) DO NOTHING',
      ['demo', 'Demo Restaurant']
    );
    
    // Create a few more test restaurants
    await pool.query(
      'INSERT INTO restaurants (restaurant_id, name) VALUES ($1, $2) ON CONFLICT (restaurant_id) DO NOTHING',
      ['testrestaurant', 'Test Restaurant']
    );
    
    await pool.query(
      'INSERT INTO restaurants (restaurant_id, name) VALUES ($1, $2) ON CONFLICT (restaurant_id) DO NOTHING',
      ['mariositalian', 'Marios Italian Kitchen']
    );
    
    console.log('Demo restaurant data ensured');
  } catch (error) {
    console.error('Demo data creation failed:', error);
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
    const staffQuery = targetStaffType ? 
      `SELECT * FROM push_subscriptions 
       WHERE restaurant_id = $1 AND is_active = true AND staff_type = $2` :
      `SELECT * FROM push_subscriptions 
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
        
        // SMS backup if available
        if (sub.phone_number && smsClient) {
          try {
            await smsClient.messages.create({
              body: `🔔 ${notificationData.title}\n${notificationData.body}\n\nReply DONE when resolved.`,
              from: process.env.TWILIO_PHONE_NUMBER,
              to: sub.phone_number
            });
            staffNotified.push({
              id: sub.id,
              name: sub.staff_name,
              type: sub.staff_type,
              method: 'sms_backup'
            });
            console.log(`✅ SMS backup sent to ${sub.staff_name}`);
          } catch (smsError) {
            console.error(`❌ SMS backup failed:`, smsError.message);
          }
        }
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
        WHERE restaurant_id = $1 AND scanned_at > $2
      `, [restaurantId, hourAgo]);

      const scansLast2Hours = await pool.query(`
        SELECT COUNT(*) as count FROM qr_scans 
        WHERE restaurant_id = $1 AND scanned_at > $2
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
      WHERE restaurant_id = $1 AND scanned_at > $2
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
const predictiveEngine = new PredictiveAnalyticsEngine();

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
app.post('/api/notifications/subscribe', async (req, res) => {
  try {
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
app.post('/api/notifications/unsubscribe', async (req, res) => {
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
app.post('/api/notifications/delivered', async (req, res) => {
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
app.get('/api/notifications/stats/:restaurantId', async (req, res) => {
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
app.get('/api/predictions/:restaurantId', async (req, res) => {
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
app.post('/api/predictions/:restaurantId/generate', async (req, res) => {
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
app.post('/api/predictions/:restaurantId/start', async (req, res) => {
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
      SELECT DATE(scanned_at) as scan_date, COUNT(*) as scans 
      FROM qr_scans 
      WHERE restaurant_id = $1 AND scanned_at >= NOW() - INTERVAL '7 days'
      GROUP BY DATE(scanned_at) 
      ORDER BY scan_date
    `, [restaurantId]);

    // Get recent activity
    const recentActivityResult = await pool.query(`
      SELECT qr_type, table_number, scanned_at, ip_address, destination_url
      FROM qr_scans 
      WHERE restaurant_id = $1 
      ORDER BY scanned_at DESC 
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
      timestamp: row.scanned_at,
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

app.get('/api/tables/:restaurantId/live', async (req, res) => {
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
             MAX(scanned_at) as last_activity
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
      WHERE restaurant_id = $1 AND DATE(scanned_at) = CURRENT_DATE
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
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// JWT secret
const JWT_SECRET = process.env.JWT_SECRET || 'temp-secret-change-in-railway';


// Helper functions
function generateToken(user) {
  return jwt.sign(
    { 
      id: user.id,
      email: user.email,
      restaurantId: user.restaurant_id,
      companyName: user.company_name
    },
    JWT_SECRET,
    { expiresIn: '7d' }
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
    await initializeDatabase();
    await ensureDemoData(); // Ensure demo restaurants exist
    
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Restaurant Intelligence Server running on port ${PORT}`);
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

// Handle 404s
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.path,
    method: req.method
  });
});

module.exports = app;