const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');

// Tạo thanh toán VNPay
router.post('/vnpay', paymentController.createVNPayPayment);

router.post('/vnpay-web', paymentController.createVNPayPaymentWeb);

// Callback từ VNPay
router.get('/vnpay/callback', paymentController.vnpayCallback);

router.get('/vnpay/callback-web', paymentController.vnpayCallbackWeb);

module.exports = router; 