// Local dev entry.
// If MONGODB_URI is set (e.g. a real Atlas cluster), it is used directly.
// Otherwise an in-memory MongoDB is started so the app runs fully offline, and the
// database is auto-seeded on first boot.
require('../src/loadEnv')();

const PORT = process.env.PORT || 5173;

async function ensureMongo() {
  if (process.env.MONGODB_URI) {
    console.log('Using MONGODB_URI from environment.');
    return;
  }
  console.log('No MONGODB_URI set — starting in-memory MongoDB (dev only)...');
  const { MongoMemoryServer } = require('mongodb-memory-server');
  const mongod = await MongoMemoryServer.create({ instance: { dbName: 'strategidefi' } });
  process.env.MONGODB_URI = mongod.getUri();
  process.env._USING_MEMORY_MONGO = '1';
  console.log('In-memory MongoDB ready.');
}

(async () => {
  await ensureMongo();

  const { connectDB } = require('../src/db');
  await connectDB();
  console.log('MongoDB connected.');

  // Seed if the database is empty (fresh in-memory instance or empty cluster).
  const Coin = require('../src/models/Coin');
  if ((await Coin.estimatedDocumentCount()) === 0) {
    console.log('Empty database — seeding demo data...');
    await require('./seed').run();
  }

  const app = require('../src/app');
  const server = app.listen(PORT, () => {
    console.log(`\nStrategiDeFi running at http://localhost:${PORT}`);
    console.log(`Admin panel:  http://localhost:${PORT}/admin`);
  });

  // Live-price websocket (dashboard coinrate stream).
  const ws = require('../src/ws');
  await ws.initState();
  ws.attachWs(server);

  // Resting limit-order matcher (fills spot limit orders when the price crosses).
  require('../src/routes/api/coincoin').startMatcher();

  // Fixed-time option settler (settles due option bets against the live price).
  require('../src/routes/api/option').startSettler();

  // Perpetual contract monitor (limit fills, take-profit/stop-loss, liquidation).
  require('../src/routes/api/contract').startMonitor();
})().catch((e) => {
  console.error('Dev server failed to start:', e);
  process.exit(1);
});
