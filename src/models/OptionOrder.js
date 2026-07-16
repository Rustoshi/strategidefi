// Fixed-time option (paper). The user stakes `bet_amount` on the price going up or down
// over `second` seconds. At delivery the entry price is compared to the live price and the
// bet is settled HONESTLY against the real market move — no house edge beyond the quoted
// odds, no rigging. Winnings pay bet_amount * odds; a loss forfeits the stake; a tie refunds.
const { mongoose } = require('../db');

const schema = new mongoose.Schema(
  {
    id: { type: Number, index: true, unique: true },
    user_id: { type: Number, index: true },
    pair_id: { type: Number },
    coin_name: { type: String },
    pair_name: { type: String },
    dir: { type: String, enum: ['up', 'down'] },
    bet_amount: { type: Number, default: 0 },
    second: { type: Number, default: 60 },
    second_name: { type: String, default: '' },
    odds: { type: Number, default: 0 }, // profit rate on a win (e.g. 0.85 = +85%)
    entry_price: { type: Number, default: 0 },
    deliver_at: { type: Number, default: 0 }, // epoch ms when it settles
    delivery_price: { type: Number, default: 0 },
    profit_amount: { type: Number, default: 0 },
    result: { type: String, default: '' }, // '', 'win', 'lose', 'tie'
    status: { type: Number, default: 0 }, // 0 pending, 1 settled
  },
  { timestamps: true }
);

schema.methods.toApi = function toApi() {
  const settled = this.status === 1;
  const statusText = !settled ? 'In progress' : this.result === 'win' ? 'Win' : this.result === 'tie' ? 'Tie' : 'Lose';
  return {
    id: this.id,
    pair_id: this.pair_id,
    pn: this.pair_name || `${this.coin_name}/USDT`,
    pair_name: this.pair_name || `${this.coin_name}/USDT`,
    coin_name: this.coin_name,
    bet_amount: Number(this.bet_amount.toFixed(2)),
    bet_up_down: this.dir === 'up' ? 1 : 0,
    direction_text: this.dir === 'up' ? 'Up' : 'Down',
    second: this.second,
    second_name: this.second_name,
    odds: this.odds,
    entry_price: this.entry_price,
    open_price: this.entry_price,
    delivery_price: settled ? this.delivery_price : 0,
    profit_amount: Number((this.profit_amount || 0).toFixed(2)),
    result: this.result,
    status: this.status,
    status_text: statusText,
    deliver_at: this.deliver_at,
    create_time: Math.floor(new Date(this.createdAt || Date.now()).getTime() / 1000),
  };
};

module.exports = mongoose.models.OptionOrder || mongoose.model('OptionOrder', schema);
