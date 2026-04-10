'use strict';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

/**
 * Sends an RFC 7807 Problem Details response.
 * @param {import('express').Response} res
 * @param {{ status: number, title: string, detail: string, instance: string, extra?: object }} opts
 */
function problem(res, { status, title, detail, instance, extra = {} }) {
  return res
    .status(status)
    .set('Content-Type', 'application/problem+json')
    .json({
      type:     `${BASE_URL}/errors/${slugify(title)}`,
      title,
      status,
      detail,
      instance,
      ...extra
    });
}

function slugify(str) {
  return str.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

module.exports = { problem };
