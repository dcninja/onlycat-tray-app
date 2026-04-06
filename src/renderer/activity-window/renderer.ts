import type { DeviceEvent } from '../../shared/types';

const eventList = document.getElementById('event-list') as HTMLUListElement;
const loadMoreBtn = document.getElementById('load-more-btn') as HTMLButtonElement;
const emptyMsg = document.getElementById('empty-msg') as HTMLParagraphElement;
const tabs = document.querySelectorAll<HTMLButtonElement>('.tab');
const searchInput = document.getElementById('search-input') as HTMLInputElement;

let allEvents: DeviceEvent[] = [];
let activeTab: 'video' | 'all' = 'video';
let searchTerm = '';

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
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

  return events;
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
      ${event.catName ? `<span class="event-type">${event.catName}</span>` : ''}
      <span class="event-type event-meta">src:${event.eventTriggerSource ?? '?'} cls:${event.eventClassification ?? '?'}</span>
      <span class="event-time">${formatTime(event.createdAt ?? '')}</span>
    </div>
  `;

  li.addEventListener('click', () => {
    window.onlycat.openVideo!(event.deviceId, event.eventId);
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

// IPC listeners
window.onlycat.onEventsList!((events: DeviceEvent[]) => {
  allEvents = events;
  renderList();
  loadMoreBtn.disabled = events.length === 0;
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
