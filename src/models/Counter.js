// Auto-increment source so documents can expose a numeric `id` (the SPA expects
// integer ids, not Mongo ObjectIds).
const { mongoose } = require('../db');

const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // collection name
  seq: { type: Number, default: 0 },
});

const Counter = mongoose.models.Counter || mongoose.model('Counter', counterSchema);

async function nextId(name) {
  const doc = await Counter.findByIdAndUpdate(
    name,
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return doc.seq;
}

module.exports = { Counter, nextId };
