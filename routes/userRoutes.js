const express = require('express');
const db = require('../db');
const jwt = require('jsonwebtoken');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const transporter = require('../config/emailConfig');
const { getVerificationEmailTemplate } = require('../utils/emailTemplates');
require('dotenv').config();

// Cấu hình nơi lưu trữ
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

// Route đăng ký
router.post('/register', async (req, res) => {
  try {
    const { email, password, fullName, phone } = req.body;

    // Kiểm tra email đã tồn tại
    const [existingUsers] = await db.query(
      'SELECT * FROM accounts WHERE email = ?',
      [email]
    );

    if (existingUsers.length > 0) {
      return res.status(400).json({ 
        error: 'Email đã được sử dụng!' 
      });
    }

    // Mã hóa mật khẩu
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Tạo token xác nhận
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 giờ

    // Thêm người dùng mới vào database
    const [result] = await db.query(
      'INSERT INTO accounts (email, pass, full_name, phone, verification_token, verification_token_expires) VALUES (?, ?, ?, ?, ?, ?)',
      [email, hashedPassword, fullName, phone, verificationToken, verificationTokenExpires]
    );

    // Tạo link xác nhận
    const verificationLink = `http://192.168.12.35:5000/user/verify-email?token=${verificationToken}`;

    // Gửi email xác nhận
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Xác nhận đăng ký tài khoản BooTicket',
      html: getVerificationEmailTemplate(verificationLink)
    };

    await transporter.sendMail(mailOptions);

    res.status(201).json({
      message: 'Đăng ký thành công! Vui lòng kiểm tra email để xác nhận tài khoản.'
    });

  } catch (error) {
    console.error('Lỗi đăng ký:', error);
    res.status(500).json({ 
      error: 'Có lỗi xảy ra khi đăng ký tài khoản' 
    });
  }
});

// Route xác nhận email
router.get('/verify-email', async (req, res) => {
  try {
    const { token } = req.query;

    // Tìm người dùng với token xác nhận
    const [users] = await db.query(
      'SELECT * FROM accounts WHERE verification_token = ? AND verification_token_expires > NOW()',
      [token]
    );

    if (users.length === 0) {
      return res.status(400).json({
        error: 'Token không hợp lệ hoặc đã hết hạn!'
      });
    }

    // Cập nhật trạng thái xác nhận
    await db.query(
      'UPDATE accounts SET is_verified = TRUE, verification_token = NULL, verification_token_expires = NULL WHERE verification_token = ?',
      [token]
    );

    res.json({
      message: 'Xác nhận email thành công! Bạn có thể đăng nhập ngay bây giờ.'
    });

  } catch (error) {
    console.error('Lỗi xác nhận email:', error);
    res.status(500).json({
      error: 'Có lỗi xảy ra khi xác nhận email'
    });
  }
});

// Đăng nhập
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const [results] = await db.query(
      'SELECT * FROM accounts WHERE email = ?',
      [email]
    );

    if (results.length > 0) {
      const user = results[0];
      
      // Kiểm tra xác nhận email
      if (!user.is_verified) {
        return res.status(401).json({
          error: 'Vui lòng xác nhận email trước khi đăng nhập!'
        });
      }

      // So sánh mật khẩu đã mã hóa
      const validPassword = await bcrypt.compare(password, user.pass);
      if (!validPassword) {
        return res.status(401).json({ error: 'Email hoặc mật khẩu không đúng!' });
      }

      const token = jwt.sign(
        { id: user.id },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
      );

      res.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.full_name,
          phone: user.phone,
          pass: user.pass,
          img: user.img,
          points: user.points,
          role: user.role
        }
      });
    } else {
      res.status(401).json({ error: 'Email hoặc mật khẩu không đúng!' });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Lỗi server khi đăng nhập' });
  }
});

// Upload avatar
router.post('/upload-avatar', upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Không có file được tải lên!' });
    }

    const filePath = `${req.file.filename}`;
    const userId = req.body.userId; // Lấy userId từ request body

    if (!userId) {
      return res.status(400).json({ error: 'Thiếu thông tin người dùng!' });
    }

    // Cập nhật avatar trong database
    await db.query(
      'UPDATE accounts SET img = ? WHERE id = ?',
      [filePath, userId]
    );

    res.json({
      message: 'Upload thành công!',
      avatar: filePath
    });
  } catch (error) {
    console.error('Upload avatar error:', error);
    res.status(500).json({ error: 'Lỗi server khi upload avatar' });
  }
});

// Route đổi mật khẩu
router.post('/change-password', async (req, res) => {
  try {
    const { userId, currentPassword, newPassword } = req.body;

    // Lấy thông tin user
    const [users] = await db.query(
      'SELECT * FROM accounts WHERE id = ?',
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy người dùng' });
    }

    const user = users[0];

    // Kiểm tra mật khẩu hiện tại
    const validPassword = await bcrypt.compare(currentPassword, user.pass);
    if (!validPassword) {
      return res.status(401).json({ error: 'Mật khẩu hiện tại không đúng!' });
    }

    // Mã hóa mật khẩu mới
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Cập nhật mật khẩu mới
    await db.query(
      'UPDATE accounts SET pass = ? WHERE id = ?',
      [hashedPassword, userId]
    );

    res.json({
      success: true,
      message: 'Đổi mật khẩu thành công!'
    });

  } catch (error) {
    console.error('Lỗi đổi mật khẩu:', error);
    res.status(500).json({
      error: 'Có lỗi xảy ra khi đổi mật khẩu'
    });
  }
});

