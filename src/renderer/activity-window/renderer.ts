import type { DeviceEvent } from '../../shared/types';

const eventList = document.getElementById('event-list') as HTMLUListElement;
const loadMoreBtn = document.getElementById('load-more-btn') as HTMLButtonElement;
const emptyMsg = document.getElementById('empty-msg') as HTMLParagraphElement;
const tabs = document.querySelectorAll<HTMLButtonElement>('.tab');
const searchInput = document.getElementById('search-input') as HTMLInputElement;
const filterChecks = document.querySelectorAll<HTMLInputElement>('.filter-check');
const filterSummary = document.querySelectorAll<HTMLInputElement>('.filter-summary');
const exportBtn = document.getElementById('export-btn') as HTMLButtonElement;

let allEvents: DeviceEvent[] = [];
let activeTab: 'video' | 'all' | 'unknown' | 'favourites' = 'video';
let searchTerm = '';
let activeClassifications: Set<number> = new Set([0, 1, 3]);
let activeDirections: Set<string> = new Set(['INWARD', 'OUTWARD']);
let activeActions: Set<string> = new Set(['TRANSIT', 'PEEK', 'DENY']);
let showNoSummary = true;
let knownRfids: Record<string, string> = {};
let lastRenderedIds: number[] = []; // track what's currently in the DOM
let lastRenderedFingerprint = ''; // track content changes (summaries etc)

// Debounce helper
function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout>;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  } catch {
    return iso;
  }
}

function visibleEvents(): DeviceEvent[] {
  let events = allEvents;

  if (activeTab === 'video') {
    events = events.filter(e => e.posterFrameIndex != null);
  } else if (activeTab === 'unknown') {
    events = events.filter(e => {
      if (e.catName) return false;
      const rfids = e.rfidCodes?.length
        ? e.rfidCodes
        : (e.subevents?.map(s => s.rfidCode).filter((c): c is string => !!c) ?? []);
      if (!rfids.length) return true;
      const allKnown = rfids.every(code => knownRfids[code]);
      return !allKnown;
    });
  } else if (activeTab === 'favourites') {
    events = events.filter(e => e.favourite === true);
  }

  if (searchTerm) {
    const term = searchTerm.toLowerCase();
    events = events.filter(e => (e.catName ?? '').toLowerCase().includes(term));
  }

  events = events.filter(e => {
    const cls = e.eventClassification ?? 0;
    return activeClassifications.has(cls);
  });

  events = events.filter(e => {
    const lastSub = e.subevents?.[e.subevents.length - 1];
    if (!lastSub) return showNoSummary;
    if (activeDirections.size < 2 && !activeDirections.has(lastSub.direction)) return false;
    if (activeActions.size < 3 && !activeActions.has(lastSub.action)) return false;
    return true;
  });

  return events;
}

function classificationBadge(cls?: number): string {
  switch (cls) {
    case 1: return `<span class="badge badge-green">Entry Allowed</span>`;
    case 2: return `<span class="badge badge-blue">Exit Allowed</span>`;
    case 3: return `<span class="badge badge-red">Contraband Detected</span>`;
    case 0: return `<span class="badge badge-grey">No Activity</span>`;
    default: return '';
  }
}

function renderEvent(event: DeviceEvent): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'event-item';
  li.dataset.globalId = String(event.globalId);

  const thumb = event.thumbnailUrl
    ? `<img class="event-thumb" src="${event.thumbnailUrl}" alt="thumbnail" loading="lazy" />`
    : `<div class="event-thumb-placeholder">📷</div>`;

  li.innerHTML = `
    ${thumb}
    <div class="event-info">
      <span class="event-device">${event.deviceName ?? event.deviceId}</span>
      ${classificationBadge(event.eventClassification)}
      ${event.catName ? `<span class="event-type">${event.catName}</span>` : ''}
      ${event.summary ? `<span class="event-summary">${event.summary}</span>` : ''}
      <span class="event-type event-meta">src:${event.eventTriggerSource ?? '?'} cls:${event.eventClassification ?? '?'}</span>
      <span class="event-time">${formatTime(event.createdAt ?? '')}</span>
    </div>
    <button class="share-btn" title="Copy link">🔗</button>
    <button class="fav-btn" title="Favourite">${event.favourite ? '⭐' : '☆'}</button>
  `;

  li.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).classList.contains('share-btn')) return;
    window.onlycat.openVideo!(event.deviceId, event.eventId);
  });

  const shareBtn = li.querySelector('.share-btn') as HTMLButtonElement;
  shareBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (event.videoUrl) {
      window.onlycat.copyUrl!(event.videoUrl);
      shareBtn.textContent = '✓';
      setTimeout(() => { shareBtn.textContent = '🔗'; }, 2000);
    }
  });

  const favBtn = li.querySelector('.fav-btn') as HTMLButtonElement;
  favBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const isFav = await window.onlycat.toggleFavourite!(event.globalId);
    event.favourite = isFav;
    favBtn.textContent = isFav ? '⭐' : '☆';
  });

  return li;
}

