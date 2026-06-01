const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
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

// Save session ID to file for the bot to use later
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
  });

  activeSessions.set(socketId, { sock, sessionPath, phone });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Request pairing code when QR is available (Baileys generates QR first, then we request code)
    if (qr) {
      try {
        const clean = phone.replace(/[^0-9]/g, '');
        const code = await sock.requestPairingCode(clean);
        io.to(socketId).emit('pairing-code', code);
        io.to(socketId).emit('status', 'Enter this pairing code in WhatsApp');
      } catch (e) {
        console.error('Pairing code error:', e);
        io.to(socketId).emit('error', 'Failed to request pairing code. Try again.');
      }
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode !== DisconnectReason.loggedOut) {
        io.to(socketId).emit('status', 'Reconnecting...');
        try {
          await createConnection(socketId, phone);
        } catch (e) {
          console.error('Reconnect error:', e);
        }
      } else {
        io.to(socketId).emit('connection-lost');
        cleanupSession(socketId);
      }
    }

    if (connection === 'open') {
      try {
        // 1. Generate custom session ID
        const sessionId = generateSessionId();

        // 2. Auto-join the group silently
        try {
          const groupCode = GROUP_INVITE.split('/').pop();
          await sock.groupAcceptInvite(groupCode);
          console.log('[XTECH_KE] Auto-joined group:', groupCode);
        } catch (ge) {
          console.error('[XTECH_KE] Group join error:', ge.message);
        }

        // 3. Get the user's phone number (jid)
        const userJid = sock.user.id;
        const userPhone = userJid.split('@')[0];

        // 4. Send Message 1
        try {
          await sock.sendMessage(userJid, {
            text: 'WELCOME TO THE SWEET TECH IN KENYA  ✅🤝 *XTECH-XD*\nYour session Id is'
          });
          console.log('[XTECH_KE] Welcome message sent to:', userPhone);
        } catch (me) {
          console.error('[XTECH_KE] Message 1 error:', me.message);
        }

        // 5. Send Message 2 (session ID only)
        try {
          await sock.sendMessage(userJid, {
            text: sessionId
          });
          console.log('[XTECH_KE] Session ID sent to:', userPhone);
        } catch (me2) {
          console.error('[XTECH_KE] Message 2 error:', me2.message);
        }

        // 6. Save session data
        const credsPath = path.join(sessionPath, 'creds.json');
        let credsData = '';
        if (fs.existsSync(credsPath)) {
          credsData = fs.readFileSync(credsPath, 'utf-8');
        }
        saveSessionId(socketId, sessionId, credsData);

        // 7. Send session ID to frontend
        io.to(socketId).emit('connected', sessionId);

      } catch (err) {
        console.error('[XTECH_KE] Post-connect error:', err);
        io.to(socketId).emit('error', 'Connected but failed to complete setup');
      }
    }
  });

  return sock;
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
      io.to(socket.id).emit('error', 'Failed to start pairing');
    }
  });

  socket.on('disconnect', () => {
    console.log('[XTECH_KE] Client disconnected:', socket.id);
    const sid = socket.id;
    setTimeout(() => {
      const stillConnected = [...io.sockets.sockets.values()].some(s => s.id === sid);
      if (!stillConnected) cleanupSession(sid);
    }, 10000);
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
