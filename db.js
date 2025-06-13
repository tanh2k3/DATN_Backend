const mysql = require('mysql2/promise');

// Tạo pool kết nối đến MySQL
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'moovie_booking',
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Kiểm tra kết nối
pool.getConnection()
  .then(connection => {
    console.log('Đã kết nối đến MySQL!');
    connection.release();
  })
  .catch(err => {
    console.error('Không thể kết nối đến MySQL:', err);
  });

module.exports = pool;