const express = require('express');
const db = require('../db');
const router = express.Router();
const multer = require('multer');
const path = require('path');

// Cấu hình multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + path.extname(file.originalname);
    cb(null, uniqueName);
  },
});

const upload = multer({ storage });

// Lấy tất cả quảng cáo
router.get('/all', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM ads');
    res.json(rows);
  } catch (err) {
    console.error('Lỗi khi lấy danh sách ads:', err);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// Thêm quảng cáo mới
router.post('/', upload.single('img'), async (req, res) => {
  try {
    const { title } = req.body;
    const { description } = req.body;
    const img = req.file ? req.file.filename : null;
    
    // Kiểm tra dữ liệu đầu vào
    if (!description || !img || !title) {
      return res.status(400).json({ error: 'Vui lòng nhập đầy đủ thông tin' });
    }

    // Thêm quảng cáo mới
    const [result] = await db.query(
      'INSERT INTO ads (title, description, img) VALUES (?, ?, ?)',
      [title, description, img]
    );

    // Lấy thông tin quảng cáo vừa thêm
    const [newAd] = await db.query(
      'SELECT * FROM ads WHERE id = ?',
      [result.insertId]
    );

    res.status(201).json(newAd[0]);
  } catch (err) {
    console.error('Lỗi khi thêm quảng cáo:', err);
    res.status(500).json({ error: 'Lỗi server' }); 
  }
});

// Cập nhật thông tin quảng cáo
router.put('/:id', upload.single('img'), async (req, res) => {
  try {
    const { id } = req.params;
    const { title } = req.body;
    const { description } = req.body;
    const img = req.file ? req.file.filename : undefined;

    // Kiểm tra dữ liệu đầu vào
    if (!title) {
      return res.status(400).json({ error: 'Vui lòng nhập đầy đủ thông tin' });
    }
    if (!description) {
      return res.status(400).json({ error: 'Vui lòng nhập đầy đủ thông tin' });
    }

    // Kiểm tra quảng cáo tồn tại
    const [existingAd] = await db.query(
      'SELECT * FROM ads WHERE id = ?',
      [id]
    );

    if (existingAd.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy quảng cáo' });
    }

    // Cập nhật thông tin
    if (img) {
      await db.query(
        'UPDATE ads SET title = ?, description = ?, img = ? WHERE id = ?',
        [title, description, img, id]
      );
    } else {
      await db.query(
        'UPDATE ads SET title = ?, description = ? WHERE id = ?',
        [title, description, id]
      );
    }

    // Lấy thông tin quảng cáo sau khi cập nhật
    const [updatedAd] = await db.query(
      'SELECT * FROM ads WHERE id = ?',
      [id]
    );

    res.json(updatedAd[0]);
  } catch (err) {
    console.error('Lỗi khi cập nhật quảng cáo:', err);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// Xóa quảng cáo
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Kiểm tra quảng cáo tồn tại
    const [existingAd] = await db.query(
      'SELECT * FROM ads WHERE id = ?',
      [id]
    );

    if (existingAd.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy quảng cáo' });
    }

    // Xóa quảng cáo
    await db.query('DELETE FROM ads WHERE id = ?', [id]);

    res.json({ message: 'Xóa quảng cáo thành công' });
  } catch (err) {
    console.error('Lỗi khi xóa quảng cáo:', err);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

module.exports = router;