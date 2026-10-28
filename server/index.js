
require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
  },
});

const TOKEN = process.env.SHARED_TOKEN;

if (!TOKEN) {
  throw new Error("SHARED_TOKEN wajib diatur");
}

const rooms = new Map();

io.use((socket, next) => {
  if (socket.handshake.auth.token !== TOKEN) {
    return next(new Error("Kode akses salah"));
  }
  next();
});

io.on("connection", (socket) => {
  socket.on("join", ({ roomId, role }) => {
    if (
      !/^[a-zA-Z0-9_-]{3,64}$/.test(roomId || "") ||
      !["sender", "viewer"].includes(role)
    ) {
      return socket.emit("app-error", "Data tidak valid");
    }

    const key = `${roomId}:${role}`;
    const existing = rooms.get(key);

    if (existing && existing !== socket.id) {
      return socket.emit(
        "app-error",
        "Peran ini sudah digunakan"
      );
    }

    socket.data.roomId = roomId;
    socket.data.role = role;
    rooms.set(key, socket.id);
    socket.join(roomId);

    socket.emit("joined", { role, roomId });
    socket.to(roomId).emit("peer-ready");
  });

  socket.on("signal", ({ type, data }) => {
    const roomId = socket.data.roomId;
    const role = socket.data.role;

    if (!roomId || !role) return;

    const otherRole =
      role === "sender" ? "viewer" : "sender";

    const targetId = rooms.get(`${roomId}:${otherRole}`);

    if (
      targetId &&
      ["offer", "answer", "candidate"].includes(type)
    ) {
      io.to(targetId).emit("signal", { type, data });
    }
  });

  socket.on("stream-stopped", () => {
    if (socket.data.role === "sender") {
      socket.to(socket.data.roomId).emit("stream-stopped");
    }
  });

  socket.on("disconnect", () => {
    const { roomId, role } = socket.data;

    if (roomId && role) {
      const key = `${roomId}:${role}`;

      if (rooms.get(key) === socket.id) {
        rooms.delete(key);
      }

      socket.to(roomId).emit("peer-left", { role });
    }
  });
});

app.get("/", (req, res) => {
  res.json({ status: "Couple Cam Server Online" });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server berjalan di port ${PORT}`);
});
