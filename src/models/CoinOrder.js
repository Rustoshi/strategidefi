const { mongoose } = require('../db');
const { fmt, unix } = require('../utils/time');

// A spot order (paper). Buy = spend USDT for coin; Sell = sell coin for USDT.
// Market orders fill immediately at the live price; limit orders rest until the price
// crosses. Balances/holdings on the Account are mutated on fill / cancel.
const coinOrderSchema = new mongoose.Schema(
  {
    id: { type: Number, index: true, unique: true },
    user_id: { type: Number, index: true },
    pair_id: { type: Number },
    coin_name: { type: String }, // base symbol, e.g. BTC
    side: { type: String, enum: ['buy', 'sell'] },
    is_market: { type: Boolean, default: true },

    entrust_price: { type: Number, default: 0 }, // requested price (limit)
    entrust_num: { type: Number, default: 0 }, // requested coin quantity
    expect_money: { type: Number, default: 0 }, // expected USDT total

    filled_price: { type: Number, default: 0 },
    filled_num: { type: Number, default: 0 },
    filled_money: { type: Number, default: 0 },

    // 0 = pending/resting, 1 = filled, 2 = cancelled
    status: { type: Number, default: 0, index: true },
  },
  { timestamps: true }
);

coinOrderSchema.methods.toApi = function () {
  return {
    id: this.id,
    order_no: String(this.id), // the Coin page cancels by order_no
    pair_id: this.pair_id,
    coin_name: this.coin_name,
    pn: `${this.coin_name}/USDT`,
    side: this.side,
    trade_type: this.is_market ? 1 : 2,
    is_market: this.is_market ? 1 : 0,
    entrust_price: this.entrust_price,
    entrust_num: this.entrust_num,
    expect_money: this.expect_money,
    price: this.filled_price || this.entrust_price,
    number: this.filled_num || this.entrust_num,
    deal_price: this.filled_price,
    deal_num: this.filled_num,
    money: this.filled_money || this.expect_money,
    status: this.status,
    status_text: this.status === 1 ? 'Filled' : this.status === 2 ? 'Cancelled' : 'Pending',
    created_at: fmt(this.createdAt),
    create_time: unix(this.createdAt),
  };
};

module.exports = mongoose.models.CoinOrder || mongoose.model('CoinOrder', coinOrderSchema);
