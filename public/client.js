const socket = io();

const CARD_ICONS = {
  dash: "/assets/cards/dash_card.png",
  speed: "/assets/cards/speed_card.png",
  shoot: "/assets/cards/shoot_card.png",
  bomb: "/assets/cards/bomb_card.png",
  heal: "/assets/cards/heal_card.png"
};

const CARD_LABELS = {
  dash: "Dash",
  speed: "Velocidade",
  shoot: "Disparo",
  bomb: "Bomba",
  heal: "Cura"
};

const cardImages = {};
for (const [card, src] of Object.entries(CARD_ICONS)) {
  const img = new Image();
  img.src = src;
  cardImages[card] = img;
}

const refs = {
  homeScreen: document.getElementById("home-screen"),
  roomScreen: document.getElementById("room-screen"),
  gameScreen: document.getElementById("game-screen"),
  orientationOverlay: document.getElementById("orientation-overlay"),
  createRoomBtn: document.getElementById("create-room-btn"),
  joinCodeBtn: document.getElementById("join-code-btn"),
  joinCodeInput: document.getElementById("join-code-input"),
  roomList: document.getElementById("room-list"),
  playerNameInput: document.getElementById("player-name"),
  roomCodeLabel: document.getElementById("room-code-label"),
  roomStatus: document.getElementById("room-status"),
  roomPlayers: document.getElementById("room-players"),
  hostControls: document.getElementById("host-controls"),
  startGameBtn: document.getElementById("start-game-btn"),
  leaveRoomBtn: document.getElementById("leave-room-btn"),
  roomSettings: document.getElementById("room-settings"),
  maxPickupsSelect: document.getElementById("max-pickups-select"),
  roundDurationSelect: document.getElementById("round-duration-select"),
  powerOptions: document.getElementById("power-options"),
  canvas: document.getElementById("game-canvas"),
  healthFill: document.getElementById("health-fill"),
  timerLabel: document.getElementById("timer-label"),
  killsLabel: document.getElementById("kills-label"),
  cardsBar: document.getElementById("cards-bar"),
  cardSlots: [...document.querySelectorAll(".card-slot")],
  mobileControls: document.getElementById("mobile-controls"),
  endOverlay: document.getElementById("end-overlay"),
  rankingList: document.getElementById("ranking-list"),
  endHostControls: document.getElementById("end-host-controls"),
  restartBtn: document.getElementById("restart-btn"),
  closeRoomBtn: document.getElementById("close-room-btn"),
  jumpBtn: document.getElementById("jump-btn"),
  slideBtn: document.getElementById("slide-btn"),
  dpadRoot: document.querySelector(".dpad"),
  dpadButtons: [...document.querySelectorAll(".dpad button")]
};

const ctx = refs.canvas.getContext("2d");

const state = {
  playerId: null,
  roomCode: null,
  snapshot: null,
  lobbyRooms: [],
  activeScreen: "home"
};

let syncingRoomSettings = false;

const controls = {
  keys: {
    KeyW: false,
    KeyA: false,
    KeyS: false,
    KeyD: false,
    ArrowUp: false,
    ArrowLeft: false,
    ArrowDown: false,
    ArrowRight: false
  },
  mobileMove: {
    up: false,
    left: false,
    right: false,
    down: false
  },
  queuedJump: false,
  queuedSlide: false,
  mouseCanvasX: 0,
  mouseCanvasY: 0
};

const viewState = {
  dpr: window.devicePixelRatio || 1,
  width: 0,
  height: 0,
  camX: 0,
  camY: 0,
  worldScale: 1,
  worldOffsetX: 0,
  worldOffsetY: 0
};

const isTouchDevice =
  window.matchMedia("(pointer: coarse)").matches ||
  /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent);

if (isTouchDevice) {
  refs.mobileControls.classList.remove("hidden");
}

buildRoomSettingsUI();
bindUI();
bindSocket();
updateRoomList();
updateOrientationOverlay();
requestAnimationFrame(renderFrame);
setInterval(sendInput, 50);