// Route xác thực mật khẩu
router.post('/verify-password', async (req, res) => {
  try {
    const { userId, password } = req.body;

    // Lấy thông tin user
    const [users] = await db.query(
      'SELECT * FROM accounts WHERE id = ?',
      [userId]
    );

    if (users.length === 0) {
      return res.json({ verified: false });
    }

    const user = users[0];

    // So sánh mật khẩu đã mã hóa
    const validPassword = await bcrypt.compare(password, user.pass);

    res.json({
      verified: validPassword
    });

  } catch (error) {
    console.error('Lỗi xác thực mật khẩu:', error);
    res.status(500).json({
      error: 'Có lỗi xảy ra khi xác thực mật khẩu'
    });
  }
});

// Route quên mật khẩu
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    // Kiểm tra email tồn tại
    const [users] = await db.query(
      'SELECT * FROM accounts WHERE email = ?',
      [email]
    );

    if (users.length === 0) {
      return res.status(404).json({ 
        error: 'Email không tồn tại trong hệ thống!' 
      });
    }

    // Tạo mật khẩu mới
    const generatePassword = () => {
      const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const lowercase = 'abcdefghijklmnopqrstuvwxyz';
      const numbers = '0123456789';
      const special = '*.#@&%';
      const all = uppercase + lowercase + numbers + special;
      
      let password = '';
      // Đảm bảo có ít nhất 1 ký tự từ mỗi loại
      password += uppercase[Math.floor(Math.random() * uppercase.length)];
      password += lowercase[Math.floor(Math.random() * lowercase.length)];
      password += numbers[Math.floor(Math.random() * numbers.length)];
      password += special[Math.floor(Math.random() * special.length)];
      
      // Thêm 4 ký tự ngẫu nhiên
      for(let i = 0; i < 4; i++) {
        password += all[Math.floor(Math.random() * all.length)];
      }
      
      // Xáo trộn mật khẩu
      return password.split('').sort(() => 0.5 - Math.random()).join('');
    };

    const newPassword = generatePassword();

    // Mã hóa mật khẩu mới
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Cập nhật mật khẩu mới trong database
    await db.query(
      'UPDATE accounts SET pass = ? WHERE email = ?',
      [hashedPassword, email]
    );

    // Gửi email với mật khẩu mới
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Mật khẩu mới của bạn - BooTicket',
      html: `
        <h2>Mật khẩu mới của bạn</h2>
        <p>Mật khẩu mới của bạn là: <strong>${newPassword}</strong></p>
        <p>Vui lòng đăng nhập và đổi mật khẩu mới để đảm bảo an toàn cho tài khoản của bạn.</p>
      `
    };

    await transporter.sendMail(mailOptions);

    res.json({
      message: 'Mật khẩu mới đã được gửi vào email của bạn!'
    });

  } catch (error) {
    console.error('Lỗi quên mật khẩu:', error);
    res.status(500).json({ 
      error: 'Có lỗi xảy ra khi xử lý yêu cầu quên mật khẩu' 
    });
  }
});

// Lấy thông tin user theo id
router.get('/info/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    const [results] = await db.query(
      'SELECT id, email, full_name, phone, points, img FROM accounts WHERE id = ?',
      [userId]
    );

    if (results.length > 0) {
      const user = results[0];
      res.json({
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        phone: user.phone,
        points: user.points,
        img: user.img
      });
    } else {
      res.status(404).json({ error: 'Không tìm thấy người dùng' });
    }
  } catch (error) {
    console.error('Error getting user info:', error);
    res.status(500).json({ error: 'Lỗi server khi lấy thông tin người dùng' });
  }
});

// Lấy tổng chi tiêu của user
router.get('/total-spent/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    const [results] = await db.query(
      'SELECT SUM(totalAmount) as totalSpent FROM orders WHERE userId = ? AND status = "COMPLETED"',
      [userId]
    );

    res.json({
      totalSpent: results[0].totalSpent || 0
    });
  } catch (error) {
    console.error('Error getting total spent:', error);
    res.status(500).json({ error: 'Lỗi server khi lấy tổng chi tiêu' });
  }
});

// Lấy danh sách tất cả user
router.get('/all', async (req, res) => {
  try {
    const [users] = await db.query(
      'SELECT id, email, img, is_verified, full_name, phone, points, role FROM accounts'
    );
    res.json(users);
  } catch (error) {
    console.error('Error getting users:', error);
    res.status(500).json({ error: 'Lỗi server khi lấy danh sách người dùng' });
  }
});

// Lấy lịch sử vé của user
router.get('/tickets/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    const [tickets] = await db.query(`
      SELECT o.*, m.title as movieTitle, m.img as movieImg, m.duration,
             c.name as cinemaName, c.map as cinemaMap,
             s.day, s.time_start, s.type,
             r.name as roomName
      FROM orders o
      JOIN movies m ON o.movieId = m.id
      JOIN cinemas c ON o.cinemaId = c.id
      JOIN showtimes s ON o.showtimeId = s.id
      JOIN rooms r ON s.id_room = r.id
      WHERE o.userId = ?
      ORDER BY o.createdAt DESC
    `, [userId]);

    res.json(tickets);
  } catch (error) {
    console.error('Error getting user tickets:', error);
    res.status(500).json({ error: 'Lỗi server khi lấy lịch sử vé' });
  }
});

module.exports = router;