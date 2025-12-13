// @ts-check
/**
 * @fileoverview Task data store - manages task CRUD operations
 * @module data/TaskStore
 */

/**
 * Task data store
 * Manages task state and provides CRUD operations
 * @class
 */
export class TaskStore {
    /**
     * @param {Object} options - Configuration
     * @param {Function} options.onChange - Callback when tasks change
     */
    constructor(options = {}) {
        this.options = options;
        this.tasks = [];
    }

    /**
     * Get all tasks
     * @returns {Array<Object>} All tasks
     */
    getAll() {
        return this.tasks;
    }

    /**
     * Set all tasks (replaces existing)
     * @param {Array<Object>} tasks - New tasks array
     */
    setAll(tasks) {
        this.tasks = tasks || [];
        this._notifyChange();
    }

    /**
     * Get a task by ID
     * @param {string} id - Task ID
     * @returns {Object|undefined} Task or undefined
     */
    getById(id) {
        return this.tasks.find(t => t.id === id);
    }

    /**
     * Add a new task
     * @param {Object} task - Task object
     * @returns {Object} Added task
     */
    add(task) {
        this.tasks.push(task);
        this._notifyChange();
        return task;
    }

    /**
     * Update a task
     * @param {string} id - Task ID
     * @param {Object} updates - Partial task updates
     * @returns {Object|undefined} Updated task or undefined
     */
    update(id, updates) {
        const task = this.getById(id);
        if (!task) return undefined;

        Object.assign(task, updates);
        this._notifyChange();
        return task;
    }

    /**
     * Delete a task
     * @param {string} id - Task ID
     * @returns {boolean} True if deleted
     */
    delete(id) {
        const index = this.tasks.findIndex(t => t.id === id);
        if (index === -1) return false;

        this.tasks.splice(index, 1);
        this._notifyChange();
        return true;
    }

    /**
     * Find tasks matching a predicate
     * @param {Function} predicate - Filter function
     * @returns {Array<Object>} Matching tasks
     */
    find(predicate) {
        return this.tasks.filter(predicate);
    }

    /**
     * Get tasks by parent ID
     * @param {string} parentId - Parent task ID
     * @returns {Array<Object>} Child tasks
     */
    getChildren(parentId) {
        return this.tasks.filter(t => t.parentId === parentId);
    }

    /**
     * Check if a task is a parent
     * @param {string} id - Task ID
     * @returns {boolean} True if task has children
     */
    isParent(id) {
        return this.tasks.some(t => t.parentId === id);
    }

    /**
     * Get task depth in hierarchy
     * @param {string} id - Task ID
     * @param {number} depth - Current depth (internal)
     * @returns {number} Depth level
     */
    getDepth(id, depth = 0) {
        const task = this.getById(id);
        if (!task || !task.parentId) return depth;
        return this.getDepth(task.parentId, depth + 1);
    }

    /**
     * Get flat list of visible tasks (respecting collapse state)
     * @param {Function} isCollapsed - Function to check if task is collapsed
     * @returns {Array<Object>} Flat list of visible tasks
     */
    getVisibleTasks(isCollapsed = () => false) {
        const result = [];
        
        const addTask = (task) => {
            result.push(task);
            if (!isCollapsed(task.id) && this.isParent(task.id)) {
                this.getChildren(task.id).forEach(child => addTask(child));
            }
        };

        this.tasks.filter(t => !t.parentId).forEach(root => addTask(root));
        return result;
    }

    /**
     * Notify subscribers of changes
     * @private
     */
    _notifyChange() {
        if (this.options.onChange) {
            this.options.onChange(this.tasks);
        }
    }
}

