const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { unauthorized } = require('../utils/response');

const SECRET = () => process.env.JWT_SECRET || 'dev-insecure-secret';

function sign(user) {
  return jwt.sign({ uid: user.id, email: user.email }, SECRET(), { expiresIn: '30d' });
}

// Extract Bearer token; attach req.user if valid. Does not reject.
async function optionalAuth(req, _res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (token) {
    try {
      const payload = jwt.verify(token, SECRET());
      req.user = await User.findOne({ id: payload.uid });
    } catch (_e) {
      req.user = null;
    }
  }
  next();
}

// Require a valid user or return the SPA's 401 envelope.
function requireAuth(req, res, next) {
  if (!req.user) return unauthorized(res);
  next();
}

module.exports = { sign, optionalAuth, requireAuth };
