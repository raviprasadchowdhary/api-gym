'use strict';

const { problem } = require('../utils/errors');

/**
 * Usage: requireRole('admin') or requireRole('admin', 'user')
 */
module.exports = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return problem(res, {
      status:   403,
      title:    'Forbidden',
      detail:   `This action requires one of the following roles: ${roles.join(', ')}`,
      instance: req.path
    });
  }
  next();
};
