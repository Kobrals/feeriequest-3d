// models/User.js
const mongoose = require('mongoose');

const ItemSchema = new mongoose.Schema({
  name: String,
  tier: { type: Number, default: 1 },
  qty: { type: Number, default: 1 }
}, { _id: false });

const QuestProgressSchema = new mongoose.Schema({
  questId: String,
  progress: { type: Number, default: 0 },
  completed: { type: Boolean, default: false }
}, { _id: false });

const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  passHash: { type: String, required: true },
  level: { type: Number, default: 1 },
  exp: { type: Number, default: 0 },
  gold: { type: Number, default: 50 },
  hp: { type: Number, default: 100 },
  maxHp: { type: Number, default: 100 },
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 },
  z: { type: Number, default: 0 },
  rotationY: { type: Number, default: 0 },
  inventory: [ItemSchema],
  quests: [QuestProgressSchema],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);
