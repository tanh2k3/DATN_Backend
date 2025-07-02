const express = require('express');
const db = require('../db');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const jwt = require('jsonwebtoken');

// Cấu hình multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
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

// Middleware kiểm tra quyền admin
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Bạn không có quyền thực hiện thao tác này!' });
  }
  next();
}

// Lấy tất cả rạp chiếu
router.get('/all', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM cinemas');
    res.json(rows);
  } catch (err) {
    console.error('Lỗi khi lấy danh sách rạp:', err);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// Thêm rạp chiếu mới
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, map } = req.body;
    
    // Kiểm tra dữ liệu đầu vào
    if (!name || !map) {
      return res.status(400).json({ error: 'Vui lòng nhập đầy đủ thông tin' });
    }

    // Thêm rạp chiếu mới
    const [result] = await db.query(
      'INSERT INTO cinemas (name, map) VALUES (?, ?)',
      [name, map]
    );

    // Lấy thông tin rạp vừa thêm
    const [newCinema] = await db.query(
      'SELECT * FROM cinemas WHERE id = ?',
      [result.insertId]
    );

    res.status(201).json(newCinema[0]);
  } catch (err) {
    console.error('Lỗi khi thêm rạp chiếu:', err);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// Cập nhật thông tin rạp chiếu
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, map } = req.body;

    // Kiểm tra dữ liệu đầu vào
    if (!name || !map) {
      return res.status(400).json({ error: 'Vui lòng nhập đầy đủ thông tin' });
    }

    // Kiểm tra rạp chiếu tồn tại
    const [existingCinema] = await db.query(
      'SELECT * FROM cinemas WHERE id = ?',
      [id]
    );

    if (existingCinema.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy rạp chiếu' });
    }

    // Cập nhật thông tin
    await db.query(
      'UPDATE cinemas SET name = ?, map = ? WHERE id = ?',
      [name, map, id]
    );

    // Lấy thông tin rạp sau khi cập nhật
    const [updatedCinema] = await db.query(
      'SELECT * FROM cinemas WHERE id = ?',
      [id]
    );

    res.json(updatedCinema[0]);
  } catch (err) {
    console.error('Lỗi khi cập nhật rạp chiếu:', err);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// Xóa rạp chiếu
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Kiểm tra rạp chiếu tồn tại
    const [existingCinema] = await db.query(
      'SELECT * FROM cinemas WHERE id = ?',
      [id]
    );

    if (existingCinema.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy rạp chiếu' });
    }

    // Kiểm tra xem rạp có đang được sử dụng trong lịch chiếu không
    const [showtimes] = await db.query(
      'SELECT * FROM showtimes WHERE id_cinema = ?',
      [id]
    );

    if (showtimes.length > 0) {
      return res.status(400).json({ 
        error: 'Không thể xóa rạp chiếu này vì đang có lịch chiếu' 
      });
    }

    // Xóa rạp chiếu
    await db.query('DELETE FROM cinemas WHERE id = ?', [id]);

    res.json({ message: 'Xóa rạp chiếu thành công' });
  } catch (err) {
    console.error('Lỗi khi xóa rạp chiếu:', err);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

module.exports = router;