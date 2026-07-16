const { mongoose } = require('../db');
const { fmt, unix } = require('../utils/time');

const coinSchema = new mongoose.Schema(
  {
    id: { type: Number, index: true, unique: true },
    coin_name: { type: String, required: true },
    symbol: { type: String, required: true },
    qty_decimals: { type: Number, default: 2 },
    price_decimals: { type: Number, default: 4 },
    icon: { type: String, default: '' },
    status: { type: Number, default: 1 },
    currency_status: { type: Number, default: 1 },
    sort: { type: Number, default: 0 },
    type: { type: Number, default: 1 },
  },
  { timestamps: true }
);

// Matches /api/common/coinlist -> { list: [...] }
coinSchema.methods.toApi = function () {
  return {
    id: this.id,
    coin_name: this.coin_name,
    symbol: this.symbol,
    qty_decimals: this.qty_decimals,
    price_decimals: this.price_decimals,
    icon: this.icon,
    status: this.status,
    currency_status: this.currency_status,
    sort: this.sort,
    created_at: fmt(this.createdAt),
    updated_at: fmt(this.updatedAt),
    type: this.type,
    create_time: unix(this.createdAt),
  };
};

module.exports = mongoose.models.Coin || mongoose.model('Coin', coinSchema);
