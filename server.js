// server.js - WebSocket Server with OAuth for EXACT Subscriber Counts
// Authenticate ONCE, get exact counts, broadcast to all clients

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { google } = require('googleapis');
const cors = require('cors');
const open = require('open');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// ==================== CONFIGURATION ====================
const CLIENT_ID = 'YOUR_CLIENT_ID.apps.googleusercontent.com';
const CLIENT_SECRET = 'YOUR_CLIENT_SECRET';
const REDIRECT_URI = 'http://localhost:3000/oauth2callback';

const UPDATE_INTERVAL = 90000; // 90 seconds

let currentSubCount = 0;
let currentGoal = 810;
let previousGoal = 800;
const increment = 10;
let oauth2Client = null;
let isAuthenticated = false;

// ==================== OAUTH SETUP ====================
const youtube = google.youtube('v3');

function createOAuthClient() {
  return new google.auth.OAuth2(
    CLIENT_ID,
    CLIENT_SECRET,
    REDIRECT_URI
  );
}

function getAuthUrl() {
  oauth2Client = createOAuthClient();
  
  const scopes = [
    'https://www.googleapis.com/auth/youtube.readonly'
  ];

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent'
  });
}

// ==================== WEB ROUTES FOR OAUTH ====================
app.get('/', (req, res) => {
  if (isAuthenticated) {
    res.send(`
      <html>
        <head>
          <title>YouTube WebSocket Server</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
            }
            .container {
              background: rgba(0, 0, 0, 0.5);
              padding: 3em;
              border-radius: 20px;
              text-align: center;
              max-width: 500px;
            }
            .status { color: #00ff88; font-size: 1.5em; margin: 1em 0; }
            .count { font-size: 3em; font-weight: bold; }
            button {
              background: #ff4c4c;
              color: white;
              border: none;
              padding: 1em 2em;
              border-radius: 10px;
              cursor: pointer;
              font-size: 1em;
              margin-top: 1em;
            }
            button:hover { background: #ff3333; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✅ Authenticated!</h1>
            <div class="status">Server is running</div>
            <div class="count">${currentSubCount.toLocaleString()} subs</div>
            <p>Goal: ${currentGoal.toLocaleString()}</p>
            <p>Connected Clients: <span id="clients">0</span></p>
            <button onclick="location.href='/logout'">Logout</button>
          </div>
          <script src="/socket.io/socket.io.js"></script>
          <script>
            const socket = io();
            socket.on('client-count', (count) => {
              document.getElementById('clients').textContent = count;
            });
          </script>
        </body>
      </html>
    `);
  } else {
    res.send(`
      <html>
        <head>
          <title>YouTube WebSocket Server - Login Required</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
            }
            .container {
              background: rgba(0, 0, 0, 0.5);
              padding: 3em;
              border-radius: 20px;
              text-align: center;
              max-width: 500px;
            }
            button {
              background: linear-gradient(135deg, #FF0000, #CC0000);
              color: white;
              border: none;
              padding: 1em 2em;
              border-radius: 10px;
              cursor: pointer;
              font-size: 1.2em;
              margin-top: 1em;
            }
            button:hover { transform: scale(1.05); }
            .steps {
              text-align: left;
              margin: 2em 0;
              line-height: 1.8;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>🔐 Authentication Required</h1>
            <p>Sign in with your YouTube account to start the WebSocket server</p>
            <div class="steps">
              <strong>This will:</strong><br>
              ✅ Get EXACT subscriber counts (no rounding!)<br>
              ✅ Update every 90 seconds automatically<br>
              ✅ Broadcast to all connected overlays<br>
              ✅ Stay authenticated (no re-login needed)
            </div>
            <button onclick="location.href='/auth'">Sign in with Google</button>
          </div>
        </body>
      </html>
    `);
  }
});

app.get('/auth', (req, res) => {
  const authUrl = getAuthUrl();
  res.redirect(authUrl);
});

app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code;
  
  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    isAuthenticated = true;
    
    console.log('✅ Authentication successful!');
    
    // Start fetching immediately
    fetchSubscriberCount();
    
    res.redirect('/');
  } catch (error) {
    console.error('❌ Authentication error:', error);
    res.send('Authentication failed. Please try again.');
  }
});

app.get('/logout', (req, res) => {
  isAuthenticated = false;
  oauth2Client = null;
  res.redirect('/');
});

