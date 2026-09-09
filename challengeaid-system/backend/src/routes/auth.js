const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { login, changePassword, reviewPasswordChange } = require('../controllers/authController');
const router = express.Router();
router.post('/login', login);
router.post('/change-password', requireAuth, changePassword);
router.get('/password-approval/:token/:action', reviewPasswordChange);
module.exports = router;
