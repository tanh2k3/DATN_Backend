const crypto = require('crypto');
const moment = require('moment');
const querystring = require('querystring');
const axios = require('axios');
const { VNPAY_CONFIG, MOMO_CONFIG } = require('../payment');
const db = require('../db');
const { VNPay } = require('vnpay');

// Tạo mã đơn hàng
const generateOrderId = () => {
    return `ORDER_${moment().format('YYYYMMDDHHmmss')}_${Math.floor(Math.random() * 1000)}`;
};

// Hàm hỗ trợ sắp xếp object
function sortObject(obj) {
    const sorted = {};
    // Sắp xếp keys theo thứ tự alphabet
    const keys = Object.keys(obj).sort((a, b) => a.localeCompare(b));
    console.log('Sorted keys:', keys);
    
    for (const key of keys) {
        if (obj[key] !== null && obj[key] !== undefined) {
            sorted[key] = obj[key];
        }
    }
    return sorted;
}

// Hàm test chữ ký
function testSignature(params, hashSecret) {
    // Sắp xếp params theo key
    const sortedParams = sortObject(params);
    
    // Tạo chuỗi ký tự để hash
    const signData = Object.entries(sortedParams)
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join('&');
    
    // Tạo chữ ký
    const hmac = crypto.createHmac("sha512", hashSecret);
    const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest("hex");
    
    return {
        signData,
        signed
    };
}

// Xử lý thanh toán VNPay
exports.createVNPayPayment = async (req, res) => {
    try {
        console.log('Received order data:', req.body);
        const orderData = req.body;
        
        // Validate dữ liệu đầu vào
        if (!orderData.movieId || !orderData.cinemaId || !orderData.showtimeId || 
            !orderData.roomId || !orderData.seats || !orderData.combos || 
            !orderData.totalAmount || !orderData.userId) {
            console.log('Missing order data');
            return res.status(400).json({ error: 'Thiếu thông tin đơn hàng' });
        }

        const orderId = generateOrderId();
        console.log('Generated order ID:', orderId);
        
        // Tạo đơn hàng mới
        const query = `
            INSERT INTO orders (
                orderId, movieId, cinemaId, showtimeId, roomId, 
                seats, combos, totalAmount, paymentMethod, status, userId,
                point_used, originalAmount
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        const values = [
            orderId,
            orderData.movieId,
            orderData.cinemaId,
            orderData.showtimeId,
            orderData.roomId,
            JSON.stringify(orderData.seats),
            JSON.stringify(orderData.combos),
            orderData.totalAmount,
            'VNPay',
            'PENDING',
            orderData.userId,
            orderData.point_used || 0,
            orderData.originalAmount || orderData.totalAmount
        ];

        await db.query(query, values);
        console.log('Order created in database with point_used:', orderData.point_used, 'and originalAmount:', orderData.originalAmount);

        // Tạo URL thanh toán VNPay
        const date = new Date();
        const createDate = moment(date).format('YYYYMMDDHHmmss');
        console.log('Create date:', createDate);
        
        const orderInfo = `Thanh toan don hang ${orderId}`;
        const orderType = 'billpayment';
        const locale = 'vn';
        const currCode = 'VND';
        
        // Đảm bảo số tiền là số nguyên, không cần nhân thêm 100 vì VNPay sẽ tự nhân
        const amount = Math.round(Number(orderData.totalAmount));
        console.log('Amount:', amount);

        // Lấy IP thực tế của người dùng
        const ipAddr = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        const cleanIp = ipAddr.replace('::ffff:', ''); // Loại bỏ IPv6 prefix nếu có
        console.log('IP Address:', cleanIp);

        // Khởi tạo VNPay
        const vnpay = new VNPay({
            tmnCode: VNPAY_CONFIG.vnp_TmnCode,
            secureSecret: VNPAY_CONFIG.vnp_HashSecret,
            vnpayHost: 'https://sandbox.vnpayment.vn',
            testMode: true,
            hashAlgorithm: 'SHA512'
        });

        // Tạo URL thanh toán
        const vnpayResponse = await vnpay.buildPaymentUrl({
            vnp_Amount: amount,
            vnp_IpAddr: cleanIp,
            vnp_TxnRef: orderId,
            vnp_OrderInfo: orderInfo,
            vnp_OrderType: orderType,
            //vnp_ReturnUrl: `${VNPAY_CONFIG.vnp_ReturnUrl}/payment/vnpay/callback`,
            vnp_ReturnUrl: `https://datn-backend-mvze.onrender.com/payment/vnpay/callback`,
            vnp_Locale: locale,
            vnp_CreateDate: createDate
        });

        console.log('VNPay Response:', vnpayResponse);
        res.json({ paymentUrl: vnpayResponse });
    } catch (error) {
        console.error('VNPay payment error:', error);
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Đơn hàng đã tồn tại' });
        }
        if (error.code === 'ER_NO_REFERENCED_ROW') {
            return res.status(400).json({ error: 'Dữ liệu không hợp lệ' });
        }
        res.status(500).json({ error: 'Lỗi khi tạo thanh toán VNPay' });
    }
};

