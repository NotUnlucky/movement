const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;

const MAX_PLAYERS = 6;
const TICK_RATE = 30;
const DEFAULT_ROUND_DURATION_SECONDS = 120;
const COUNTDOWN_SECONDS = 3;
const ROUND_DURATION_OPTIONS = [120, 180, 240, 300];
const MAX_PICKUP_OPTIONS = [6, 7, 8, 9];

const WORLD_WIDTH = 1600;
const WORLD_HEIGHT = 900;
const PLAYER_RADIUS = 18;
const PLAYER_HALF_WIDTH = 14;
const PLAYER_HALF_HEIGHT = 24;
const PLAYER_SLIDE_HALF_HEIGHT = 16;
const PLAYER_MAX_HEALTH = 100;

const BASE_SPEED = 220;
const SPEED_BUFF_MULTIPLIER = 1.6;
const SPEED_BUFF_SECONDS = 3;

const SLIDE_SECONDS = 0.28;
const SLIDE_SPEED = 520;
const SLIDE_COOLDOWN_SECONDS = 0.22;

const JUMP_SECONDS = 0.24;
const JUMP_COOLDOWN_SECONDS = 0.12;
const JUMP_VELOCITY = -780;
const GRAVITY = 1900;
const MAX_FALL_SPEED = 980;
const WALL_JUMP_VELOCITY = -740;
const WALL_JUMP_HORIZONTAL_SPEED = 360;
const WALL_JUMP_LOCK_SECONDS = 0.16;
const WALL_JUMP_COOLDOWN_SECONDS = 0.05;

const RESPAWN_SECONDS = 2;
const PICKUP_SPAWN_INTERVAL = 10;
const PICKUP_SPAWN_COUNT = 2;
const DEFAULT_MAX_PICKUPS = 6;

const BULLET_SPEED = 760;
const BULLET_DAMAGE = 35;
const BULLET_LIFE_SECONDS = 1;
const BULLET_RADIUS = 5;

const BOMB_SPEED = 380;
const BOMB_DAMAGE = 30;
const BOMB_RADIUS = 90;
const BOMB_FLIGHT_SECONDS = 0.9;

const CARD_TYPES = ["dash", "speed", "shoot", "bomb", "heal"];

const SPAWN_POINTS = [
  { x: 230, y: 175 },
  { x: 1370, y: 175 },
  { x: 1340, y: 395 },
  { x: 260, y: 395 },
  { x: 1335, y: 665 },
  { x: 235, y: 665 }
];

const MAP_OBSTACLES = [
  { x: 0, y: 240, w: 430, h: 34 },
  { x: 1170, y: 240, w: 430, h: 34 },
  { x: 0, y: 470, w: 410, h: 34 },
  { x: 1170, y: 470, w: 430, h: 34 },
  { x: 0, y: 705, w: 420, h: 36 },
  { x: 1170, y: 705, w: 430, h: 36 },
  { x: 525, y: 150, w: 150, h: 40 },
  { x: 925, y: 150, w: 150, h: 40 },
  { x: 525, y: 410, w: 140, h: 40 },
  { x: 920, y: 410, w: 150, h: 40 },
  { x: 515, y: 670, w: 140, h: 40 },
  { x: 920, y: 670, w: 150, h: 40 },
  { x: 748, y: 220, w: 70, h: 90 },
  { x: 748, y: 470, w: 70, h: 95 },
  { x: 740, y: 740, w: 85, h: 94 }
];

const rooms = new Map();
const socketToRoom = new Map();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

app.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

