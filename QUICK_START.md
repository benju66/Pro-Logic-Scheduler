# Quick Start Guide

## 🚀 Easy Ways to Start the App

### Option 1: Double-Click Scripts (Easiest!)

**For Tauri Desktop App:**
- Double-click `start-app.sh` in Finder
- Or right-click → Open With → Terminal

**For Browser Mode:**
- Double-click `start-browser.sh` in Finder

### Option 2: Short npm Commands

```bash
# Start Tauri app (desktop)
npm start
# or
npm run start:app

# Start browser mode
npm run start:browser

# Clean up and start fresh
npm run clean && npm start
```

### Option 3: VS Code Tasks

1. Press `Cmd + Shift + P` (Mac) or `Ctrl + Shift + P` (Windows/Linux)
2. Type "Tasks: Run Task"
3. Select:
   - **"Start Tauri App"** - Desktop app
   - **"Start Browser Mode"** - Browser only
   - **"Clean & Start Tauri"** - Kill old processes first

### Option 4: Terminal Shortcuts

Add these to your `~/.zshrc` or `~/.bashrc`:

```bash
# Quick aliases
alias scheduler="cd ~/Downloads/pro-logic-scheduler-tauri && npm start"
alias scheduler-browser="cd ~/Downloads/pro-logic-scheduler-tauri && npm run start:browser"
```

Then just type `scheduler` in any terminal!

## 📝 Original Commands (Still Work)

```bash
# Tauri desktop app
npm run tauri:dev

# Browser mode
npm run dev
```

## 🎯 Recommended Workflow

1. **For quick testing:** Use `npm start` or double-click `start-app.sh`
2. **For browser testing:** Use `npm run start:browser` or double-click `start-browser.sh`
3. **If port is busy:** Use `npm run clean && npm start`
