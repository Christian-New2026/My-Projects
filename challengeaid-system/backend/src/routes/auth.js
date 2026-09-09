const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { login, changePassword } = require('../controllers/authController');
const router = express.Router();
router.post('/login', login);
router.post('/change-password', requireAuth, changePassword);
module.exports = router;