// Xử lý callback từ VNPay
exports.vnpayCallback = async (req, res) => {
    try {
        const vnpParams = req.query;
        console.log('VNPay callback params:', vnpParams);

        // Lấy chữ ký từ params
        const secureHash = vnpParams['vnp_SecureHash'];
        delete vnpParams['vnp_SecureHash'];
        delete vnpParams['vnp_SecureHashType'];

        // Sắp xếp params theo key
        const sortedParams = sortObject(vnpParams);
        
        // Tạo chuỗi ký tự để hash theo đúng thứ tự
        const signData = Object.entries(sortedParams)
            .map(([key, value]) => `${key}=${value.replace(/\s+/g, '+')}`)
            .join('&');

        console.log('Sign data:', signData);
        console.log('Expected hash:', secureHash);

        // Tạo chữ ký
        const hmac = crypto.createHmac('sha512', VNPAY_CONFIG.vnp_HashSecret);
        const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');
        console.log('Generated hash:', signed);

        // Kiểm tra chữ ký
        if (secureHash !== signed) {
            console.log('Invalid signature');
            console.log('Expected:', secureHash);
            console.log('Received:', signed);
            return res.status(400).json({ error: 'Chữ ký không hợp lệ' });
        }

        // Lấy thông tin từ params
        const orderId = vnpParams['vnp_TxnRef'];
        const rspCode = vnpParams['vnp_ResponseCode'];
        const amount = vnpParams['vnp_Amount'];
        const bankCode = vnpParams['vnp_BankCode'];
        const payDate = vnpParams['vnp_PayDate'];
        const transactionNo = vnpParams['vnp_TransactionNo'];

        console.log('Payment info:', {
            orderId,
            rspCode,
            amount,
            bankCode,
            payDate,
            transactionNo
        });

        // Lấy thông tin đơn hàng để lấy point_used và originalAmount
        const orderQuery = 'SELECT point_used, originalAmount, userId, totalAmount FROM orders WHERE orderId = ?';
        const [orderResult] = await db.query(orderQuery, [orderId]);
        const order = orderResult[0];
        
        if (!order) {
            throw new Error('Không tìm thấy đơn hàng');
        }

        // Cập nhật trạng thái đơn hàng
        const query = `
            UPDATE orders 
            SET status = ?, 
                paymentInfo = ?,
                point_used = ?,
                originalAmount = ?
            WHERE orderId = ?
        `;
        
        const status = rspCode === '00' ? 'COMPLETED' : 'FAILED';
        const paymentInfo = JSON.stringify({
            bankCode,
            payDate,
            transactionNo,
            amount: Number(amount) / 100
        });

        await db.query(query, [status, paymentInfo, order.point_used, order.originalAmount, orderId]);
        console.log('Order updated:', { orderId, status, point_used: order.point_used, originalAmount: order.originalAmount });

        // Nếu thanh toán thành công, cập nhật ghế đã đặt và cộng điểm thưởng
        if (status === 'COMPLETED') {
            try {
                // Lấy thông tin đơn hàng
                const orderQuery = 'SELECT showtimeId, seats, totalAmount, userId, point_used FROM orders WHERE orderId = ?';
                const [orderResult] = await db.query(orderQuery, [orderId]);
                console.log('Order data:', orderResult);
                
                if (orderResult && orderResult.length > 0) {
                    const order = orderResult[0];
                    console.log('ShowtimeId from order:', order.showtimeId);
                    
                    // Tính điểm thưởng (10% tổng giá trị đơn hàng)
                    const rewardPoints = (Math.floor(order.totalAmount * 0.1))/1000;
                    console.log('Reward points:', rewardPoints);

                    // Trừ điểm đã sử dụng và cộng điểm thưởng mới
                    const updatePointsQuery = `
                        UPDATE accounts 
                        SET points = CASE 
                            WHEN points IS NULL THEN ? 
                            ELSE points - ? + ? 
                        END
                        WHERE id = ?
                    `;
                    await db.query(updatePointsQuery, [rewardPoints, order.point_used, rewardPoints, order.userId]);
                    console.log('Updated points for user:', order.userId, 'point_used:', order.point_used, 'rewardPoints:', rewardPoints);
                    
                    // Lấy danh sách ghế đã đặt hiện tại
                    const showtimeQuery = 'SELECT bookedSeats FROM showtimes WHERE id = ?';
                    const [showtimeResult] = await db.query(showtimeQuery, [order.showtimeId]);
                    console.log('Raw showtime data:', showtimeResult);
                    
                    // Cập nhật danh sách ghế đã đặt
                    let currentBookedSeats = [];
                    try {
                        if (showtimeResult && showtimeResult.length > 0 && showtimeResult[0].bookedSeats !== null && showtimeResult[0].bookedSeats !== undefined) {
                            currentBookedSeats = JSON.parse(showtimeResult[0].bookedSeats);
                            console.log('Parsed current booked seats:', currentBookedSeats);
                        } else {
                            console.log('No existing booked seats found');
                        }
                    } catch (e) {
                        console.error('Error parsing current booked seats:', e);
                        currentBookedSeats = [];
                    }

                    const newBookedSeats = order.seats || [];
                    console.log('New booked seats:', newBookedSeats);

                    const updatedBookedSeats = [...currentBookedSeats, ...newBookedSeats];
                    console.log('Updated booked seats:', updatedBookedSeats);
                    
                    // Cập nhật vào database
                    const updateShowtimeQuery = 'UPDATE showtimes SET bookedSeats = ? WHERE id = ?';
                    const updateResult = await db.query(updateShowtimeQuery, [JSON.stringify(updatedBookedSeats), order.showtimeId]);
                    console.log('Update result:', updateResult);
                }
            } catch (error) {
                console.error('Error updating booked seats and reward points:', error);
            }
        }

        // Chuyển hướng về ứng dụng Expo
        //const redirectUrl = `exp://192.168.12.35:8081/--/PaymentResult?status=${status}`;
        const redirectUrl = `exp://uffvefa-anonymous-8081.exp.direct/--/PaymentResult?status=${status}`;
        res.redirect(redirectUrl);

    } catch (error) {
        console.error('VNPay callback error:', error);
        //res.redirect('exp://192.168.12.35:8081/--/PaymentResult?status=FAILED');
        res.redirect('exp://uffvefa-anonymous-8081.exp.direct/--/PaymentResult?status=FAILED');
    }
};

