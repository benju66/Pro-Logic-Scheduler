/**
 * @fileoverview Command UI Binding
 * @module commands/CommandUIBinding
 * 
 * Binds toolbar buttons to command states, automatically
 * enabling/disabling buttons based on canExecute.
 * 
 * Usage:
 * ```typescript
 * const binding = new CommandUIBinding(commandService);
 * binding.bindButton('[data-action="undo"]', 'edit.undo');
 * binding.bindButton('[data-action="bulk-delete"]', 'task.delete');
 * binding.start();
 * ```
 */

import { Subscription } from 'rxjs';
import { CommandService } from './CommandService';

interface ButtonBinding {
    selector: string;
    commandId: string;
    element: HTMLElement | null;
}

/**
 * CommandUIBinding - Wires toolbar buttons to command states
 * 
 * Observes command canExecute states and updates button disabled
 * attributes accordingly.
 */
export class CommandUIBinding {
    private bindings: ButtonBinding[] = [];
    private subscription: Subscription | null = null;
    private commandService: CommandService;

    constructor(commandService?: CommandService) {
        this.commandService = commandService || CommandService.getInstance();
    }

    /**
     * Bind a button to a command.
     * The button will be disabled when the command cannot execute.
     * 
     * @param selector - CSS selector for the button
     * @param commandId - Command ID to bind
     */
    bindButton(selector: string, commandId: string): this {
        this.bindings.push({
            selector,
            commandId,
            element: null
        });
        return this;
    }

    /**
     * Start observing command states and updating buttons.
     * Should be called after DOM is ready.
     */
    start(): void {
        if (this.subscription) {
            this.stop();
        }

        // Resolve elements
        for (const binding of this.bindings) {
            binding.element = document.querySelector(binding.selector);
            if (!binding.element) {
                console.warn(`[CommandUIBinding] Element not found: ${binding.selector}`);
            }
        }

        // Get unique command IDs
        const commandIds = [...new Set(this.bindings.map(b => b.commandId))];

        // Subscribe to state changes
        this.subscription = this.commandService.canExecuteMany$(commandIds).subscribe(
            states => this.updateButtons(states)
        );

        // Initial update
        this.commandService.notifyStateChange();

        console.log(`[CommandUIBinding] ✅ Started with ${this.bindings.length} bindings`);
    }

    /**
     * Stop observing and clean up subscriptions.
     */
    stop(): void {
        if (this.subscription) {
            this.subscription.unsubscribe();
            this.subscription = null;
        }
    }

    /**
     * Update button disabled states based on command canExecute states.
     * @private
     */
    private updateButtons(states: Record<string, boolean>): void {
        for (const binding of this.bindings) {
            if (!binding.element) continue;

            const canExecute = states[binding.commandId];
            const button = binding.element as HTMLButtonElement;

            if (canExecute) {
                button.removeAttribute('disabled');
                button.classList.remove('disabled');
            } else {
                button.setAttribute('disabled', 'disabled');
                button.classList.add('disabled');
            }
        }
    }

    /**
     * Manually trigger a state refresh.
     * Useful when you know state has changed.
     */
    refresh(): void {
        this.commandService.notifyStateChange();
    }
}
