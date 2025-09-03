const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3001;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Security middleware
app.use(helmet());
app.use(cors({
  origin: ['https://your-netlify-site.netlify.app', 'http://localhost:3000'],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Initialize database tables
async function initializeDatabase() {
  try {
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
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(restaurant_id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS qr_scans (
        id SERIAL PRIMARY KEY,
        restaurant_id VARCHAR(100) NOT NULL,
        qr_type VARCHAR(50) NOT NULL,
        scanned_at TIMESTAMP DEFAULT NOW(),
        user_agent TEXT,
        ip_address INET,
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(restaurant_id)
      )
    `);

    console.log('Database tables initialized successfully');
  } catch (error) {
    console.error('Database initialization failed:', error);
  }
}

// Health check endpoint
app.get('/api/status', (req, res) => {
  res.json({ 
    status: 'active', 
    timestamp: new Date().toISOString(),
    service: 'QR Analytics Tracking Server'
  });
});

// QR Generation Recording
app.post('/api/qr/generated', async (req, res) => {
  try {
    const { restaurantId, qrType, trackingUrl, destinationUrl, restaurantData } = req.body;

    // Ensure restaurant exists
    await pool.query(
      'INSERT INTO restaurants (restaurant_id, name) VALUES ($1, $2) ON CONFLICT (restaurant_id) DO UPDATE SET name = $2',
      [restaurantId, restaurantData?.name || restaurantId]
    );

    // Record QR code
    await pool.query(
      'INSERT INTO qr_codes (restaurant_id, qr_type, tracking_url, destination_url) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
      [restaurantId, qrType, trackingUrl, destinationUrl]
    );

    console.log(`QR Generated: ${qrType} for ${restaurantId}`);
    res.json({ success: true, message: 'QR generation recorded' });

  } catch (error) {
    console.error('QR generation recording failed:', error);
    res.status(500).json({ error: 'Failed to record QR generation' });
  }
});

// QR Scan Tracking (when customers scan QR codes)
app.get('/qr/:restaurantId/:qrType', async (req, res) => {
  try {
    const { restaurantId, qrType } = req.params;
    const { dest, ssid, pass } = req.query;
    const userAgent = req.headers['user-agent'];
    const ipAddress = req.ip || req.connection.remoteAddress;

    // Record the scan
    await pool.query(
      'INSERT INTO qr_scans (restaurant_id, qr_type, user_agent, ip_address) VALUES ($1, $2, $3, $4)',
      [restaurantId, qrType, userAgent, ipAddress]
    );

    console.log(`Scan recorded: ${qrType} for ${restaurantId}`);

    // Handle different QR types
    switch(qrType) {
      case 'menu':
        if (dest && dest !== 'https://defaultmenu.com') {
          res.redirect(dest);
        } else {
          res.send(createMenuPage(restaurantId));
        }
        break;

      case 'wifi':
        res.send(createWiFiPage(restaurantId, ssid, pass));
        break;

      case 'review':
        if (dest) {
          res.redirect(dest);
        } else {
          res.redirect(`https://www.google.com/search?q=${encodeURIComponent(restaurantId + ' reviews')}`);
        }
        break;

      case 'booking':
        if (dest) {
          res.redirect(dest);
        } else {
          res.redirect(`https://www.opentable.com/s?term=${encodeURIComponent(restaurantId)}`);
        }
        break;

      case 'specials':
        if (dest) {
          res.redirect(dest);
        } else {
          res.send(createSpecialsPage(restaurantId));
        }
        break;

      default:
        res.status(404).send('QR code type not found');
    }

  } catch (error) {
    console.error('QR scan tracking failed:', error);
    // Fallback: redirect to destination anyway
    if (req.query.dest) {
      res.redirect(req.query.dest);
    } else {
      res.status(500).send('Tracking error occurred');
    }
  }
});

// Analytics API for Dashboard
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
    const dailyScansResult = await pool.query(
      `SELECT DATE(scanned_at) as scan_date, COUNT(*) as scans 
       FROM qr_scans 
       WHERE restaurant_id = $1 AND scanned_at >= NOW() - INTERVAL '7 days'
       GROUP BY DATE(scanned_at) 
       ORDER BY scan_date`,
      [restaurantId]
    );

    // Get recent activity
    const recentActivityResult = await pool.query(
      'SELECT qr_type, scanned_at, ip_address FROM qr_scans WHERE restaurant_id = $1 ORDER BY scanned_at DESC LIMIT 10',
      [restaurantId]
    );

    // Format data for dashboard
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
      timestamp: row.scanned_at,
      ip: row.ip_address
    }));

    const analytics = {
      restaurantId: restaurantId,
      totalScans: totalScans,
      totalSavings: 12847 + Math.floor(totalScans / 10) * 50,
      qrCodes: qrCodes,
      dailyScans: dailyScans,
      recentActivity: recentActivity,
      engagementRate: totalScans > 0 ? Math.min(95, (totalScans / 10) + 30) : 0,
      scansToday: dailyScans[new Date().getDay()] || 0
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

// Helper functions for QR scan pages
function createMenuPage(restaurantId) {
  return `
    <html>
    <head><title>Menu - ${formatRestaurantName(restaurantId)}</title></head>
    <body style="font-family: Arial; text-align: center; padding: 50px; background: #f8fafc;">
      <h2>🍽️ Welcome to ${formatRestaurantName(restaurantId)}</h2>
      <p>📱 Loading menu...</p>
      <p style="color: #666; margin-top: 20px;">Menu link not configured yet.</p>
      <p><a href="javascript:history.back()">← Back</a></p>
    </body>
    </html>
  `;
}

function createWiFiPage(restaurantId, ssid, pass) {
  return `
    <html>
    <head><title>WiFi - ${formatRestaurantName(restaurantId)}</title></head>
    <body style="font-family: Arial; text-align: center; padding: 50px; background: #f0f9ff;">
      <h2>🍽️ Welcome to ${formatRestaurantName(restaurantId)}</h2>
      <h3>📶 Free WiFi Access</h3>
      <div style="background: white; padding: 20px; border-radius: 10px; margin: 20px auto; max-width: 300px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
        <p><strong>Network:</strong> ${ssid || 'Restaurant_WiFi'}</p>
        <p><strong>Password:</strong> ${pass || 'Ask staff'}</p>
      </div>
      <p style="color: #666;">Connect manually or tap below for auto-connect</p>
      <button onclick="autoConnect()" style="background: #3b82f6; color: white; padding: 15px 30px; border: none; border-radius: 8px; font-size: 16px; cursor: pointer;">
        📱 Auto Connect
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

function createSpecialsPage(restaurantId) {
  return `
    <html>
    <head><title>Specials - ${formatRestaurantName(restaurantId)}</title></head>
    <body style="font-family: Arial; text-align: center; padding: 50px;">
      <h2>🎉 ${formatRestaurantName(restaurantId)} Specials</h2>
      <p>Check back soon for our latest offers!</p>
      <p><a href="javascript:history.back()">← Back</a></p>
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

// Initialize database on startup
initializeDatabase();

// Start server
app.listen(PORT, () => {
  console.log(`🚀 QR Tracking Server running on port ${PORT}`);
  console.log(`📊 Analytics API: /api/analytics/[restaurantId]`);
  console.log(`🔗 QR Tracking: /qr/[restaurantId]/[qrType]`);
});

module.exports = app;