// Xử lý thanh toán VNPay Web
exports.createVNPayPaymentWeb = async (req, res) => {
    try {
        console.log('Received order data:', req.body);
        const orderData = req.body;
        
        // Validate dữ liệu đầu vào
        if (!orderData.movieId || !orderData.cinemaId || !orderData.showtimeId || 
            !orderData.roomId || !orderData.seats || !orderData.combos || 
            !orderData.totalAmount || !orderData.userId) {
            console.log('Missing order data');
            return res.status(400).json({ error: 'Thiếu thông tin đơn hàng' });
        }

        const orderId = generateOrderId();
        console.log('Generated order ID:', orderId);
        
        // Tạo đơn hàng mới
        const query = `
            INSERT INTO orders (
                orderId, movieId, cinemaId, showtimeId, roomId, 
                seats, combos, totalAmount, paymentMethod, status, userId,
                point_used, originalAmount
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        const values = [
            orderId,
            orderData.movieId,
            orderData.cinemaId,
            orderData.showtimeId,
            orderData.roomId,
            JSON.stringify(orderData.seats),
            JSON.stringify(orderData.combos),
            orderData.totalAmount,
            'VNPay',
            'PENDING',
            orderData.userId,
            orderData.point_used || 0,
            orderData.originalAmount || orderData.totalAmount
        ];

        await db.query(query, values);
        console.log('Order created in database with point_used:', orderData.point_used, 'and originalAmount:', orderData.originalAmount);

        // Tạo URL thanh toán VNPay
        const date = new Date();
        const createDate = moment(date).format('YYYYMMDDHHmmss');
        console.log('Create date:', createDate);
        
        const orderInfo = `Thanh toan don hang ${orderId}`;
        const orderType = 'billpayment';
        const locale = 'vn';
        const currCode = 'VND';
        
        // Đảm bảo số tiền là số nguyên, không cần nhân thêm 100 vì VNPay sẽ tự nhân
        const amount = Math.round(Number(orderData.totalAmount));
        console.log('Amount:', amount);

        // Lấy IP thực tế của người dùng
        const ipAddr = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        const cleanIp = ipAddr.replace('::ffff:', ''); // Loại bỏ IPv6 prefix nếu có
        console.log('IP Address:', cleanIp);

        // Khởi tạo VNPay
        const vnpay = new VNPay({
            tmnCode: VNPAY_CONFIG.vnp_TmnCode,
            secureSecret: VNPAY_CONFIG.vnp_HashSecret,
            vnpayHost: 'https://sandbox.vnpayment.vn',
            testMode: true,
            hashAlgorithm: 'SHA512'
        });

        // Tạo URL thanh toán
        const vnpayResponse = await vnpay.buildPaymentUrl({
            vnp_Amount: amount,
            vnp_IpAddr: cleanIp,
            vnp_TxnRef: orderId,
            vnp_OrderInfo: orderInfo,
            vnp_OrderType: orderType,
            //vnp_ReturnUrl: `${VNPAY_CONFIG.vnp_ReturnUrl}/payment/vnpay/callback-web`,
            vnp_ReturnUrl: `https://datn-backend-mvze.onrender.com/payment/vnpay/callback-web`,
            vnp_Locale: locale,
            vnp_CreateDate: createDate
        });

        console.log('VNPay Response:', vnpayResponse);
        res.json({ paymentUrl: vnpayResponse });
    } catch (error) {
        console.error('VNPay payment error:', error);
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Đơn hàng đã tồn tại' });
        }
        if (error.code === 'ER_NO_REFERENCED_ROW') {
            return res.status(400).json({ error: 'Dữ liệu không hợp lệ' });
        }
        res.status(500).json({ error: 'Lỗi khi tạo thanh toán VNPay' });
    }
};

