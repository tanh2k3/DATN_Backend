const redis = require('redis');
const client = redis.createClient(
    {
        url: 'redis://default:5r5hAOvw9z8g581QhKLDIa3ljqxjFkaM@redis-13383.c325.us-east-1-4.ec2.redns.redis-cloud.com:13383'
      }
);

client.on('error', (err) => console.error('Redis Client Error', err));
client.connect();

module.exports = client; 