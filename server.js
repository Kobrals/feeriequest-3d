// === Modules ===
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const path = require("path");

// === Config ===
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret";

// === MongoDB ===
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log("✅ MongoDB connecté"))
  .catch(err => console.error("❌ MongoDB erreur:", err));

// === Modèles ===
const UserSchema = new mongoose.Schema({
  username: String,
  passwordHash: String,
  posX: Number,
  posY: Number,
  posZ: Number
});
const User = mongoose.model("User", UserSchema);

// === Middleware ===
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// === Routes API ===
// Inscription
app.post("/api/register", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({error: "Données manquantes"});
  const hash = await bcrypt.hash(password, 10);
  const user = new User({ username, passwordHash: hash, posX:0,posY:0,posZ:0 });
  await user.save();
  res.json({ success: true });
});

// Connexion
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (!user) return res.status(401).json({error: "Utilisateur inconnu"});
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(401).json({error: "Mot de passe incorrect"});
  const token = jwt.sign({ id: user._id }, JWT_SECRET);
  res.json({ token });
});

// Sauvegarde position
app.post("/api/save", async (req, res) => {
  const { token, x, y, z } = req.body;
  try {
    const data = jwt.verify(token, JWT_SECRET);
    await User.updateOne({ _id: data.id }, { posX: x, posY: y, posZ: z });
    res.json({ success: true });
  } catch (e) {
    res.status(401).json({error: "Token invalide"});
  }
});

// === Socket.IO pour position temps réel ===
io.on("connection", socket => {
  console.log("Nouvelle connexion Socket.IO");

  socket.on("move", data => {
    // renvoie la position à tout le monde
    socket.broadcast.emit("playerMoved", { id: socket.id, ...data });
  });

  socket.on("disconnect", () => {
    io.emit("playerLeft", { id: socket.id });
  });
});

// === Start ===
server.listen(PORT, () => console.log(`🚀 Serveur démarré sur le port ${PORT}`));
