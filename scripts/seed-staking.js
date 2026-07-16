// Seed the Earn/staking plan tiers (idempotent — safe to re-run).
//
// Deposit bands, lock cycles and daily-income-rate bands from the product design.
// Rates are decimals: 0.014 = 1.40%/day. Expected income per cycle is derived as
// rate x day_num in StakingPlan.toApi (e.g. 2.20%/day x 3 days = 6.60%).
require('../src/loadEnv')();

const TIERS = [
  { min_price: 1800, max_price: 10000, day_num: 1, profit_rate_min: 0.014, profit_rate_max: 0.018 },
  { min_price: 10001, max_price: 50000, day_num: 1, profit_rate_min: 0.018, profit_rate_max: 0.022 },
  { min_price: 50001, max_price: 150000, day_num: 3, profit_rate_min: 0.022, profit_rate_max: 0.026 },
  { min_price: 150001, max_price: 450000, day_num: 3, profit_rate_min: 0.026, profit_rate_max: 0.03 },
  { min_price: 450001, max_price: 1000000, day_num: 3, profit_rate_min: 0.03, profit_rate_max: 0.034 },
  { min_price: 1000001, max_price: 9999999999, day_num: 3, profit_rate_min: 0.034, profit_rate_max: 0.038 },
];

const PLAN_NAME = 'Tether AI';
const PLAN_ICON = '/tether.png'; // shipped in public/ — served from the app root

async function run() {
  const StakingPlan = require('../src/models/StakingPlan');
  const { nextId } = require('../src/models/Counter');

  for (let i = 0; i < TIERS.length; i++) {
    const t = TIERS[i];
    const existing = await StakingPlan.findOne({ min_price: t.min_price, day_num: t.day_num });
    const doc = {
      names: PLAN_NAME,
      image: PLAN_ICON,
      min_price: t.min_price,
      max_price: t.max_price,
      day_num: t.day_num,
      profit_rate_min: t.profit_rate_min,
      profit_rate_max: t.profit_rate_max,
      sort: i,
      status: 1,
    };
    if (existing) {
      Object.assign(existing, doc);
      await existing.save();
    } else {
      await StakingPlan.create({ id: await nextId('staking_plans'), ...doc });
    }
  }
  const total = await StakingPlan.countDocuments({ status: 1 });
  console.log(`Seeded staking plans. Active plans: ${total}`);
}

module.exports = { run };

if (require.main === module) {
  (async () => {
    const { connectDB } = require('../src/db');
    await connectDB();
    await run();
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
}