io.on("connection", (socket) => {
  emitLobbyRooms(socket);

  socket.on("create_room", (payload) => {
    removePlayerFromRoom(socket.id);
    const roomCode = generateRoomCode();
    const room = createRoom(roomCode, socket.id);
    rooms.set(roomCode, room);

    addPlayerToRoom(room, socket, payload?.name);
    socket.join(roomCode);
    socketToRoom.set(socket.id, roomCode);

    socket.emit("joined_room", { roomCode, playerId: socket.id });
    emitRoomSnapshot(room);
    emitLobbyRooms();
  });

  socket.on("join_room", (payload) => {
    const roomCode = String(payload?.roomCode || "").trim().toUpperCase();
    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit("error_message", "Sala nao encontrada.");
      return;
    }
    if (room.state !== "waiting") {
      socket.emit("error_message", "A sala ja iniciou.");
      return;
    }
    if (room.players.size >= MAX_PLAYERS) {
      socket.emit("error_message", "Sala cheia.");
      return;
    }

    removePlayerFromRoom(socket.id);
    addPlayerToRoom(room, socket, payload?.name);
    socket.join(roomCode);
    socketToRoom.set(socket.id, roomCode);

    socket.emit("joined_room", { roomCode, playerId: socket.id });
    emitRoomSnapshot(room);
    emitLobbyRooms();
  });

  socket.on("leave_room", () => {
    removePlayerFromRoom(socket.id);
  });

  socket.on("start_game", () => {
    const room = getRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id) {
      return;
    }
    if (room.state !== "waiting" && room.state !== "ended") {
      return;
    }
    resetRound(room);
    emitLobbyRooms();
  });

  socket.on("restart_game", () => {
    const room = getRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id || room.state !== "ended") {
      return;
    }
    resetRound(room);
  });

  socket.on("close_room", () => {
    const room = getRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id) {
      return;
    }
    closeRoom(room, "A sala foi encerrada pelo host.");
  });

  socket.on("update_room_settings", (payload) => {
    const room = getRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id || room.state !== "waiting") {
      return;
    }

    room.settings = sanitizeRoomSettings(payload, room.settings);
    if (room.pickups.length > room.settings.maxPickups) {
      room.pickups.splice(0, room.pickups.length - room.settings.maxPickups);
    }
    room.roundRemaining = room.settings.roundDurationSeconds;
    emitRoomSnapshot(room);
  });

  socket.on("input_state", (payload) => {
    const room = getRoomBySocket(socket.id);
    if (!room) {
      return;
    }
    const player = room.players.get(socket.id);
    if (!player) {
      return;
    }

    player.input.moveX = clamp(Number(payload?.moveX) || 0, -1, 1);
    player.input.wantJump = Boolean(payload?.jump);
    player.input.wantSlide = Boolean(payload?.slide);
    player.input.targetX = Number.isFinite(payload?.targetX) ? payload.targetX : player.x + player.facingX * 100;
    player.input.targetY = Number.isFinite(payload?.targetY) ? payload.targetY : player.y;
  });

  socket.on("use_card", (payload) => {
    const room = getRoomBySocket(socket.id);
    if (!room || room.state !== "running") {
      return;
    }
    const player = room.players.get(socket.id);
    if (!player || !player.alive) {
      return;
    }
    const slot = Number(payload?.slot);
    if (!Number.isInteger(slot) || slot < 0 || slot >= player.inventory.length) {
      return;
    }
    const cardType = player.inventory[slot];
    if (!cardType) {
      return;
    }

    const targetX = Number.isFinite(payload?.targetX) ? payload.targetX : player.x + player.facingX * 100;
    const targetY = Number.isFinite(payload?.targetY) ? payload.targetY : player.y;
    const dir = normalize(targetX - player.x, targetY - player.y);
    const now = Date.now();

    player.inventory[slot] = null;

    if (cardType === "dash") {
      player.slideUntil = now + SLIDE_SECONDS * 1000;
      player.slideCooldownUntil = now + SLIDE_COOLDOWN_SECONDS * 1000;
      player.slideDirX = dir.x !== 0 ? Math.sign(dir.x) : Math.sign(player.facingX) || 1;
    } else if (cardType === "speed") {
      player.speedBuffUntil = now + SPEED_BUFF_SECONDS * 1000;
    } else if (cardType === "shoot") {
      room.bullets.push({
        id: makeEntityId("bullet"),
        ownerId: player.id,
        x: player.x + dir.x * 28,
        y: player.y + dir.y * 28,
        vx: dir.x * BULLET_SPEED,
        vy: dir.y * BULLET_SPEED,
        life: BULLET_LIFE_SECONDS,
        damage: BULLET_DAMAGE
      });
    } else if (cardType === "bomb") {
      room.bombs.push({
        id: makeEntityId("bomb"),
        ownerId: player.id,
        x: player.x + dir.x * 18,
        y: player.y + dir.y * 18,
        vx: dir.x * BOMB_SPEED,
        vy: dir.y * BOMB_SPEED,
        elapsed: 0,
        flight: BOMB_FLIGHT_SECONDS,
        damage: BOMB_DAMAGE,
        radius: BOMB_RADIUS
      });
    } else if (cardType === "heal") {
      player.health = clamp(player.health + 20, 0, PLAYER_MAX_HEALTH);
    }
  });

  socket.on("disconnect", () => {
    removePlayerFromRoom(socket.id);
  });
});

