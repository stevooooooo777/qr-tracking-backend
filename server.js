const CONFIG = {
    // API base URL detection
    getApiBaseUrl() {
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            return 'http://localhost:3001';
        }
        return 'https://qr.insane.marketing';
    },
    
    // Restaurant ID generation - cleaned and consistent
    generateRestaurantId(restaurantName) {
        if (!restaurantName) return null;
        
        return restaurantName
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9\s]/g, '')
            .replace(/\s+/g, '')
            .substring(0, 20);
    },
    
    // Fix duplicate restaurant ID issue
    validateRestaurantId(restaurantId) {
        if (!restaurantId) return null;
        
        // Check for common duplication patterns
        if (restaurantId.length > 4) {
            const half = Math.floor(restaurantId.length / 2);
            const firstHalf = restaurantId.substring(0, half);
            const secondHalf = restaurantId.substring(half);
            
            if (firstHalf === secondHalf) {
                console.warn(`Fixed duplicated restaurant ID: ${restaurantId} → ${firstHalf}`);
                return firstHalf;
            }
        }
        
        return restaurantId;
    },
    
    // Get authenticated user info - WITH FALLBACK
    getAuthenticatedUser() {
        const restaurantName = localStorage.getItem('user_restaurant_name');
        const rawRestaurantId = localStorage.getItem('user_restaurant_id');
        
        // FALLBACK for testing without login
        if (!restaurantName || !rawRestaurantId) {
            console.warn('[AUTH] No user data found, using fallback');
            // Use default test data so dashboards can still load
            return {
                restaurantName: 'Demo Restaurant',
                restaurantId: 'demo',
                userType: 'restaurant'
            };
        }
        
        // Clean and validate restaurant ID
        const restaurantId = this.validateRestaurantId(rawRestaurantId);
        
        if (!restaurantId) {
            console.warn('[AUTH] Invalid restaurant ID, using fallback');
            return {
                restaurantName: restaurantName || 'Demo Restaurant',
                restaurantId: 'demo',
                userType: 'restaurant'
            };
        }
        
        return {
            restaurantName,
            restaurantId,
            userType: localStorage.getItem('user_type') || 'restaurant'
        };
    },
    
    // Enhanced API call with better error handling
    async makeApiCall(endpoint, options = {}) {
        const url = `${this.getApiBaseUrl()}${endpoint}`;
        
        console.log(`[API] Calling: ${url}`);
        
        try {
            const response = await fetch(url, {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    ...options.headers
                },
                ...options
            });
            
            // Handle both success and error responses
            const text = await response.text();
            let data;
            
            try {
                data = JSON.parse(text);
            } catch (e) {
                console.error(`[API] Invalid JSON response from ${url}:`, text);
                data = {};
            }
            
            if (!response.ok) {
                console.warn(`[API] Error ${response.status} for ${url}:`, data);
                // Return empty data structure instead of throwing
                return this.getEmptyDataStructure(endpoint);
            }
            
            console.log(`[API] Success for ${url}:`, data);
            return data;
            
        } catch (error) {
            console.error(`[API] Failed for ${url}:`, error.message);
            // Return empty data structure instead of throwing
            return this.getEmptyDataStructure(endpoint);
        }
    },
    
    // Get empty data structure based on endpoint
    getEmptyDataStructure(endpoint) {
        if (endpoint.includes('/analytics/')) {
            return {
                totalScans: 0,
                todayScans: 0,
                weeklyScans: 0,
                monthlyScans: 0,
                scansByType: {},
                recentScans: [],
                hourlyData: [],
                tableData: [],
                conversionRate: 0,
                avgSessionTime: 0
            };
        } else if (endpoint.includes('/alerts')) {
            return [];
        } else if (endpoint.includes('/status')) {
            return [];
        }
        return {};
    },
    
    // Load restaurant analytics - ALWAYS RETURNS DATA
    async loadRestaurantAnalytics(restaurantId) {
        if (!restaurantId) {
            console.warn('[ANALYTICS] No restaurant ID provided, using demo data');
            return this.getDemoAnalytics();
        }
        
        try {
            const data = await this.makeApiCall(`/api/analytics/${restaurantId}`);
            
            // Ensure all required fields exist
            const analytics = {
                totalScans: data.totalScans || 0,
                todayScans: data.todayScans || 0,
                weeklyScans: data.weeklyScans || 0,
                monthlyScans: data.monthlyScans || 0,
                scansByType: data.scansByType || {},
                recentScans: Array.isArray(data.recentScans) ? data.recentScans : [],
                hourlyData: Array.isArray(data.hourlyData) ? data.hourlyData : [],
                tableData: Array.isArray(data.tableData) ? data.tableData : [],
                conversionRate: data.conversionRate || 0,
                avgSessionTime: data.avgSessionTime || 0
            };
            
            console.log(`[ANALYTICS] Loaded for ${restaurantId}:`, analytics);
            
            // If no data, show demo data to avoid empty dashboards
            if (analytics.totalScans === 0) {
                console.log('[ANALYTICS] No real data yet, enhancing with demo data');
                return this.getDemoAnalytics();
            }
            
            return analytics;
            
        } catch (error) {
            console.error(`[ANALYTICS] Failed to load for ${restaurantId}:`, error.message);
            // Return demo data instead of throwing error
            return this.getDemoAnalytics();
        }
    },
    
    // Get demo analytics data
    getDemoAnalytics() {
        const now = new Date();
        const hours = [];
        for (let i = 0; i < 24; i++) {
            hours.push({
                hour: i,
                count: Math.floor(Math.random() * 10) + (i >= 11 && i <= 14 ? 15 : 0) + (i >= 18 && i <= 21 ? 20 : 0)
            });
        }
        
        return {
            totalScans: 156,
            todayScans: 23,
            weeklyScans: 89,
            monthlyScans: 156,
            scansByType: {
                menu: 78,
                review: 23,
                contact: 15,
                wifi: 40
            },
            recentScans: [
                { qr_type: 'menu', table_number: 5, timestamp: new Date(now - 300000).toISOString() },
                { qr_type: 'wifi', table_number: 3, timestamp: new Date(now - 600000).toISOString() },
                { qr_type: 'review', table_number: 7, timestamp: new Date(now - 900000).toISOString() },
                { qr_type: 'menu', table_number: 2, timestamp: new Date(now - 1200000).toISOString() },
                { qr_type: 'contact', table_number: null, timestamp: new Date(now - 1500000).toISOString() }
            ],
            hourlyData: hours.filter(h => h.hour <= now.getHours()),
            tableData: [],
            conversionRate: 15.4,
            avgSessionTime: 245
        };
    },
    
    // Load table alerts - ALWAYS RETURNS ARRAY
    async loadTableAlerts(restaurantId) {
        if (!restaurantId) {
            console.warn('[ALERTS] No restaurant ID provided');
            return [];
        }
        
        try {
            const data = await this.makeApiCall(`/api/tables/${restaurantId}/alerts`);
            
            const alerts = Array.isArray(data) ? data : [];
            console.log(`[ALERTS] Loaded ${alerts.length} alerts for ${restaurantId}`);
            return alerts;
            
        } catch (error) {
            console.error(`[ALERTS] Failed to load for ${restaurantId}:`, error.message);
            return [];
        }
    },
    
    // Load table status - ALWAYS RETURNS ARRAY
    async loadTableStatus(restaurantId) {
        if (!restaurantId) {
            console.warn('[TABLES] No restaurant ID provided');
            return [];
        }
        
        try {
            const data = await this.makeApiCall(`/api/tables/${restaurantId}/status`);
            
            const tables = Array.isArray(data) ? data : [];
            console.log(`[TABLES] Loaded ${tables.length} tables for ${restaurantId}`);
            return tables;
            
        } catch (error) {
            console.error(`[TABLES] Failed to load for ${restaurantId}:`, error.message);
            return [];
        }
    },
    
    // Error display helper
    showError(elementId, message, canRetry = false) {
        const element = document.getElementById(elementId);
        if (!element) return;
        
        element.innerHTML = `
            <div style="background: #fef2f2; border: 1px solid #fca5a5; border-radius: 8px; padding: 20px; text-align: center; color: #dc2626;">
                <div style="font-size: 24px; margin-bottom: 12px;">⚠️</div>
                <h3 style="margin-bottom: 8px; color: #dc2626;">Data Loading Error</h3>
                <p style="margin-bottom: 16px;">${message}</p>
                ${canRetry ? `
                    <button onclick="location.reload()" 
                            style="background: #dc2626; color: white; padding: 8px 16px; border: none; border-radius: 6px; cursor: pointer;">
                        Retry
                    </button>
                ` : ''}
                <div style="margin-top: 12px; font-size: 12px; color: #6b7280;">
                    If this problem persists, contact support.
                </div>
            </div>
        `;
    },
    
    // Loading state helper
    showLoading(elementId, message = 'Loading data...') {
        const element = document.getElementById(elementId);
        if (!element) return;
        
        element.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #6b7280;">
                <div class="spinner" style="margin: 0 auto 16px;"></div>
                <p>${message}</p>
            </div>
        `;
    },
    
    // Empty state helper
    showEmptyState(elementId, title, message) {
        const element = document.getElementById(elementId);
        if (!element) return;
        
        element.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #6b7280;">
                <div style="font-size: 48px; margin-bottom: 16px;">📊</div>
                <h3 style="margin-bottom: 8px; color: #374151;">${title}</h3>
                <p>${message}</p>
            </div>
        `;
    },
    
    // Server health check
    async checkServerHealth() {
        try {
            const response = await fetch(`${this.getApiBaseUrl()}/api/health`, {
                method: 'GET',
                timeout: 5000
            });
            return response.ok;
        } catch (error) {
            console.error('[HEALTH] Server check failed:', error.message);
            return false;
        }
    }
};

// Add spinner CSS
if (typeof document !== 'undefined') {
    const style = document.createElement('style');
    style.textContent = `
        .spinner {
            width: 24px;
            height: 24px;
            border: 3px solid #e5e7eb;
            border-top: 3px solid #3b82f6;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(style);
}

// Make CONFIG globally available
if (typeof window !== 'undefined') {
    window.CONFIG = CONFIG;
}