function buildRoomSettingsUI() {
  refs.powerOptions.innerHTML = "";
  for (const cardType of Object.keys(CARD_ICONS)) {
    const label = document.createElement("label");
    label.className = "power-option";
    label.innerHTML = `
      <input type="checkbox" data-card="${cardType}" />
      <span>${CARD_LABELS[cardType] || cardType}</span>
    `;
    refs.powerOptions.appendChild(label);
  }
}

function bindUI() {
  refs.createRoomBtn.addEventListener("click", () => {
    socket.emit("create_room", { name: getPlayerName() });
    tryLockLandscape();
  });

  refs.joinCodeBtn.addEventListener("click", () => {
    const roomCode = refs.joinCodeInput.value.trim().toUpperCase();
    if (!roomCode) {
      return;
    }
    socket.emit("join_room", { roomCode, name: getPlayerName() });
    tryLockLandscape();
  });

  refs.leaveRoomBtn.addEventListener("click", () => {
    socket.emit("leave_room");
    moveToHome();
  });

  refs.startGameBtn.addEventListener("click", () => {
    socket.emit("start_game");
    tryLockLandscape();
  });

  refs.restartBtn.addEventListener("click", () => {
    socket.emit("restart_game");
    refs.endOverlay.classList.add("hidden");
  });

  refs.closeRoomBtn.addEventListener("click", () => {
    socket.emit("close_room");
  });

  refs.maxPickupsSelect.addEventListener("change", emitRoomSettingsChange);
  refs.roundDurationSelect.addEventListener("change", emitRoomSettingsChange);
  refs.powerOptions.addEventListener("change", emitRoomSettingsChange);

  refs.cardSlots.forEach((slotButton) => {
    slotButton.addEventListener("click", () => {
      const slot = Number(slotButton.dataset.slot);
      useCard(slot);
    });
  });

  refs.canvas.addEventListener("mousemove", (event) => {
    const rect = refs.canvas.getBoundingClientRect();
    controls.mouseCanvasX = event.clientX - rect.left;
    controls.mouseCanvasY = event.clientY - rect.top;
  });

  window.addEventListener("keydown", (event) => {
    if (event.repeat) {
      return;
    }
    if (event.code in controls.keys) {
      controls.keys[event.code] = true;
    }
    if (event.code === "Space") {
      controls.queuedJump = true;
      event.preventDefault();
    }
    if (event.code === "KeyW" || event.code === "ArrowUp") {
      controls.queuedJump = true;
      event.preventDefault();
    }
    if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
      controls.queuedSlide = true;
      event.preventDefault();
    }
    if (event.code === "KeyS" || event.code === "ArrowDown") {
      controls.queuedSlide = true;
      event.preventDefault();
    }
    if (event.code === "Digit1") {
      useCard(0);
    } else if (event.code === "Digit2") {
      useCard(1);
    } else if (event.code === "Digit3") {
      useCard(2);
    }
  });

  window.addEventListener("keyup", (event) => {
    if (event.code in controls.keys) {
      controls.keys[event.code] = false;
    }
  });

  if (isTouchDevice) {
    setupMobileButtons();
  }

  window.addEventListener("resize", () => {
    updateOrientationOverlay();
    resizeCanvas();
  });
  window.addEventListener("orientationchange", () => {
    updateOrientationOverlay();
  });
}

