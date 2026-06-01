#!/bin/bash
# XTECH_KE Pairing Server - Start Script
# Auto-installs Cloudflare Tunnel, npm deps, and starts on port 3000

echo ""
echo "  ========================================="
echo "     XTECH_KE Pairing Server"
echo "     Initializing..."
echo "  ========================================="
echo ""

# ---- Install Cloudflare Tunnel ----
if [ ! -f ./cloudflared ]; then
    echo "[XTECH_KE] Downloading Cloudflare Tunnel..."
    wget -q --show-progress -O ./cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 2>/dev/null || \
    curl -L --progress-bar -o ./cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
    chmod +x ./cloudflared 2>/dev/null
    echo "[XTECH_KE] Cloudflare Tunnel installed!"
else
    echo "[XTECH_KE] Cloudflare Tunnel already installed."
fi

# ---- Start Cloudflare Tunnel in background ----
echo "[XTECH_KE] Starting Cloudflare Tunnel..."
./cloudflared tunnel run --token "eyJhIjoiYmU5ZmIwMGMzNDhlMTBkNjBlNDMxMjk4ZTYyYTM2MjEiLCJ0IjoiYTY1ZWM4ODEtZTNhYi00ZDczLTlhZjktNmRkNDk0ZTNkMDE1IiwicyI6IllXTTVNbUV3TjJFdE9UTm1NUzAwT1RKakxUZzBOMlF0TVRBNU5EVmhOVEkxTTJNMiJ9" &
TUNNEL_PID=$!
echo "[XTECH_KE] Cloudflare Tunnel started (PID: $TUNNEL_PID)"

sleep 3

# ---- Install NPM Dependencies ----
echo "[XTECH_KE] Installing dependencies..."
npm install --production --legacy-peer-deps 2>&1 | tail -5
echo "[XTECH_KE] Dependencies installed!"

# ---- Create sessions dir ----
mkdir -p sessions

# ---- Start Server ----
echo "[XTECH_KE] Starting pairing server on port 3000..."
echo ""
node index.js
