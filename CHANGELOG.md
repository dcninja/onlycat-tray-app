# Changelog

## [1.1.0] - 2026-04-17

### Added
- Door Policy section in tray menu — lists all policies per device, active policy marked with ✓, click to activate
- Share button (🔗) on each event card to copy the event URL to clipboard
- Search box in Recent Activity to filter events by cat name
- Classification filter checkboxes (Entry Allowed, Exit Allowed, Contraband Detected, No Activity)
- Two tabs in Recent Activity: "Video Movement Events" and "All Events"
- Event classification badges with colour coding (🟢 Entry Allowed, 🔵 Exit Allowed, 🔴 Contraband Detected)
- Classification labels in desktop notifications with emoji colour coding
- Cat name displayed on each event (looked up via RFID profile, cached locally)
- Multiple cat names shown when event has multiple RFID codes
- Notification thumbnail image attached to desktop notifications
- Badge counter on tray icon showing number of missed events
- "Notify only on Video Movement" toggle in tray menu (persisted across restarts)
- "Check for Updates" in tray menu — checks GitHub releases and opens browser if update available
- RFID-to-cat-name cache persisted in settings file to reduce API calls
- Full event feed cached in memory on startup (no more Load More button)
- Uptime/connectivity info shown per device in tray menu
- UK date/time formatting throughout

### Changed
- Event thumbnails enlarged (96×72px)
- Activity window narrowed to 500px
- Video window set to 600px wide at 80% zoom
- All windows now show cat icon in taskbar
- App name set to "OnlyCat" (fixes "Electron" label in taskbar/notifications)
- "Connected" status removed from tray menu (only shown when disconnected/reconnecting)
- Event cache retries up to 3 times with backoff on startup failure

### Fixed
- Preload scripts now compile as CommonJS (fixes "exports is not defined" error)
- Renderer scripts compile as ES modules (fixes browser compatibility)
- Token and settings stored outside project directory (never committed to git)
- Import ordering and code cleanup for security review

## [1.0.0] - 2026-04-03

### Added
- Initial release
- System tray icon with device status
- Device token authentication with encrypted local storage
- Recent Activity window with event list, thumbnails and timestamps
- Live event notifications via Socket.IO subscriptions
- Video stream viewer (loads onlycat.app event page)
- Auto-reconnect with 60-second timeout notification
- Cross-platform builds for Linux (.deb, .AppImage), macOS (.zip) and Windows (.exe)
- GitHub Actions CI/CD workflow for automated releases
