/**
 * @fileoverview File I/O service - handles saving and loading schedule files
 * @module ui/services/FileService
 */

import type { Task, ProjectData, Calendar } from '../../types';
import { DEFAULT_WORKING_DAYS } from '../../core/Constants';
import { OrderingService } from '../../services/OrderingService';

/**
 * File service options
 */
export interface FileServiceOptions {
  onToast?: (message: string, type: 'success' | 'error') => void;
  isTauri?: boolean;
}

/**
 * File service for handling schedule file operations
 * Desktop-only: Uses Tauri native dialogs
 */
export class FileService {
  private onToast: (message: string, type: 'success' | 'error') => void;

  /**
   * @param options - Configuration
   */
  constructor(options: FileServiceOptions = {}) {
    this.onToast = options.onToast || (() => {});
  }

  /**
   * Save schedule data to file using Tauri native dialog
   * @param data - Schedule data to save
   * @returns Promise that resolves when saved
   */
  async saveToFile(data: ProjectData): Promise<void> {
    if (!window.tauriDialog || !window.tauriFs) {
      throw new Error('Tauri APIs not available - desktop application required');
    }
    return this._saveTauri(data);
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
   * Open schedule file using Tauri native dialog
   * @returns Promise that resolves with project data or undefined if cancelled
   */
  async openFromFile(): Promise<ProjectData | undefined> {
    if (!window.tauriDialog || !window.tauriFs) {
      throw new Error('Tauri APIs not available - desktop application required');
    }
    return this._openTauri();
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
   * Import MS Project XML from content string
   * Used by native Tauri dialog flow
   * 
   * @param content - XML file content as string
   * @returns Parsed tasks and calendar
   */
  async importFromMSProjectXMLContent(content: string): Promise<{ tasks: Task[], calendar: Calendar }> {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(content, 'text/xml');

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
      
      // Track the last sortKey for sequential generation
      let lastSortKey: string | null = null;

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

        // CRITICAL FIX: Generate sequential sortKey
        const sortKey = OrderingService.generateAppendKey(lastSortKey);
        lastSortKey = sortKey;

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
          sortKey: sortKey, // <--- Assign the generated key
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

      // Fourth pass: Parse calendars and exceptions
      const calendar = this._parseCalendars(xmlDoc);

      this.onToast(`Imported ${importedTasks.length} tasks from MS Project`, 'success');

      return { tasks: importedTasks, calendar };
    } catch (err) {
      const error = err as Error;
      console.error('[FileService] XML import failed:', error);
      this.onToast('Failed to parse XML file', 'error');
      throw error;
    }
  }

  /**
   * Import MS Project XML from File object (legacy browser API)
   * @param file - File object from file input
   * @returns Parsed tasks and calendar
   */
  async importFromMSProjectXML(file: File): Promise<{ tasks: Task[], calendar: Calendar }> {
    const content = await file.text();
    return this.importFromMSProjectXMLContent(content);
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
   * Parse calendars and exceptions from MS Project XML
   * @private
   * @param xmlDoc - Parsed XML document
   * @returns Calendar object with exceptions
   */
  private _parseCalendars(xmlDoc: Document): Calendar {
    const calendar: Calendar = {
      workingDays: [...DEFAULT_WORKING_DAYS],
      exceptions: {},
    };

    try {
      // Find Calendars section
      let calendarsElement: Element | null = xmlDoc.querySelector('Calendars');
      if (!calendarsElement) {
        const calendarsCollection = xmlDoc.getElementsByTagName('Calendars');
        calendarsElement = calendarsCollection.length > 0 ? calendarsCollection[0] : null;
      }

      if (!calendarsElement) {
        // No calendars found, return default calendar
        return calendar;
      }

      // Find all Calendar elements
      const calendarElements = calendarsElement.querySelectorAll('Calendar');
      const calendarElementsArray = Array.from(calendarElements);

      // Find the base calendar (IsBaseCalendar = 1)
      let baseCalendar: Element | null = null;
      for (const calEl of calendarElementsArray) {
        const isBaseCalendar = this._getXMLValue(calEl as Element, 'IsBaseCalendar');
        if (isBaseCalendar === '1') {
          baseCalendar = calEl as Element;
          break;
        }
      }

      // If no base calendar found, try the first calendar
      if (!baseCalendar && calendarElementsArray.length > 0) {
        baseCalendar = calendarElementsArray[0] as Element;
      }

      if (!baseCalendar) {
        return calendar;
      }

      // Parse exceptions from the base calendar
      // MS Project XML structure: <Calendar><Exceptions><Exception>...</Exception></Exceptions></Calendar>
      let exceptionsContainer: Element | null = baseCalendar.querySelector('Exceptions');
      if (!exceptionsContainer) {
        const exceptionsCollection = baseCalendar.getElementsByTagName('Exceptions');
        exceptionsContainer = exceptionsCollection.length > 0 ? exceptionsCollection[0] : null;
      }

      if (!exceptionsContainer) {
        return calendar;
      }

      const exceptions = exceptionsContainer.querySelectorAll('Exception');
      const exceptionsArray = Array.from(exceptions);

      exceptionsArray.forEach((exceptionEl) => {
        const timePeriod = exceptionEl.querySelector('TimePeriod');
        if (!timePeriod) return;

        const fromDateStr = this._getXMLValue(timePeriod as Element, 'FromDate');
        const toDateStr = this._getXMLValue(timePeriod as Element, 'ToDate');
        const exceptionName = this._getXMLValue(exceptionEl as Element, 'Name');

        if (!fromDateStr) return;

        // Parse dates (MS Project format: YYYY-MM-DDTHH:mm:ss or YYYY-MM-DD)
        const fromDate = fromDateStr.split('T')[0];
        const toDate = toDateStr ? toDateStr.split('T')[0] : fromDate;

        // Generate all dates in the range (inclusive)
        const dates = this._generateDateRange(fromDate, toDate);

        // Add each date as a non-working day exception
        dates.forEach((dateStr) => {
          calendar.exceptions[dateStr] = {
            date: dateStr,
            working: false,
            description: exceptionName || 'Holiday',
          };
        });
      });
    } catch (err) {
      console.warn('[FileService] Failed to parse calendars:', err);
      // Return default calendar if parsing fails
    }

    return calendar;
  }

  /**
   * Generate array of date strings between two dates (inclusive)
   * @private
   * @param fromDate - Start date (YYYY-MM-DD)
   * @param toDate - End date (YYYY-MM-DD)
   * @returns Array of date strings
   */
  private _generateDateRange(fromDate: string, toDate: string): string[] {
    const dates: string[] = [];
    const start = new Date(fromDate);
    const end = new Date(toDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return [fromDate]; // Return single date if parsing fails
    }

    const current = new Date(start);
    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0];
      dates.push(dateStr);
      current.setDate(current.getDate() + 1);
    }

    return dates;
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
