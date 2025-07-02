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

// Lấy tất cả phòng chiếu
router.get('/all', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM rooms');
    res.json(rows);
  } catch (err) {
    console.error('Lỗi khi lấy danh sách phòng:', err);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// Lấy phòng chiếu theo rạp
router.get('/cinema/:cinemaId', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM rooms WHERE id_cinema = ?', [req.params.cinemaId]);
    res.json(rows);
  } catch (err) {
    console.error('Lỗi khi lấy danh sách phòng:', err);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// Thêm phòng chiếu mới
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, hang, cot, id_cinema } = req.body;
    
    // Kiểm tra xem rạp có tồn tại không
    const [cinema] = await db.query('SELECT * FROM cinemas WHERE id = ?', [id_cinema]);
    if (cinema.length === 0) {
      return res.status(400).json({ error: 'Rạp chiếu không tồn tại' });
    }

    // Thêm phòng chiếu mới
    const [result] = await db.query(
      'INSERT INTO rooms (name, hang, cot, id_cinema) VALUES (?, ?, ?, ?)',
      [name, hang, cot, id_cinema]
    );

    // Lấy thông tin phòng chiếu vừa thêm
    const [newRoom] = await db.query('SELECT * FROM rooms WHERE id = ?', [result.insertId]);
    
    res.status(201).json({
      message: 'Thêm phòng chiếu thành công',
      room: newRoom[0]
    });
  } catch (err) {
    console.error('Lỗi khi thêm phòng chiếu:', err);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// Cập nhật phòng chiếu
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, hang, cot, id_cinema } = req.body;
    const roomId = req.params.id;

    // Kiểm tra xem phòng chiếu có tồn tại không
    const [room] = await db.query('SELECT * FROM rooms WHERE id = ?', [roomId]);
    if (room.length === 0) {
      return res.status(404).json({ error: 'Phòng chiếu không tồn tại' });
    }

    // Kiểm tra xem rạp có tồn tại không
    const [cinema] = await db.query('SELECT * FROM cinemas WHERE id = ?', [id_cinema]);
    if (cinema.length === 0) {
      return res.status(400).json({ error: 'Rạp chiếu không tồn tại' });
    }

    // Cập nhật phòng chiếu
    await db.query(
      'UPDATE rooms SET name = ?, hang = ?, cot = ?, id_cinema = ? WHERE id = ?',
      [name, hang, cot, id_cinema, roomId]
    );

    // Lấy thông tin phòng chiếu sau khi cập nhật
    const [updatedRoom] = await db.query('SELECT * FROM rooms WHERE id = ?', [roomId]);
    
    res.json({
      message: 'Cập nhật phòng chiếu thành công',
      room: updatedRoom[0]
    });
  } catch (err) {
    console.error('Lỗi khi cập nhật phòng chiếu:', err);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// Xóa phòng chiếu
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const roomId = req.params.id;

    // Kiểm tra xem phòng chiếu có tồn tại không
    const [room] = await db.query('SELECT * FROM rooms WHERE id = ?', [roomId]);
    if (room.length === 0) {
      return res.status(404).json({ error: 'Phòng chiếu không tồn tại' });
    }

    // Kiểm tra xem phòng chiếu có đang được sử dụng trong suất chiếu không
    const [showtimes] = await db.query('SELECT * FROM showtimes WHERE id_room = ?', [roomId]);
    if (showtimes.length > 0) {
      return res.status(400).json({ error: 'Không thể xóa phòng chiếu đang có suất chiếu' });
    }

    // Xóa phòng chiếu
    await db.query('DELETE FROM rooms WHERE id = ?', [roomId]);
    
    res.json({ message: 'Xóa phòng chiếu thành công' });
  } catch (err) {
    console.error('Lỗi khi xóa phòng chiếu:', err);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

module.exports = router;