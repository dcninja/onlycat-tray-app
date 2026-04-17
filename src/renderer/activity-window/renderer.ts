import type { DeviceEvent } from '../../shared/types';

const eventList = document.getElementById('event-list') as HTMLUListElement;
const loadMoreBtn = document.getElementById('load-more-btn') as HTMLButtonElement;
const emptyMsg = document.getElementById('empty-msg') as HTMLParagraphElement;
const tabs = document.querySelectorAll<HTMLButtonElement>('.tab');
const searchInput = document.getElementById('search-input') as HTMLInputElement;
const filterChecks = document.querySelectorAll<HTMLInputElement>('.filter-check');

let allEvents: DeviceEvent[] = [];
let activeTab: 'video' | 'all' = 'video';
let searchTerm = '';
let activeClassifications: Set<number> = new Set([0, 1, 2, 3]);

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
  let events = activeTab === 'video'
    ? allEvents.filter(e => e.posterFrameIndex != null)
    : allEvents;

  if (searchTerm) {
    const term = searchTerm.toLowerCase();
    events = events.filter(e =>
      (e.catName ?? '').toLowerCase().includes(term)
    );
  }

  // Apply classification filters
  events = events.filter(e => {
    const cls = e.eventClassification ?? 0;
    return activeClassifications.has(cls);
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
      <span class="event-type event-meta">src:${event.eventTriggerSource ?? '?'} cls:${event.eventClassification ?? '?'}</span>
      <span class="event-time">${formatTime(event.createdAt ?? '')}</span>
    </div>
    <button class="share-btn" title="Copy link">🔗</button>
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
    activeTab = tab.dataset.tab as 'video' | 'all';
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

// IPC listeners
window.onlycat.onEventsList!((events: DeviceEvent[]) => {
  allEvents = events;
  renderList();
  loadMoreBtn.hidden = true; // all events loaded at once
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
