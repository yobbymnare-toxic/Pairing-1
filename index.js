require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, delay } = require('@whiskeysockets/baileys');
const path = require('path');
const fs = require('fs');
const pino = require('pino');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const PORT = process.env.PORT || 3000;
const GROUP_INVITE = 'https://chat.whatsapp.com/Ksmby6VkxI85nGS1SML5w0';

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const activeSessions = new Map();
const sessionsDir = path.join(__dirname, 'sessions');
if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });

// Generate custom session ID: xtech-md2026[random 16 alphanumeric]
function generateSessionId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let random = '';
  for (let i = 0; i < 16; i++) {
    random += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return 'xtech-md2026' + random;
}

function saveSessionId(socketId, sessionId, credsData) {
  const sessionFile = path.join(__dirname, 'sessions', socketId + '_session.json');
  fs.writeFileSync(sessionFile, JSON.stringify({
    sessionId: sessionId,
    creds: credsData,
    createdAt: new Date().toISOString()
  }, null, 2));
}

function cleanupSession(id) {
  const data = activeSessions.get(id);
  if (data) {
    try { data.sock.end(); } catch (e) {}
    try { fs.rmSync(data.sessionPath, { recursive: true, force: true }); } catch (e) {}
    activeSessions.delete(id);
  }
}

async function createConnection(socketId, phone) {
  const sessionPath = path.join(__dirname, 'sessions', socketId);
  if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });

  // Clean up old socket if exists
  const old = activeSessions.get(socketId);
  if (old && old.sock) {
    try { old.sock.end(); } catch (e) {}
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    browser: Browsers.macOS('Desktop'),
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 25000,
    markOnlineOnConnect: true,
    retryRequestDelayMs: 2500,
    maxMsgRetryCount: 3,
  });

  let reconnectCount = 0;
  const MAX_RECONNECT = 5;
  let pairCodeRequested = false;

  activeSessions.set(socketId, { sock, sessionPath, phone });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // When QR data is available, request pairing code (only once)
    if (qr && !pairCodeRequested) {
      pairCodeRequested = true;
      try {
        const clean = phone.replace(/[^0-9]/g, '');
        // Small delay to let connection stabilize
        await delay(1000);
        const code = await sock.requestPairingCode(clean);
        console.log('[XTECH_KE] Pairing code generated:', code);
        io.to(socketId).emit('pairing-code', code);
        io.to(socketId).emit('status', 'Enter this pairing code in WhatsApp');
      } catch (e) {
        console.error('[XTECH_KE] Pairing code error:', e.message);
        pairCodeRequested = false;
        // Try again after delay
        setTimeout(async () => {
          try {
            const clean = phone.replace(/[^0-9]/g, '');
            const code = await sock.requestPairingCode(clean);
            console.log('[XTECH_KE] Pairing code retry success:', code);
            io.to(socketId).emit('pairing-code', code);
            io.to(socketId).emit('status', 'Enter this pairing code in WhatsApp');
          } catch (e2) {
            console.error('[XTECH_KE] Pairing code retry failed:', e2.message);
            io.to(socketId).emit('error', 'Failed to get pairing code. Go back and try again.');
          }
        }, 3000);
      }
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const reason = lastDisconnect?.error?.message || 'Unknown';

      console.log('[XTECH_KE] Connection closed. Code:', statusCode, 'Reason:', reason);

      if (statusCode === DisconnectReason.loggedOut) {
        io.to(socketId).emit('connection-lost');
        cleanupSession(socketId);
        return;
      }

      reconnectCount++;
      if (reconnectCount > MAX_RECONNECT) {
        console.log('[XTECH_KE] Max reconnects reached for:', socketId);
        io.to(socketId).emit('error', 'Connection failed. Please go back and try again.');
        cleanupSession(socketId);
        return;
      }

      io.to(socketId).emit('status', 'Reconnecting... (attempt ' + reconnectCount + '/' + MAX_RECONNECT + ')');

      // Delay before reconnect
      await delay(3000);

      try {
        const { state: newState, saveCreds: newSave } = await useMultiFileAuthState(sessionPath);
        const newSock = makeWASocket({
          auth: newState,
          printQRInTerminal: false,
          logger: pino({ level: 'silent' }),
          browser: Browsers.macOS('Desktop'),
          connectTimeoutMs: 60000,
          defaultQueryTimeoutMs: 60000,
          keepAliveIntervalMs: 25000,
          markOnlineOnConnect: true,
        });

        newSock.ev.on('creds.update', newSave);
        activeSessions.set(socketId, { sock: newSock, sessionPath, phone });

        // Re-attach connection handler for the new socket
        newSock.ev.on('connection.update', async (newUpdate) => {
          const { connection: newConn, lastDisconnect: newLast, qr: newQr } = newUpdate;

          if (newQr && !pairCodeRequested) {
            pairCodeRequested = true;
            try {
              const clean = phone.replace(/[^0-9]/g, '');
              await delay(1000);
              const code = await newSock.requestPairingCode(clean);
              console.log('[XTECH_KE] Pairing code (reconnect):', code);
              io.to(socketId).emit('pairing-code', code);
              io.to(socketId).emit('status', 'Enter this pairing code in WhatsApp');
            } catch (e) {
              console.error('[XTECH_KE] Pairing code error on reconnect:', e.message);
              io.to(socketId).emit('error', 'Failed to get pairing code. Try again.');
            }
          }

          if (newConn === 'open') {
            await handleConnected(socketId, newSock, sessionPath);
          }

          if (newConn === 'close') {
            const sc = newLast?.error?.output?.statusCode;
            if (sc === DisconnectReason.loggedOut) {
              io.to(socketId).emit('connection-lost');
              cleanupSession(socketId);
            } else {
              // Try full reconnect via createConnection
              reconnectCount++;
              if (reconnectCount <= MAX_RECONNECT) {
                io.to(socketId).emit('status', 'Reconnecting...');
                await delay(3000);
                try { await createConnection(socketId, phone); } catch (e) {}
              } else {
                io.to(socketId).emit('error', 'Connection failed. Please try again.');
                cleanupSession(socketId);
              }
            }
          }
        });

      } catch (reconnErr) {
        console.error('[XTECH_KE] Reconnect error:', reconnErr.message);
        io.to(socketId).emit('error', 'Reconnection failed. Please try again.');
        cleanupSession(socketId);
      }
    }

    if (connection === 'open') {
      await handleConnected(socketId, sock, sessionPath);
    }
  });

  return sock;
}