// ==================== FETCH EXACT SUBSCRIBER COUNT ====================
async function fetchSubscriberCount() {
  if (!isAuthenticated || !oauth2Client) {
    console.log('⚠️  Not authenticated. Please sign in first.');
    return;
  }

  try {
    const response = await youtube.channels.list({
      auth: oauth2Client,
      part: 'statistics',
      mine: true
    });

    if (response.data.items && response.data.items.length > 0) {
      const subCount = parseInt(response.data.items[0].statistics.subscriberCount);
      
      // Update goal if needed
      if (subCount >= currentGoal) {
        previousGoal = currentGoal;
        currentGoal = Math.ceil((subCount + 1) / increment) * increment;
      }
      
      currentSubCount = subCount;
      
      // Broadcast to all connected clients
      const updateData = {
        count: currentSubCount,
        goal: currentGoal,
        previousGoal: previousGoal,
        timestamp: new Date().toISOString(),
        exact: true
      };
      
      io.emit('subscriber-update', updateData);
      
      console.log(`[${new Date().toLocaleTimeString()}] 📊 Exact Subs: ${currentSubCount} | Goal: ${currentGoal}`);
      
      return subCount;
    }
  } catch (error) {
    console.error('❌ Error fetching subscriber count:', error.message);
    
    // If token expired, mark as not authenticated
    if (error.message.includes('invalid_grant') || error.message.includes('invalid_token')) {
      console.log('⚠️  Token expired. Please re-authenticate.');
      isAuthenticated = false;
      io.emit('error', { message: 'Authentication expired. Please re-authenticate the server.' });
    } else {
      io.emit('error', { message: 'Failed to fetch subscriber count' });
    }
  }
}

// ==================== WEBSOCKET CONNECTION ====================
let connectedClients = 0;

io.on('connection', (socket) => {
  connectedClients++;
  console.log(`✅ Client connected: ${socket.id} (Total: ${connectedClients})`);
  
  io.emit('client-count', connectedClients);
  
  // Send current data immediately to new client
  if (isAuthenticated) {
    socket.emit('subscriber-update', {
      count: currentSubCount,
      goal: currentGoal,
      previousGoal: previousGoal,
      timestamp: new Date().toISOString(),
      exact: true
    });
  } else {
    socket.emit('error', { 
      message: 'Server not authenticated. Admin needs to sign in at http://localhost:3000' 
    });
  }
  
  socket.on('disconnect', () => {
    connectedClients--;
    console.log(`❌ Client disconnected: ${socket.id} (Total: ${connectedClients})`);
    io.emit('client-count', connectedClients);
  });
  
  socket.on('request-update', () => {
    if (isAuthenticated) {
      fetchSubscriberCount();
    }
  });
});

// ==================== AUTO-UPDATE LOOP ====================
setInterval(() => {
  if (isAuthenticated) {
    fetchSubscriberCount();
  }
}, UPDATE_INTERVAL);

// ==================== START SERVER ====================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║  🚀 YouTube WebSocket Server (OAuth + Exact Counts)       ║
╠════════════════════════════════════════════════════════════╣
║  📡 Server running on: http://localhost:${PORT}              ║
║  🔐 Please visit: http://localhost:${PORT}                   ║
║  📊 Update interval: ${UPDATE_INTERVAL / 1000} seconds                      ║
╚════════════════════════════════════════════════════════════╝
  `);
  
  // Auto-open browser for authentication
  if (!isAuthenticated) {
    console.log('🌐 Opening browser for authentication...\n');
    open(`http://localhost:${PORT}`);
  }
});

// ==================== SETUP INSTRUCTIONS ====================
/*
SETUP INSTRUCTIONS:

1. Install Node.js from https://nodejs.org/

2. Create folder and save this as 'server.js'

3. Install dependencies:
   npm init -y
   npm install express socket.io googleapis cors open

4. Get OAuth Credentials from Google Cloud Console:
   - Go to https://console.cloud.google.com/
   - Create project → Enable YouTube Data API v3
   - Go to Credentials → Create OAuth 2.0 Client ID
   - Application type: Web application
   - Authorized redirect URIs: http://localhost:3000/oauth2callback
   - Copy Client ID and Client Secret

5. Edit this file and replace:
   - YOUR_CLIENT_ID.apps.googleusercontent.com
   - YOUR_CLIENT_SECRET

6. Run server:
   node server.js

7. Browser will auto-open → Sign in with your YouTube account

8. Once authenticated, your overlays can connect to:
   ws://localhost:3000

9. For production (accessible from internet):
   - Deploy to Railway, Render, or Heroku
   - Update REDIRECT_URI to your production URL
   - Add production redirect URI to Google Cloud Console

EXACT COUNTS! No API key rounding! 🎯
*/
