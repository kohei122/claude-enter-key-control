# Claude Enter Key Control (by marusin)

A Chrome extension that prevents accidental message sending in Claude.

## Features

- Press Enter to insert a newline  
- Press Shift + Enter to send your message  
- Supports Ctrl, Cmd, and combined send key modes

## Benefits

- Write longer prompts without accidental sending  
- Improve typing comfort and control  
- Reduce mistakes when editing messages  

## Privacy

- No data collection  
- No external communication  
- Works only on Claude  

## Installation

1. Download from Chrome Web Store  
2. Enable the extension  
3. Start using Claude with improved input behavior  

## Changelog

### 1.4.0
- Improved Claude send button detection based on the input/composer DOM structure.
- Improved send shortcut compatibility in multilingual Claude UI environments.
- Reduced the risk of incorrectly detecting attachment, model selector, recording, menu, feedback, or other unrelated buttons.
- Removed broad document-level button search from Claude send button detection.

### 1.3.1
- Improved send shortcut compatibility for Claude in multilingual UI environments.
- Improved send button detection for localized Claude UI labels.
- Adjusted send button detection to avoid feedback, comment, and report buttons.

### 1.3.0
- Improved IME handling for Japanese, Chinese, Korean, and other composition-based input methods
- Fixed duplicate content script initialization to prevent repeated newline handling in some cases

### 1.2.1
- Added Spanish localization
- Added Brazilian Portuguese localization
- Added Traditional Chinese localization

### 1.2.0
- Added Cmd+Enter support for Mac users
- Added Shift+Cmd+Enter send mode
- Added Mac-only Cmd support to the existing Shift/Ctrl send modes
- Shows Cmd send key options only on macOS

### 1.1.5
- Updated popup description text
- Updated localized app descriptions

### 1.1.4
- Added collapsible secondary settings in popup
- Moved language/version/other extensions link into secondary area

### 1.1.3
- UI improvements

### 1.1.2
- Simplified popup UI text
- Updated text consistency across languages

## Developer

Developed by Marushin