setInterval(() => {
  for (const room of rooms.values()) {
    tickRoom(room);
  }
}, Math.round(1000 / TICK_RATE));

server.listen(PORT, () => {
  console.log(`Cartada Royale server listening on port ${PORT}`);
});

function createRoom(code, hostId) {
  const settings = getDefaultRoomSettings();
  return {
    code,
    hostId,
    state: "waiting",
    createdAt: Date.now(),
    settings,
    players: new Map(),
    pickups: [],
    bullets: [],
    bombs: [],
    countdownRemaining: COUNTDOWN_SECONDS,
    roundRemaining: settings.roundDurationSeconds,
    spawnTimer: 0,
    lastTickAt: Date.now()
  };
}

function addPlayerToRoom(room, socket, rawName) {
  const spawn = pickSpawn(room.players.size);
  room.players.set(socket.id, {
    id: socket.id,
    name: sanitizeName(rawName),
    x: spawn.x,
    y: spawn.y,
    health: PLAYER_MAX_HEALTH,
    kills: 0,
    deaths: 0,
    alive: true,
    respawnSeconds: 0,
    inventory: [null, null, null],
    facingX: 1,
    vx: 0,
    vy: 0,
    onGround: false,
    speedBuffUntil: 0,
    slideUntil: 0,
    slideCooldownUntil: 0,
    slideDirX: 1,
    jumpUntil: 0,
    jumpCooldownUntil: 0,
    wallJumpDirX: 0,
    wallJumpLockUntil: 0,
    wallJumpCooldownUntil: 0,
    lastDamagedBy: null,
    input: {
      moveX: 0,
      wantJump: false,
      wantSlide: false,
      targetX: spawn.x + 100,
      targetY: spawn.y
    }
  });

  if (!room.players.has(room.hostId)) {
    room.hostId = socket.id;
  }
}

function removePlayerFromRoom(socketId) {
  const roomCode = socketToRoom.get(socketId);
  if (!roomCode) {
    return;
  }

  const room = rooms.get(roomCode);
  socketToRoom.delete(socketId);
  if (!room) {
    return;
  }

  room.players.delete(socketId);
  const sock = io.sockets.sockets.get(socketId);
  if (sock) {
    sock.leave(roomCode);
  }

  if (room.players.size === 0) {
    rooms.delete(roomCode);
    emitLobbyRooms();
    return;
  }

  if (room.hostId === socketId) {
    room.hostId = room.players.keys().next().value;
  }

  if (room.state !== "waiting" && room.players.size < 1) {
    room.state = "ended";
  }

  emitRoomSnapshot(room);
  emitLobbyRooms();
}

function closeRoom(room, reason) {
  for (const playerId of room.players.keys()) {
    socketToRoom.delete(playerId);
    const sock = io.sockets.sockets.get(playerId);
    if (sock) {
      sock.leave(room.code);
      sock.emit("room_closed", reason);
    }
  }
  rooms.delete(room.code);
  emitLobbyRooms();
}

function getRoomBySocket(socketId) {
  const roomCode = socketToRoom.get(socketId);
  if (!roomCode) {
    return null;
  }
  return rooms.get(roomCode) || null;
}

function emitLobbyRooms(targetSocket = null) {
  const payload = [];
  for (const room of rooms.values()) {
    if (room.state === "waiting") {
      payload.push({
        roomCode: room.code,
        players: room.players.size,
        maxPlayers: MAX_PLAYERS
      });
    }
  }

  if (targetSocket) {
    targetSocket.emit("lobby_rooms", payload);
  } else {
    io.emit("lobby_rooms", payload);
  }
}

