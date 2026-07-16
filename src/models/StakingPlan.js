// An Earn/staking plan tier: a deposit band (min_price..max_price), a lock cycle (day_num)
// and the displayed daily-income-rate band. Rates are stored as decimals (0.014 = 1.40%).
//
// Demo data for a private sandbox: balances here are simulated and yield is only ever moved
// by an explicit admin credit (see services/staking.creditYield), which writes a real
// CreditLog transaction. Nothing accrues on a timer from these rates.
const { mongoose } = require('../db');

const schema = new mongoose.Schema(
  {
    id: { type: Number, index: true, unique: true },
    names: { type: String, default: 'Tether AI' },
    image: { type: String, default: '' },
    min_price: { type: Number, default: 0 },
    max_price: { type: Number, default: 0 },
    day_num: { type: Number, default: 1 }, // lock cycle in days
    profit_rate_min: { type: Number, default: 0 }, // decimal, e.g. 0.014 = 1.40%/day
    profit_rate_max: { type: Number, default: 0 },
    sort: { type: Number, default: 0 },
    status: { type: Number, default: 1 },
  },
  { timestamps: true }
);

// Card shape the Earn page renders. profit_rate_* / expect_profit_rate MUST be numeric —
// the compiled template does `(100*rate).toFixed(2)` and reads `expect_profit_rate.min`,
// so omitting them throws and blanks the whole list.
// Expected income over the cycle = daily rate x day_num (matches the product design).
schema.methods.toApi = function toApi() {
  const days = this.day_num || 1;
  return {
    id: this.id,
    names: this.names,
    image: this.image,
    min_price: this.min_price,
    max_price: this.max_price,
    day_num: this.day_num,
    profit_rate_min: this.profit_rate_min,
    profit_rate_max: this.profit_rate_max,
    expect_profit_rate: {
      min: Number((this.profit_rate_min * days).toFixed(6)),
      max: Number((this.profit_rate_max * days).toFixed(6)),
    },
  };
};

module.exports = mongoose.models.StakingPlan || mongoose.model('StakingPlan', schema);
