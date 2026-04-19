# Changelog

## [1.5.2] - 2026-04-19

### Fixed
- Event summaries (direction/action emojis) not showing on cached events after app restart
  - Summaries fetched from API were discarded during cache dedup before reaching the renderer
  - Backfill now runs before filtering, and updated events are re-sent to the activity window
  - Updated summaries are also persisted to SQLite so they survive future restarts
- Unknown Cats tab incorrectly showing known cats (e.g. Roxy)
  - Events without `rfidCodes` on the event object now also check subevent RFID codes from event summaries
  - Cat names are backfilled from the local RFID cache when loading events from SQLite
  - RFID cache is now sent to the renderer after live events arrive
- Activity window not coming to front on Linux when already open — window is now recreated on each open
- Video retry loop no longer infinite — capped at 6 retries (30 seconds), then shows permanent message
- Disconnect timer now cleared on sign out, preventing stale "connection lost" notifications
- Notification thumbnail temp files cleaned up after 60 seconds even if OS dismisses without click/close

### Changed
- Activity window stays on top on Linux (not on Windows/macOS where focus works natively)
- Search input debounced (200ms) for smoother typing with large event lists
- Event list uses DocumentFragment for batch DOM rendering instead of one-by-one append
- Full re-render skipped when visible event list hasn't changed
- New live events prepended directly to DOM instead of rebuilding entire list
- Thumbnail images use lazy loading to reduce initial load time
- Screenshots added to README

## [1.5.1] - 2026-04-19

### Fixed
- Event summaries (direction/action emojis) not showing on cached events after app restart
  - Summaries fetched from API were discarded during cache dedup before reaching the renderer
  - Backfill now runs before filtering, and updated events are re-sent to the activity window
  - Updated summaries are also persisted to SQLite so they survive future restarts
- Unknown Cats tab incorrectly showing known cats (e.g. Roxy)
  - Events without `rfidCodes` on the event object now also check subevent RFID codes from event summaries
  - Cat names are backfilled from the local RFID cache when loading events from SQLite
  - RFID cache is now sent to the renderer after live events arrive

## [1.5.0] - 2026-04-19

### Added
- **Favourites** — star button (⭐/☆) on each event card to mark favourites, persisted in SQLite (thanks @Alex-Ala)
- **Favourites tab** in Recent Activity — shows only starred events
- **Load More button restored** — events fetched one page at a time instead of full history on startup
  - Each page is cached to SQLite as it's loaded
  - Previously cached events load instantly from DB on startup
  - Dramatically reduces API strain for large event histories
- **General Settings page** — renamed from Notification Settings, now includes device token management (thanks @TeslaTap)
  - View and change device token without signing out
  - Token update reconnects automatically
- **Event summary caching** — `getEventSummary` results cached in SQLite, skipped on subsequent loads
- **Cache cleared on token change** — event DB wiped when signing out or changing token

### Changed
- Token input is now visible text (not masked) for easier entry (thanks @TeslaTap)
- Activity window height increased by 200px
- Settings window renamed from "Notification Settings" to "Settings"
- Removed automatic full event history fetch on startup
- Events are now cached incrementally as the user browses
- Initial load fetches last 24 hours of events (thanks @Alex-Ala)

## [1.3.1] - 2026-04-18

### Added
- Event summary with emojis shown on a new line in desktop notifications
- Test notification now fetches event summary before firing

## [1.3.0] - 2026-04-18

### Added
- **SQLite local database** — events are now persisted to `events.db` between sessions
  - First run fetches full event history with 250ms throttle between pages to be polite to the API
  - Subsequent runs load from DB instantly, then only fetch events newer than the last stored one
  - Live events are saved to DB as they arrive
  - Dramatically reduces API calls after first run
- **Event summary in notifications** — direction and action emojis shown on a new line in desktop notifications
- **Test notification enriched** — test notification now fetches event summary before firing

### Fixed
- Transit and Deny action filters were swapped in both the activity window and notification settings
- Action filter threshold was hardcoded to 2 — now correctly handles all 3 actions (Transit, Peek, Deny)

## [1.2.0] - 2026-04-18

### Added
- **Event Summary integration** — direction and action from `getEventSummary` API shown on each event card and in notifications
  - Emoji indicators: 🢃 Inward, 🢁 Outward, 👀 Peek, ⛔ Deny, ✅ Transit
  - Shows the final/last subevent outcome per event
- **Notification Settings window** — dedicated settings page replacing the simple tray toggle
  - Configure which event classifications trigger notifications
  - Filter by direction (Inward/Outward) and action (Transit, Peek, Deny)
  - Toggle for video movement only
  - Toggle for events without summary data
  - Settings persisted to disk and applied immediately
- **Unknown Cats tab** in Recent Activity — shows events with RFID codes not in your saved cat name cache, helping identify unregistered chips or visitor cats
- **Event Summary Filters** in Recent Activity — filter by direction (🢃/🢁) and action (✅/👀/⛔) with "No Summary" option
- **Deny (⛔)** added to action filters throughout
- New actions/directions automatically added to existing settings on upgrade (no manual reset needed)

### Changed
- "Notify only on Video Movement" tray toggle replaced with "⚙ Notification Settings" button
- Notification settings window height increased to 670px
- Event summary now shows last subevent (final outcome) rather than first
- Direction labels updated with emoji in all filter UIs
- Exit Allowed removed from classification filters (not used by the API)

### Fixed
- Deny filter not selected by default on first run
- Settings merge now preserves new defaults when upgrading from older versions

## [1.1.0] - 2026-04-17

### Added
- Door Policy section in tray menu — lists all policies per device, active policy marked with ✓, click to activate
- Share button (🔗) on each event card to copy the event URL to clipboard
- Search box in Recent Activity to filter events by cat name
- Classification filter checkboxes (Entry Allowed, Contraband Detected, No Activity)
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
