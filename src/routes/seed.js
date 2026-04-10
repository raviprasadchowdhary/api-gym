'use strict';

const express = require('express');
const router  = express.Router();
const { seedFull, seedMinimal } = require('../db/seed');
const { problem } = require('../utils/errors');

const CREDENTIALS = {
  admin: { email: 'admin@test.com', password: 'Admin123!' },
  user:  { email: 'user@test.com',  password: 'User123!'  },
  user2: { email: 'user2@test.com', password: 'User123!'  }
};

// ── Reset-key guard ───────────────────────────────────────────────────────────
// When RESET_SECRET env var is set, both seed routes require the caller to send
// the matching value in the X-Reset-Key header. Requests without the correct key
// are rejected with 401. When RESET_SECRET is not set (local dev), the guard is
// bypassed so local testing works without configuration.
function requireResetKey(req, res, next) {
  const secret = process.env.RESET_SECRET;
  if (!secret) return next(); // no secret configured → open (local dev)
  const provided = req.headers['x-reset-key'];
  if (!provided || provided !== secret) {
    return problem(res, {
      status:   401,
      title:    'Unauthorized',
      detail:   'Missing or invalid X-Reset-Key header.',
      instance: req.originalUrl
    });
  }
  return next();
}

// ── POST /seed/reset ──────────────────────────────────────────────────────────
// Wipes everything and re-seeds with full data set. Call this between test suites.
router.post('/reset', requireResetKey, async (req, res) => {
  await seedFull();
  return res.status(200).json({
    message:     'Store wiped and fully re-seeded',
    credentials: CREDENTIALS,
    counts: {
      users:      3,
      categories: 4,
      products:   11
    }
  });
});

// ── POST /seed/minimal ────────────────────────────────────────────────────────
// Seeds only users — no products or categories. Good for edge-case testing.
router.post('/minimal', requireResetKey, async (req, res) => {
  await seedMinimal();
  return res.status(200).json({
    message:     'Store wiped and seeded with users only (no products/categories)',
    credentials: CREDENTIALS,
    counts: {
      users:      3,
      categories: 0,
      products:   0
    }
  });
});

module.exports = router;
