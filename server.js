const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const port = Number(process.env.PORT || 3000);
const publicDir = __dirname;
const colors = ["red", "blue", "green", "yellow"];
const values = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "Skip", "Reverse", "+2"];
const wilds = ["Wild", "+4"];
const rooms = new Map();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/api/create" && req.method === "POST") {
      const body = await readJson(req);
      const room = createRoom(body.name);
      sendJson(res, { roomCode: room.code, playerId: room.players[0].id });
      return;
    }

    if (url.pathname === "/api/join" && req.method === "POST") {
      const body = await readJson(req);
      const room = requireRoom(body.roomCode);
      if (room.started) throw httpError(400, "That room already started.");
      if (room.players.length >= 4) throw httpError(400, "That room is full.");
      const player = addPlayer(room, body.name);
      sendJson(res, { roomCode: room.code, playerId: player.id });
      return;
    }

    if (url.pathname === "/api/state" && req.method === "GET") {
      const room = requireRoom(url.searchParams.get("room"));
      const player = requirePlayer(room, url.searchParams.get("player"));
      sendJson(res, viewState(room, player.id));
      return;
    }

    if (url.pathname === "/api/action" && req.method === "POST") {
      const body = await readJson(req);
      const room = requireRoom(body.roomCode);
      const player = requirePlayer(room, body.playerId);
      handleAction(room, player, body);
      sendJson(res, viewState(room, player.id));
      return;
    }

    serveStatic(url.pathname, res);
  } catch (error) {
    sendJson(res, { error: error.message || "Server error." }, error.status || 500);
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Color Clash server running at http://localhost:${port}`);
  for (const address of localAddresses()) {
    console.log(`LAN address: http://${address}:${port}`);
  }
});

function createRoom(name) {
  let code = "";
  do {
    code = Math.random().toString(36).slice(2, 6).toUpperCase();
  } while (rooms.has(code));

  const room = {
    code,
    hostId: "",
    players: [],
    deck: [],
    discard: [],
    currentPlayer: 0,
    direction: 1,
    pendingDraw: 0,
    started: false,
    gameOver: false,
    message: "Waiting for players.",
  };
  const host = addPlayer(room, name);
  room.hostId = host.id;
  rooms.set(code, room);
  return room;
}

function addPlayer(room, name) {
  const player = {
    id: cryptoId(),
    name: cleanName(name),
    hand: [],
    announcedClash: false,
    hasDrawnThisTurn: false,
  };
  room.players.push(player);
  room.message = `${player.name} joined.`;
  return player;
}

function handleAction(room, player, action) {
  if (action.type === "start") {
    if (player.id !== room.hostId) throw httpError(403, "Only the host can start.");
    if (room.players.length < 2) throw httpError(400, "Need at least 2 players.");
    startGame(room);
    return;
  }

  if (action.type === "restart") {
    if (player.id !== room.hostId) throw httpError(403, "Only the host can restart.");
    startGame(room);
    return;
  }

  if (!room.started) throw httpError(400, "The room has not started yet.");
  if (room.gameOver) throw httpError(400, "The round is over.");
  if (room.players[room.currentPlayer].id !== player.id) throw httpError(403, "It is not your turn.");

  if (action.type === "draw") {
    drawForPlayer(room, player);
    return;
  }

  if (action.type === "play") {
    playCard(room, player, Number(action.cardIndex), action.color);
    return;
  }

  if (action.type === "clash") {
    if (player.hand.length === 1) {
      player.announcedClash = true;
      room.message = `${player.name} called CLASH.`;
    } else {
      player.hand.push(drawCard(room), drawCard(room));
      room.message = `${player.name} called CLASH too early and drew 2.`;
    }
  }
}

function startGame(room) {
  room.deck = createDeck();
  room.discard = [];
  room.currentPlayer = 0;
  room.direction = 1;
  room.pendingDraw = 0;
  room.started = true;
  room.gameOver = false;
  room.players.forEach((player) => {
    player.hand = [];
    player.announcedClash = false;
    player.hasDrawnThisTurn = false;
  });

  for (let round = 0; round < 7; round += 1) {
    room.players.forEach((player) => player.hand.push(drawCard(room)));
  }

  let firstCard = drawCard(room);
  while (firstCard.color === "wild" || isAction(firstCard)) {
    room.deck.unshift(firstCard);
    room.deck = shuffle(room.deck);
    firstCard = drawCard(room);
  }
  room.discard.push(firstCard);
  room.message = `${room.players[0].name} starts.`;
}

function playCard(room, player, cardIndex, chosenColor) {
  const card = player.hand[cardIndex];
  if (!card) throw httpError(400, "Card not found.");
  if (!isPlayable(room, card)) throw httpError(400, "That card cannot be played now.");

  if (player.hand.length === 1 && !player.announcedClash) {
    player.hand.push(drawCard(room), drawCard(room));
    room.message = `${player.name} forgot to call CLASH and drew 2.`;
    return;
  }

  player.hand.splice(cardIndex, 1);
  const playedCard = { ...card };
  if (playedCard.color === "wild") {
    playedCard.color = colors.includes(chosenColor) ? chosenColor : pickBestColor(player.hand);
    playedCard.originalWild = true;
  }
  room.discard.push(playedCard);
  player.hasDrawnThisTurn = false;
  if (player.hand.length !== 1) player.announcedClash = false;

  if (player.hand.length === 0) {
    room.gameOver = true;
    room.message = `${player.name} won the round.`;
    return;
  }

  applyAction(room, playedCard, player);
}

