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

// Middleware kiểm tra quyền admin
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Bạn không có quyền thực hiện thao tác này!' });
  }
  next();
}


// Lấy tất cả suất chiếu
router.get('/all', async (req, res) => {
  try {
    const [rows] = await db.query(`SELECT * FROM showtimes`);
    res.json(rows);
  } catch (err) {
    console.error('Lỗi khi lấy danh sách suất chiếu:', err);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// Thêm suất chiếu mới
router.post('/add', async (req, res) => {
  try {
    const { id_movie, id_cinema, id_room, day, time_start, type } = req.body;

    // Kiểm tra xem phòng chiếu có thuộc rạp đã chọn không
    const [roomCheck] = await db.query(
      'SELECT * FROM rooms WHERE id = ? AND id_cinema = ?',
      [id_room, id_cinema]
    );

    if (roomCheck.length === 0) {
      return res.status(400).json({ error: 'Phòng chiếu không thuộc rạp đã chọn' });
    }

    // Kiểm tra xem có suất chiếu trùng lịch không
    const [existingShowtime] = await db.query(
      'SELECT * FROM showtimes WHERE id_room = ? AND day = ? AND time_start = ?',
      [id_room, day, time_start]
    );

    if (existingShowtime.length > 0) {
      return res.status(400).json({ error: 'Đã có suất chiếu khác trong phòng này vào thời gian này' });
    }

    // Thêm suất chiếu mới
    const [result] = await db.query(
      'INSERT INTO showtimes (id_movie, id_cinema, id_room, day, time_start, type, bookedSeats) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id_movie, id_cinema, id_room, day, time_start, type, JSON.stringify([])]
    );

    // Lấy thông tin suất chiếu vừa thêm
    const [newShowtime] = await db.query(`
      SELECT s.*, c.name as cinema_name, r.name as room_name 
      FROM showtimes s
      LEFT JOIN cinemas c ON s.id_cinema = c.id
      LEFT JOIN rooms r ON s.id_room = r.id
      WHERE s.id = ?
    `, [result.insertId]);

    res.status(200).json({
      message: 'Thêm suất chiếu thành công',
      showtime: newShowtime[0]
    });
  } catch (err) {
    console.error('Lỗi khi thêm suất chiếu:', err);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// Lấy danh sách ghế đã đặt của một showtime
router.get('/:id/booked-seats', async (req, res) => {
    try {
        const showtimeId = req.params.id;
        const query = 'SELECT bookedSeats FROM showtimes WHERE id = ?';
        const [result] = await db.query(query, [showtimeId]);
        
        if (result && result.length > 0) {
            const bookedSeats = result[0].bookedSeats ? JSON.parse(result[0].bookedSeats) : [];
            res.json({ bookedSeats });
        } else {
            res.json({ bookedSeats: [] });
        }
    } catch (error) {
        console.error('Error getting booked seats:', error);
        res.status(500).json({ error: 'Lỗi khi lấy danh sách ghế đã đặt' });
    }
});

// Xóa lịch chiếu theo ID
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [result] = await db.query('DELETE FROM showtimes WHERE id = ?', [req.params.id]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Không tìm thấy lịch chiếu' });
    }
    
    res.json({ message: 'Xóa lịch chiếu thành công' });
  } catch (err) {
    console.error('Lỗi khi xóa lịch chiếu:', err);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

module.exports = router;