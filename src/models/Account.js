const { mongoose } = require('../db');

// A user's simulated (paper) balances. Three sub-accounts mirror the app's Assets page:
// Funds (spot), Contract (derivatives margin), and Fiat. All amounts are in USDT.
// Spot holdings are tracked per coin symbol under `holdings`. No real funds are ever
// involved — deposit/withdraw are inert stubs; the starting balance is credited on signup.
const STARTING_FUNDS = Number(process.env.DEMO_START_USDT || 10000);

const accountSchema = new mongoose.Schema(
  {
    user_id: { type: Number, index: true, unique: true },

    funds: { type: Number, default: STARTING_FUNDS }, // Funds Account available (USDT)
    funds_freeze: { type: Number, default: 0 },

    contract: { type: Number, default: 0 }, // Contract Account available (USDT)
    contract_freeze: { type: Number, default: 0 },

    fiat: { type: Number, default: 0 }, // Fiat Account available (USDT)
    fiat_freeze: { type: Number, default: 0 },

    // Spot coin holdings, e.g. { BTC: 0.5, ETH: 2 } — kept as a plain object.
    holdings: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

accountSchema.statics.forUser = async function (userId) {
  let acc = await this.findOne({ user_id: userId });
  if (!acc) acc = await this.create({ user_id: userId });
  return acc;
};

accountSchema.statics.STARTING_FUNDS = STARTING_FUNDS;

module.exports = mongoose.models.Account || mongoose.model('Account', accountSchema);
