'use strict';

const express = require('express');
const router  = express.Router();
const { seedFull, seedMinimal } = require('../db/seed');

const CREDENTIALS = {
  admin: { email: 'admin@test.com', password: 'Admin123!' },
  user:  { email: 'user@test.com',  password: 'User123!'  },
  user2: { email: 'user2@test.com', password: 'User123!'  }
};

// ── POST /seed/reset ──────────────────────────────────────────────────────────
// Wipes everything and re-seeds with full data set. Call this between test suites.
router.post('/reset', async (req, res) => {
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
router.post('/minimal', async (req, res) => {
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
