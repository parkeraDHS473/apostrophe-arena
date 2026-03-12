const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ── Serve static files (the game HTML) ──
app.use(express.static(path.join(__dirname, 'public')));

// ── In-memory rooms ──
// rooms[code] = {
//   host: ws,
//   players: { id: { ws, name, score } },
//   state: { phase, questions, currentQ, timePerQ, answers }
// }
const rooms = {};

function send(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function broadcast(room, obj, excludeWs = null) {
  const msg = JSON.stringify(obj);
  // Send to all players
  Object.values(room.players).forEach(({ ws }) => {
    if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
  // Also send to host if not excluded
  if (room.host && room.host !== excludeWs && room.host.readyState === WebSocket.OPEN) {
    room.host.send(msg);
  }
}

function getRoomSummary(room) {
  return {
    phase: room.state.phase,
    players: Object.entries(room.players).reduce((acc, [id, p]) => {
      acc[id] = { name: p.name, score: p.score, answered: p.answered || false };
      return acc;
    }, {}),
    currentQ: room.state.currentQ,
    totalQ: room.state.questions ? room.state.questions.length : 0,
    timePerQ: room.state.timePerQ,
    answers: room.state.answers || {},
  };
}

wss.on('connection', (ws) => {
  let myRoom = null;
  let myId = null;
  let isHost = false;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // ── HOST: Create room ──
    if (msg.type === 'host_create') {
      const code = Math.random().toString(36).substr(2, 4).toUpperCase();
      const room = {
        host: ws,
        players: {},
        state: {
          phase: 'lobby',
          questions: msg.questions,
          currentQ: 0,
          timePerQ: msg.timePerQ || 20,
          mode: msg.mode || 'blitz',
          answers: {},
        },
        timerTimeout: null,
      };
      rooms[code] = room;
      myRoom = room;
      myId = 'host';
      isHost = true;

      // Add host as a player too
      room.players['host'] = { ws, name: msg.name, score: 0, answered: false };

      send(ws, { type: 'room_created', code, id: 'host', mode: room.state.mode });
      send(ws, { type: 'state', summary: getRoomSummary(room) });
      console.log(`Room ${code} created by ${msg.name}`);
    }

    // ── PLAYER: Join room ──
    else if (msg.type === 'join') {
      const code = msg.code.toUpperCase();
      const room = rooms[code];

      if (!room) {
        send(ws, { type: 'error', message: 'Room not found' });
        return;
      }
      if (room.state.phase !== 'lobby') {
        send(ws, { type: 'error', message: 'Game already in progress' });
        return;
      }

      const id = 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
      myRoom = room;
      myId = id;
      isHost = false;

      room.players[id] = { ws, name: msg.name, score: 0, answered: false };

      send(ws, { type: 'joined', id, code });
      broadcast(room, { type: 'state', summary: getRoomSummary(room) });
      console.log(`${msg.name} joined room ${code}`);
    }

    // ── HOST: Start game ──
    else if (msg.type === 'host_start') {
      if (!myRoom || !isHost) return;
      myRoom.state.phase = 'question';
      myRoom.state.currentQ = 0;
      myRoom.state.answers = {};
      Object.values(myRoom.players).forEach(p => p.answered = false);

      const q = shuffleQuestion(myRoom.state.questions[0]);
      myRoom.state.currentShuffledAns = q.ans;
      broadcast(myRoom, {
        type: 'question',
        index: 0,
        total: myRoom.state.questions.length,
        timePerQ: myRoom.state.timePerQ,
        mode: myRoom.state.mode,
        cat: q.cat,
        text: q.q,
        choices: q.ch,
        summary: getRoomSummary(myRoom),
      });

      startTimer(myRoom);
      console.log(`Room ${Object.keys(rooms).find(k => rooms[k] === myRoom)} game started`);
    }

    // ── PLAYER/HOST: Submit answer ──
    else if (msg.type === 'answer') {
      if (!myRoom || !myId) return;
      if (myRoom.state.answers[myId]) return; // already answered

      const correctAns = myRoom.state.currentShuffledAns ?? myRoom.state.questions[myRoom.state.currentQ].ans;
      const correct = msg.choice === correctAns;
      const timeBonus = Math.max(0, msg.timeLeft || 0);
      const pts = correct ? 100 + timeBonus * 5 : 0;

      myRoom.state.answers[myId] = { choice: msg.choice, correct, pts };
      myRoom.players[myId].answered = true;
      if (correct) myRoom.players[myId].score += pts;

      // Tell everyone about updated answer count + scores
      broadcast(myRoom, { type: 'state', summary: getRoomSummary(myRoom) });

      // If all players answered, auto-reveal
      const total = Object.keys(myRoom.players).length;
      const answered = Object.keys(myRoom.state.answers).length;
      if (answered >= total) {
        if (myRoom.timerTimeout) clearTimeout(myRoom.timerTimeout);
        revealAnswer(myRoom);
      }
    }

    // ── HOST: Force reveal (manual) ──
    else if (msg.type === 'host_reveal') {
      if (!myRoom || !isHost) return;
      if (myRoom.timerTimeout) clearTimeout(myRoom.timerTimeout);
      revealAnswer(myRoom);
    }

    // ── HOST: Next question ──
    else if (msg.type === 'host_next') {
      if (!myRoom || !isHost) return;
      const next = myRoom.state.currentQ + 1;

      if (next >= myRoom.state.questions.length) {
        // Game over
        myRoom.state.phase = 'results';
        broadcast(myRoom, {
          type: 'results',
          summary: getRoomSummary(myRoom),
        });
      } else {
        myRoom.state.currentQ = next;
        myRoom.state.phase = 'question';
        myRoom.state.answers = {};
        Object.values(myRoom.players).forEach(p => p.answered = false);

        const q = shuffleQuestion(myRoom.state.questions[next]);
        myRoom.state.currentShuffledAns = q.ans;
        broadcast(myRoom, {
          type: 'question',
          index: next,
          total: myRoom.state.questions.length,
          timePerQ: myRoom.state.timePerQ,
          mode: myRoom.state.mode,
          cat: q.cat,
          text: q.q,
          choices: q.ch,
          summary: getRoomSummary(myRoom),
        });

        startTimer(myRoom);
      }
    }
  });

  ws.on('close', () => {
    if (!myRoom || !myId) return;
    delete myRoom.players[myId];

    if (isHost) {
      // Host left — notify everyone and clean up
      broadcast(myRoom, { type: 'error', message: 'Host disconnected. Game ended.' });
      const code = Object.keys(rooms).find(k => rooms[k] === myRoom);
      if (code) delete rooms[code];
    } else {
      broadcast(myRoom, { type: 'state', summary: getRoomSummary(myRoom) });
    }
  });
});

// ── Shuffle choices so correct answer isn't always in same position ──
function shuffleQuestion(q) {
  const indices = [0, 1, 2, 3];
  // Fisher-Yates shuffle
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const shuffledChoices = indices.map(i => q.ch[i]);
  const newAns = indices.indexOf(q.ans);
  return { ...q, ch: shuffledChoices, ans: newAns };
}

// ── Timer helper ──
function startTimer(room) {
  if (room.timerTimeout) clearTimeout(room.timerTimeout);
  room.timerTimeout = setTimeout(() => {
    revealAnswer(room);
  }, room.state.timePerQ * 1000 + 500); // +500ms grace
}

// ── Reveal answer + award scores ──
function revealAnswer(room) {
  if (room.state.phase === 'reveal') return;
  room.state.phase = 'reveal';

  const q = room.state.questions[room.state.currentQ];
  const correctIndex = room.state.currentShuffledAns ?? q.ans;

  broadcast(room, {
    type: 'reveal',
    correctIndex,
    rule: q.rule,
    exp: q.exp,
    answers: room.state.answers,
    summary: getRoomSummary(room),
  });
}

// ── Cleanup empty rooms after 2 hours ──
setInterval(() => {
  const now = Date.now();
  Object.entries(rooms).forEach(([code, room]) => {
    if (Object.keys(room.players).length === 0) {
      delete rooms[code];
      console.log(`Cleaned up empty room ${code}`);
    }
  });
}, 1000 * 60 * 30);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Apostrophe Arena running on port ${PORT}`));
