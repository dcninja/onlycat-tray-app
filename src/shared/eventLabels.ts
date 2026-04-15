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
