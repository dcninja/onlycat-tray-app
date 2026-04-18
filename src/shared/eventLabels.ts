export function classificationLabel(classification?: number): string {
  switch (classification) {
    case 0: return 'No Activity';
    case 1: return 'Entry Allowed';
    case 2: return 'Exit Allowed';
    case 3: return 'Contraband Detected';
    default: return '';
  }
}

export function triggerSourceLabel(source?: number): string {
  switch (source) {
    case 1: return 'RFID Only';
    case 2: return 'Motion Only';
    case 3: return 'Motion + RFID';
    default: return 'Unknown';
  }
}

export function directionEmoji(direction: string): string {
  switch (direction.toUpperCase()) {
    case 'INWARD':  return '🢃';
    case 'OUTWARD': return '🢁';
    default: return '';
  }
}

export function actionEmoji(action: string): string {
  switch (action.toUpperCase()) {
    case 'PEEK':    return '👀';
    case 'DENY':    return '⛔';
    case 'TRANSIT': return '✅';
    default: return '';
  }
}

export function formatSubevent(direction: string, action: string): string {
  const dEmoji = directionEmoji(direction);
  const aEmoji = actionEmoji(action);
  const dir = direction === 'INWARD' ? 'In' : direction === 'OUTWARD' ? 'Out' : direction;
  const act = action.charAt(0) + action.slice(1).toLowerCase();
  return `${dEmoji} ${dir} ${aEmoji} ${act}`.trim();
}