async function handleConnected(socketId, sock, sessionPath) {
  try {
    const sessionId = generateSessionId();

    // Auto-join group
    try {
      const groupCode = GROUP_INVITE.split('/').pop();
      await sock.groupAcceptInvite(groupCode);
      console.log('[XTECH_KE] Auto-joined group:', groupCode);
    } catch (ge) {
      console.error('[XTECH_KE] Group join error:', ge.message);
    }

    // Get user JID
    const userJid = sock.user.id;

    // Message 1
    try {
      await sock.sendMessage(userJid, {
        text: 'WELCOME TO THE SWEET TECH IN KENYA  ✅🤝 *XTECH-XD*\nYour session Id is'
      });
      console.log('[XTECH_KE] Welcome message sent');
    } catch (me) {
      console.error('[XTECH_KE] Message 1 error:', me.message);
    }

    // Message 2 (session ID only)
    try {
      await sock.sendMessage(userJid, { text: sessionId });
      console.log('[XTECH_KE] Session ID sent');
    } catch (me2) {
      console.error('[XTECH_KE] Message 2 error:', me2.message);
    }

    // Save session
    const credsPath = path.join(sessionPath, 'creds.json');
    let credsData = '';
    if (fs.existsSync(credsPath)) {
      credsData = fs.readFileSync(credsPath, 'utf-8');
    }
    saveSessionId(socketId, sessionId, credsData);

    // Send to frontend
    io.to(socketId).emit('connected', sessionId);

  } catch (err) {
    console.error('[XTECH_KE] Post-connect error:', err);
    io.to(socketId).emit('error', 'Connected but failed setup');
  }
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'online', bot: 'XTECH_KE', version: '1.0.0' });
});

io.on('connection', (socket) => {
  console.log('[XTECH_KE] Client connected:', socket.id);

  socket.on('start-pair', async (phoneNumber) => {
    if (!phoneNumber || phoneNumber.length < 10) {
      io.to(socket.id).emit('error', 'Enter a valid phone number');
      return;
    }
    try {
      io.to(socket.id).emit('status', 'Requesting pairing code...');
      await createConnection(socket.id, phoneNumber);
    } catch (e) {
      console.error('[XTECH_KE] Start pair error:', e.message);
      io.to(socket.id).emit('error', 'Failed to start pairing. Try again.');
    }
  });

  socket.on('disconnect', () => {
    console.log('[XTECH_KE] Client disconnected:', socket.id);
    const sid = socket.id;
    setTimeout(() => {
      const stillConnected = [...io.sockets.sockets.values()].some(s => s.id === sid);
      if (!stillConnected) cleanupSession(sid);
    }, 15000);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  =========================================');
  console.log('     XTECH_KE Pairing Server');
  console.log('     Running on http://0.0.0.0:' + PORT);
  console.log('     Ready for WhatsApp Pairing');
  console.log('  =========================================');
  console.log('');
});

process.on('SIGINT', () => {
  for (const [id] of activeSessions) cleanupSession(id);
  server.close();
  process.exit(0);
});

process.on('uncaughtException', (err) => console.error('Uncaught:', err));
process.on('unhandledRejection', (err) => console.error('Unhandled:', err));