function renderList(): void {
  const visible = visibleEvents();
  const newIds = visible.map(e => e.globalId);

  // Build a fingerprint that includes summary data so we detect content changes
  const fingerprint = visible.map(e => `${e.globalId}:${e.summary ?? ''}`).join(',');

  // Skip full re-render if the visible list and content haven't changed
  if (fingerprint === lastRenderedFingerprint) {
    emptyMsg.hidden = visible.length > 0;
    return;
  }

  // Use DocumentFragment for batch DOM insertion
  const fragment = document.createDocumentFragment();
  for (const ev of visible) {
    fragment.appendChild(renderEvent(ev));
  }
  eventList.innerHTML = '';
  eventList.appendChild(fragment);
  lastRenderedIds = newIds;
  lastRenderedFingerprint = fingerprint;
  emptyMsg.hidden = visible.length > 0;
}

// Tab switching
tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    activeTab = tab.dataset.tab as 'video' | 'all' | 'unknown' | 'favourites';
    renderList();
  });
});

// Search — debounced to avoid filtering on every keystroke
const debouncedRender = debounce(() => renderList(), 200);
searchInput.addEventListener('input', () => {
  searchTerm = searchInput.value.trim();
  debouncedRender();
});

// Classification filters
filterChecks.forEach(checkbox => {
  checkbox.addEventListener('change', () => {
    activeClassifications = new Set(
      Array.from(filterChecks)
        .filter(c => c.checked)
        .map(c => parseInt(c.dataset.classification ?? '0'))
    );
    renderList();
  });
});

// Summary filters
filterSummary.forEach(checkbox => {
  checkbox.addEventListener('change', () => {
    activeDirections = new Set(
      Array.from(filterSummary)
        .filter(c => c.checked && c.dataset.direction)
        .map(c => c.dataset.direction!)
    );
    activeActions = new Set(
      Array.from(filterSummary)
        .filter(c => c.checked && c.dataset.action)
        .map(c => c.dataset.action!)
    );
    const noSummaryCheck = document.querySelector<HTMLInputElement>('.filter-summary[data-nosummary]');
    showNoSummary = noSummaryCheck?.checked ?? true;
    renderList();
  });
});

// Known RFIDs from main process
window.onlycat.onKnownRfids!((cache: Record<string, string>) => {
  knownRfids = cache;
  if (activeTab === 'unknown') renderList();
});

// IPC listeners
window.onlycat.onEventsList!((events: DeviceEvent[]) => {
  // Merge: keep any events from Load More that aren't in the new list
  const incomingIds = new Set(events.map(e => e.globalId));
  const keepFromExisting = allEvents.filter(e => !incomingIds.has(e.globalId));
  allEvents = [...events, ...keepFromExisting].sort((a, b) => b.globalId - a.globalId);
  renderList();
  loadMoreBtn.disabled = events.length === 0;
});

window.onlycat.onEventsLoadMoreResult!((events: DeviceEvent[]) => {
  // Dedup: only add events not already in the list
  const existingIds = new Set(allEvents.map(e => e.globalId));
  const newEvents = events.filter(e => !existingIds.has(e.globalId));
  allEvents = [...allEvents, ...newEvents];
  // Sort so newly loaded events appear in the correct chronological position
  allEvents.sort((a, b) => b.globalId - a.globalId);
  renderList();
  loadMoreBtn.disabled = events.length === 0;
});

window.onlycat.onEventPrepend!((event: DeviceEvent) => {
  // Dedup: skip if already in list
  if (allEvents.some(e => e.globalId === event.globalId)) return;
  allEvents = [event, ...allEvents];
  // Fast path: if the new event passes filters, prepend to DOM instead of full re-render
  const visible = visibleEvents();
  if (visible.length > 0 && visible[0].globalId === event.globalId) {
    const li = renderEvent(event);
    eventList.insertBefore(li, eventList.firstChild);
    lastRenderedIds = [event.globalId, ...lastRenderedIds];
    emptyMsg.hidden = true;
  } else {
    renderList();
  }
});

// Load more — paginate from the bottom of recent events, not ancient cached ones
loadMoreBtn.addEventListener('click', () => {
  if (allEvents.length === 0) return;
  // Find the smallest globalId among events from the last 14 days
  // This avoids using ancient cached events as the cursor
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const recentEvents = allEvents.filter(e => {
    const ts = e.createdAt ?? e.timestamp ?? '';
    return ts >= twoWeeksAgo;
  });
  const targetEvents = recentEvents.length > 0 ? recentEvents : allEvents;
  const minGlobalId = Math.min(...targetEvents.map(e => e.globalId));
  loadMoreBtn.disabled = true;
  window.onlycat.loadMore!(minGlobalId);
});

// Export visible events
exportBtn.addEventListener('click', async () => {
  const visible = visibleEvents();
  if (visible.length === 0) return;
  exportBtn.disabled = true;
  exportBtn.textContent = 'Exporting...';
  try {
    await window.onlycat.exportEvents!(visible);
  } catch { /* skip */ }
  exportBtn.textContent = '📥 Export';
  exportBtn.disabled = false;
});

// Initial load
window.onlycat.loadMore!();
