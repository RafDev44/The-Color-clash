const colors = ["red", "blue", "green", "yellow"];

const lobbyEl = document.querySelector("#lobby");
const gameTableEl = document.querySelector("#gameTable");
const roomCodeInput = document.querySelector("#roomCodeInput");
const playerNameInput = document.querySelector("#playerNameInput");
const createRoomButton = document.querySelector("#createRoomButton");
const joinRoomButton = document.querySelector("#joinRoomButton");
const startRoomButton = document.querySelector("#startRoomButton");
const leaveRoomButton = document.querySelector("#leaveRoomButton");
const lobbyMessageEl = document.querySelector("#lobbyMessage");
const roomInfoEl = document.querySelector("#roomInfo");
const playersWaitingEl = document.querySelector("#playersWaiting");

const opponentsEl = document.querySelector("#opponents");
const playerHandEl = document.querySelector("#playerHand");
const deckCountEl = document.querySelector("#deckCount");
const playerCountEl = document.querySelector("#playerCount");
const playerNameEl = document.querySelector("#playerName");
const messageEl = document.querySelector("#message");
const turnBadgeEl = document.querySelector("#turnBadge");
const drawButton = document.querySelector("#drawButton");
const sayClashButton = document.querySelector("#sayClashButton");
const newGameButton = document.querySelector("#newGameButton");
const colorDialog = document.querySelector("#colorDialog");

let session = JSON.parse(localStorage.getItem("colorClashSession") || "null");
let latestState = null;
let awaitingColorCard = null;
let pollTimer = null;

function saveSession(nextSession) {
  session = nextSession;
  localStorage.setItem("colorClashSession", JSON.stringify(session));
}

function clearSession(note = "Session cleared. Create or join a room.") {
  window.clearInterval(pollTimer);
  localStorage.removeItem("colorClashSession");
  session = null;
  latestState = null;
  roomCodeInput.value = "";
  showLobby(note);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Something went wrong.");
  }
  return data;
}

