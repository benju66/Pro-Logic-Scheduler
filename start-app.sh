#!/bin/bash

# Pro Logic Scheduler - Quick Start Script
# Double-click this file or run: ./start-app.sh

cd "$(dirname "$0")"

echo "🚀 Starting Pro Logic Scheduler..."
echo ""

# Kill any existing processes
echo "🧹 Cleaning up old processes..."
killall node 2>/dev/null || true
# Kill anything using port 1420
lsof -ti:1420 | xargs kill -9 2>/dev/null || true
sleep 2

# Start the app
echo "🏎️ Starting Tauri app..."
npm run tauri:dev

