# How to Debug on Mac

## Method 1: Right-Click Menu (Easiest)

1. **Right-click** (or Control+Click) anywhere in the Tauri app window
2. Select **"Inspect Element"** or **"Inspect"** from the context menu
3. The DevTools window will open
4. Click the **"Console"** tab at the top

## Method 2: Keyboard Shortcut

1. **Right-click** anywhere in the app window
2. Look for **"Inspect"** option
3. Or try: **Cmd+Option+I** (may work depending on Tauri version)

## Method 3: If Right-Click Doesn't Work

Some Tauri apps disable the context menu. In that case:

1. **Stop the app** (Ctrl+C in terminal)
2. **Edit the Tauri config** to enable DevTools
3. Or use the terminal output

## Method 4: Check Terminal Output

The debugging messages also appear in the terminal where you ran `npm run tauri:dev`:

1. Look at the terminal window where you started the app
2. You'll see console.log messages there
3. Look for messages like:
   - `🔧 Initializing button handlers...`
   - `✅ Button handlers initialized`
   - `✅ Found X buttons`
   - `🖱️ Header click detected`

## Quick Test

Once DevTools is open:

1. Go to **Console** tab
2. Type: `document.querySelectorAll('[data-action]').length`
3. Press Enter
4. Should show number of buttons (should be 18+)

## If DevTools Won't Open

If you can't access DevTools, we can add a visible debug panel to the app itself. Let me know if you need that!

