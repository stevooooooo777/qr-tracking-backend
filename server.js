const express = require('express');
const cors = require('cors');

console.log('🚀 ULTRA-MINIMAL SERVER STARTING...');

const app = express();
const port = process.env.PORT || 8080;

// Log every request
app.use((req, res, next) => {
  console.log(`[REQ] ${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// CORS
app.use(cors({ origin: '*' }));

// SIMPLEST HEALTH CHECK POSSIBLE
app.get('/health', (req, res) => {
  console.log('[HEALTH] /health HIT - SENDING OK');
  res.status(200).send('OK');
});

app.get('/api/health', (req, res) => {
  console.log('[HEALTH] /api/health HIT');
  res.status(200).json({ 
    status: 'minimal server alive',
    timestamp: new Date().toISOString()
  });
});

// Catch-all - log everything
app.use('*', (req, res) => {
  console.log(`[CATCHALL] ${req.method} ${req.path}`);
  res.status(200).json({ 
    message: 'Minimal server responding!',
    path: req.path,
    method: req.method
  });
});

// Start server
console.log(`🎯 About to listen on port ${port}`);
console.log(`🎯 NODE_ENV: ${process.env.NODE_ENV}`);
console.log(`🎯 PORT: ${process.env.PORT}`);

app.listen(port, () => {
  console.log(`✅ MINIMAL SERVER LISTENING ON PORT ${port}`);
  console.log('🎉 READY FOR HEALTH CHECKS!');
});

// Keep alive
setInterval(() => {
  console.log('💓 MINIMAL SERVER ALIVE');
}, 30000); // Every 30 seconds

console.log('📝 SERVER FILE LOADED SUCCESSFULLY');