function setupMobileButtons() {
  const resetDpadState = () => {
    controls.mobileMove.up = false;
    controls.mobileMove.left = false;
    controls.mobileMove.right = false;
    controls.mobileMove.down = false;
  };

  let dpadPointerId = null;
  const updateDpadFromPoint = (clientX, clientY) => {
    const target = document.elementFromPoint(clientX, clientY);
    const dpadButton = target?.closest?.(".dpad button");
    resetDpadState();
    if (!dpadButton || !refs.dpadRoot.contains(dpadButton)) {
      return;
    }
    const dir = dpadButton.dataset.move;
    if (dir in controls.mobileMove) {
      controls.mobileMove[dir] = true;
    }
  };

  refs.dpadRoot.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    dpadPointerId = event.pointerId;
    refs.dpadRoot.setPointerCapture(event.pointerId);
    updateDpadFromPoint(event.clientX, event.clientY);
  });

  refs.dpadRoot.addEventListener("pointermove", (event) => {
    if (event.pointerId !== dpadPointerId) {
      return;
    }
    event.preventDefault();
    updateDpadFromPoint(event.clientX, event.clientY);
  });

  const releaseDpad = (event) => {
    if (event.pointerId !== dpadPointerId) {
      return;
    }
    dpadPointerId = null;
    resetDpadState();
  };
  refs.dpadRoot.addEventListener("pointerup", releaseDpad);
  refs.dpadRoot.addEventListener("pointercancel", releaseDpad);
  refs.dpadRoot.addEventListener("lostpointercapture", () => {
    dpadPointerId = null;
    resetDpadState();
  });

  refs.jumpBtn.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    controls.queuedJump = true;
  });

  refs.slideBtn.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    controls.queuedSlide = true;
  });
}

function bindSocket() {
  socket.on("lobby_rooms", (rooms) => {
    state.lobbyRooms = rooms || [];
    updateRoomList();
  });

  socket.on("joined_room", ({ roomCode, playerId }) => {
    state.roomCode = roomCode;
    state.playerId = playerId;
    refs.roomCodeLabel.textContent = roomCode;
    setScreen("room");
  });

  socket.on("room_snapshot", (snapshot) => {
    state.snapshot = snapshot;
    state.roomCode = snapshot.roomCode;
    refs.roomCodeLabel.textContent = snapshot.roomCode;

    if (snapshot.state === "waiting") {
      setScreen("room");
      refs.endOverlay.classList.add("hidden");
      renderRoomWaiting(snapshot);
    } else {
      setScreen("game");
      renderEndOverlay(snapshot);
    }

    updateCardsFromSnapshot();
    updateHudFromSnapshot();
  });

  socket.on("error_message", (message) => {
    window.alert(message);
  });

  socket.on("room_closed", (message) => {
    window.alert(message || "Sala encerrada.");
    moveToHome();
  });
}

function renderRoomWaiting(snapshot) {
  const meIsHost = state.playerId && state.playerId === snapshot.hostId;
  const roundMinutes = Math.round((snapshot.settings?.roundDurationSeconds || 120) / 60);
  const maxPickups = snapshot.settings?.maxPickups || 6;
  refs.roomStatus.textContent = `Jogadores: ${snapshot.players.length}/6. Poderes no mapa: ${maxPickups}. Tempo: ${roundMinutes} min.`;
  refs.hostControls.classList.toggle("hidden", !meIsHost);
  refs.roomSettings.classList.toggle("readonly", !meIsHost);
  syncRoomSettingsUI(snapshot, meIsHost);

  refs.roomPlayers.innerHTML = "";
  for (const player of snapshot.players) {
    const li = document.createElement("li");
    const hostTag = player.id === snapshot.hostId ? " (host)" : "";
    li.textContent = `${player.name}${hostTag}`;
    refs.roomPlayers.appendChild(li);
  }
}

function syncRoomSettingsUI(snapshot, isHost) {
  const settings = snapshot.settings || {};
  const allowedCards = new Set(settings.allowedCards || Object.keys(CARD_ICONS));

  syncingRoomSettings = true;
  refs.maxPickupsSelect.value = String(settings.maxPickups || 6);
  refs.roundDurationSelect.value = String(settings.roundDurationSeconds || 120);

  const inputs = refs.powerOptions.querySelectorAll("input[type='checkbox']");
  inputs.forEach((input) => {
    input.checked = allowedCards.has(input.dataset.card);
    input.disabled = !isHost;
  });

  refs.maxPickupsSelect.disabled = !isHost;
  refs.roundDurationSelect.disabled = !isHost;
  syncingRoomSettings = false;
}

