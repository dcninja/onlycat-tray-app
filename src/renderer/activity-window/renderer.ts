import type { DeviceEvent } from '../../shared/types';

const eventList = document.getElementById('event-list') as HTMLUListElement;
const loadMoreBtn = document.getElementById('load-more-btn') as HTMLButtonElement;
const emptyMsg = document.getElementById('empty-msg') as HTMLParagraphElement;
const tabs = document.querySelectorAll<HTMLButtonElement>('.tab');
const searchInput = document.getElementById('search-input') as HTMLInputElement;
const filterChecks = document.querySelectorAll<HTMLInputElement>('.filter-check');
const filterSummary = document.querySelectorAll<HTMLInputElement>('.filter-summary');

let allEvents: DeviceEvent[] = [];
let activeTab: 'video' | 'all' | 'unknown' | 'favourites' = 'video';
let searchTerm = '';
let activeClassifications: Set<number> = new Set([0, 1, 3]);
let activeDirections: Set<string> = new Set(['INWARD', 'OUTWARD']);
let activeActions: Set<string> = new Set(['TRANSIT', 'PEEK', 'DENY']);
let showNoSummary = true;
let knownRfids: Record<string, string> = {};

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
      // Check subevents for RFID codes if the event itself has none
      const rfids = e.rfidCodes?.length
        ? e.rfidCodes
        : (e.subevents?.map(s => s.rfidCode).filter((c): c is string => !!c) ?? []);
      if (!rfids.length) return true; // no RFID anywhere = unknown
      // If all RFID codes are known, this isn't an unknown cat
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

  // Summary filters — only filter events that have summary data
  // Events without summary data are controlled by the "No Summary" checkbox
  events = events.filter(e => {
    const lastSub = e.subevents?.[e.subevents.length - 1];
    if (!lastSub) return showNoSummary;
    // If direction filter is active and doesn't match, hide
    if (activeDirections.size < 2 && !activeDirections.has(lastSub.direction)) return false;
    // If action filter is active and doesn't match, hide
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
    ? `<img class="event-thumb" src="${event.thumbnailUrl}" alt="thumbnail" />`
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
    // Don't open video if share button was clicked
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
  eventList.innerHTML = '';
  for (const ev of visible) {
    eventList.appendChild(renderEvent(ev));
  }
  emptyMsg.hidden = visible.length > 0;
}

function updateEmptyState(): void {
  emptyMsg.hidden = visibleEvents().length > 0;
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

// Search
searchInput.addEventListener('input', () => {
  searchTerm = searchInput.value.trim();
  renderList();
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
  allEvents = events;
  renderList();
  loadMoreBtn.disabled = events.length === 0;
  loadMoreBtn.hidden = false;
});

window.onlycat.onEventsLoadMoreResult!((events: DeviceEvent[]) => {
  allEvents = [...allEvents, ...events];
  renderList();
  loadMoreBtn.disabled = events.length === 0;
});

window.onlycat.onEventPrepend!((event: DeviceEvent) => {
  allEvents = [event, ...allEvents];
  renderList();
});

// Load more — use smallest globalId as cursor
loadMoreBtn.addEventListener('click', () => {
  if (allEvents.length === 0) return;
  const minGlobalId = Math.min(...allEvents.map((e) => e.globalId));
  loadMoreBtn.disabled = true;
  window.onlycat.loadMore!(minGlobalId);
});

// Initial load
window.onlycat.loadMore!();
