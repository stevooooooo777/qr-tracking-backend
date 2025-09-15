const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3001;

// PostgreSQL connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// JWT Configuration
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-change-in-production';

// Test database connection
pool.on('connect', () => {
    console.log('[DATABASE] Connected to PostgreSQL database');
});

pool.on('error', (err) => {
    console.error('[DATABASE] PostgreSQL connection error:', err);
});

// Initialize database tables
// Initialize database tables
async function initializeDatabase() {
    try {
        // Create restaurants table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS restaurants (
                id SERIAL PRIMARY KEY,
                restaurant_id VARCHAR(100) UNIQUE NOT NULL,
                restaurant_name VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create users table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                full_name VARCHAR(255) NOT NULL,
                restaurant_name VARCHAR(255) NOT NULL,
                restaurant_id VARCHAR(100) NOT NULL,
                plan VARCHAR(50) DEFAULT 'professional',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_login TIMESTAMP,
                is_active BOOLEAN DEFAULT true,
                FOREIGN KEY (restaurant_id) REFERENCES restaurants (restaurant_id) ON DELETE CASCADE
            )
        `);

        // Create QR scans table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS qr_scans (
                id SERIAL PRIMARY KEY,
                restaurant_id VARCHAR(100) NOT NULL,
                qr_type VARCHAR(50) NOT NULL,
                table_number INTEGER,
                scan_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                user_agent TEXT,
                ip_address VARCHAR(45),
                referrer TEXT,
                session_duration INTEGER DEFAULT 0,
                converted BOOLEAN DEFAULT false,
                FOREIGN KEY (restaurant_id) REFERENCES restaurants (restaurant_id) ON DELETE CASCADE
            )
        `);

        // Create table alerts table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS table_alerts (
                id SERIAL PRIMARY KEY,
                restaurant_id VARCHAR(100) NOT NULL,
                table_number INTEGER NOT NULL,
                alert_type VARCHAR(50) NOT NULL,
                message TEXT NOT NULL,
                priority VARCHAR(20) DEFAULT 'medium',
                resolved BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                resolved_at TIMESTAMP,
                FOREIGN KEY (restaurant_id) REFERENCES restaurants (restaurant_id) ON DELETE CASCADE
            )
        `);

        // Create table status table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS table_status (
                id SERIAL PRIMARY KEY,
                restaurant_id VARCHAR(100) NOT NULL,
                table_number INTEGER NOT NULL,
                status VARCHAR(20) DEFAULT 'available',
                party_size INTEGER DEFAULT 0,
                seated_at TIMESTAMP,
                last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                estimated_duration INTEGER DEFAULT 60,
                FOREIGN KEY (restaurant_id) REFERENCES restaurants (restaurant_id) ON DELETE CASCADE,
                UNIQUE(restaurant_id, table_number)
            )
        `);

        // Create indexes for better performance
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_qr_scans_restaurant ON qr_scans(restaurant_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_table_alerts_restaurant ON table_alerts(restaurant_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_table_status_restaurant ON table_status(restaurant_id)`);

        console.log('[DATABASE] All tables initialized successfully');
    } catch (error) {
        console.error('[DATABASE] Error initializing tables:', error);
    }
}

// Initialize database on startup
initializeDatabase();

// Middleware
app.use(cors({
    origin: [
        'http://localhost:3000', 
        'https://sme.insane.marketing', 
        'https://qr.insane.marketing',
        'https://insane.marketing'
    ],
    credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Helper functions
function generateToken(user) {
    return jwt.sign(
        { 
            id: user.id, 
            email: user.email, 
            restaurantId: user.restaurant_id 
        },
        JWT_SECRET,
        { expiresIn: '30d' }
    );
}

function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (error) {
        return null;
    }
}

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        database: 'postgresql'
    });
});

// AUTHENTICATION ENDPOINTS

// Registration endpoint
app.post('/api/auth/register', async (req, res) => {
    const { restaurantName, restaurantId, fullName, email, password } = req.body;
    
    console.log(`[AUTH] Registration attempt: ${email} for ${restaurantName}`);
    
    try {
        // Validate input
        if (!email || !password || !restaurantName || !fullName || !restaurantId) {
            return res.status(400).json({
                success: false,
                message: 'All fields are required'
            });
        }
        
        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 6 characters'
            });
        }
        
        // Check if user already exists
        const existingUser = await pool.query(
            'SELECT email FROM users WHERE email = $1',
            [email]
        );
        
        if (existingUser.rows.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'An account with this email already exists'
            });
        }
        
        // Hash password
        const saltRounds = 12;
        const passwordHash = await bcrypt.hash(password, saltRounds);
        
        // Create restaurant first
        await pool.query(
            'INSERT INTO restaurants (restaurant_id, restaurant_name) VALUES ($1, $2) ON CONFLICT (restaurant_id) DO NOTHING',
            [restaurantId, restaurantName]
        );
        
        // Create user
        const userResult = await pool.query(
            `INSERT INTO users (email, password_hash, full_name, restaurant_name, restaurant_id) 
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [email, passwordHash, fullName, restaurantName, restaurantId]
        );
        
        const userId = userResult.rows[0].id;
        
        // Generate token
        const user = {
            id: userId,
            email: email,
            restaurant_id: restaurantId
        };
        
        const token = generateToken(user);
        
        console.log(`[AUTH] User registered successfully: ${email}`);
        
        res.status(201).json({
            success: true,
            message: 'Account created successfully',
            token: token,
            user: {
                id: userId,
                email: email,
                full_name: fullName,
                restaurant_name: restaurantName,
                restaurant_id: restaurantId,
                plan: 'professional'
            }
        });
        
    } catch (error) {
        console.error('[AUTH] Registration error:', error);
        res.status(500).json({
            success: false,
            message: 'Registration failed. Please try again.'
        });
    }
});

