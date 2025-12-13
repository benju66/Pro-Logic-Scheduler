#!/bin/bash

# Pro Logic Scheduler - Browser Mode Quick Start
# Double-click this file or run: ./start-browser.sh

cd "$(dirname "$0")"

echo "🌐 Starting Pro Logic Scheduler in Browser Mode..."
echo ""

# Kill any existing processes
echo "🧹 Cleaning up old processes..."
killall node 2>/dev/null || true
# Kill anything using port 1420
lsof -ti:1420 | xargs kill -9 2>/dev/null || true
sleep 2

# Start the dev server
echo "🚀 Starting development server..."
npm run dev

echo ""
echo "✅ Server starting at http://localhost:1420"
echo "📖 Open your browser to that URL"

