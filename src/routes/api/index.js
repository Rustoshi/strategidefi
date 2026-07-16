const express = require('express');
const router = express.Router();

router.use('/auth', require('./auth'));
router.use('/common', require('./common'));
router.use('/credit', require('./credit'));
router.use('/coincoin', require('./coincoin'));
router.use('/option', require('./option'));
router.use('/pledge', require('./pledge'));
router.use('/contract', require('./contract'));
router.use('/support', require('./support'));

// Any /api/* route not implemented yet degrades quietly with a success-shaped envelope
// so the SPA never surfaces a developer error toast to end users. The SPA only shows a
// message when status_code !== 200, so unknown probes (e.g. GET /api/auth/login on page
// load) stay silent. Unhandled paths are logged server-side for developer visibility.
router.all('*', (req, res) => {
  console.warn(`[api] unhandled ${req.method} ${req.baseUrl}${req.path}`);
  res.json({ status_code: 200, data: [], message: 'success' });
});

module.exports = router;