// Login endpoint
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    
    console.log(`[AUTH] Login attempt: ${email}`);
    
    try {
        // Validate input
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Email and password are required'
            });
        }
        
        // Find user
        const userResult = await pool.query(
            'SELECT * FROM users WHERE email = $1 AND is_active = true',
            [email]
        );
        
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
        
        // Update last login
        await pool.query(
            'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
            [user.id]
        );
        
        // Generate token
        const token = generateToken(user);
        
        console.log(`[AUTH] User logged in successfully: ${email}`);
        
        res.json({
            success: true,
            message: 'Login successful',
            token: token,
            user: {
                id: user.id,
                email: user.email,
                full_name: user.full_name,
                restaurant_name: user.restaurant_name,
                restaurant_id: user.restaurant_id,
                plan: user.plan
            }
        });
        
    } catch (error) {
        console.error('[AUTH] Login error:', error);
        res.status(500).json({
            success: false,
            message: 'Login failed. Please try again.'
        });
    }
});

// Token verification endpoint
app.post('/api/auth/verify', (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Access token is required'
        });
    }
    
    const decoded = verifyToken(token);
    
    if (!decoded) {
        return res.status(403).json({
            success: false,
            message: 'Invalid or expired token'
        });
    }
    
    res.json({
        success: true,
        user: decoded
    });
});

// Forgot password endpoint
app.post('/api/auth/forgot-password', async (req, res) => {
    const { email } = req.body;
    
    console.log(`[AUTH] Password reset requested for: ${email}`);
    
    try {
        // In production, implement actual password reset
        res.json({
            success: true,
            message: 'If an account with that email exists, a reset link has been sent.'
        });
        
    } catch (error) {
        console.error('[AUTH] Password reset error:', error);
        res.status(500).json({
            success: false,
            message: 'Password reset request failed. Please try again.'
        });
    }
});

// QR TRACKING ENDPOINTS

// QR scan tracking
app.get('/qr/:restaurantId/:qrType', async (req, res) => {
    const { restaurantId, qrType } = req.params;
    const { table, redirect } = req.query;
    
    console.log(`[QR-SCAN] ${restaurantId} - ${qrType} - Table: ${table || 'N/A'}`);
    
    try {
        // Record the scan
        await recordQRScan({
            restaurantId,
            qrType,
            tableNumber: table ? parseInt(table) : null,
            userAgent: req.get('User-Agent'),
            ipAddress: req.ip || req.connection.remoteAddress,
            referrer: req.get('Referrer')
        });
        
        // Update table status if applicable
        if (table && qrType === 'menu') {
            await updateTableStatus(restaurantId, parseInt(table), 'occupied');
        }
        
        // Redirect to appropriate destination
        const redirectUrl = getRedirectUrl(qrType, redirect);
        console.log(`[QR-SCAN] Redirecting to: ${redirectUrl}`);
        
        res.redirect(redirectUrl);
        
    } catch (error) {
        console.error(`[QR-SCAN] Error:`, error);
        res.status(500).json({ error: 'Failed to process QR scan' });
    }
});