// Xử lý callback từ VNPay Web
exports.vnpayCallbackWeb = async (req, res) => {
    try {
        const vnpParams = req.query;
        console.log('VNPay callback params:', vnpParams);

        // Lấy chữ ký từ params
        const secureHash = vnpParams['vnp_SecureHash'];
        delete vnpParams['vnp_SecureHash'];
        delete vnpParams['vnp_SecureHashType'];

        // Sắp xếp params theo key
        const sortedParams = sortObject(vnpParams);
        
        // Tạo chuỗi ký tự để hash theo đúng thứ tự
        const signData = Object.entries(sortedParams)
            .map(([key, value]) => `${key}=${value.replace(/\s+/g, '+')}`)
            .join('&');

        console.log('Sign data:', signData);
        console.log('Expected hash:', secureHash);

        // Tạo chữ ký
        const hmac = crypto.createHmac('sha512', VNPAY_CONFIG.vnp_HashSecret);
        const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');
        console.log('Generated hash:', signed);

        // Kiểm tra chữ ký
        if (secureHash !== signed) {
            console.log('Invalid signature');
            console.log('Expected:', secureHash);
            console.log('Received:', signed);
            return res.status(400).json({ error: 'Chữ ký không hợp lệ' });
        }

        // Lấy thông tin từ params
        const orderId = vnpParams['vnp_TxnRef'];
        const rspCode = vnpParams['vnp_ResponseCode'];
        const amount = vnpParams['vnp_Amount'];
        const bankCode = vnpParams['vnp_BankCode'];
        const payDate = vnpParams['vnp_PayDate'];
        const transactionNo = vnpParams['vnp_TransactionNo'];

        console.log('Payment info:', {
            orderId,
            rspCode,
            amount,
            bankCode,
            payDate,
            transactionNo
        });

        // Lấy thông tin đơn hàng để lấy point_used và originalAmount
        const orderQuery = 'SELECT point_used, originalAmount, userId, totalAmount FROM orders WHERE orderId = ?';
        const [orderResult] = await db.query(orderQuery, [orderId]);
        const order = orderResult[0];
        
        if (!order) {
            throw new Error('Không tìm thấy đơn hàng');
        }

        // Cập nhật trạng thái đơn hàng
        const query = `
            UPDATE orders 
            SET status = ?, 
                paymentInfo = ?,
                point_used = ?,
                originalAmount = ?
            WHERE orderId = ?
        `;
        
        const status = rspCode === '00' ? 'COMPLETED' : 'FAILED';
        const paymentInfo = JSON.stringify({
            bankCode,
            payDate,
            transactionNo,
            amount: Number(amount) / 100
        });

        await db.query(query, [status, paymentInfo, order.point_used, order.originalAmount, orderId]);
        console.log('Order updated:', { orderId, status, point_used: order.point_used, originalAmount: order.originalAmount });

        // Nếu thanh toán thành công, cập nhật ghế đã đặt và cộng điểm thưởng
        if (status === 'COMPLETED') {
            try {
                // Lấy thông tin đơn hàng
                const orderQuery = 'SELECT showtimeId, seats, totalAmount, userId, point_used FROM orders WHERE orderId = ?';
                const [orderResult] = await db.query(orderQuery, [orderId]);
                console.log('Order data:', orderResult);
                
                if (orderResult && orderResult.length > 0) {
                    const order = orderResult[0];
                    console.log('ShowtimeId from order:', order.showtimeId);
                    
                    // Tính điểm thưởng (10% tổng giá trị đơn hàng)
                    const rewardPoints = (Math.floor(order.totalAmount * 0.1))/1000;
                    console.log('Reward points:', rewardPoints);

                    // Trừ điểm đã sử dụng và cộng điểm thưởng mới
                    const updatePointsQuery = `
                        UPDATE accounts 
                        SET points = CASE 
                            WHEN points IS NULL THEN ? 
                            ELSE points - ? + ? 
                        END
                        WHERE id = ?
                    `;
                    await db.query(updatePointsQuery, [rewardPoints, order.point_used, rewardPoints, order.userId]);
                    console.log('Updated points for user:', order.userId, 'point_used:', order.point_used, 'rewardPoints:', rewardPoints);
                    
                    // Lấy danh sách ghế đã đặt hiện tại
                    const showtimeQuery = 'SELECT bookedSeats FROM showtimes WHERE id = ?';
                    const [showtimeResult] = await db.query(showtimeQuery, [order.showtimeId]);
                    console.log('Raw showtime data:', showtimeResult);
                    
                    // Cập nhật danh sách ghế đã đặt
                    let currentBookedSeats = [];
                    try {
                        if (showtimeResult && showtimeResult.length > 0 && showtimeResult[0].bookedSeats !== null && showtimeResult[0].bookedSeats !== undefined) {
                            currentBookedSeats = JSON.parse(showtimeResult[0].bookedSeats);
                            console.log('Parsed current booked seats:', currentBookedSeats);
                        } else {
                            console.log('No existing booked seats found');
                        }
                    } catch (e) {
                        console.error('Error parsing current booked seats:', e);
                        currentBookedSeats = [];
                    }

                    const newBookedSeats = order.seats || [];
                    console.log('New booked seats:', newBookedSeats);

                    const updatedBookedSeats = [...currentBookedSeats, ...newBookedSeats];
                    console.log('Updated booked seats:', updatedBookedSeats);
                    
                    // Cập nhật vào database
                    const updateShowtimeQuery = 'UPDATE showtimes SET bookedSeats = ? WHERE id = ?';
                    const updateResult = await db.query(updateShowtimeQuery, [JSON.stringify(updatedBookedSeats), order.showtimeId]);
                    console.log('Update result:', updateResult);
                }
            } catch (error) {
                console.error('Error updating booked seats and reward points:', error);
            }
        }

        // Chuyển hướng về web
        //const redirectUrl = `http://localhost:5173/payment-result?status=${status}`;
        const redirectUrl = `https://datn-frontend.web.app/payment-result?status=${status}`;
        res.redirect(redirectUrl);

    } catch (error) {
        console.error('VNPay callback error:', error);
        //res.redirect('http://localhost:5173/payment-result?status=FAILED');
        res.redirect('https://datn-frontend.web.app/payment-result?status=FAILED');
    }
};