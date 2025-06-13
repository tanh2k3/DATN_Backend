const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { createServer } = require('http');
const { Server } = require('socket.io');
require('dotenv').config();
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
const PORT = process.env.PORT || 5000;
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

  socket.on('join-showtime', (showtimeId) => {
    socket.join(`showtime-${showtimeId}`);
  });

  socket.on('seat-selected', ({ showtimeId, seatCode }) => {
    socket.to(`showtime-${showtimeId}`).emit('seat-selected', seatCode);
  });

  socket.on('seat-deselected', ({ showtimeId, seatCode }) => {
    socket.to(`showtime-${showtimeId}`).emit('seat-deselected', seatCode);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Start server
httpServer.listen(PORT, () => {
  console.log(`Server is running on http://${process.env.DB_HOST}:${PORT}`);
});