function emitRoomSnapshot(room) {
  const ranking = [...room.players.values()]
    .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.name.localeCompare(b.name))
    .map((player) => ({
      id: player.id,
      name: player.name,
      kills: player.kills,
      deaths: player.deaths
    }));

  const payload = {
    roomCode: room.code,
    hostId: room.hostId,
    state: room.state,
    settings: {
      maxPickups: room.settings.maxPickups,
      roundDurationSeconds: room.settings.roundDurationSeconds,
      allowedCards: [...room.settings.allowedCards]
    },
    countdownRemaining: room.countdownRemaining,
    roundRemaining: room.roundRemaining,
    world: { width: WORLD_WIDTH, height: WORLD_HEIGHT },
    obstacles: MAP_OBSTACLES,
    players: [...room.players.values()].map((player) => ({
      id: player.id,
      name: player.name,
      x: player.x,
      y: player.y,
      health: player.health,
      maxHealth: PLAYER_MAX_HEALTH,
      kills: player.kills,
      deaths: player.deaths,
      alive: player.alive,
      inventory: player.inventory,
      facingX: player.facingX,
      vx: player.vx,
      vy: player.vy,
      onGround: player.onGround,
      speedBuff: Date.now() < player.speedBuffUntil,
      sliding: Date.now() < player.slideUntil,
      jumping: !player.onGround
    })),
    pickups: room.pickups.map((pickup) => ({
      id: pickup.id,
      type: pickup.type,
      x: pickup.x,
      y: pickup.y
    })),
    bullets: room.bullets.map((bullet) => ({
      id: bullet.id,
      x: bullet.x,
      y: bullet.y
    })),
    bombs: room.bombs.map((bomb) => ({
      id: bomb.id,
      x: bomb.x,
      y: bomb.y,
      z: computeBombHeight(bomb)
    })),
    ranking
  };

  io.to(room.code).emit("room_snapshot", payload);
}

function tickRoom(room) {
  const now = Date.now();
  const dt = clamp((now - room.lastTickAt) / 1000, 0, 0.05);
  room.lastTickAt = now;

  if (room.state === "countdown") {
    room.countdownRemaining = Math.max(0, room.countdownRemaining - dt);
    if (room.countdownRemaining <= 0) {
      room.state = "running";
      room.roundRemaining = room.settings.roundDurationSeconds;
      room.spawnTimer = 0;
      spawnPickups(room, PICKUP_SPAWN_COUNT);
    }
  } else if (room.state === "running") {
    room.roundRemaining = Math.max(0, room.roundRemaining - dt);
    room.spawnTimer += dt;

    if (room.spawnTimer >= PICKUP_SPAWN_INTERVAL) {
      room.spawnTimer -= PICKUP_SPAWN_INTERVAL;
      spawnPickups(room, PICKUP_SPAWN_COUNT);
    }

    for (const player of room.players.values()) {
      updatePlayer(room, player, dt, now);
    }

    updateBullets(room, dt);
    updateBombs(room, dt);
    collectPickups(room);

    if (room.roundRemaining <= 0) {
      room.state = "ended";
    }
  }

  emitRoomSnapshot(room);
}

function resetRound(room) {
  room.state = "countdown";
  room.countdownRemaining = COUNTDOWN_SECONDS;
  room.roundRemaining = room.settings.roundDurationSeconds;
  room.spawnTimer = 0;
  room.pickups = [];
  room.bullets = [];
  room.bombs = [];
  room.lastTickAt = Date.now();

  let index = 0;
  for (const player of room.players.values()) {
    const spawn = pickSpawn(index);
    index += 1;
    player.x = spawn.x;
    player.y = spawn.y;
    player.health = PLAYER_MAX_HEALTH;
    player.kills = 0;
    player.deaths = 0;
    player.alive = true;
    player.respawnSeconds = 0;
    player.inventory = [null, null, null];
    player.speedBuffUntil = 0;
    player.slideUntil = 0;
    player.slideCooldownUntil = 0;
    player.jumpUntil = 0;
    player.jumpCooldownUntil = 0;
    player.wallJumpDirX = 0;
    player.wallJumpLockUntil = 0;
    player.wallJumpCooldownUntil = 0;
    player.vx = 0;
    player.vy = 0;
    player.onGround = false;
    player.input.wantJump = false;
    player.input.wantSlide = false;
  }
}

