const express = require('express');
const db = require('../db');
const jwt = require('jsonwebtoken');
const router = express.Router();
const multer = require('multer');
const path = require('path');

// cấu hình nơi lưu trữ
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/'); // lưu vào thư mục uploads
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + path.extname(file.originalname);
    cb(null, uniqueName);
  },
});

const upload = multer({ storage });

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

// Lấy tất cả ticket
router.get('/all', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: 'Thiếu thông tin userId' });
    }

    const [rows] = await db.query(
      `SELECT * FROM orders WHERE userId = ? AND status = 'COMPLETED' ORDER BY createdAt DESC`,
      [userId]
    );

    res.json(rows);
  } catch (err) {
    console.error('Lỗi khi lấy danh sách ticket:', err);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

module.exports = router;