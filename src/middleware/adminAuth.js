const jwt = require('jsonwebtoken');
const User = require('../models/User');

const SECRET = () => process.env.ADMIN_SESSION_SECRET || 'dev-admin-secret';

function signAdmin(user) {
  return jwt.sign({ uid: user.id, admin: true }, SECRET(), { expiresIn: '7d' });
}

// Gate EJS admin routes via an httpOnly cookie. Redirects to the login page.
async function requireAdmin(req, res, next) {
  const token = req.cookies && req.cookies.admin_token;
  if (!token) return res.redirect('/admin/login');
  try {
    const payload = jwt.verify(token, SECRET());
    const user = await User.findOne({ id: payload.uid, is_admin: true });
    if (!user) return res.redirect('/admin/login');
    req.admin = user;
    res.locals.admin = user;
    next();
  } catch (_e) {
    res.clearCookie('admin_token');
    return res.redirect('/admin/login');
  }
}

module.exports = { signAdmin, requireAdmin };
