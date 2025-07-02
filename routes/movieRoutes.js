const express = require('express');
const db = require('../db');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { Client } = require('@elastic/elasticsearch');

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

const esClient = new Client({
  node: process.env.ELASTICSEARCH_URL,
  auth: {
    username: process.env.ELASTICSEARCH_USERNAME,
    password: process.env.ELASTICSEARCH_PASSWORD
  }
});

// Lấy tất cả phim
router.get('/all', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM movies');
    res.json(rows);
  } catch (err) {
    console.error('Lỗi khi lấy danh sách phim:', err);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// Tìm kiếm phim bằng Elasticsearch
router.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q) {
    // Nếu không có query, trả về tất cả phim như cũ
    try {
      const [rows] = await db.query('SELECT * FROM movies');
      return res.json(rows);
    } catch (err) {
      console.error('Lỗi khi lấy danh sách phim:', err);
      return res.status(500).json({ error: 'Lỗi server' });
    }
  }
  try {
    const response = await esClient.search({
      index: 'movies',
      body: {
        query: {
          multi_match: {
            query: q,
            fields: ['title^3', 'description', 'genre', 'director', 'actors'],
            fuzziness: 'AUTO'
          }
        }
      }
    });
    const hits = response.hits.hits.map(hit => hit._source);
    res.json(hits);
  } catch (err) {
    console.error('Lỗi khi tìm kiếm phim với Elasticsearch:', err);
    res.status(500).json({ error: 'Lỗi server hoặc Elasticsearch chưa sẵn sàng' });
  }
});

// Lấy phim theo ID
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM movies WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy phim' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('Lỗi khi lấy thông tin phim:', err);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// Thêm phim mới
router.post('/add', authenticateToken, requireAdmin, upload.fields([
  { name: 'img', maxCount: 1 },
  { name: 'poster', maxCount: 1 }
]), async (req, res) => {
  try {
    const {
      title,
      duration,
      release_day,
      label,
      genre,
      trailer,
      description,
      director,
      actors,
      language
    } = req.body;

    // Xử lý link trailer YouTube để lấy mã video
    let trailerCode = trailer;
    if (trailer.includes('youtube.com/watch?v=')) {
      trailerCode = trailer.split('v=')[1].split('&')[0];
    } else if (trailer.includes('youtu.be/')) {
      trailerCode = trailer.split('youtu.be/')[1];
    }

    // Lấy tên file ảnh đã upload
    const img = req.files['img'] ? req.files['img'][0].filename : null;
    const poster = req.files['poster'] ? req.files['poster'][0].filename : null;

    const query = `
      INSERT INTO movies (
        title, duration, release_day, label, genre,
        img, poster, trailer, description, heart,
        director, actors, language
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      title,
      duration,
      release_day,
      label,
      genre,
      img,
      poster,
      trailerCode,
      description,
      0, // heart mặc định là 0
      director,
      actors,
      language
    ];

    const [result] = await db.query(query, values);
    // Lấy phim vừa thêm để index lên Elasticsearch
    const [movies] = await db.query('SELECT * FROM movies WHERE id = ?', [result.insertId]);
    if (movies.length > 0) {
      await esClient.index({
        index: 'movies',
        id: movies[0].id,
        body: movies[0]
      });
    }
    res.status(200).json({ message: 'Thêm phim thành công', movieId: result.insertId });
  } catch (err) {
    console.error('Lỗi khi thêm phim:', err);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// Kiểm tra phim đã like chưa
router.post('/:id/heart-check', async (req, res) => {
  const { id } = req.params;
  const { id_user } = req.body;

  try {
    const [result] = await db.query('SELECT likee FROM acc_like_movies WHERE id_acc = ? AND id_movie = ?', [id_user, id]);

    if(result.length === 0) {
      res.json({likee: 0});
    }
    else {
      res.json({likee: 1});
    }
    
  } catch (err) {
    console.error('Lỗi:', err);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

//Tăng/giảm số lượng trái tim
router.post('/:id/heart', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { increment, id_user } = req.body;

  try {
    // Lấy số lượng trái tim hiện tại
    const [result] = await db.query('SELECT heart FROM movies WHERE id = ?', [id]);

    if (result.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy phim' });
    }

    const currentHeart = result[0].heart;
    const newHeart = increment ? currentHeart + 1 : Math.max(0, currentHeart - 1);

    // Cập nhật số lượng trái tim
    await db.query('UPDATE movies SET heart = ? WHERE id = ?', [newHeart, id]);
    
    if(increment) {
      await db.query('INSERT INTO acc_like_movies (id_acc, id_movie, likee) VALUE (?,?,?)', [id_user, id, 1]);
    } else {
      await db.query('DELETE FROM acc_like_movies WHERE id_acc = ? AND id_movie = ?', [id_user, id]);
    }

    res.json({ heart: newHeart });
  } catch (err) {
    console.error('Lỗi khi cập nhật số lượng trái tim:', err);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// Xóa phim
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    // Lấy thông tin phim để xóa ảnh
    const [movie] = await db.query('SELECT img, poster FROM movies WHERE id = ?', [req.params.id]);
    
    if (movie.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy phim' });
    }

    // Xóa phim khỏi database
    await db.query('DELETE FROM movies WHERE id = ?', [req.params.id]);

    // Xóa phim khỏi Elasticsearch
    try {
      await esClient.delete({
        index: 'movies',
        id: req.params.id
      });
      console.log('Đã xóa phim khỏi Elasticsearch:', req.params.id);
    } catch (esErr) {
      // Nếu không tìm thấy document, vẫn cho qua
      if (esErr.meta && esErr.meta.statusCode === 404) {
        console.log('Phim không tồn tại trên Elasticsearch:', req.params.id);
      } else {
        console.error('Lỗi khi xóa phim khỏi Elasticsearch:', esErr);
      }
    }

    // Xóa file ảnh nếu tồn tại
    if (movie[0].img) {
      const imgPath = path.join(__dirname, '../uploads', movie[0].img);
      if (fs.existsSync(imgPath)) {
        fs.unlinkSync(imgPath);
      }
    }
    
    if (movie[0].poster) {
      const posterPath = path.join(__dirname, '../uploads', movie[0].poster);
      if (fs.existsSync(posterPath)) {
        fs.unlinkSync(posterPath);
      }
    }

    res.json({ message: 'Xóa phim thành công' });
  } catch (err) {
    console.error('Lỗi khi xóa phim:', err);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

module.exports = router;