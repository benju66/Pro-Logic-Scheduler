// @ts-check
/**
 * @fileoverview File I/O service - handles saving and loading schedule files
 * @module ui/services/FileService
 */

/**
 * File service for handling schedule file operations
 * Supports both browser File System Access API and Tauri native dialogs
 * @class
 */
export class FileService {
    /**
     * @param {Object} options - Configuration
     * @param {Function} options.onToast - Toast notification callback
     * @param {boolean} options.isTauri - Whether running in Tauri environment
     */
    constructor(options = {}) {
        this.options = options;
        this.isTauri = options.isTauri || false;
        this.onToast = options.onToast || (() => {});
    }

    /**
     * Check if File System Access API is supported
     * @returns {boolean} True if supported
     */
    static isFileSystemAccessSupported() {
        return 'showSaveFilePicker' in window && 'showOpenFilePicker' in window;
    }

    /**
     * Save schedule data to file
     * @param {Object} data - Schedule data to save
     * @param {Array<Object>} data.tasks - Tasks array
     * @param {Object} data.calendar - Calendar configuration
     * @returns {Promise<void>}
     */
    async saveToFile(data) {
        if (this.isTauri && window.tauriDialog && window.tauriFs) {
            return this._saveTauri(data);
        } else if (FileService.isFileSystemAccessSupported()) {
            return this._saveBrowser(data);
        } else {
            // Fallback to download
            this.exportAsDownload(data);
        }
    }

    /**
     * Save using Tauri native dialog
     * @private
     * @param {Object} data - Schedule data
     */
    async _saveTauri(data) {
        try {
            const savePath = await window.tauriDialog.save({
                filters: [{ name: 'Schedule', extensions: ['json'] }],
                defaultPath: 'My_Schedule.json'
            });

            if (savePath) {
                const jsonData = JSON.stringify({
                    ...data,
                    exportedAt: new Date().toISOString(),
                    version: '2.0.0'
                }, null, 2);

                await window.tauriFs.writeTextFile(savePath, jsonData);
                this.onToast('Schedule saved', 'success');
            }
        } catch (err) {
            console.error('[FileService] Save failed:', err);
            this.onToast('Failed to save file', 'error');
            throw err;
        }
    }

