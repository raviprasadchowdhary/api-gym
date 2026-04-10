'use strict';

const { verifyAccess } = require('../utils/jwt');
const { store }        = require('../db/store');
const { problem }      = require('../utils/errors');

module.exports = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return problem(res, {
      status:   401,
      title:    'Unauthorized',
      detail:   'Missing or malformed Authorization header. Expected: Bearer <token>',
      instance: req.path
    });
  }

  const token = authHeader.slice(7);
  let payload;

  try {
    payload = verifyAccess(token);
  } catch (err) {
    const detail = err.name === 'TokenExpiredError'
      ? 'Access token has expired — use /v1/auth/refresh to get a new one'
      : 'Invalid access token';
    return problem(res, { status: 401, title: 'Unauthorized', detail, instance: req.path });
  }

  const user = store.users.find(u => u.id === payload.sub && !u.deleted);
  if (!user) {
    return problem(res, {
      status:   401,
      title:    'Unauthorized',
      detail:   'User account no longer exists or has been deleted',
      instance: req.path
    });
  }

  req.user = user;
  next();
};
