# Pro Logic Scheduler

**The Field-First Execution Engine**

![Status](https://img.shields.io/badge/Status-Production--Ready-brightgreen)
![Tech](https://img.shields.io/badge/Stack-Tauri%20%7C%20Rust%20%7C%20TypeScript-blue)
![Performance](https://img.shields.io/badge/Performance-60FPS%20%40%2010k%2B%20Tasks-orange)

---

## 🏗️ The Problem
Traditional scheduling tools (MS Project, P6) are built for the **Office**, not the **Field**. They are slow, clunky, and disconnect the Superintendent from the Project Manager.

## 🚀 The Solution
**Pro Logic Scheduler** is a high-performance **Execution Engine** designed to bridge that gap. It combines the rigor of Critical Path Method (CPM) with the speed of a native application, enabling Superintendents to manage 10,000+ line item schedules without lag.

---

## 🛡️ The Performance Moat

We didn't just build another React wrapper. We engineered a Ferrari.

### 1. "Puppeteer" Architecture (Unified Viewport)
Most schedulers crash because they try to sync two independent scroll areas (Grid & Gantt). We use a **Master Controller** pattern where a single "Puppeteer" (`SchedulerViewport`) drives two "dumb" renderers (`GridRenderer` & `GanttRenderer`) in a single animation frame.
* **Result:** Zero scroll jitter. Perfect sync. 60 FPS performance.

### 2. Native Foundation
* **Tauri (Rust):** Provides a secure, tiny-footprint native wrapper with system-level performance.
* **Rust CPM Engine:** High-performance Critical Path Method calculations in Rust (O(N) complexity).
* **SQLite:** True offline-first capability. No "loading spinners"—your data is local and instant.

---

## 🧠 Enterprise-Grade Logic

### The Scheduling Triangle
We enforce logical consistency automatically, mimicking the behavior of industry standards like MS Project:
* **Edit Duration:** $\to$ Updates End Date.
* **Edit Start:** $\to$ Applies **SNET** (Start No Earlier Than) constraint.
* **Edit End:** $\to$ Applies **FNLT** (Finish No Later Than) constraint.

### Health Analysis Engine
We don't just show dates; we show **Risk**.
* 🟣 **Blocked:** Circular dependencies or missing logic.
* 🔴 **Critical:** Negative float or missed deadlines (>3 days).
* 🟡 **At-Risk:** Low float (<2 days) or tight deadline buffers.
* 🟢 **Healthy:** On track with adequate float.

### Conflict-Free Ordering (Fractional Indexing)
We use lexicographical keys (e.g., `"a0"`, `"a0V"`) instead of integer indexes. This allows unlimited drag-and-drop reordering without rewriting the entire database, essential for multi-user sync.

---

## 🗺️ Strategic Roadmap

We are executing a 4-Phase Strategy to disrupt the market:

### Phase 1: Persistence (✅ Complete)
* [x] Core Data Architecture (`TaskStore`, `OrderingService`)
* [x] File System Integration (Save/Load JSON)
* [x] History Manager (Undo/Redo)

### Phase 2: Performance (✅ Complete)
* [x] "Puppeteer" Unified Viewport Architecture
* [x] DOM Pooling & Virtualization
* [x] 60 FPS Rendering Benchmark

### Phase 3: Field Utility (✅ Complete)
* [x] **SQLite Migration:** True Offline-First reliability.
* [x] **Rust CPM Engine:** High-performance scheduling calculations.
* [x] **Desktop-Only Architecture:** Native performance, no browser fallbacks.
* [ ] **Swipe-to-Status:** Mobile-friendly updating for Superintendents.
* [ ] **Lookahead Views:** Auto-generated 3-week lookaheads.

### Phase 4: Ecosystem (🔮 Future)
* [ ] **Confidence Engine:** Monte Carlo simulations for completion probability.
* [ ] **Cloud Sync:** Real-time collaboration between Field and Office.

---

## ⚡ Quick Start

### Prerequisites
* Node.js (v18+)
* Rust (latest stable)

### Installation
```bash
# Install dependencies
npm install

# Run Native App (Tauri Desktop)
npm run tauri dev

# Build for Production
npm run tauri build