function updatePlayer(room, player, dt, now) {
  if (!player.alive) {
    player.respawnSeconds -= dt;
    if (player.respawnSeconds <= 0) {
      const spawn = pickSpawn(Math.floor(Math.random() * SPAWN_POINTS.length));
      player.x = spawn.x;
      player.y = spawn.y;
      player.health = PLAYER_MAX_HEALTH;
      player.alive = true;
      player.vx = 0;
      player.vy = 0;
      player.onGround = false;
      player.wallJumpDirX = 0;
      player.wallJumpLockUntil = 0;
      player.wallJumpCooldownUntil = 0;
      player.lastDamagedBy = null;
    }
    return;
  }

  const desiredMoveX = clamp(player.input.moveX, -1, 1);
  if (Math.abs(desiredMoveX) > 0.05) {
    player.facingX = Math.sign(desiredMoveX);
  } else if (Math.abs(player.input.targetX - player.x) > 2) {
    player.facingX = Math.sign(player.input.targetX - player.x);
  }

  if (player.input.wantJump && player.onGround && now >= player.jumpCooldownUntil) {
    player.vy = JUMP_VELOCITY;
    player.onGround = false;
    player.jumpUntil = now + JUMP_SECONDS * 1000;
    player.jumpCooldownUntil = now + JUMP_COOLDOWN_SECONDS * 1000;
  } else if (player.input.wantJump && !player.onGround && now >= player.wallJumpCooldownUntil) {
    const wallContacts = getWallContacts(player, now < player.slideUntil);
    if (wallContacts.left || wallContacts.right) {
      const wallJumpDirection =
        wallContacts.left && !wallContacts.right ? 1 : wallContacts.right && !wallContacts.left ? -1 : -player.facingX || 1;
      player.vx = wallJumpDirection * WALL_JUMP_HORIZONTAL_SPEED;
      player.vy = WALL_JUMP_VELOCITY;
      player.facingX = wallJumpDirection;
      player.wallJumpDirX = wallJumpDirection;
      player.wallJumpLockUntil = now + WALL_JUMP_LOCK_SECONDS * 1000;
      player.wallJumpCooldownUntil = now + WALL_JUMP_COOLDOWN_SECONDS * 1000;
      player.jumpUntil = now + JUMP_SECONDS * 1000;
    }
  }

  if (player.input.wantSlide && player.onGround && now >= player.slideCooldownUntil) {
    const slideDirection = Math.abs(desiredMoveX) > 0.05 ? Math.sign(desiredMoveX) : Math.sign(player.facingX) || 1;
    player.slideDirX = slideDirection;
    player.slideUntil = now + SLIDE_SECONDS * 1000;
    player.slideCooldownUntil = now + SLIDE_COOLDOWN_SECONDS * 1000;
  }

  let speed = BASE_SPEED;
  if (now < player.speedBuffUntil) {
    speed *= SPEED_BUFF_MULTIPLIER;
  }
  if (!player.onGround) {
    speed *= 0.9;
  }

  const isSliding = now < player.slideUntil;
  if (isSliding) {
    player.vx = player.slideDirX * SLIDE_SPEED;
  } else if (now < player.wallJumpLockUntil) {
    player.vx = player.wallJumpDirX * WALL_JUMP_HORIZONTAL_SPEED;
  } else {
    player.vx = desiredMoveX * speed;
  }
  player.vy = Math.min(MAX_FALL_SPEED, player.vy + GRAVITY * dt);

  movePlayerPlatformer(player, dt, isSliding);
}

function movePlayerPlatformer(player, dt, isSliding) {
  const halfWidth = PLAYER_HALF_WIDTH;
  const halfHeight = isSliding ? PLAYER_SLIDE_HALF_HEIGHT : PLAYER_HALF_HEIGHT;

  let nextX = clamp(player.x + player.vx * dt, halfWidth, WORLD_WIDTH - halfWidth);
  for (const rect of MAP_OBSTACLES) {
    if (!aabbIntersectsRect(nextX, player.y, halfWidth, halfHeight, rect)) {
      continue;
    }
    if (player.vx > 0) {
      nextX = rect.x - halfWidth;
    } else if (player.vx < 0) {
      nextX = rect.x + rect.w + halfWidth;
    }
  }
  player.x = nextX;

  let nextY = player.y + player.vy * dt;
  player.onGround = false;

  if (nextY >= WORLD_HEIGHT - halfHeight) {
    nextY = WORLD_HEIGHT - halfHeight;
    player.vy = 0;
    player.onGround = true;
  } else if (nextY <= halfHeight) {
    nextY = halfHeight;
    player.vy = 0;
  }

  for (const rect of MAP_OBSTACLES) {
    if (!aabbIntersectsRect(player.x, nextY, halfWidth, halfHeight, rect)) {
      continue;
    }

    if (player.vy > 0) {
      nextY = rect.y - halfHeight;
      player.vy = 0;
      player.onGround = true;
    } else if (player.vy < 0) {
      nextY = rect.y + rect.h + halfHeight;
      player.vy = 0;
    }
  }

  player.y = nextY;
}

