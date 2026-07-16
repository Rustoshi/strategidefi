// Local production-style start: requires a real MONGODB_URI in the environment / .env.
require('../src/loadEnv')();
const app = require('../src/app');
const { connectDB } = require('../src/db');

const PORT = process.env.PORT || 5173;

(async () => {
  try {
    await connectDB();
    console.log('MongoDB connected');
  } catch (e) {
    console.error('MongoDB connection failed:', e.message);
  }
  const server = app.listen(PORT, () => console.log(`StrategiDeFi running at http://localhost:${PORT}`));
  try {
    const ws = require('../src/ws');
    await ws.initState();
    ws.attachWs(server);
  } catch (e) {
    console.error('WebSocket init failed:', e.message);
  }
  // Background matchers/settlers (spot limit orders + fixed-time option delivery).
  try { require('../src/routes/api/coincoin').startMatcher(); } catch (e) { console.error('matcher init failed:', e.message); }
  try { require('../src/routes/api/option').startSettler(); } catch (e) { console.error('settler init failed:', e.message); }
  try { require('../src/routes/api/contract').startMonitor(); } catch (e) { console.error('contract monitor init failed:', e.message); }
})();
