const router = require('express').Router();
const apiRoutes = require('./api');
const pageRoutes = require('./pages');

router.use('/api', apiRoutes);
router.use('/page', pageRoutes);

module.exports = router;
