const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { createServer } = require('http');
const { Server } = require('socket.io');
require('dotenv').config();
const redisClient = require('./redisClient');
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
const PORT = process.env.PORT || 5000;
const syncMoviesToES = require('./syncMoviesToES');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Test route
app.get('/', (req, res) => {
  res.send('Backend is running!');
});

const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const userRoutes = require('./routes/userRoutes');
app.use('/user', userRoutes);
const movieRoutes = require('./routes/movieRoutes');
app.use('/movie', movieRoutes);
const cinemaRoutes = require('./routes/cinemaRoutes');
app.use('/cinema', cinemaRoutes);
const showtimeRoutes = require('./routes/showtimeRoutes');
app.use('/showtime', showtimeRoutes);
const roomRoutes = require('./routes/roomRoutes');
app.use('/room', roomRoutes);
const comboRoutes = require('./routes/comboRoutes');
app.use('/combo', comboRoutes);
const paymentRoutes = require('./routes/paymentRoutes');
app.use('/payment', paymentRoutes);
const ticketRoutes = require('./routes/ticketRoutes');
app.use('/ticket', ticketRoutes);
const adsRoutes = require('./routes/adsRoutes');
app.use('/ads', adsRoutes);

// Socket.IO events
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Lưu userId cho từng socket
  let currentUserId = null;

  // Khi client join showtime, truyền kèm userId
  socket.on('join-showtime', async ({ showtimeId, userId }) => {
    if (!showtimeId || !userId) return;
    currentUserId = userId;
    socket.join(`showtime-${showtimeId}`);
    const key = `showtime:${showtimeId}:heldSeatsHash`;
    let heldSeats = await redisClient.hGetAll(key);
    socket.emit('init-held-seats', heldSeats || {});
  });

  // Khi giữ ghế
  socket.on('seat-selected', async ({ showtimeId, seatCode, userId }) => {
    if (!showtimeId || !seatCode || !userId) return;
    const key = `showtime:${showtimeId}:heldSeatsHash`;
    await redisClient.hSet(key, seatCode, String(userId));
    await redisClient.expire(key, 300);
    socket.to(`showtime-${showtimeId}`).emit('seat-selected', { seatCode, userId });
  });

  // Khi bỏ chọn ghế
  socket.on('seat-deselected', async ({ showtimeId, seatCode, userId }) => {
    if (!showtimeId || !seatCode || !userId) return;
    const key = `showtime:${showtimeId}:heldSeatsHash`;
    await redisClient.hDel(key, seatCode);
    socket.to(`showtime-${showtimeId}`).emit('seat-deselected', { seatCode, userId });
  });

  // Khi thanh toán thành công, xóa các ghế của userId khỏi Redis
  socket.on('clear-held-seats', async ({ showtimeId, userId, seatCodes }) => {
    if (!showtimeId || !userId || !Array.isArray(seatCodes)) return;
    const key = `showtime:${showtimeId}:heldSeatsHash`;
    for (const seatCode of seatCodes) {
      if (!seatCode) continue;
      const holder = await redisClient.hGet(key, seatCode);
      if (holder === String(userId)) {
        await redisClient.hDel(key, seatCode);
      }
    }
    socket.to(`showtime-${showtimeId}`).emit('clear-held-seats', { seatCodes, userId });
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    // Có thể bổ sung logic giải phóng ghế nếu muốn
  });
});

// Start server
httpServer.listen(PORT, () => {
  console.log(`Server is running on http://${process.env.DB_HOST}:${PORT}`);
  console.log('Elasticsearch URL:', process.env.ELASTICSEARCH_URL);
  // Tự động đồng bộ phim lên Elasticsearch khi server khởi động
  syncMoviesToES();
});