function emitRoomSettingsChange() {
  if (syncingRoomSettings || !state.snapshot || !state.playerId) {
    return;
  }

  if (state.playerId !== state.snapshot.hostId || state.snapshot.state !== "waiting") {
    return;
  }

  const allowedCards = [...refs.powerOptions.querySelectorAll("input[type='checkbox']:checked")].map(
    (input) => input.dataset.card
  );

  if (allowedCards.length === 0) {
    syncRoomSettingsUI(state.snapshot, true);
    return;
  }

  socket.emit("update_room_settings", {
    maxPickups: Number(refs.maxPickupsSelect.value),
    roundDurationSeconds: Number(refs.roundDurationSelect.value),
    allowedCards
  });
}

function renderEndOverlay(snapshot) {
  if (snapshot.state !== "ended") {
    refs.endOverlay.classList.add("hidden");
    return;
  }

  refs.endOverlay.classList.remove("hidden");
  refs.rankingList.innerHTML = "";
  snapshot.ranking.forEach((entry) => {
    const li = document.createElement("li");
    li.textContent = `${entry.name} - ${entry.kills} kill(s)`;
    refs.rankingList.appendChild(li);
  });

  const meIsHost = state.playerId && state.playerId === snapshot.hostId;
  refs.endHostControls.classList.toggle("hidden", !meIsHost);
}

function setScreen(name) {
  if (state.activeScreen === name) {
    return;
  }
  state.activeScreen = name;
  refs.homeScreen.classList.toggle("hidden", name !== "home");
  refs.roomScreen.classList.toggle("hidden", name !== "room");
  refs.gameScreen.classList.toggle("hidden", name !== "game");
  resizeCanvas();
}

function moveToHome() {
  state.roomCode = null;
  state.snapshot = null;
  state.playerId = null;
  setScreen("home");
}

function updateRoomList() {
  refs.roomList.innerHTML = "";

  if (!state.lobbyRooms.length) {
    const empty = document.createElement("div");
    empty.textContent = "Nenhuma sala aberta no momento.";
    refs.roomList.appendChild(empty);
    return;
  }

  state.lobbyRooms.forEach((room) => {
    const row = document.createElement("div");
    row.className = "room-entry";
    row.innerHTML = `
      <span>Sala <strong>${room.roomCode}</strong> (${room.players}/${room.maxPlayers})</span>
      <button data-code="${room.roomCode}">Entrar</button>
    `;
    const joinBtn = row.querySelector("button");
    joinBtn.addEventListener("click", () => {
      socket.emit("join_room", {
        roomCode: room.roomCode,
        name: getPlayerName()
      });
      tryLockLandscape();
    });
    refs.roomList.appendChild(row);
  });
}

function getPlayerName() {
  const raw = refs.playerNameInput.value.trim();
  return raw || "Jogador";
}

function updateOrientationOverlay() {
  const block = isTouchDevice && window.innerHeight > window.innerWidth;
  refs.orientationOverlay.classList.toggle("hidden", !block);
}

async function tryLockLandscape() {
  if (!isTouchDevice || !screen.orientation || !screen.orientation.lock) {
    return;
  }
  try {
    await screen.orientation.lock("landscape");
  } catch (_err) {
    // ignored: browser/device can refuse orientation lock
  }
}

function getLocalPlayer() {
  if (!state.snapshot || !state.playerId) {
    return null;
  }
  return state.snapshot.players.find((player) => player.id === state.playerId) || null;
}

