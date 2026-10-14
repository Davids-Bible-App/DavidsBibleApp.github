## David's bible App DBA.v.1.0.8

### :BuildNo-0180

##### Docs:

- Improved: Docs now shown in Memes as an Info button.
- Changed: Audio Docs show in menu as an Information button.

### :BuildNo-0179

##### Strongs Lookup:

- Added: Search History Dropdown.
- Improved: Better Lookup as some verses and references were getting ommitted.
- Added: Extra info like Number of Occurances, Number of verses.
- Added: Each Verse now has a Strongs Reference included, useful for word searching.
- Improved: Definitions - Strongs-Ref, now click-jump to Reference.

##### Settings:

-Improved: Save Button style clarity.

##### Audio:

- Fixed: Delete Author cancel, Now actually cancels the delete.
- Improved: Menu now closes, automatically on click outside, or on button press.

### :BuildNo-0178

##### TopNav:

- Minor Theme Changes.

##### Components:

- Cleaned up from debug data.

##### Audio:

- If refresh is used when audio in DeSync Mode, it resyncs to save Book/chapter for next Audio Resume.

### :BuildNo-0177

##### Audio (Android Only):

- Ongoing Update Issue - Tauri-codex & Tauri-macros, cause event issues, therefore Tauri and dependancies, have been Locked to safe versions until fixed.

### :BuildNo-0176

##### Audio (Android Only):

- Ongoing Update Issue - All Updates have been Locked to safe versions until, bad update found.
- Removed tauri-Plugin-Foreground-service from Audio.jsx
- Fix: Navigate/jumpTo Book2book same chapterNo, Audio not changing.

### :BuildNo-0175

##### Editor:

- Moved: Exports to Menu.
- Added: Word/char Count.
- Added: Css Styling to Html export.

##### Streak:

- Rename: "Your Streak" to "Your Daily Streak Usage"

##### Strongs:

- Fix: Now pre-loaded when needed for Definition Number Lookup.

##### Search:

- Added: Send to Clipboard, alongside Editor and Topic.
- Added: No Results moved to top of history and hides after 1.5secs
- Fix: Now Maintains Search Input Focus on No Results Found, for quick retype.

##### Audio:

- Fix: Audio(ReSync) OT/NT NavBtn Changer.
- Fix: Negate possible Android Service error on Cleanup, while on Windows.
- Added: Auto-Scrolling-Reader, turned off, during DeSync Mode.
- Renamed UnSync to DeSync'd.

### :BuildNo-0174

##### Audio:

- Fix: Desync between Reader Chapter and Audio Chapter on Book Change (Android).
- Fix: Audio Stopping on Book Change (Android).
- Fix: Timer Countdown (Windows).
- Added: Full DeSync/ReSync, To Listen to Audio and Navigate the rest of the App (Beta).
- Fix: GoToVerse(JumpTo) OT/NT NavBtn Changer

### :BuildNo-0173

##### Bible Chat (Windows Desktop Only):

- Add your own Download URL's for Other Models.
- Auto get size of Model, in custom URL.
- Upload, border animation while importing.

### :BuildNo-0172

##### Bible Chat (Windows Desktop Only):

- Added: Chat Stop, if Chat too long or too slow...
- Added: No Loaded Model - Quick Link Open Modals.
- UI Spacing Improvements.
- Renamable descriptive Models (Maintaining Original filename - Hidden from UI).
- Available To Download - Models show description on hover.
- Ability to scroll up to read, while AI is replying.
- Models Need Manual Loading, to Improve App Startup time.

### :BuildNo-0171

##### Bible Chat (Windows Desktop Only):

- Added: Chat History
- Added: New Chat
- Added: Models Upload/Download
- Added: Models Choose which Model to load
- Added: Hidden Start Prompt that can be customised, to keep the AI on-Focus and minimize drifting.
- Improved Chat Layout.
- Thinking Now Animates.

### :BuildNo-0170

##### Bible Chat:

- Added AI LLM for Windows11 Desktop Only.  
  Source URL: [https://ollama.com/robzilla/bibleai](https://ollama.com/robzilla/bibleai)

### :BuildNo-0169

##### Button Shadows:

- Adjusted Nue Button Shadows, to prevent some buttons looking distorted in shape. The Icons now look more centered.

##### Topic Chang

- Topics Exported to editor, now preserve line spacing of description text.
- New Copy-To-Clipboard feature added, also preserving line spacing.

### :BuildNo-0168

##### Selected Vers

- Strongs Picture, now work as expected on first use, after opening App or after refresh.
- Set Audio as default on bottom nav-bar swipe-up, instead of history, on first install.

##### Strongs Lookup:

- Inputbox Clear Button, keeps it's position, on different screen sizes.

### :BuildNo-06

##### Android MediaTray and Background Servie

- Notifications in dropdown system menu, now close when the App is swiped away to close.