    /**
     * Save using browser File System Access API
     * @private
     * @param {Object} data - Schedule data
     */
    async _saveBrowser(data) {
        try {
            const options = {
                suggestedName: 'My_Schedule.json',
                types: [{
                    description: 'Pro Logic Schedule',
                    accept: { 'application/json': ['.json'] },
                }],
            };
            const handle = await window.showSaveFilePicker(options);

            const writable = await handle.createWritable();
            const jsonData = JSON.stringify({
                ...data,
                exportedAt: new Date().toISOString(),
                version: '2.0.0'
            }, null, 2);

            await writable.write(jsonData);
            await writable.close();

            this.onToast('Saved to disk successfully', 'success');
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('[FileService] Save failed:', err);
                throw err;
            }
        }
    }

    /**
     * Open schedule from file
     * @returns {Promise<Object|undefined>} Schedule data or undefined if cancelled
     */
    async openFromFile() {
        if (this.isTauri && window.tauriDialog && window.tauriFs) {
            return this._openTauri();
        } else if (FileService.isFileSystemAccessSupported()) {
            return this._openBrowser();
        } else {
            // Fallback - return undefined, caller should use file input
            return undefined;
        }
    }

    /**
     * Open using Tauri native dialog
     * @private
     * @returns {Promise<Object|undefined>}
     */
    async _openTauri() {
        try {
            const selected = await window.tauriDialog.open({
                filters: [{ name: 'Schedule', extensions: ['json'] }]
            });

            if (selected) {
                const content = await window.tauriFs.readTextFile(selected);
                const parsed = JSON.parse(content);

                if (parsed.tasks) {
                    return parsed;
                } else {
                    throw new Error('Invalid schedule file format');
                }
            }
        } catch (err) {
            console.error('[FileService] Open failed:', err);
            this.onToast('Failed to open file', 'error');
            throw err;
        }
    }

    /**
     * Open using browser File System Access API
     * @private
     * @returns {Promise<Object|undefined>}
     */
    async _openBrowser() {
        try {
            const [handle] = await window.showOpenFilePicker({
                types: [{
                    description: 'Pro Logic Schedule',
                    accept: { 'application/json': ['.json'] },
                }],
            });

            const file = await handle.getFile();
            const text = await file.text();
            const parsed = JSON.parse(text);

            if (parsed.tasks) {
                return parsed;
            } else {
                throw new Error('Invalid schedule file format');
            }
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('[FileService] Open failed:', err);
                this.onToast('Failed to open file - invalid format', 'error');
                throw err;
            }
        }
    }

    /**
     * Import schedule from File object (from file input)
     * @param {File} file - File object
     * @returns {Promise<Object>} Schedule data
     */
    async importFromFile(file) {
        try {
            const text = await file.text();
            const parsed = JSON.parse(text);

            if (parsed.tasks) {
                return parsed;
            } else {
                throw new Error('Invalid format');
            }
        } catch (err) {
            console.error('[FileService] Import failed:', err);
            this.onToast('Failed to import - invalid file', 'error');
            throw err;
        }
    }

    /**
     * Export schedule as downloadable JSON file
     * @param {Object} data - Schedule data
     */
    exportAsDownload(data) {
        const jsonData = JSON.stringify({
            ...data,
            exportedAt: new Date().toISOString(),
            version: '2.0.0',
        }, null, 2);

        const blob = new Blob([jsonData], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `Schedule_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.onToast('Schedule exported', 'success');
    }

    /**
     * Import MS Project XML file
     * @param {File} file - XML file object
     * @returns {Promise<Object>} Schedule data with imported tasks
     */
    async importFromMSProjectXML(file) {
        try {
            const text = await file.text();
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(text, 'text/xml');

            // Check for parsing errors
            const parseError = xmlDoc.querySelector('parsererror');
            if (parseError) {
                throw new Error('Invalid XML file');
            }

            // Find tasks in the XML
            let xmlTasks = xmlDoc.querySelectorAll('Task');
            if (xmlTasks.length === 0) {
                xmlTasks = xmlDoc.getElementsByTagName('Task');
            }

            if (xmlTasks.length === 0) {
                throw new Error('No tasks found in XML file');
            }

            const importedTasks = [];
            const uidToIdMap = new Map();

            // First pass: Create tasks
            Array.from(xmlTasks).forEach((xmlTask) => {
                const uid = this._getXMLValue(xmlTask, 'UID');
                const name = this._getXMLValue(xmlTask, 'Name');
                const duration = this._getXMLValue(xmlTask, 'Duration');
                const start = this._getXMLValue(xmlTask, 'Start');
                const finish = this._getXMLValue(xmlTask, 'Finish');
                const outlineLevel = parseInt(this._getXMLValue(xmlTask, 'OutlineLevel') || '1');
                const summary = this._getXMLValue(xmlTask, 'Summary') === '1';
                const percentComplete = parseInt(this._getXMLValue(xmlTask, 'PercentComplete') || '0');
                const constraintType = this._getXMLValue(xmlTask, 'ConstraintType');
                const constraintDate = this._getXMLValue(xmlTask, 'ConstraintDate');
                const notes = this._getXMLValue(xmlTask, 'Notes');

                // Skip empty names or summary task "0"
                if (!name || uid === '0') return;

                const taskId = `imported_${uid}_${Date.now()}`;
                uidToIdMap.set(uid, taskId);

                // Parse duration (PT8H0M0S format or just days)
                let durationDays = 1;
                if (duration) {
                    const durationMatch = duration.match(/PT(\d+)H/);
                    if (durationMatch) {
                        durationDays = Math.max(1, Math.round(parseInt(durationMatch[1]) / 8));
                    } else {
                        durationDays = parseInt(duration) || 1;
                    }
                }

                // Parse dates
                const startDate = start ? start.split('T')[0] : '';
                const endDate = finish ? finish.split('T')[0] : '';

                // Map constraint types
                const constraintMap = {
                    '0': 'asap',
                    '1': 'alap',
                    '2': 'mso',
                    '3': 'mfo',
                    '4': 'snet',
                    '5': 'snlt',
                    '6': 'fnet',
                    '7': 'fnlt',
                };

                const task = {
                    id: taskId,
                    name: name,
                    start: startDate,
                    end: endDate,
                    duration: durationDays,
                    parentId: null,
                    dependencies: [],
                    progress: percentComplete,
                    constraintType: constraintMap[constraintType] || 'asap',
                    constraintDate: constraintDate ? constraintDate.split('T')[0] : '',
                    notes: notes || '',
                    _collapsed: false,
                    _outlineLevel: outlineLevel,
                    _msProjectUID: uid,
                };

                importedTasks.push(task);
            });

            // Second pass: Set up hierarchy
            for (let i = 0; i < importedTasks.length; i++) {
                const task = importedTasks[i];
                const level = task._outlineLevel || 1;

                for (let j = i - 1; j >= 0; j--) {
                    const potentialParent = importedTasks[j];
                    if ((potentialParent._outlineLevel || 1) < level) {
                        task.parentId = potentialParent.id;
                        break;
                    }
                }
            }

            // Third pass: Parse dependencies
            Array.from(xmlTasks).forEach((xmlTask) => {
                const uid = this._getXMLValue(xmlTask, 'UID');
                const taskId = uidToIdMap.get(uid);
                if (!taskId) return;

                const task = importedTasks.find(t => t.id === taskId);
                if (!task) return;

                const predLinks = xmlTask.querySelectorAll('PredecessorLink');
                Array.from(predLinks).forEach(link => {
                    const predUID = this._getXMLValue(link, 'PredecessorUID');
                    const linkType = this._getXMLValue(link, 'Type');
                    const lagDuration = this._getXMLValue(link, 'LinkLag');

                    const predTaskId = uidToIdMap.get(predUID);
                    if (predTaskId) {
                        const typeMap = { '0': 'FF', '1': 'FS', '2': 'SF', '3': 'SS' };

                        let lagDays = 0;
                        if (lagDuration) {
                            lagDays = Math.round(parseInt(lagDuration) / (10 * 60 * 8));
                        }

                        task.dependencies.push({
                            id: predTaskId,
                            type: typeMap[linkType] || 'FS',
                            lag: lagDays,
                        });
                    }
                });
            });

            // Clean up temporary properties
            importedTasks.forEach(task => {
                delete task._outlineLevel;
                delete task._msProjectUID;
            });

            this.onToast(`Imported ${importedTasks.length} tasks from MS Project`, 'success');

            return { tasks: importedTasks };
        } catch (err) {
            console.error('[FileService] MS Project XML import failed:', err);
            this.onToast('Failed to import MS Project XML: ' + err.message, 'error');
            throw err;
        }
    }

    /**
     * Export schedule to MS Project XML format
     * @param {Object} data - Schedule data
     * @param {Array<Object>} data.tasks - Tasks array
     * @param {Object} data.calendar - Calendar configuration
     */
    exportToMSProjectXML(data) {
        const today = new Date().toISOString();
        const projectName = 'Pro Logic Schedule';

        // Get project start date
        const projectStartDate = this._getProjectStartDate(data.tasks);

        let xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="http://schemas.microsoft.com/project">
    <Name>${projectName}</Name>
    <CreationDate>${today}</CreationDate>
    <LastSaved>${today}</LastSaved>
    <ScheduleFromStart>1</ScheduleFromStart>
    <StartDate>${projectStartDate}</StartDate>
    <Tasks>`;

        // Export tasks
        data.tasks.forEach((task, index) => {
            const uid = index + 1;
            const start = task.start ? `${task.start}T08:00:00` : '';
            const finish = task.end ? `${task.end}T17:00:00` : '';
            const duration = `PT${task.duration * 8}H0M0S`;
            const percentComplete = task.progress || 0;

            // Map constraint types back
            const constraintMap = {
                'asap': '0',
                'alap': '1',
                'mso': '2',
                'mfo': '3',
                'snet': '4',
                'snlt': '5',
                'fnet': '6',
                'fnlt': '7',
            };

            xml += `
        <Task>
            <UID>${uid}</UID>
            <ID>${uid}</ID>
            <Name>${this._escapeXML(task.name)}</Name>
            <Duration>${duration}</Duration>
            <Start>${start}</Start>
            <Finish>${finish}</Finish>
            <PercentComplete>${percentComplete}</PercentComplete>
            <ConstraintType>${constraintMap[task.constraintType] || '0'}</ConstraintType>`;

            if (task.constraintDate) {
                xml += `\n            <ConstraintDate>${task.constraintDate}T08:00:00</ConstraintDate>`;
            }

            if (task.notes) {
                xml += `\n            <Notes>${this._escapeXML(task.notes)}</Notes>`;
            }

            // Export dependencies
            if (task.dependencies && task.dependencies.length > 0) {
                task.dependencies.forEach(dep => {
                    const depUID = data.tasks.findIndex(t => t.id === dep.id) + 1;
                    if (depUID > 0) {
                        const linkTypeMap = { 'FF': '0', 'FS': '1', 'SF': '2', 'SS': '3' };
                        const lagMinutes = (dep.lag || 0) * 10 * 60 * 8; // Convert days to tenths of minutes
                        xml += `\n            <PredecessorLink>
                <PredecessorUID>${depUID}</PredecessorUID>
                <Type>${linkTypeMap[dep.type] || '1'}</Type>
                <LinkLag>${lagMinutes}</LinkLag>
            </PredecessorLink>`;
                    }
                });
            }

            xml += '\n        </Task>';
        });

        xml += `
    </Tasks>
</Project>`;

        // Download XML
        const blob = new Blob([xml], { type: 'application/xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Schedule_${new Date().toISOString().split('T')[0]}.xml`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.onToast('Exported to MS Project XML', 'success');
    }

    /**
     * Get project start date from tasks
     * @private
     * @param {Array<Object>} tasks - Tasks array
     * @returns {string} Start date string
     */
    _getProjectStartDate(tasks) {
        if (!tasks || tasks.length === 0) {
            return new Date().toISOString().split('T')[0];
        }

        const dates = tasks
            .map(t => t.start)
            .filter(d => d)
            .sort();

        return dates[0] || new Date().toISOString().split('T')[0];
    }

    /**
     * Helper to get value from XML element
     * @private
     * @param {Element} parent - Parent XML element
     * @param {string} tagName - Tag name to find
     * @returns {string} Text content or empty string
     */
    _getXMLValue(parent, tagName) {
        const el = parent.querySelector(tagName) || parent.getElementsByTagName(tagName)[0];
        return el ? el.textContent : '';
    }

    /**
     * Escape XML special characters
     * @private
     * @param {string} text - Text to escape
     * @returns {string} Escaped text
     */
    _escapeXML(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }
}

