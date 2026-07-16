// A perpetual-contract order/position (paper).
//
// Contract sizing: 1 Cont = 1 USDT of notional (pair_info.unit_amount = 1). That keeps the
// app's own "Estimated Margin" display (entrust_sheet / lever / unit_amount) exactly equal to
// the margin actually charged here: margin = notional / lever.
//
// PnL is settled honestly against the live mark price — long profits when price rises, short
// when it falls. No house edge.
const { mongoose } = require('../db');

const schema = new mongoose.Schema(
  {
    id: { type: Number, index: true, unique: true },
    order_no: { type: String, index: true },
    user_id: { type: Number, index: true },
    pair_id: { type: Number, index: true },
    pair_name: { type: String, default: '' },
    coin_name: { type: String, default: '' },
    entrust_type: { type: Number, default: 1 }, // 1 = long (open more), 2 = short
    trade_type: { type: Number, default: 1 }, // 1 = limit, 2 = market
    lever: { type: Number, default: 1 },
    entrust_price: { type: Number, default: 0 }, // requested limit price
    entrust_sheet: { type: Number, default: 0 }, // quantity in Cont
    avg_price: { type: Number, default: 0 }, // fill / open price (0 until filled)
    margin: { type: Number, default: 0 },
    stop_win_price: { type: Number, default: 0 },
    stop_lose_price: { type: Number, default: 0 },
    close_price: { type: Number, default: 0 },
    profit: { type: Number, default: 0 },
    // 0 = current (resting limit), 1 = open position, 2 = closed, 3 = cancelled
    status: { type: Number, default: 0 },
    close_reason: { type: String, default: '' }, // '', 'manual', 'take_profit', 'stop_loss', 'liquidation'
  },
  { timestamps: true }
);

// Unrealised PnL for an open position at `mark`.
schema.methods.pnlAt = function pnlAt(mark) {
  if (!this.avg_price || !mark) return 0;
  const dir = this.entrust_type === 1 ? 1 : -1;
  return Number((this.entrust_sheet * dir * (mark / this.avg_price - 1)).toFixed(4));
};

schema.methods.toApi = function toApi(mark) {
  const markPrice = Number(mark) || this.close_price || this.avg_price;
  const profit = this.status === 1 ? this.pnlAt(markPrice) : Number((this.profit || 0).toFixed(4));
  return {
    id: this.id,
    order_no: this.order_no,
    pair_id: this.pair_id,
    pair_name: this.pair_name,
    entrust_type: this.entrust_type,
    trade_type: this.trade_type,
    lever: this.lever,
    entrust_price: this.entrust_price,
    entrust_sheet: this.entrust_sheet,
    avg_price: this.avg_price,
    mark_price: Number(markPrice) || 0,
    now_price: Number(markPrice) || 0,
    margin: Number((this.margin || 0).toFixed(2)),
    earnest_price: Number((this.margin || 0).toFixed(2)), // the position list renders margin as earnest_price
    profit: Number(profit.toFixed(2)),
    profit_rate: this.margin ? Number(((profit / this.margin) * 100).toFixed(2)) : 0,
    stop_win_price: this.stop_win_price || '',
    stop_lose_price: this.stop_lose_price || '',
    close_price: this.close_price,
    status: this.status,
    status_text: ['Pending', 'Open', 'Closed', 'Cancelled'][this.status] || '',
    close_reason: this.close_reason,
    create_time: Math.floor(new Date(this.createdAt || Date.now()).getTime() / 1000),
  };
};

module.exports = mongoose.models.ContractOrder || mongoose.model('ContractOrder', schema);
