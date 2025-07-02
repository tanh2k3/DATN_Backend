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

// Lấy tất cả combo
router.get('/all', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM combos');
    res.json(rows);
  } catch (err) {
    console.error('Lỗi khi lấy danh sách combo:', err);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// Thêm combo mới
router.post('/', authenticateToken, requireAdmin, upload.single('img'), async (req, res) => {
  try {
    const { name, cost, description } = req.body;
    const img = req.file ? req.file.filename : null;
    
    // Kiểm tra dữ liệu đầu vào
    if (!name || !cost || !description || !img) {
      return res.status(400).json({ error: 'Vui lòng nhập đầy đủ thông tin' });
    }

    // Thêm combo mới
    const [result] = await db.query(
      'INSERT INTO combos (name, cost, description, img) VALUES (?, ?, ?, ?)',
      [name, cost, description, img]
    );

    // Lấy thông tin combo vừa thêm
    const [newCombo] = await db.query(
      'SELECT * FROM combos WHERE id = ?',
      [result.insertId]
    );

    res.status(201).json(newCombo[0]);
  } catch (err) {
    console.error('Lỗi khi thêm combo:', err);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// Cập nhật thông tin combo
router.put('/:id', authenticateToken, requireAdmin, upload.single('img'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, cost, description } = req.body;
    const img = req.file ? req.file.filename : undefined;

    // Kiểm tra dữ liệu đầu vào
    if (!name || !cost || !description) {
      return res.status(400).json({ error: 'Vui lòng nhập đầy đủ thông tin' });
    }

    // Kiểm tra combo tồn tại
    const [existingCombo] = await db.query(
      'SELECT * FROM combos WHERE id = ?',
      [id]
    );

    if (existingCombo.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy combo' });
    }

    // Cập nhật thông tin
    if (img) {
      await db.query(
        'UPDATE combos SET name = ?, cost = ?, description = ?, img = ? WHERE id = ?',
        [name, cost, description, img, id]
      );
    } else {
      await db.query(
        'UPDATE combos SET name = ?, cost = ?, description = ? WHERE id = ?',
        [name, cost, description, id]
      );
    }

    // Lấy thông tin combo sau khi cập nhật
    const [updatedCombo] = await db.query(
      'SELECT * FROM combos WHERE id = ?',
      [id]
    );

    res.json(updatedCombo[0]);
  } catch (err) {
    console.error('Lỗi khi cập nhật combo:', err);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// Xóa combo
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Kiểm tra combo tồn tại
    const [existingCombo] = await db.query(
      'SELECT * FROM combos WHERE id = ?',
      [id]
    );

    if (existingCombo.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy combo' });
    }

    /*// Kiểm tra xem combo có đang được sử dụng trong đơn hàng không
    const [orders] = await db.query(
      'SELECT * FROM orders WHERE combo_id = ?',
      [id]
    );

    if (orders.length > 0) {
      return res.status(400).json({ 
        error: 'Không thể xóa combo này vì đang được sử dụng trong đơn hàng' 
      });
    }*/

    // Xóa combo
    await db.query('DELETE FROM combos WHERE id = ?', [id]);

    res.json({ message: 'Xóa combo thành công' });
  } catch (err) {
    console.error('Lỗi khi xóa combo:', err);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

module.exports = router;