// server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const User = require('./models/User');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || '';
const JWT_SECRET = process.env.JWT_SECRET || 'devsecret';

if (!MONGODB_URI) console.warn('⚠️ MONGODB_URI non défini - utilisation locale sans DB possible');

mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(()=> console.log('✅ MongoDB connecté'))
  .catch(err => console.error('❌ MongoDB erreur:', err));

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Auth API
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username+password requis' });
    if (await User.findOne({ username })) return res.status(400).json({ error: 'username déjà pris' });
    const passHash = await bcrypt.hash(password, 10);
    const user = new User({ username, passHash });
    await user.save();
    const token = jwt.sign({ id: user._id, username: user.username }, JWT_SECRET);
    res.json({ token, username: user.username });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'erreur serveur' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username+password requis' });
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: 'identifiants invalides' });
    const ok = await bcrypt.compare(password, user.passHash);
    if (!ok) return res.status(400).json({ error: 'identifiants invalides' });
    const token = jwt.sign({ id: user._id, username: user.username }, JWT_SECRET);
    res.json({ token, username: user.username });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'erreur serveur' });
  }
});

// secure middleware
function verifyTokenHeader(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'token manquant' });
  const parts = auth.split(' ');
  if (parts.length !== 2) return res.status(401).json({ error: 'token invalide' });
  try {
    const payload = jwt.verify(parts[1], JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'token invalide' });
  }
}

// load profile
app.get('/api/load', verifyTokenHeader, async (req, res) => {
  const user = await User.findById(req.user.id).lean();
  if (!user) return res.status(404).json({ error: 'user not found' });
  delete user.passHash;
  res.json({ user });
});

// save profile (partial)
app.post('/api/save', verifyTokenHeader, async (req, res) => {
  try {
    const payload = req.body;
    const allowed = ['x','y','z','rotationY','inventory','quests','level','exp','gold','hp','maxHp'];
    const data = {};
    allowed.forEach(k => { if (k in payload) data[k] = payload[k]; });
    await User.findByIdAndUpdate(req.user.id, data, { new: true });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'save failed' });
  }
});

// --- In-memory realtime game state ---
const players = {}; // socketId -> player obj (including userId when linked)
const monsters = {}; // id -> monster
let nextMonsterId = 1;

function spawnMonster(type='beast', x=0,y=0,z=0, level=1) {
  const id = nextMonsterId++;
  monsters[id] = {
    id, type, x: x + (Math.random()*40-20), y: y + (Math.random()*40-20), z,
    hp: type==='boss' ? 300 : 60 + level*15, maxHp: type==='boss' ? 300 : 60 + level*15,
    level, lootTier: type==='boss'?3:1
  };
  io.emit('monster_spawn', monsters[id]);
  return monsters[id];
}

// initial small spawn
for (let i=0;i<8;i++) spawnMonster('beast', Math.random()*300-150, Math.random()*300-150, 0, 1+Math.floor(Math.random()*4));

setInterval(()=> {
  // wander monsters a bit and broadcast
  Object.values(monsters).forEach(m => { m.x += (Math.random()*6-3); m.y += (Math.random()*6-3); });
  io.emit('monsters_update', Object.values(monsters));
}, 1500);