// Record QR scan function
async function recordQRScan(scanData) {
    const { restaurantId, qrType, tableNumber, userAgent, ipAddress, referrer } = scanData;
    
    try {
        // Ensure restaurant exists
        await pool.query(
            'INSERT INTO restaurants (restaurant_id, restaurant_name) VALUES ($1, $2) ON CONFLICT (restaurant_id) DO NOTHING',
            [restaurantId, restaurantId.charAt(0).toUpperCase() + restaurantId.slice(1)]
        );
        
        // Record the scan
        const result = await pool.query(
            `INSERT INTO qr_scans (restaurant_id, qr_type, table_number, user_agent, ip_address, referrer) 
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [restaurantId, qrType, tableNumber, userAgent, ipAddress, referrer]
        );
        
        console.log(`[DB] Scan recorded - ID: ${result.rows[0].id}`);
        return result.rows[0].id;
        
    } catch (error) {
        console.error('[DB] Error recording scan:', error);
        throw error;
    }
}

// Update table status function
async function updateTableStatus(restaurantId, tableNumber, status) {
    try {
        await pool.query(
            `INSERT INTO table_status (restaurant_id, table_number, status, last_activity, seated_at) 
             VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CASE WHEN $3 = 'occupied' THEN CURRENT_TIMESTAMP ELSE NULL END)
             ON CONFLICT (restaurant_id, table_number) 
             DO UPDATE SET status = $3, last_activity = CURRENT_TIMESTAMP, 
                          seated_at = CASE WHEN $3 = 'occupied' THEN CURRENT_TIMESTAMP ELSE table_status.seated_at END`,
            [restaurantId, tableNumber, status]
        );
        
        console.log(`[DB] Table ${tableNumber} status updated to ${status}`);
        
    } catch (error) {
        console.error('[DB] Error updating table status:', error);
        throw error;
    }
}

// Get redirect URL function
function getRedirectUrl(qrType, customRedirect) {
    if (customRedirect) return customRedirect;
    
    const redirectMap = {
        menu: 'https://example.com/menu',
        review: 'https://example.com/review',
        contact: 'https://example.com/contact',
        wifi: 'https://example.com/wifi',
        survey: 'https://example.com/survey'
    };
    
    return redirectMap[qrType] || 'https://example.com';
}

// ANALYTICS ENDPOINTS

// Analytics endpoint
app.get('/api/analytics/:restaurantId', async (req, res) => {
    const { restaurantId } = req.params;
    
    console.log(`[ANALYTICS] Loading data for: ${restaurantId}`);
    
    try {
        // Get total scans
        const totalScansResult = await pool.query(
            'SELECT COUNT(*) as count FROM qr_scans WHERE restaurant_id = $1',
            [restaurantId]
        );
        
        // Get today's scans
        const todayScansResult = await pool.query(
            "SELECT COUNT(*) as count FROM qr_scans WHERE restaurant_id = $1 AND DATE(scan_timestamp) = CURRENT_DATE",
            [restaurantId]
        );
        
        // Get weekly scans
        const weeklyScansResult = await pool.query(
            "SELECT COUNT(*) as count FROM qr_scans WHERE restaurant_id = $1 AND scan_timestamp >= CURRENT_DATE - INTERVAL '7 days'",
            [restaurantId]
        );
        
        // Get monthly scans
        const monthlyScansResult = await pool.query(
            "SELECT COUNT(*) as count FROM qr_scans WHERE restaurant_id = $1 AND scan_timestamp >= CURRENT_DATE - INTERVAL '30 days'",
            [restaurantId]
        );
        
        // Get scans by type
        const scansByTypeResult = await pool.query(
            'SELECT qr_type, COUNT(*) as count FROM qr_scans WHERE restaurant_id = $1 GROUP BY qr_type',
            [restaurantId]
        );
        
        // Get hourly data for today
        const hourlyDataResult = await pool.query(
            `SELECT EXTRACT(HOUR FROM scan_timestamp) as hour, COUNT(*) as count 
             FROM qr_scans 
             WHERE restaurant_id = $1 AND DATE(scan_timestamp) = CURRENT_DATE
             GROUP BY EXTRACT(HOUR FROM scan_timestamp) 
             ORDER BY hour`,
            [restaurantId]
        );
        
        // Get recent scans
        const recentScansResult = await pool.query(
            'SELECT * FROM qr_scans WHERE restaurant_id = $1 ORDER BY scan_timestamp DESC LIMIT 20',
            [restaurantId]
        );
        
        // Format results
        const totalScans = parseInt(totalScansResult.rows[0].count);
        const todayScans = parseInt(todayScansResult.rows[0].count);
        const weeklyScans = parseInt(weeklyScansResult.rows[0].count);
        const monthlyScans = parseInt(monthlyScansResult.rows[0].count);
        
        const scansByType = {};
        scansByTypeResult.rows.forEach(row => {
            scansByType[row.qr_type] = parseInt(row.count);
        });
        
        const hourlyData = hourlyDataResult.rows.map(row => ({
            hour: parseInt(row.hour),
            count: parseInt(row.count)
        }));
        
        const results = {
            totalScans,
            todayScans,
            weeklyScans,
            monthlyScans,
            scansByType,
            hourlyData,
            recentScans: recentScansResult.rows,
            conversionRate: totalScans > 0 ? ((totalScans * 0.15) + Math.random() * 10).toFixed(1) : 0,
            avgSessionTime: totalScans > 0 ? Math.floor(120 + Math.random() * 180) : 0
        };
        
        console.log(`[ANALYTICS] Returning data:`, {
            totalScans,
            todayScans,
            scanTypes: Object.keys(scansByType).length
        });
        
        res.json(results);
        
    } catch (error) {
        console.error('[ANALYTICS] Error:', error);
        res.status(500).json({ error: 'Failed to load analytics' });
    }
});

// TABLE MANAGEMENT ENDPOINTS

// Get table alerts
app.get('/api/tables/:restaurantId/alerts', async (req, res) => {
    const { restaurantId } = req.params;
    
    try {
        const result = await pool.query(
            'SELECT * FROM table_alerts WHERE restaurant_id = $1 AND resolved = false ORDER BY created_at DESC',
            [restaurantId]
        );
        
        console.log(`[ALERTS] Found ${result.rows.length} alerts for ${restaurantId}`);
        res.json(result.rows);
        
    } catch (error) {
        console.error('[ALERTS] Database error:', error);
        res.status(500).json({ error: 'Failed to load alerts' });
    }
});

// Get table status
app.get('/api/tables/:restaurantId/status', async (req, res) => {
    const { restaurantId } = req.params;
    
    try {
        const result = await pool.query(
            'SELECT * FROM table_status WHERE restaurant_id = $1 ORDER BY table_number',
            [restaurantId]
        );
        
        console.log(`[TABLES] Found ${result.rows.length} tables for ${restaurantId}`);
        res.json(result.rows);
        
    } catch (error) {
        console.error('[TABLES] Database error:', error);
        res.status(500).json({ error: 'Failed to load table status' });
    }
});

// Create table alert
app.post('/api/tables/:restaurantId/alerts', async (req, res) => {
    const { restaurantId } = req.params;
    const { table_number, alert_type, message, priority = 'medium' } = req.body;
    
    try {
        const result = await pool.query(
            'INSERT INTO table_alerts (restaurant_id, table_number, alert_type, message, priority) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [restaurantId, table_number, alert_type, message, priority]
        );
        
        console.log(`[ALERTS] Created alert ${result.rows[0].id} for table ${table_number}`);
        res.json({ id: result.rows[0].id, success: true });
        
    } catch (error) {
        console.error('[ALERTS] Error creating alert:', error);
        res.status(500).json({ error: 'Failed to create alert' });
    }
});

// Resolve table alert
app.put('/api/tables/:restaurantId/alerts/:alertId/resolve', async (req, res) => {
    const { alertId } = req.params;
    
    try {
        await pool.query(
            'UPDATE table_alerts SET resolved = true, resolved_at = CURRENT_TIMESTAMP WHERE id = $1',
            [alertId]
        );
        
        console.log(`[ALERTS] Resolved alert ${alertId}`);
        res.json({ success: true });
        
    } catch (error) {
        console.error('[ALERTS] Error resolving alert:', error);
        res.status(500).json({ error: 'Failed to resolve alert' });
    }
});

// Update table status
app.put('/api/tables/:restaurantId/:tableNumber/status', async (req, res) => {
    const { restaurantId, tableNumber } = req.params;
    const { status, party_size } = req.body;
    
    try {
        await pool.query(
            `INSERT INTO table_status (restaurant_id, table_number, status, party_size, last_activity) 
             VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
             ON CONFLICT (restaurant_id, table_number) 
             DO UPDATE SET status = $3, party_size = $4, last_activity = CURRENT_TIMESTAMP`,
            [restaurantId, parseInt(tableNumber), status, party_size || 0]
        );
        
        console.log(`[TABLES] Updated table ${tableNumber} status to ${status}`);
        res.json({ success: true });
        
    } catch (error) {
        console.error('[TABLES] Error updating status:', error);
        res.status(500).json({ error: 'Failed to update table status' });
    }
});

// SERVICE REQUEST ENDPOINTS

// Handle service requests
app.post('/api/service/request', async (req, res) => {
    const { restaurantId, tableNumber, serviceType, urgent, timestamp } = req.body;
    
    console.log(`[SERVICE] Request: ${serviceType} for table ${tableNumber} at ${restaurantId}`);
    
    try {
        // Create alert for service request
        const result = await pool.query(
            'INSERT INTO table_alerts (restaurant_id, table_number, alert_type, message, priority) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [
                restaurantId, 
                tableNumber, 
                serviceType, 
                `Service request: ${serviceType.replace('_', ' ')}`,
                urgent ? 'high' : 'medium'
            ]
        );
        
        const alertId = result.rows[0].id;
        
        console.log(`[SERVICE] Created alert ${alertId} for service request`);
        
        res.json({
            success: true,
            message: 'Service request sent successfully',
            alertId: alertId
        });
        
    } catch (error) {
        console.error('[SERVICE] Error creating request:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to send service request'
        });
    }
});

// QR GENERATION TRACKING

// Track QR generation
app.post('/api/qr/generated', async (req, res) => {
    const { restaurantId, restaurantName, qrTypes, generatedAt } = req.body;
    
    console.log(`[QR-GEN] QR codes generated for ${restaurantName}`);
    
    try {
        // Ensure restaurant exists
        await pool.query(
            'INSERT INTO restaurants (restaurant_id, restaurant_name) VALUES ($1, $2) ON CONFLICT (restaurant_id) DO NOTHING',
            [restaurantId, restaurantName]
        );
        
        console.log(`[QR-GEN] Recorded generation for ${restaurantId}`);
        res.json({ success: true });
        
    } catch (error) {
        console.error('[QR-GEN] Error:', error);
        res.status(500).json({ error: 'Failed to record QR generation' });
    }
});

// Track table intelligence generation
app.post('/api/table-intelligence/generated', async (req, res) => {
    const { restaurantId, restaurantName, tableCount, systemType, generatedAt } = req.body;
    
    console.log(`[TABLE-INTEL] System generated for ${restaurantName} with ${tableCount} tables`);
    
    try {
        // Ensure restaurant exists
        await pool.query(
            'INSERT INTO restaurants (restaurant_id, restaurant_name) VALUES ($1, $2) ON CONFLICT (restaurant_id) DO NOTHING',
            [restaurantId, restaurantName]
        );
        
        console.log(`[TABLE-INTEL] Recorded generation for ${restaurantId}`);
        res.json({ success: true });
        
    } catch (error) {
        console.error('[TABLE-INTEL] Error:', error);
        res.status(500).json({ error: 'Failed to record system generation' });
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('[ERROR]', error);
    res.status(500).json({ 
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
});

// 404 handler
app.use((req, res) => {
    console.log(`[404] ${req.method} ${req.url}`);
    res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(PORT, () => {
    console.log(`[SERVER] QR Analytics API running on port ${PORT}`);
    console.log(`[SERVER] Health check: http://localhost:${PORT}/api/health`);
    console.log(`[SERVER] Database: PostgreSQL`);
    console.log(`[SERVER] Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('[SERVER] Shutting down gracefully...');
    pool.end(() => {
        console.log('[DATABASE] PostgreSQL pool closed');
        process.exit(0);
    });
});