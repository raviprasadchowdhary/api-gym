'use strict';

const { v4: uuidv4 } = require('uuid');

module.exports = (req, res, next) => {
  const requestId = req.headers['x-request-id'] || uuidv4();
  req.requestId = requestId;
  res.set('X-Request-Id', requestId);
  next();
};
