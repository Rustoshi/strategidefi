// Seeds demo/reference data matching the original site's contract.
// Idempotent: clears the collections it owns, then re-inserts.
require('../src/loadEnv')();

const { connectDB } = require('../src/db');
const { Counter } = require('../src/models/Counter');
const User = require('../src/models/User');
const Banner = require('../src/models/Banner');
const Coin = require('../src/models/Coin');
const Notice = require('../src/models/Notice');
const Setting = require('../src/models/Setting');

// Point banner/coin icons at whatever host actually serves the images. Defaults to the
// working live host; set ASSET_BASE_URL=/upload to use this app's locally-mirrored copies.
const ASSET = (process.env.ASSET_BASE_URL || 'https://api.strategidefi.com').replace(/\/$/, '');

const COINS = [
  ['USDT', 'USDT', 2, 4, 100],
  ['BTC', 'BTC', 6, 6, 99],
  ['ETH', 'ETH', 5, 6, 98],
  ['BNB', 'BNB', 4, 4, 90],
  ['BCH', 'BCH', 4, 4, 80],
  ['LTC', 'LTC', 4, 4, 70],
  ['XRP', 'XRP', 4, 6, 60],
  ['ADA', 'ADA', 2, 6, 50],
  ['DOGE', 'DOGE', 2, 6, 40],
  ['SOL', 'SOL', 4, 4, 30],
  ['DOT', 'DOT', 4, 4, 20],
  ['LINK', 'LINK', 4, 4, 10],
];

async function run() {
  await connectDB();

  await Promise.all([
    Banner.deleteMany({}),
    Coin.deleteMany({}),
    Notice.deleteMany({}),
    Setting.deleteMany({}),
    Counter.deleteMany({}),
  ]);

  // Banners (the two real slides, served from a working host).
  await Banner.create([
    {
      id: 1,
      name: 'Welcome',
      image: `${ASSET}/upload/images/7242a168693352707f6b10f88d2834fd.jpg`,
      sort: 11,
      status: 1,
      type: 1,
    },
    {
      id: 2,
      name: 'Secure & Reliable',
      image: `${ASSET}/upload/images/cbb038716af94e6a9d2b1a0e395371b7.jpg`,
      sort: 10,
      status: 1,
      type: 1,
    },
  ]);

  // Coins.
  await Coin.create(
    COINS.map(([coin_name, symbol, q, p, sort], i) => ({
      id: i + 1,
      coin_name,
      symbol,
      qty_decimals: q,
      price_decimals: p,
      icon: `${ASSET}/upload/images/${symbol}.png`,
      status: 1,
      currency_status: 1,
      sort,
      type: 1,
    }))
  );

  // Welcome notice.
  await Notice.create({
    id: 1,
    user_id: 0,
    titles: 'Welcome New Users',
    contents:
      'Hello new user:\r\nThank you for your support. To thank all new users for joining us, we provide a new-user reward mechanism. Please provide your account ID to customer service to learn the details.',
    status: 0,
  });

  // Settings.
  const settings = {
    site_name: 'StrategiDeFi',
    customer_service_url: '',
    min_withdraw: '10',
    withdraw_fee: '1',
    default_chain: 'TRC20',
    maintenance: '0',
  };
  for (const [name, value] of Object.entries(settings)) {
    await Setting.updateOne({ name }, { $set: { value } }, { upsert: true });
  }

  // Bootstrap admin user.
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@strategidefi.com').toLowerCase();
  const adminPass = process.env.ADMIN_PASSWORD || 'admin12345';
  await User.deleteOne({ email: adminEmail });
  const admin = new User({
    id: 1,
    email: adminEmail,
    nickname: 'Administrator',
    invite_code: 'ADMIN1',
    is_admin: true,
    status: 1,
  });
  await admin.setPassword(adminPass);
  await admin.save();
  // Keep the users counter ahead of the seeded admin id.
  await Counter.findByIdAndUpdate('users', { $set: { seq: 1 } }, { upsert: true });
  await Counter.findByIdAndUpdate('banners', { $set: { seq: 2 } }, { upsert: true });
  await Counter.findByIdAndUpdate('coins', { $set: { seq: COINS.length } }, { upsert: true });
  await Counter.findByIdAndUpdate('notices', { $set: { seq: 1 } }, { upsert: true });

  console.log(`Seeded: ${COINS.length} coins, 2 banners, 1 notice, ${Object.keys(settings).length} settings.`);
  console.log(`Admin login: ${adminEmail} / ${adminPass}`);
}

module.exports = { run };

// Allow `npm run seed` to execute directly.
if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
