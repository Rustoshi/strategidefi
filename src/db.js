// Mongoose connection with global caching so serverless (Vercel) invocations
// reuse a single connection across warm lambda executions instead of opening a
// new one on every request.
const mongoose = require('mongoose');

let cached = global._mongoose;
if (!cached) cached = global._mongoose = { conn: null, promise: null };

async function connectDB() {
  if (cached.conn) return cached.conn;

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set. Copy .env.example to .env and fill it in.');

  if (!cached.promise) {
    cached.promise = mongoose
      .connect(uri, {
        bufferCommands: false,
        serverSelectionTimeoutMS: 10000,
        // Isolate StrategiDeFi into its own database within the cluster so its collections
        // never collide with any other app's data that may live in the URI's database.
        // Override with DB_NAME if you want a specific database.
        dbName: process.env.DB_NAME || 'strategidefi',
      })
      .then((m) => m);
  }
  cached.conn = await cached.promise;
  return cached.conn;
}

module.exports = { connectDB, mongoose };