async function createRoom() {
  try {
    const name = cleanName();
    const data = await api("/api/create", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    saveSession(data);
    setLobbyMessage(`Room ${data.roomCode} created. Share this code.`);
    await loadState();
    startPolling();
  } catch (error) {
    setLobbyMessage(error.message);
  }
}

async function joinRoom() {
  try {
    const name = cleanName();
    const roomCode = roomCodeInput.value.trim().toUpperCase();
    const data = await api("/api/join", {
      method: "POST",
      body: JSON.stringify({ name, roomCode }),
    });
    saveSession(data);
    setLobbyMessage(`Joined room ${data.roomCode}.`);
    await loadState();
    startPolling();
  } catch (error) {
    setLobbyMessage(error.message);
  }
}

async function startRoom() {
  await sendAction("start");
}

async function loadState() {
  if (!session) {
    showLobby();
    return;
  }

  try {
    latestState = await api(`/api/state?room=${session.roomCode}&player=${session.playerId}`);
    render();
  } catch (error) {
    clearSession(`${error.message} Create a new room or enter the current room code again.`);
  }
}

function startPolling() {
  window.clearInterval(pollTimer);
  pollTimer = window.setInterval(loadState, 700);
}

async function sendAction(type, payload = {}) {
  if (!session) return;
  try {
    await api("/api/action", {
      method: "POST",
      body: JSON.stringify({
        roomCode: session.roomCode,
        playerId: session.playerId,
        type,
        ...payload,
      }),
    });
    await loadState();
  } catch (error) {
    setMessage(error.message);
  }
}

function cleanName() {
  const name = playerNameInput.value.trim();
  if (!name) return "Player";
  return name.slice(0, 16);
}

function showLobby(note = "") {
  lobbyEl.hidden = false;
  gameTableEl.hidden = true;
  setLobbyMessage(note || "Create a room or join with a code.");
  playersWaitingEl.innerHTML = "";
  roomInfoEl.textContent = "";
}

function render() {
  if (!latestState) {
    showLobby();
    return;
  }

  lobbyEl.hidden = latestState.started;
  gameTableEl.hidden = !latestState.started;
  roomInfoEl.textContent = `Room ${latestState.roomCode}`;
  playersWaitingEl.innerHTML = latestState.players
    .map((player) => `<span>${escapeHtml(player.name)}${player.isYou ? " (you)" : ""}</span>`)
    .join("");
  startRoomButton.hidden = !latestState.isHost || latestState.started;
  startRoomButton.disabled = latestState.players.length < 2;

  if (!latestState.started) {
    setLobbyMessage(latestState.players.length < 2 ? "Waiting for at least 2 players." : "Ready to start.");
    return;
  }

  renderGame();
}

function renderGame() {
  const top = latestState.topCard;
  document.querySelector("#discardPile").replaceWith(createCardElement(top, { large: true, disabled: true }));
  document.querySelector(".discard-wrap .card").id = "discardPile";

  deckCountEl.textContent = latestState.deckCount;
  playerNameEl.textContent = latestState.you.name;
  playerCountEl.textContent = `${latestState.you.hand.length} card${latestState.you.hand.length === 1 ? "" : "s"}`;
  turnBadgeEl.textContent = latestState.isYourTurn ? "Your turn" : `${latestState.currentPlayerName}'s turn`;
  setMessage(latestState.message);

  opponentsEl.innerHTML = "";
  latestState.players
    .filter((player) => !player.isYou)
    .forEach((player) => {
      const opponent = document.createElement("article");
      opponent.className = `opponent ${player.isCurrent ? "active" : ""}`;
      opponent.innerHTML = `
        <div>
          <strong>${escapeHtml(player.name)}</strong>
          <span>${player.cardCount} card${player.cardCount === 1 ? "" : "s"}</span>
        </div>
        <div class="mini-cards">${Array.from({ length: Math.min(player.cardCount, 5) }, () => '<span class="mini-card"></span>').join("")}</div>
      `;
      opponentsEl.appendChild(opponent);
    });

  playerHandEl.innerHTML = "";
  latestState.you.hand.forEach((card, index) => {
    const playable = latestState.isYourTurn && card.playable;
    const cardEl = createCardElement(card, {
      playable,
      blocked: latestState.isYourTurn && !playable,
      disabled: !playable,
    });
    cardEl.addEventListener("click", () => handlePlayerCard(index));
    playerHandEl.appendChild(cardEl);
  });
}

function handlePlayerCard(cardIndex) {
  const card = latestState.you.hand[cardIndex];
  if (card.color === "wild") {
    awaitingColorCard = cardIndex;
    colorDialog.showModal();
    return;
  }
  sendAction("play", { cardIndex });
}

function createCardElement(card, options = {}) {
  const cardEl = document.createElement("button");
  cardEl.type = "button";
  cardEl.className = `card ${card.originalWild ? "wild" : card.color}`;
  if (options.large) cardEl.classList.add("large");
  if (options.playable) cardEl.classList.add("playable");
  if (options.blocked) cardEl.classList.add("blocked");
  cardEl.disabled = options.disabled || false;
  cardEl.setAttribute("aria-label", cardLabel(card));

  const label = card.value;
  cardEl.innerHTML = `
    <span class="corner">${label}</span>
    <span class="face">${label}</span>
    <span class="corner bottom">${label}</span>
  `;
  return cardEl;
}

function cardLabel(card) {
  if (card.originalWild) return `${card.value} as ${card.color}`;
  return `${card.color} ${card.value}`;
}

function setLobbyMessage(text) {
  lobbyMessageEl.textContent = text;
}

function setMessage(text) {
  messageEl.textContent = text;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

createRoomButton.addEventListener("click", createRoom);
joinRoomButton.addEventListener("click", joinRoom);
startRoomButton.addEventListener("click", startRoom);
leaveRoomButton.addEventListener("click", () => clearSession());
roomCodeInput.addEventListener("input", () => {
  roomCodeInput.value = roomCodeInput.value.toUpperCase();
});
drawButton.addEventListener("click", () => sendAction("draw"));
newGameButton.addEventListener("click", () => sendAction("restart"));
sayClashButton.addEventListener("click", () => sendAction("clash"));

colorDialog.addEventListener("close", () => {
  if (awaitingColorCard === null || !colorDialog.returnValue) {
    awaitingColorCard = null;
    return;
  }
  sendAction("play", { cardIndex: awaitingColorCard, color: colorDialog.returnValue });
  awaitingColorCard = null;
  colorDialog.returnValue = "";
});

if (session) {
  loadState().then(startPolling);
} else {
  showLobby();
}
