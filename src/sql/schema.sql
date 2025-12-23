-- ============================================================================
-- Pro Logic Scheduler: SQLite Schema
-- Version: 2.0.0
-- Event Sourcing + Materialized Views Architecture
-- ============================================================================

-- ============================================================================
-- TASKS TABLE (Current State - Materialized from Events)
-- ============================================================================
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    parent_id TEXT,
    sort_key TEXT NOT NULL,
    
    -- Core Data
    name TEXT NOT NULL DEFAULT 'New Task',
    notes TEXT DEFAULT '',
    
    -- Scheduling Inputs
    duration INTEGER NOT NULL DEFAULT 1,
    constraint_type TEXT NOT NULL DEFAULT 'asap',
    constraint_date TEXT,
    dependencies TEXT NOT NULL DEFAULT '[]',  -- JSON array
    
    -- Progress
    progress INTEGER NOT NULL DEFAULT 0,
    
    -- NOTE: 'dependencies' is a JSON array of {id, type, lag} objects.
    -- SQLite foreign keys CANNOT cascade into JSON. Application logic must
    -- handle "Ghost Links" (references to deleted tasks) during:
    -- 1. CPM calculation (skip missing predecessors, log warning)
    -- 2. Periodic cleanup job (remove invalid dependency references)
    -- 3. Task deletion (proactively clean successor dependencies)
    
    -- Actuals
    actual_start TEXT,
    actual_finish TEXT,
    remaining_duration INTEGER,
    
    -- Baseline
    baseline_start TEXT,
    baseline_finish TEXT,
    baseline_duration INTEGER,
    
    -- UI State
    is_collapsed INTEGER NOT NULL DEFAULT 0,
    
    -- Metadata
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    
    -- Indexes
    FOREIGN KEY (parent_id) REFERENCES tasks(id) ON DELETE SET NULL
);

-- Critical index for hierarchy queries (getChildren, getVisibleTasks)
CREATE INDEX IF NOT EXISTS idx_tasks_parent_sort 
    ON tasks(parent_id, sort_key);

-- Index for dependency lookups
CREATE INDEX IF NOT EXISTS idx_tasks_id ON tasks(id);


-- ============================================================================
-- CALENDAR TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS calendar (
    id INTEGER PRIMARY KEY CHECK (id = 1),  -- Singleton
    working_days TEXT NOT NULL DEFAULT '[1,2,3,4,5]',  -- JSON array [Mon-Fri]
    exceptions TEXT NOT NULL DEFAULT '{}',  -- JSON object {date: exception}
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Initialize calendar with default values
INSERT OR IGNORE INTO calendar (id) VALUES (1);


-- ============================================================================
-- TRADE PARTNERS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS trade_partners (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    contact TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    color TEXT NOT NULL DEFAULT '#3B82F6',
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_trade_partners_name ON trade_partners(name);


-- ============================================================================
-- TASK <-> TRADE PARTNER JUNCTION TABLE
-- ============================================================================
-- NOTE: Junction table chosen over JSON column for these reasons:
-- 1. Referential integrity via CASCADE (auto-cleanup on delete)
-- 2. Efficient SQL queries: "Which tasks use Partner X?"
-- 3. Atomic updates (change one assignment without rewriting entire array)
-- 
-- Performance: DataLoader reads entire table on startup and maps in JS.
-- This is acceptable for <100k tasks. Do NOT switch to JSON column.
-- ============================================================================
CREATE TABLE IF NOT EXISTS task_trade_partners (
    task_id TEXT NOT NULL,
    trade_partner_id TEXT NOT NULL,
    assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (task_id, trade_partner_id),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (trade_partner_id) REFERENCES trade_partners(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ttp_task ON task_trade_partners(task_id);
CREATE INDEX IF NOT EXISTS idx_ttp_partner ON task_trade_partners(trade_partner_id);


-- ============================================================================
-- EVENTS TABLE (Append-Only Audit Log)
-- ============================================================================
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    target_id TEXT,                -- Task ID (null for project-level events)
    payload TEXT NOT NULL,         -- JSON payload
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    user_id TEXT,                  -- Future: for collaboration
    session_id TEXT,               -- Future: for session tracking
    
    -- Index for replay performance
    CONSTRAINT valid_event_type CHECK (
        event_type IN (
            -- Task CRUD
            'TASK_CREATED',
            'TASK_UPDATED',
            'TASK_DELETED',
            'TASK_MOVED',
            
            -- Hierarchy
            'TASK_INDENTED',
            'TASK_OUTDENTED',
            
            -- Dependencies
            'DEPENDENCY_ADDED',
            'DEPENDENCY_REMOVED',
            'DEPENDENCY_UPDATED',
            
            -- Baseline
            'BASELINE_SET',
            'BASELINE_CLEARED',
            
            -- Calendar
            'CALENDAR_UPDATED',
            
            -- Project
            'PROJECT_IMPORTED',
            'PROJECT_CLEARED',
            
            -- Bulk
            'BULK_UPDATE',
            'BULK_DELETE'
        )
    )
);

CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_events_target ON events(target_id);


-- ============================================================================
-- SNAPSHOTS TABLE (For Fast Startup)
-- ============================================================================
CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tasks_json TEXT NOT NULL,      -- JSON array of all tasks (inputs only)
    calendar_json TEXT NOT NULL,   -- JSON calendar object
    trade_partners_json TEXT DEFAULT '[]',  -- JSON array of trade partners
    event_id INTEGER NOT NULL,     -- Last event ID included in snapshot
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    
    FOREIGN KEY (event_id) REFERENCES events(id)
);

-- Keep only last 5 snapshots for space efficiency
CREATE TRIGGER IF NOT EXISTS cleanup_old_snapshots
AFTER INSERT ON snapshots
BEGIN
    DELETE FROM snapshots 
    WHERE id NOT IN (
        SELECT id FROM snapshots ORDER BY id DESC LIMIT 5
    );
END;

