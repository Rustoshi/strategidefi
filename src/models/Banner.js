const { mongoose } = require('../db');
const { fmt, unix } = require('../utils/time');

const bannerSchema = new mongoose.Schema(
  {
    id: { type: Number, index: true, unique: true },
    name: { type: String, default: '' },
    redirect_url: { type: String, default: null },
    image: { type: String, default: '' },
    sort: { type: Number, default: 0 },
    status: { type: Number, default: 1 }, // 1 = shown
    type: { type: Number, default: 1 },
  },
  { timestamps: true }
);

// Serialize to the exact shape the SPA reads from /api/common/index.
bannerSchema.methods.toApi = function () {
  return {
    id: this.id,
    name: this.name,
    redirect_url: this.redirect_url,
    image: this.image,
    sort: this.sort,
    created_at: fmt(this.createdAt),
    updated_at: fmt(this.updatedAt),
    status: this.status,
    type: this.type,
    create_time: unix(this.createdAt),
  };
};

module.exports = mongoose.models.Banner || mongoose.model('Banner', bannerSchema);
