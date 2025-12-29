# Quick Start Guide

## 🚀 Easy Ways to Start the App

**Note:** Pro Logic Scheduler is a desktop-only application. Browser mode is not supported.

### Option 1: Double-Click Scripts (Easiest!)

**For Tauri Desktop App:**
- Double-click `start-app.sh` in Finder
- Or right-click → Open With → Terminal

### Option 2: Short npm Commands

```bash
# Start Tauri app (desktop)
npm start
# or
npm run start:app

# Clean up and start fresh
npm run clean && npm start
```

### Option 3: VS Code Tasks

1. Press `Cmd + Shift + P` (Mac) or `Ctrl + Shift + P` (Windows/Linux)
2. Type "Tasks: Run Task"
3. Select:
   - **"Start Tauri App"** - Desktop app
   - **"Clean & Start Tauri"** - Kill old processes first

### Option 4: Terminal Shortcuts

Add this to your `~/.zshrc` or `~/.bashrc`:

```bash
# Quick alias
alias scheduler="cd ~/path/to/pro-logic-scheduler-tauri && npm start"
```

Then just type `scheduler` in any terminal!

## 📝 Original Commands (Still Work)

```bash
# Tauri desktop app (with hot reload)
npm run tauri dev

# Build for production
npm run tauri build
```

## 🎯 Recommended Workflow

1. **For development:** Use `npm start` or `npm run tauri:dev`
   - ✅ **Hot reload enabled** - Frontend changes (TypeScript, CSS) update automatically
   - ✅ No need to rebuild or restart for code changes
   - ✅ Only restart needed for Rust backend changes (`src-tauri/src/*.rs`)

2. **If port is busy:** Use `npm run clean && npm start`

3. **For production:** Use `npm run tauri build`

## 🔥 Hot Reload Details

When running `npm run tauri:dev` or `npm start`:
- **Frontend changes** (TypeScript, CSS, HTML) → **Auto-reloads instantly** ✨
- **Rust changes** (`src-tauri/src/*.rs`) → Requires app restart
- **Config changes** (`tauri.conf.json`) → Requires app restart

**You do NOT need to run `npm run build` during development!** The dev server handles everything automatically.