function resizeCanvas() {
  const rect = refs.canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  const targetWidth = Math.round(rect.width * dpr);
  const targetHeight = Math.round(rect.height * dpr);
  if (refs.canvas.width !== targetWidth || refs.canvas.height !== targetHeight) {
    refs.canvas.width = targetWidth;
    refs.canvas.height = targetHeight;
  }
  viewState.width = rect.width;
  viewState.height = rect.height;
  viewState.dpr = dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function sendInput() {
  if (!state.snapshot || state.activeScreen !== "game") {
    return;
  }
  if (isTouchDevice && window.innerHeight > window.innerWidth) {
    return;
  }

  const local = getLocalPlayer();
  if (!local || !local.alive) {
    controls.queuedJump = false;
    controls.queuedSlide = false;
    return;
  }

  let moveX = 0;
  if (controls.keys.KeyA || controls.keys.ArrowLeft) {
    moveX -= 1;
  }
  if (controls.keys.KeyD || controls.keys.ArrowRight) {
    moveX += 1;
  }

  if (isTouchDevice) {
    if (controls.mobileMove.left) {
      moveX -= 1;
    }
    if (controls.mobileMove.right) {
      moveX += 1;
    }
    if (controls.mobileMove.up) {
      controls.queuedJump = true;
    }
    if (controls.mobileMove.down) {
      controls.queuedSlide = true;
    }
  }

  const aim = getAimWorld(local);
  socket.emit("input_state", {
    moveX,
    jump: controls.queuedJump,
    slide: controls.queuedSlide,
    targetX: aim.x,
    targetY: aim.y
  });
  controls.queuedJump = false;
  controls.queuedSlide = false;
}

function useCard(slot) {
  if (!state.snapshot || state.activeScreen !== "game") {
    return;
  }
  const local = getLocalPlayer();
  if (!local || !local.alive) {
    return;
  }
  const aim = getAimWorld(local);
  socket.emit("use_card", { slot, targetX: aim.x, targetY: aim.y });
}

function getAimWorld(local) {
  if (isTouchDevice) {
    const nearestEnemy = findNearestEnemy(local);
    if (nearestEnemy) {
      return { x: nearestEnemy.x, y: nearestEnemy.y };
    }
    const moveX =
      (controls.mobileMove.right ? 1 : 0) - (controls.mobileMove.left ? 1 : 0) + local.facingX * 0.25;
    const moveY = (controls.mobileMove.down ? 1 : 0) - (controls.mobileMove.up ? 1 : 0);
    const mag = Math.hypot(moveX, moveY) || 1;
    return {
      x: local.x + (moveX / mag) * 180,
      y: local.y + (moveY / mag) * 180
    };
  }

  const worldW = state.snapshot.world.width;
  const worldH = state.snapshot.world.height;
  return {
    x: clamp(
      viewState.camX + (controls.mouseCanvasX - viewState.worldOffsetX) / Math.max(0.0001, viewState.worldScale),
      0,
      worldW
    ),
    y: clamp(
      viewState.camY + (controls.mouseCanvasY - viewState.worldOffsetY) / Math.max(0.0001, viewState.worldScale),
      0,
      worldH
    )
  };
}

function findNearestEnemy(local) {
  if (!state.snapshot) {
    return null;
  }
  let best = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const player of state.snapshot.players) {
    if (player.id === local.id || !player.alive) {
      continue;
    }
    const dx = player.x - local.x;
    const dy = player.y - local.y;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = player;
    }
  }
  return best;
}

function updateCardsFromSnapshot() {
  const local = getLocalPlayer();
  refs.cardSlots.forEach((slotButton, index) => {
    const img = slotButton.querySelector("img");
    const type = local ? local.inventory[index] : null;
    if (type && CARD_ICONS[type]) {
      img.src = CARD_ICONS[type];
      slotButton.classList.add("filled");
    } else {
      img.removeAttribute("src");
      slotButton.classList.remove("filled");
    }
  });
}

function updateHudFromSnapshot() {
  const snapshot = state.snapshot;
  const local = getLocalPlayer();
  if (!snapshot || !local) {
    return;
  }

  const healthRatio = clamp(local.health / local.maxHealth, 0, 1);
  refs.healthFill.style.transform = `scaleX(${healthRatio})`;
  refs.killsLabel.textContent = `Kills: ${local.kills}`;

  if (snapshot.state === "countdown") {
    refs.timerLabel.textContent = `Inicio em ${Math.ceil(snapshot.countdownRemaining)}`;
  } else {
    refs.timerLabel.textContent = formatSeconds(snapshot.roundRemaining);
  }
}

