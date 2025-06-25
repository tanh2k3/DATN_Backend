const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const jwt = require('jsonwebtoken');

// Middleware kiểm tra access token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Không có access token' });
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(401).json({ error: 'Access token không hợp lệ hoặc đã hết hạn' });
    req.user = user;
    next();
  });
}

// Tạo thanh toán VNPay
router.post('/vnpay', authenticateToken, paymentController.createVNPayPayment);

router.post('/vnpay-web', authenticateToken, paymentController.createVNPayPaymentWeb);

// Callback từ VNPay
router.get('/vnpay/callback', paymentController.vnpayCallback);

router.get('/vnpay/callback-web', paymentController.vnpayCallbackWeb);

module.exports = router; 