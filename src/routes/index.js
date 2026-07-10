const express = require('express');

const authRoutes = require('./auth.routes');
const profileRoutes = require('./profile.routes');
const discoveryRoutes = require('./discovery.routes');
const matchRoutes = require('./match.routes');
const referenceRoutes = require('./reference.routes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/reference', referenceRoutes);
router.use('/profiles', profileRoutes);
router.use('/discovery', discoveryRoutes);
router.use('/matches', matchRoutes);

module.exports = router;