function renderFrame(now) {
  resizeCanvas();
  const snapshot = state.snapshot;

  if (state.activeScreen === "game" && snapshot) {
    drawGame(snapshot, now / 1000);
    updateHudFromSnapshot();
  }

  requestAnimationFrame(renderFrame);
}

function drawGame(snapshot, timeSeconds) {
  const local = getLocalPlayer();
  if (!local) {
    return;
  }

  const worldW = snapshot.world.width;
  const worldH = snapshot.world.height;
  const viewW = viewState.width;
  const viewH = viewState.height;

  const scale = Math.min(viewW / worldW, viewH / worldH);
  const drawW = worldW * scale;
  const drawH = worldH * scale;
  const offsetX = (viewW - drawW) / 2;
  const offsetY = (viewH - drawH) / 2;
  const camX = 0;
  const camY = 0;
  viewState.camX = camX;
  viewState.camY = camY;
  viewState.worldScale = scale;
  viewState.worldOffsetX = offsetX;
  viewState.worldOffsetY = offsetY;

  ctx.clearRect(0, 0, viewW, viewH);

  ctx.fillStyle = "#838b95";
  ctx.fillRect(0, 0, viewW, viewH);

  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);
  drawObstacles(snapshot.obstacles, camX, camY);
  drawPickups(snapshot.pickups, camX, camY);
  drawBullets(snapshot.bullets, camX, camY);
  drawBombs(snapshot.bombs, camX, camY);
  drawPlayers(snapshot.players, local.id, camX, camY, timeSeconds);
  ctx.restore();

  if (snapshot.state === "countdown") {
    drawCenterText(`Partida em ${Math.ceil(snapshot.countdownRemaining)}`);
  }
  if (snapshot.state === "ended") {
    drawCenterText("Rodada encerrada");
  }
}

function drawObstacles(obstacles, camX, camY) {
  for (const rect of obstacles) {
    ctx.fillStyle = "#141515";
    ctx.fillRect(rect.x - camX, rect.y - camY, rect.w, rect.h);
    ctx.fillStyle = "#5f6368";
    ctx.fillRect(rect.x - camX + 8, rect.y - camY + 8, rect.w - 16, rect.h - 16);
  }
}

function drawPickups(pickups, camX, camY) {
  for (const pickup of pickups) {
    const sx = pickup.x - camX;
    const sy = pickup.y - camY;
    ctx.fillStyle = "rgba(0, 0, 0, 0.24)";
    ctx.beginPath();
    ctx.arc(sx, sy, 20, 0, Math.PI * 2);
    ctx.fill();

    const icon = cardImages[pickup.type];
    if (icon && icon.complete) {
      ctx.drawImage(icon, sx - 16, sy - 22, 32, 44);
    } else {
      ctx.fillStyle = "#2fd3c6";
      ctx.fillRect(sx - 12, sy - 18, 24, 36);
    }
  }
}