function updateBullets(room, dt) {
  const survivors = [];
  for (const bullet of room.bullets) {
    bullet.life -= dt;
    if (bullet.life <= 0) {
      continue;
    }

    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;

    if (
      bullet.x < -20 ||
      bullet.y < -20 ||
      bullet.x > WORLD_WIDTH + 20 ||
      bullet.y > WORLD_HEIGHT + 20
    ) {
      continue;
    }

    let hitObstacle = false;
    for (const rect of MAP_OBSTACLES) {
      if (circleIntersectsRect(bullet.x, bullet.y, BULLET_RADIUS, rect)) {
        hitObstacle = true;
        break;
      }
    }
    if (hitObstacle) {
      continue;
    }

    let hit = false;
    for (const target of room.players.values()) {
      if (!target.alive || target.id === bullet.ownerId) {
        continue;
      }
      if (distanceSquared(bullet.x, bullet.y, target.x, target.y) <= (PLAYER_RADIUS + BULLET_RADIUS) ** 2) {
        applyDamage(room, target, bullet.damage, bullet.ownerId);
        hit = true;
        break;
      }
    }

    if (!hit) {
      survivors.push(bullet);
    }
  }
  room.bullets = survivors;
}

function updateBombs(room, dt) {
  const survivors = [];
  for (const bomb of room.bombs) {
    bomb.elapsed += dt;
    bomb.x += bomb.vx * dt;
    bomb.y += bomb.vy * dt;

    if (bomb.elapsed >= bomb.flight) {
      explodeBomb(room, bomb);
      continue;
    }
    survivors.push(bomb);
  }
  room.bombs = survivors;
}

function explodeBomb(room, bomb) {
  for (const target of room.players.values()) {
    if (!target.alive || target.id === bomb.ownerId) {
      continue;
    }
    const distSq = distanceSquared(bomb.x, bomb.y, target.x, target.y);
    if (distSq <= bomb.radius ** 2) {
      applyDamage(room, target, bomb.damage, bomb.ownerId);
    }
  }
}

function collectPickups(room) {
  if (room.pickups.length === 0) {
    return;
  }

  const keep = [];
  for (const pickup of room.pickups) {
    let consumed = false;
    for (const player of room.players.values()) {
      if (!player.alive) {
        continue;
      }
      if (distanceSquared(player.x, player.y, pickup.x, pickup.y) > 36 ** 2) {
        continue;
      }
      const slot = player.inventory.findIndex((entry) => entry === null);
      if (slot === -1) {
        continue;
      }
      player.inventory[slot] = pickup.type;
      consumed = true;
      break;
    }
    if (!consumed) {
      keep.push(pickup);
    }
  }
  room.pickups = keep;
}

function spawnPickups(room, amount) {
  const maxPickups = room.settings?.maxPickups || DEFAULT_MAX_PICKUPS;
  const allowedCards = room.settings?.allowedCards?.length ? room.settings.allowedCards : CARD_TYPES;
  const availableSlots = Math.max(0, maxPickups - room.pickups.length);
  const spawnCount = Math.min(amount, availableSlots);
  for (let i = 0; i < spawnCount; i += 1) {
    const type = allowedCards[Math.floor(Math.random() * allowedCards.length)];
    const pos = findFreePosition();
    room.pickups.push({
      id: makeEntityId("pickup"),
      type,
      x: pos.x,
      y: pos.y
    });
  }
  if (room.pickups.length > maxPickups) {
    room.pickups.splice(0, room.pickups.length - maxPickups);
  }
}

function applyDamage(room, target, damage, attackerId) {
  if (!target.alive) {
    return;
  }

  target.health = Math.max(0, target.health - damage);
  target.lastDamagedBy = attackerId;

  if (target.health > 0) {
    return;
  }

  target.alive = false;
  target.deaths += 1;
  target.respawnSeconds = RESPAWN_SECONDS;
  target.speedBuffUntil = 0;
  target.slideUntil = 0;
  target.jumpUntil = 0;
  target.vx = 0;
  target.vy = 0;
  target.onGround = false;
  target.wallJumpDirX = 0;
  target.wallJumpLockUntil = 0;
  target.wallJumpCooldownUntil = 0;
  target.inventory = [null, null, null];

  if (attackerId && attackerId !== target.id) {
    const attacker = room.players.get(attackerId);
    if (attacker) {
      attacker.kills += 1;
    }
  }
}