function drawForPlayer(room, player) {
  if (room.pendingDraw > 0) {
    const amount = room.pendingDraw;
    for (let i = 0; i < amount; i += 1) player.hand.push(drawCard(room));
    room.pendingDraw = 0;
    player.hasDrawnThisTurn = false;
    player.announcedClash = false;
    room.message = `${player.name} drew ${amount} cards.`;
    advanceTurn(room, 1);
    return;
  }

  if (player.hasDrawnThisTurn) {
    player.hasDrawnThisTurn = false;
    player.announcedClash = false;
    room.message = `${player.name} passed.`;
    advanceTurn(room, 1);
    return;
  }

  const card = drawCard(room);
  player.hand.push(card);
  player.hasDrawnThisTurn = true;
  room.message = isPlayable(room, card) ? `${player.name} drew a playable card.` : `${player.name} drew a card. Draw again to pass.`;
}

function applyAction(room, card, player) {
  let steps = 1;

  if (card.value === "Reverse") {
    room.direction *= -1;
    if (room.players.length === 2) steps = 2;
    room.message = `${player.name} reversed direction.`;
  } else if (card.value === "Skip") {
    room.message = `${nextPlayer(room).name} was skipped.`;
    steps = 2;
  } else if (card.value === "+2") {
    room.pendingDraw += 2;
    room.message = `${nextPlayer(room).name} must stack a draw card or take ${room.pendingDraw}.`;
  } else if (card.value === "+4") {
    room.pendingDraw += 4;
    room.message = `${nextPlayer(room).name} must stack a draw card or take ${room.pendingDraw}.`;
  } else {
    room.message = `${player.name} played ${cardLabel(card)}.`;
  }

  advanceTurn(room, steps);
}

function createDeck() {
  const cards = [];
  colors.forEach((color) => {
    cards.push({ color, value: "0" });
    values.slice(1).forEach((value) => {
      cards.push({ color, value }, { color, value });
    });
  });

  for (let i = 0; i < 4; i += 1) {
    wilds.forEach((value) => cards.push({ color: "wild", value }));
  }

  return shuffle(cards);
}

function drawCard(room) {
  if (!room.deck.length) {
    const top = room.discard.pop();
    room.deck = shuffle(room.discard);
    room.discard = [top];
  }
  return room.deck.pop();
}

function isPlayable(room, card) {
  const top = topCard(room);
  if (room.pendingDraw > 0) {
    return card.value === "+2" || card.value === "+4";
  }
  return card.color === "wild" || card.color === top.color || card.value === top.value;
}

function viewState(room, playerId) {
  const player = requirePlayer(room, playerId);
  return {
    roomCode: room.code,
    isHost: room.hostId === playerId,
    started: room.started,
    deckCount: room.deck.length,
    topCard: room.started ? topCard(room) : null,
    currentPlayerName: room.started ? room.players[room.currentPlayer].name : "",
    isYourTurn: room.started && room.players[room.currentPlayer].id === playerId && !room.gameOver,
    message: room.message,
    you: {
      name: player.name,
      hand: player.hand.map((card) => ({ ...card, playable: room.started && !room.gameOver && room.players[room.currentPlayer].id === playerId && isPlayable(room, card) })),
    },
    players: room.players.map((nextPlayer) => ({
      name: nextPlayer.name,
      cardCount: nextPlayer.hand.length,
      isYou: nextPlayer.id === playerId,
      isCurrent: room.started && room.players[room.currentPlayer].id === nextPlayer.id,
    })),
  };
}

function serveStatic(urlPath, res) {
  const requested = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.normalize(path.join(publicDir, requested));
  if (!filePath.startsWith(publicDir)) throw httpError(403, "Forbidden.");

  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendJson(res, { error: "Not found." }, 404);
      return;
    }
    res.writeHead(200, { "Content-Type": contentType(filePath) });
    res.end(content);
  });
}

function topCard(room) {
  return room.discard[room.discard.length - 1];
}

function nextPlayer(room) {
  return room.players[wrapIndex(room, room.currentPlayer + room.direction)];
}

function advanceTurn(room, steps) {
  room.players[room.currentPlayer].hasDrawnThisTurn = false;
  room.currentPlayer = wrapIndex(room, room.currentPlayer + room.direction * steps);
}

function wrapIndex(room, index) {
  return (index + room.players.length) % room.players.length;
}

function isAction(card) {
  return ["Skip", "Reverse", "+2", "+4"].includes(card.value);
}

function cardLabel(card) {
  if (card.originalWild) return `${card.value} as ${card.color}`;
  return `${card.color} ${card.value}`;
}

function pickBestColor(hand) {
  const counts = Object.fromEntries(colors.map((color) => [color, 0]));
  hand.forEach((card) => {
    if (counts[card.color] !== undefined) counts[card.color] += 1;
  });
  return colors.reduce((best, color) => (counts[color] > counts[best] ? color : best), "red");
}

function shuffle(cards) {
  const copy = [...cards];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function cleanName(name) {
  const value = String(name || "Player").trim().slice(0, 16);
  return value || "Player";
}

function requireRoom(code) {
  const room = rooms.get(String(code || "").trim().toUpperCase());
  if (!room) throw httpError(404, "Room not found.");
  return room;
}

function requirePlayer(room, id) {
  const player = room.players.find((candidate) => candidate.id === id);
  if (!player) throw httpError(404, "Player not found in this room.");
  return player;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10000) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(httpError(400, "Invalid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function cryptoId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function contentType(filePath) {
  const ext = path.extname(filePath);
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
  }[ext] || "application/octet-stream";
}

function localAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((item) => item && item.family === "IPv4" && !item.internal)
    .map((item) => item.address);
}
