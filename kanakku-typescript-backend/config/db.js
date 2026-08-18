// config/db.js
const mongoose = require('mongoose');

const connectDB = async () => {
  if (!process.env.MONGO_URI) {
    console.warn('MONGO_URI not set — skipping Mongo connection (Prisma/Postgres is the primary store).');
    return;
  }
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB connected');
  } catch (error) {
    console.error('MongoDB connection failed (non-fatal — Prisma/Postgres is the primary store):', error.message);
  }
};

module.exports = connectDB;
