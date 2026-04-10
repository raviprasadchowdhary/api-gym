'use strict';

const jwt = require('jsonwebtoken');

const ACCESS_SECRET  = process.env.JWT_SECRET          || 'dev-access-secret-change-in-prod';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET  || 'dev-refresh-secret-change-in-prod';

function signAccess(payload) {
  return jwt.sign(payload, ACCESS_SECRET, { algorithm: 'HS256', expiresIn: '15m' });
}

function signRefresh(payload) {
  return jwt.sign(payload, REFRESH_SECRET, { algorithm: 'HS256', expiresIn: '7d' });
}

function verifyAccess(token) {
  // algorithms array prevents 'alg: none' and algorithm confusion attacks
  return jwt.verify(token, ACCESS_SECRET, { algorithms: ['HS256'] });
}

function verifyRefresh(token) {
  return jwt.verify(token, REFRESH_SECRET, { algorithms: ['HS256'] });
}

module.exports = { signAccess, signRefresh, verifyAccess, verifyRefresh };
