# Pro Logic Scheduler - Tauri Desktop App

High-performance construction project scheduling application built with Tauri.

## Features

- 🚀 10,000+ task performance with virtual scrolling
- 📊 Interactive Gantt chart with canvas rendering
- 🔗 Critical Path Method (CPM) analysis
- 📁 MS Project XML import/export
- 💾 Native file save/open dialogs
- ⌨️ Full keyboard navigation

## Prerequisites

Before building, you need to install:

### 1. Rust
```bash
# macOS/Linux
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Windows - download from https://rustup.rs
```

### 2. Node.js (v18+)
```bash
# Using nvm (recommended)
nvm install 18
nvm use 18

# Or download from https://nodejs.org
```

### 3. Tauri Prerequisites

**macOS:**
```bash
xcode-select --install
```

**Windows:**
- Install [Microsoft Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
- Install [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)

**Linux (Debian/Ubuntu):**
```bash
sudo apt update
sudo apt install libwebkit2gtk-4.0-dev \
    build-essential \
    curl \
    wget \
    file \
    libssl-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev
```

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Run in development mode
npm run tauri:dev

# 3. Build for production
npm run tauri:build
```

## Project Structure

```
pro-logic-scheduler-tauri/
├── index.html              # Main HTML file
├── package.json            # Node.js dependencies
├── vite.config.js          # Vite bundler config
├── src/                    # JavaScript source
│   ├── main.js             # Entry point
│   ├── SchedulerEngine.js  # Core orchestration
│   ├── VirtualScrollGrid.js
│   ├── CanvasGantt.js
│   ├── SideDrawer.js
│   ├── DependenciesModal.js
│   ├── CalendarModal.js
│   ├── CPM.js              # Critical Path Method
│   └── DateUtils.js        # Date calculations
└── src-tauri/              # Rust/Tauri backend
    ├── Cargo.toml          # Rust dependencies
    ├── tauri.conf.json     # Tauri configuration
    ├── src/
    │   └── main.rs         # Rust entry point
    └── icons/              # App icons
```

## Development Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server only |
| `npm run tauri:dev` | Start Tauri + Vite in dev mode |
| `npm run build` | Build web assets |
| `npm run tauri:build` | Build production executable |

## Building Executables

After running `npm run tauri:build`, you'll find:

- **macOS:** `src-tauri/target/release/bundle/dmg/`
- **Windows:** `src-tauri/target/release/bundle/msi/`
- **Linux:** `src-tauri/target/release/bundle/deb/` or `appimage/`

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+N | New project |
| Ctrl+O | Open file |
| Ctrl+S | Save file |
| Ctrl+Z/Y | Undo/Redo |
| Ctrl+C/X/V | Copy/Cut/Paste |
| F2 | Edit cell |
| Delete | Delete task |
| Tab | Indent |
| Arrow keys | Navigate |

## Notes

- The app uses Tauri's native file dialogs for better integration
- Data is stored in localStorage (persists between sessions)
- MS Project XML files can be imported/exported for compatibility

## Troubleshooting

### Build fails with Rust errors
```bash
rustup update
cargo clean
npm run tauri:build
```

### WebView2 not found (Windows)
Download and install from: https://developer.microsoft.com/en-us/microsoft-edge/webview2/

### Permission denied (Linux)
```bash
chmod +x src-tauri/target/release/pro-logic-scheduler
```

## License

MIT
