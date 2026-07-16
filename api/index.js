// Vercel serverless entry. Vercel's @vercel/node runtime imports this module and passes
// (req, res) straight to the exported Express app — no app.listen() here.
require('../src/loadEnv')();
module.exports = require('../src/app');
