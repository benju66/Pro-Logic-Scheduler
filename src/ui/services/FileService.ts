/**
 * @fileoverview File I/O service - handles saving and loading schedule files
 * @module ui/services/FileService
 */

import type { Task, ProjectData } from '../../types';

/**
 * File service options
 */
export interface FileServiceOptions {
  onToast?: (message: string, type: 'success' | 'error') => void;
  isTauri?: boolean;
}

/**
 * File service for handling schedule file operations
 * Supports both browser File System Access API and Tauri native dialogs
 */
export class FileService {
  private isTauri: boolean;
  private onToast: (message: string, type: 'success' | 'error') => void;

  /**
   * @param options - Configuration
   */
  constructor(options: FileServiceOptions = {}) {
    this.isTauri = options.isTauri || false;
    this.onToast = options.onToast || (() => {});
  }

  /**
   * Check if File System Access API is supported
   * @returns True if supported
   */
  static isFileSystemAccessSupported(): boolean {
    return 'showSaveFilePicker' in window && 'showOpenFilePicker' in window;
  }

  /**
   * Save schedule data to file
   * @param data - Schedule data to save
   * @returns Promise that resolves when saved
   */
  async saveToFile(data: ProjectData): Promise<void> {
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
   * @param data - Schedule data
   */
  private async _saveTauri(data: ProjectData): Promise<void> {
    try {
      if (!window.tauriDialog || !window.tauriFs) {
        throw new Error('Tauri APIs not available');
      }

      const savePath = await window.tauriDialog.save({
        filters: [{ name: 'Schedule', extensions: ['json'] }],
        defaultPath: 'My_Schedule.json'
      } as any);

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
      const error = err as Error;
      console.error('[FileService] Save failed:', error);
      this.onToast('Failed to save file', 'error');
      throw error;
    }
  }

  /**
   * Save using browser File System Access API
   * @private
   * @param data - Schedule data
   */
  private async _saveBrowser(data: ProjectData): Promise<void> {
    try {
      const options = {
        suggestedName: 'My_Schedule.json',
        types: [{
          description: 'Pro Logic Schedule',
          accept: { 'application/json': ['.json'] },
        }],
      };
      const handle = await (window as any).showSaveFilePicker(options);

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
      const error = err as Error;
      if (error.name !== 'AbortError') {
        console.error('[FileService] Save failed:', error);
        throw error;
      }
    }
  }

  /**
   * Open schedule from file
   * @returns Schedule data or undefined if cancelled
   */
  async openFromFile(): Promise<ProjectData | undefined> {
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
   * @returns Schedule data or undefined
   */
  private async _openTauri(): Promise<ProjectData | undefined> {
    try {
      if (!window.tauriDialog || !window.tauriFs) {
        throw new Error('Tauri APIs not available');
      }

      const selected = await window.tauriDialog.open({
        filters: [{ name: 'Schedule', extensions: ['json'] }]
      } as any);

      if (selected) {
        const content = await window.tauriFs.readTextFile(selected);
        const parsed = JSON.parse(content) as ProjectData;

        if (parsed.tasks) {
          return parsed;
        } else {
          throw new Error('Invalid schedule file format');
        }
      }
    } catch (err) {
      const error = err as Error;
      console.error('[FileService] Open failed:', error);
      this.onToast('Failed to open file', 'error');
      throw error;
    }
  }

  /**
   * Open using browser File System Access API
   * @private
   * @returns Schedule data or undefined
   */
  private async _openBrowser(): Promise<ProjectData | undefined> {
    try {
      const [handle] = await (window as any).showOpenFilePicker({
        types: [{
          description: 'Pro Logic Schedule',
          accept: { 'application/json': ['.json'] },
        }],
      });

      const file = await handle.getFile();
      const text = await file.text();
      const parsed = JSON.parse(text) as ProjectData;

      if (parsed.tasks) {
        return parsed;
      } else {
        throw new Error('Invalid schedule file format');
      }
    } catch (err) {
      const error = err as Error;
      if (error.name !== 'AbortError') {
        console.error('[FileService] Open failed:', error);
        this.onToast('Failed to open file - invalid format', 'error');
        throw error;
      }
    }
  }

  /**
   * Import schedule from File object (from file input)
   * @param file - File object
   * @returns Schedule data
   */
  async importFromFile(file: File): Promise<ProjectData> {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as ProjectData;

      if (parsed.tasks) {
        return parsed;
      } else {
        throw new Error('Invalid format');
      }
    } catch (err) {
      const error = err as Error;
      console.error('[FileService] Import failed:', error);
      this.onToast('Failed to import - invalid file', 'error');
      throw error;
    }
  }

  /**
   * Export schedule as downloadable JSON file
   * @param data - Schedule data
   */
  exportAsDownload(data: ProjectData): void {
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
   * @param file - XML file object
   * @returns Schedule data with imported tasks
   */
  async importFromMSProjectXML(file: File): Promise<{ tasks: Task[] }> {
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
      let xmlTasks: NodeListOf<Element> | HTMLCollectionOf<Element> = xmlDoc.querySelectorAll('Task');
      if (xmlTasks.length === 0) {
        const htmlCollection = xmlDoc.getElementsByTagName('Task');
        // Convert HTMLCollection to array for consistent handling
        xmlTasks = Array.from(htmlCollection) as any;
      }

      if (xmlTasks.length === 0) {
        throw new Error('No tasks found in XML file');
      }

      const importedTasks: Task[] = [];
      const uidToIdMap = new Map<string, string>();

      // First pass: Create tasks
      const xmlTasksArray = xmlTasks instanceof NodeList ? Array.from(xmlTasks) : Array.isArray(xmlTasks) ? xmlTasks : Array.from(xmlTasks);
      xmlTasksArray.forEach((xmlTask) => {
        const uid = this._getXMLValue(xmlTask as Element, 'UID');
        const name = this._getXMLValue(xmlTask as Element, 'Name');
        const duration = this._getXMLValue(xmlTask as Element, 'Duration');
        const start = this._getXMLValue(xmlTask as Element, 'Start');
        const finish = this._getXMLValue(xmlTask as Element, 'Finish');
        const outlineLevel = parseInt(this._getXMLValue(xmlTask as Element, 'OutlineLevel') || '1');
        const percentComplete = parseInt(this._getXMLValue(xmlTask as Element, 'PercentComplete') || '0');
        const constraintType = this._getXMLValue(xmlTask as Element, 'ConstraintType');
        const constraintDate = this._getXMLValue(xmlTask as Element, 'ConstraintDate');
        const notes = this._getXMLValue(xmlTask as Element, 'Notes');

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
        const constraintMap: Record<string, string> = {
          '0': 'asap',
          '1': 'alap',
          '2': 'mso',
          '3': 'mfo',
          '4': 'snet',
          '5': 'snlt',
          '6': 'fnet',
          '7': 'fnlt',
        };

        const task: Task = {
          id: taskId,
          name: name,
          wbs: '',
          level: outlineLevel - 1,
          start: startDate,
          end: endDate,
          duration: durationDays,
          parentId: null,
          dependencies: [],
          progress: percentComplete,
          constraintType: (constraintMap[constraintType] || 'asap') as any,
          constraintDate: constraintDate ? constraintDate.split('T')[0] : null,
          notes: notes || '',
          _collapsed: false,
        };

        importedTasks.push(task);
      });

      // Second pass: Set up hierarchy
      for (let i = 0; i < importedTasks.length; i++) {
        const task = importedTasks[i];
        const level = task.level + 1;

        for (let j = i - 1; j >= 0; j--) {
          const potentialParent = importedTasks[j];
          if ((potentialParent.level + 1) < level) {
            task.parentId = potentialParent.id;
            break;
          }
        }
      }

      // Third pass: Parse dependencies
      Array.from(xmlTasks).forEach((xmlTask) => {
        const uid = this._getXMLValue(xmlTask as Element, 'UID');
        const taskId = uidToIdMap.get(uid);
        if (!taskId) return;

        const task = importedTasks.find(t => t.id === taskId);
        if (!task) return;

        const predLinks = xmlTask.querySelectorAll('PredecessorLink');
        Array.from(predLinks).forEach(link => {
          const predUID = this._getXMLValue(link as Element, 'PredecessorUID');
          const linkType = this._getXMLValue(link as Element, 'Type');
          const lagDuration = this._getXMLValue(link as Element, 'LinkLag');

          const predTaskId = uidToIdMap.get(predUID);
          if (predTaskId) {
            const typeMap: Record<string, string> = { '0': 'FF', '1': 'FS', '2': 'SF', '3': 'SS' };

            let lagDays = 0;
            if (lagDuration) {
              lagDays = Math.round(parseInt(lagDuration) / (10 * 60 * 8));
            }

            task.dependencies.push({
              id: predTaskId,
              type: (typeMap[linkType] || 'FS') as any,
              lag: lagDays,
            });
          }
        });
      });

      this.onToast(`Imported ${importedTasks.length} tasks from MS Project`, 'success');

      return { tasks: importedTasks };
    } catch (err) {
      const error = err as Error;
      console.error('[FileService] MS Project XML import failed:', error);
      this.onToast('Failed to import MS Project XML: ' + error.message, 'error');
      throw error;
    }
  }

  /**
   * Export schedule to MS Project XML format
   * @param data - Schedule data
   */
  exportToMSProjectXML(data: ProjectData): void {
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
    data.tasks.forEach((task: Task, index: number) => {
      const uid = index + 1;
      const start = task.start ? `${task.start}T08:00:00` : '';
      const finish = task.end ? `${task.end}T17:00:00` : '';
      const duration = `PT${task.duration * 8}H0M0S`;
      const percentComplete = task.progress || 0;

      // Map constraint types back
      const constraintMap: Record<string, string> = {
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
        task.dependencies.forEach((dep) => {
          const depUID = data.tasks.findIndex((t: Task) => t.id === dep.id) + 1;
          if (depUID > 0) {
            const linkTypeMap: Record<string, string> = { 'FF': '0', 'FS': '1', 'SF': '2', 'SS': '3' };
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
   * @param tasks - Tasks array
   * @returns Start date string
   */
  private _getProjectStartDate(tasks: Task[]): string {
    if (!tasks || tasks.length === 0) {
      return new Date().toISOString().split('T')[0];
    }

    const dates = tasks
      .map(t => t.start)
      .filter((d): d is string => !!d)
      .sort();

    return dates[0] || new Date().toISOString().split('T')[0];
  }

  /**
   * Helper to get value from XML element
   * @private
   * @param parent - Parent XML element
   * @param tagName - Tag name to find
   * @returns Text content or empty string
   */
  private _getXMLValue(parent: Element, tagName: string): string {
    const el = parent.querySelector(tagName) || parent.getElementsByTagName(tagName)[0];
    return el ? (el.textContent || '') : '';
  }

  /**
   * Escape XML special characters
   * @private
   * @param text - Text to escape
   * @returns Escaped text
   */
  private _escapeXML(text: string): string {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
