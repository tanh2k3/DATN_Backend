const pool = require('./db');
const { Client } = require('@elastic/elasticsearch');
require('dotenv').config();

const esClient = new Client({
  node: process.env.ELASTICSEARCH_URL,
  auth: {
    username: process.env.ELASTICSEARCH_USERNAME,
    password: process.env.ELASTICSEARCH_PASSWORD
  }
});

async function syncMoviesToES() {
  try {
    const [movies] = await pool.query('SELECT * FROM movies');
    if (!movies.length) {
      console.log('Không có phim nào trong database.');
      return;
    }
    // Kiểm tra index đã tồn tại chưa
    const exists = await esClient.indices.exists({ index: 'movies' });
    if (!exists) {
      await esClient.indices.create({
        index: 'movies',
        body: {
          mappings: {
            properties: {
              title: { type: 'text' },
              description: { type: 'text' },
              genre: { type: 'text' },
              director: { type: 'text' },
              actors: { type: 'text' },
              label: { type: 'text' },
              language: { type: 'text' },
              release_day: { type: 'date' },
              duration: { type: 'integer' },
              img: { type: 'keyword' },
              poster: { type: 'keyword' },
              trailer: { type: 'keyword' },
              heart: { type: 'integer' }
            }
          }
        }
      });
      console.log('Đã tạo index movies trên Elasticsearch.');
    }
    // Index từng phim
    for (const movie of movies) {
      await esClient.index({
        index: 'movies',
        id: movie.id,
        body: movie
      });
      console.log(`Đã index phim: ${movie.title}`);
    }
    console.log('Đồng bộ phim lên Elasticsearch thành công!');
  } catch (err) {
    console.error('Lỗi khi đồng bộ phim lên Elasticsearch:', err);
  }
}

module.exports = syncMoviesToES;