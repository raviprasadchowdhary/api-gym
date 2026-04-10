'use strict';

const { problem } = require('../utils/errors');

/**
 * Validates req.body (default), req.query, or req.params against a Joi schema.
 * Strips unknown fields (mass-assignment protection).
 *
 * Usage: validate(schema), validate(schema, 'query'), validate(schema, 'params')
 */
module.exports = (schema, target = 'body') => (req, res, next) => {
  const data = target === 'body'   ? req.body
             : target === 'query'  ? req.query
             : req.params;

  const { error, value } = schema.validate(data, { abortEarly: false, stripUnknown: true });

  if (error) {
    return problem(res, {
      status:   422,
      title:    'Validation Error',
      detail:   'One or more fields failed validation',
      instance: req.path,
      extra: {
        errors: error.details.map(d => ({
          field:   d.path.join('.'),
          message: d.message.replace(/['"]/g, '')
        }))
      }
    });
  }

  if (target === 'body')        req.body  = value;
  else if (target === 'query')  req.query = value;
  next();
};