// --- Socket.IO real-time
io.on('connection', socket => {
  console.log('Nouvelle connexion Socket.IO', socket.id);

  // client may authenticate to bind to DB user
  socket.on('auth', async ({ token }) => {
    if (!token) return;
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      const dbUser = await User.findById(payload.id).lean();
      if (!dbUser) return;
      // create or update in-memory player
      players[socket.id] = {
        socketId: socket.id,
        userId: dbUser._id.toString(),
        username: dbUser.username,
        x: dbUser.x || 0, y: dbUser.y || 0, z: dbUser.z || 0,
        rotationY: dbUser.rotationY || 0,
        hp: dbUser.hp || dbUser.maxHp || 100,
        maxHp: dbUser.maxHp || 100,
        level: dbUser.level || 1,
        exp: dbUser.exp || 0,
        gold: dbUser.gold || 0,
        inventory: dbUser.inventory || [],
        quests: dbUser.quests || []
      };
      socket.emit('auth_ok', { player: players[socket.id] });
      io.emit('player_joined', players[socket.id]);
    } catch (e) { /* ignore */ }
  });

  // anonymous join
  socket.on('join_guest', ({ name }) => {
    players[socket.id] = {
      socketId: socket.id,
      userId: null,
      username: name || `Invité${Math.floor(Math.random()*1000)}`,
      x: Math.random()*200-100, y: Math.random()*200-100, z:0,
      rotationY: 0, hp: 100, maxHp: 100, level: 1, exp:0, gold: 40, inventory: [], quests: []
    };
    socket.emit('auth_ok', { player: players[socket.id] });
    io.emit('player_joined', players[socket.id]);
  });

  // receive movement updates
  socket.on('move', pos => {
    const p = players[socket.id];
    if (!p) return;
    p.x = pos.x; p.y = pos.y; p.z = pos.z || 0; p.rotationY = pos.rotationY || p.rotationY;
    socket.broadcast.emit('player_moved', { socketId: socket.id, x: p.x, y: p.y, z: p.z, rotationY: p.rotationY });
  });

  // attack event
  socket.on('attack', ({ monsterId, dmg }) => {
    const p = players[socket.id]; const m = monsters[monsterId];
    if (!p || !m) return;
    const finalDmg = Math.max(1, Math.floor(dmg + p.level*1.2 + (Math.random()*6-3)));
    m.hp -= finalDmg;
    io.emit('monster_damaged', { monsterId: m.id, hp: m.hp });
    if (m.hp <= 0) {
      const gold = 10 + Math.floor(Math.random()*40) + m.level*5;
      const exp = 8 + m.level*12;
      p.gold += gold; p.exp += exp;
      let loot = null;
      const drop = Math.random();
      if (drop > 0.9) loot = { name: 'Épée enchantée', tier: m.lootTier || 1 };
      else if (drop > 0.6) loot = { name: 'Herbe magique', tier: 1 };
      if (loot) {
        const ex = p.inventory.find(i => i.name === loot.name && i.tier === loot.tier);
        if (ex) ex.qty = (ex.qty||1) + (loot.qty||1);
        else p.inventory.push({ ...loot, qty: loot.qty || 1 });
      }
      delete monsters[monsterId];
      io.emit('monster_killed', { monsterId, by: p.socketId, gold, exp, loot });
      // level up
      while (p.exp >= p.level * 100) {
        p.exp -= p.level * 100;
        p.level++; p.maxHp += 10; p.hp = p.maxHp;
        io.to(socket.id).emit('leveled', { level: p.level });
      }
      // persist some fields if linked user
      if (p.userId) {
        User.findByIdAndUpdate(p.userId, { gold: p.gold, exp: p.exp, level: p.level, inventory: p.inventory }).catch(e => console.error('save err', e));
      }
    } else {
      // monster may retaliate
      if (Math.random() < 0.4) {
        const rDmg = Math.max(1, Math.floor(m.level*2 + Math.random()*8));
        p.hp -= rDmg;
        io.to(socket.id).emit('damaged', { dmg: rDmg, hp: p.hp });
        if (p.hp <= 0) {
          p.hp = Math.floor(p.maxHp * 0.6);
          p.x = Math.random()*200-100; p.y = Math.random()*200-100;
          p.gold = Math.max(0, p.gold - Math.floor(p.gold*0.05));
          io.to(socket.id).emit('died', { hp: p.hp, x: p.x, y: p.y, gold: p.gold });
        }
      }
    }
  });

  // request state (on connect client asks)
  socket.on('request_state', () => {
    socket.emit('state', { players: Object.values(players), monsters: Object.values(monsters) });
  });

  // save_request from client (persist player state)
  socket.on('save_request', async () => {
    const p = players[socket.id];
    if (!p || !p.userId) return socket.emit('save_response', { ok:false, error:'not linked' });
    try {
      await User.findByIdAndUpdate(p.userId, {
        x: p.x, y: p.y, z: p.z, rotationY: p.rotationY,
        inventory: p.inventory, quests: p.quests,
        level: p.level, exp: p.exp, gold: p.gold, hp: p.hp, maxHp: p.maxHp
      });
      socket.emit('save_response', { ok:true });
    } catch (e) {
      socket.emit('save_response', { ok:false, error:'save failed' });
    }
  });

  socket.on('disconnect', () => {
    // persist on disconnect if user linked
    const p = players[socket.id];
    if (p && p.userId) {
      User.findByIdAndUpdate(p.userId, {
        x: p.x, y: p.y, z: p.z, rotationY: p.rotationY,
        inventory: p.inventory, quests: p.quests,
        level: p.level, exp: p.exp, gold: p.gold, hp: p.hp, maxHp: p.maxHp
      }).catch(e => console.error('save on disconnect failed', e));
    }
    delete players[socket.id];
    io.emit('player_left', { socketId: socket.id });
  });
});

server.listen(PORT, () => console.log(`🚀 Serveur démarré sur le port ${PORT}`));
