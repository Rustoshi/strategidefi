const { mongoose } = require('../db');

// Flexible key/value site settings surfaced by /api/common/getsetting.
// Stored as a single document keyed by `name` so the admin can edit arbitrary keys.
const settingSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, index: true },
    value: { type: mongoose.Schema.Types.Mixed, default: '' },
  },
  { timestamps: true }
);

settingSchema.statics.asObject = async function () {
  const rows = await this.find().lean();
  return rows.reduce((acc, r) => {
    acc[r.name] = r.value;
    return acc;
  }, {});
};

module.exports = mongoose.models.Setting || mongoose.model('Setting', settingSchema);
