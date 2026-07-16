// Admin-configurable key/value settings store. One document per setting `key`; `value` is
// free-form (string / number / object / array). Use this for anything an admin should be
// able to change at runtime without a redeploy — e.g. the deposit wallet addresses and bank
// details surfaced on the Deposit page.
const { mongoose } = require('../db');

const schema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    value: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

// Read a setting, falling back to `def` when it isn't set yet.
schema.statics.get = async function get(key, def) {
  const doc = await this.findOne({ key }).lean();
  return doc && doc.value !== undefined ? doc.value : def;
};

// Create or update a setting.
schema.statics.set = async function set(key, value) {
  await this.updateOne({ key }, { $set: { value } }, { upsert: true });
  return value;
};

// Read a setting, seeding it with `def` on first access so an admin has a row to edit later.
schema.statics.getOrSeed = async function getOrSeed(key, def) {
  const existing = await this.findOne({ key });
  if (existing && existing.value !== undefined) return existing.value;
  await this.updateOne({ key }, { $set: { value: def } }, { upsert: true });
  return def;
};

module.exports = mongoose.models.AppSettings || mongoose.model('AppSettings', schema);
