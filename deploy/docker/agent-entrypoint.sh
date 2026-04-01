#!/bin/sh
# Agent container entrypoint
# Starts a Pi SDK session that listens for WebSocket connections from the web app.
#
# Environment:
#   USER_ID         — user identifier
#   SESSION_ID      — session/conversation identifier
#   WEB_APP_URL     — callback URL for the web app
#   MCP_SERVER_URL  — URL of the MCP server for science/HPC tools

set -e

echo "Starting Goldilocks agent for user=$USER_ID session=$SESSION_ID"
echo "MCP server: $MCP_SERVER_URL"
echo "Web app: $WEB_APP_URL"

# Configure MCP connection
export PI_MCP_SERVERS="goldilocks=$MCP_SERVER_URL"

# Start the Pi agent in server mode, listening for WebSocket connections
# The web app will proxy user WebSocket connections to this port
exec node -e "
const { createAgentSession, AuthStorage, ModelRegistry, SessionManager, DefaultResourceLoader, createCodingTools } = require('@mariozechner/pi-coding-agent');
const { WebSocketServer } = require('ws');
const http = require('http');

const PORT = 8080;

async function main() {
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200);
      res.end('ok');
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  const wss = new WebSocketServer({ server });
  
  console.log('Agent listening on port', PORT);
  server.listen(PORT);

  // Agent session is created when the first WebSocket connection arrives
  wss.on('connection', async (ws) => {
    console.log('Web app connected');
    
    try {
      const authStorage = AuthStorage.create();
      const modelRegistry = ModelRegistry.create(authStorage);
      const loader = new DefaultResourceLoader({ cwd: '/work' });
      await loader.reload();
      
      const sessionManager = SessionManager.create('/work', '/tmp/pi-session');
      const { session } = await createAgentSession({
        cwd: '/work',
        sessionManager,
        authStorage,
        modelRegistry,
        tools: createCodingTools('/work'),
        resourceLoader: loader,
      });

      // Forward agent events to web app
      session.subscribe((event) => {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify(event));
        }
      });

      // Receive prompts from web app
      ws.on('message', async (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'prompt') {
          await session.prompt(msg.text);
        } else if (msg.type === 'abort') {
          await session.abort();
        }
      });

      ws.on('close', () => {
        console.log('Web app disconnected');
        session.dispose();
      });
    } catch (err) {
      console.error('Failed to create session:', err);
      ws.close(1011, 'Session creation failed');
    }
  });
}

main().catch(err => { console.error(err); process.exit(1); });
"