function findFreePosition() {
  for (let i = 0; i < 40; i += 1) {
    const candidate = {
      x: randRange(80, WORLD_WIDTH - 80),
      y: randRange(90, WORLD_HEIGHT - 90)
    };
    const blocked = MAP_OBSTACLES.some((rect) => circleIntersectsRect(candidate.x, candidate.y, 22, rect));
    if (!blocked) {
      return candidate;
    }
  }
  return { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };
}

function computeBombHeight(bomb) {
  const t = clamp(bomb.elapsed / bomb.flight, 0, 1);
  return 90 * (4 * t * (1 - t));
}

function pickSpawn(index) {
  const point = SPAWN_POINTS[index % SPAWN_POINTS.length];
  return { x: point.x, y: point.y };
}

function sanitizeName(name) {
  const clean = String(name || "Jogador").trim();
  if (!clean) {
    return "Jogador";
  }
  return clean.slice(0, 16);
}

function getDefaultRoomSettings() {
  return {
    maxPickups: DEFAULT_MAX_PICKUPS,
    roundDurationSeconds: DEFAULT_ROUND_DURATION_SECONDS,
    allowedCards: [...CARD_TYPES]
  };
}

function sanitizeRoomSettings(rawSettings, currentSettings) {
  const next = {
    maxPickups: currentSettings?.maxPickups ?? DEFAULT_MAX_PICKUPS,
    roundDurationSeconds: currentSettings?.roundDurationSeconds ?? DEFAULT_ROUND_DURATION_SECONDS,
    allowedCards: [...(currentSettings?.allowedCards || CARD_TYPES)]
  };

  if (rawSettings && MAX_PICKUP_OPTIONS.includes(Number(rawSettings.maxPickups))) {
    next.maxPickups = Number(rawSettings.maxPickups);
  }

  if (rawSettings && ROUND_DURATION_OPTIONS.includes(Number(rawSettings.roundDurationSeconds))) {
    next.roundDurationSeconds = Number(rawSettings.roundDurationSeconds);
  }

  if (rawSettings && Array.isArray(rawSettings.allowedCards)) {
    const filteredCards = [...new Set(rawSettings.allowedCards.map((value) => String(value).trim().toLowerCase()))].filter(
      (cardType) => CARD_TYPES.includes(cardType)
    );
    if (filteredCards.length > 0) {
      next.allowedCards = filteredCards;
    }
  }

  return next;
}

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = "";
    for (let i = 0; i < 4; i += 1) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (rooms.has(code));
  return code;
}

function makeEntityId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function normalize(x, y) {
  const length = Math.hypot(x, y);
  if (length < 0.0001) {
    return { x: 0, y: 0, length: 0 };
  }
  return { x: x / length, y: y / length, length };
}

function distanceSquared(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return dx * dx + dy * dy;
}

function getWallContacts(player, isSliding) {
  const halfWidth = PLAYER_HALF_WIDTH;
  const halfHeight = isSliding ? PLAYER_SLIDE_HALF_HEIGHT : PLAYER_HALF_HEIGHT;
  const playerLeft = player.x - halfWidth;
  const playerRight = player.x + halfWidth;
  const playerTop = player.y - halfHeight + 2;
  const playerBottom = player.y + halfHeight - 2;

  let left = playerLeft <= 0.5;
  let right = playerRight >= WORLD_WIDTH - 0.5;

  for (const rect of MAP_OBSTACLES) {
    if (playerBottom <= rect.y + 1 || playerTop >= rect.y + rect.h - 1) {
      continue;
    }
    if (Math.abs(playerLeft - (rect.x + rect.w)) <= 2) {
      left = true;
    }
    if (Math.abs(playerRight - rect.x) <= 2) {
      right = true;
    }
  }

  return { left, right };
}

function aabbIntersectsRect(cx, cy, halfW, halfH, rect) {
  const left = cx - halfW;
  const right = cx + halfW;
  const top = cy - halfH;
  const bottom = cy + halfH;
  return !(right <= rect.x || left >= rect.x + rect.w || bottom <= rect.y || top >= rect.y + rect.h);
}

function circleIntersectsRect(cx, cy, r, rect) {
  const closestX = clamp(cx, rect.x, rect.x + rect.w);
  const closestY = clamp(cy, rect.y, rect.y + rect.h);
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy <= r * r;
}