function drawBullets(bullets, camX, camY) {
  ctx.fillStyle = "#ffe07c";
  for (const bullet of bullets) {
    const sx = bullet.x - camX;
    const sy = bullet.y - camY;
    ctx.beginPath();
    ctx.arc(sx, sy, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBombs(bombs, camX, camY) {
  for (const bomb of bombs) {
    const sx = bomb.x - camX;
    const sy = bomb.y - camY;
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(sx, sy + 8, 11, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#2e2e2e";
    ctx.beginPath();
    ctx.arc(sx, sy - bomb.z * 0.35, 8, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPlayers(players, localId, camX, camY, timeSeconds) {
  const sortedPlayers = [...players].sort((a, b) => a.y - b.y);
  for (const player of sortedPlayers) {
    const sx = player.x - camX;
    const sy = player.y - camY;

    drawHealthBar(sx, sy - 38, player.health / player.maxHealth);
    drawStickman(player, sx, sy, timeSeconds, player.id === localId);

    ctx.fillStyle = "#0a0a0a";
    ctx.font = "12px Trebuchet MS";
    ctx.textAlign = "center";
    ctx.fillText(player.name, sx, sy - 48);
  }
}

function drawStickman(player, x, y, timeSeconds, isLocal) {
  if (!player.alive) {
    ctx.strokeStyle = "#491219";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x - 11, y - 11);
    ctx.lineTo(x + 11, y + 11);
    ctx.moveTo(x + 11, y - 11);
    ctx.lineTo(x - 11, y + 11);
    ctx.stroke();
    return;
  }

  const facingSign = Math.sign(player.facingX) || 1;
  const isWalking = player.onGround && Math.abs(player.vx) > 20 && !player.sliding;
  const runCycle = isWalking ? Math.sin(timeSeconds * 13 + hashToOffset(player.id)) : 0;
  const armSwing = runCycle * 9;
  const legSwing = runCycle * 11;
  const lean = player.sliding ? 0.55 * facingSign : player.jumping ? -0.2 : 0;
  const jumpLift = player.jumping ? -8 : 0;

  const bodyTopY = y - 21 + jumpLift;
  const bodyBottomY = y + 3 + jumpLift;
  const headY = y - 30 + jumpLift;

  if (player.speedBuff) {
    ctx.strokeStyle = "rgba(47, 211, 198, 0.65)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y - 4, 23, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (isLocal) {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y - 5, 24, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.strokeStyle = "#090909";
  ctx.lineWidth = 4;

  ctx.beginPath();
  ctx.arc(x, headY, 10, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x, bodyTopY);
  ctx.lineTo(x + lean * 14, bodyBottomY);
  ctx.stroke();

  const armY = bodyTopY + 10;
  ctx.beginPath();
  ctx.moveTo(x + lean * 6, armY);
  ctx.lineTo(x - 12 * facingSign, armY + armSwing);
  ctx.moveTo(x + lean * 6, armY);
  ctx.lineTo(x + 12 * facingSign, armY - armSwing);
  ctx.stroke();

  const hipX = x + lean * 12;
  ctx.beginPath();
  if (player.sliding) {
    ctx.moveTo(hipX, bodyBottomY);
    ctx.lineTo(hipX + 16 * facingSign, bodyBottomY + 9);
    ctx.moveTo(hipX, bodyBottomY);
    ctx.lineTo(hipX - 10 * facingSign, bodyBottomY + 15);
  } else {
    ctx.moveTo(hipX, bodyBottomY);
    ctx.lineTo(hipX - 8 * facingSign, bodyBottomY + 20 + legSwing);
    ctx.moveTo(hipX, bodyBottomY);
    ctx.lineTo(hipX + 8 * facingSign, bodyBottomY + 20 - legSwing);
  }
  ctx.stroke();
}

function drawHealthBar(x, y, ratio) {
  ctx.fillStyle = "rgba(0, 0, 0, 0.48)";
  ctx.fillRect(x - 18, y, 36, 6);
  ctx.fillStyle = ratio < 0.35 ? "#f55562" : "#59e28b";
  ctx.fillRect(x - 18, y, 36 * clamp(ratio, 0, 1), 6);
}

function drawCenterText(text) {
  ctx.fillStyle = "rgba(0, 0, 0, 0.48)";
  ctx.fillRect(viewState.width / 2 - 130, 30, 260, 48);
  ctx.fillStyle = "#f6fbff";
  ctx.textAlign = "center";
  ctx.font = "700 26px Trebuchet MS";
  ctx.fillText(text, viewState.width / 2, 62);
}

function formatSeconds(value) {
  const total = Math.max(0, Math.ceil(value));
  const minutes = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (total % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function hashToOffset(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash % 1000;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
