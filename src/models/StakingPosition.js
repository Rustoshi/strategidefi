// A user's stake in an Earn plan. Principal is moved out of the usable balance for the
// plan's lock cycle. Yield is NOT accrued automatically by any formula — `total_yield` only
// ever grows when an admin credits realised earnings (YieldService.creditYield), which also
// writes a CreditLog transaction. So the numbers shown are always money that actually moved.
const { mongoose } = require('../db');

const schema = new mongoose.Schema(
  {
    id: { type: Number, index: true, unique: true },
    user_id: { type: Number, index: true },
    plan_id: { type: Number, index: true },
    plan_name: { type: String, default: '' },
    amount: { type: Number, default: 0 }, // principal staked
    day_num: { type: Number, default: 1 },
    start_at: { type: Number, default: 0 }, // epoch ms
    end_at: { type: Number, default: 0 }, // epoch ms when the cycle matures
    total_yield: { type: Number, default: 0 }, // sum of admin-credited yield
    status: { type: Number, default: 0 }, // 0 active, 1 redeemed
  },
  { timestamps: true }
);

schema.methods.toApi = function toApi() {
  const matured = this.status === 0 && Date.now() >= this.end_at;
  return {
    id: this.id,
    plan_id: this.plan_id,
    names: this.plan_name,
    amount: Number((this.amount || 0).toFixed(2)),
    price: Number((this.amount || 0).toFixed(2)),
    day_num: this.day_num,
    profit: Number((this.total_yield || 0).toFixed(2)),
    total_profit: Number((this.total_yield || 0).toFixed(2)),
    status: this.status,
    status_text: this.status === 1 ? 'Redeemed' : matured ? 'Matured' : 'Active',
    start_time: Math.floor((this.start_at || 0) / 1000),
    end_time: Math.floor((this.end_at || 0) / 1000),
    create_time: Math.floor(new Date(this.createdAt || Date.now()).getTime() / 1000),
  };
};

module.exports = mongoose.models.StakingPosition || mongoose.model('StakingPosition', schema);
