interface TelemetryPoint {
  timestamp: string;
  measureName: string;
  value: number;
}

interface MetricConfig {
  measureName: string;
  canvasId: string;
  valueId: string;
  unit: string;
  color: string;
  format: (v: number) => string;
  chartFormat?: (v: number) => number; // transform raw values for chart display
}

// Convert RSSI dBm to percentage (typical range: -100 = 0%, -30 = 100%)
function rssiToPercent(rssi: number): number {
  const clamped = Math.max(-100, Math.min(-30, rssi));
  return Math.round(((clamped + 100) / 70) * 100);
}

const metrics: MetricConfig[] = [
  { measureName: 'wifi_rssi', canvasId: 'wifi-chart', valueId: 'wifi-value', unit: '%', color: '#5c6bc0', format: v => `${rssiToPercent(v)}% (${v.toFixed(0)} dBm)`, chartFormat: v => rssiToPercent(v) },
  { measureName: 'vbat', canvasId: 'vbat-chart', valueId: 'vbat-value', unit: 'V', color: '#66bb6a', format: v => `${v.toFixed(2)} V` },
  { measureName: 'vbus', canvasId: 'vbus-chart', valueId: 'vbus-value', unit: 'V', color: '#ffa726', format: v => `${v.toFixed(2)} V` },
  { measureName: 'tcpu', canvasId: 'tcpu-chart', valueId: 'tcpu-value', unit: '°C', color: '#ef5350', format: v => `${v.toFixed(1)} °C` },
  { measureName: 'uptime', canvasId: 'uptime-chart', valueId: 'uptime-value', unit: 'days', color: '#ab47bc', format: v => `${(v / 86400).toFixed(1)} days`, chartFormat: v => v / 86400 },
  { measureName: 'free_storage', canvasId: 'storage-chart', valueId: 'storage-value', unit: 'GB', color: '#26c6da', format: v => `${(v / 1073741824).toFixed(1)} GB`, chartFormat: v => v / 1073741824 },
];

let activeRange = '24h';

function rangeToSince(range: string): string {
  const now = Date.now();
  switch (range) {
    case '24h': return new Date(now - 24 * 60 * 60 * 1000).toISOString();
    case '7d': return new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    case '30d': return new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
    default: return new Date(now - 24 * 60 * 60 * 1000).toISOString();
  }
}

function drawChart(canvas: HTMLCanvasElement, points: TelemetryPoint[], color: string, transform?: (v: number) => number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx || points.length === 0) return;

  // Handle high-DPI displays
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  const padding = { top: 10, right: 10, bottom: 20, left: 45 };
  const chartW = w - padding.left - padding.right;
  const chartH = h - padding.top - padding.bottom;

  ctx.clearRect(0, 0, w, h);

  const values = points.map(p => transform ? transform(p.value) : p.value);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;

  const times = points.map(p => new Date(p.timestamp).getTime());
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const timeRange = maxTime - minTime || 1;

  // Draw grid lines
  ctx.strokeStyle = '#2a2a3e';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = padding.top + (chartH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(w - padding.right, y);
    ctx.stroke();
  }

  // Draw Y-axis labels
  ctx.fillStyle = '#616161';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const val = maxVal - (range / 4) * i;
    const y = padding.top + (chartH / 4) * i;
    ctx.fillText(val.toFixed(1), padding.left - 5, y + 3);
  }

  // Draw line
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();

  for (let i = 0; i < points.length; i++) {
    const x = padding.left + ((times[i] - minTime) / timeRange) * chartW;
    const y = padding.top + chartH - ((values[i] - minVal) / range) * chartH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Draw fill
  ctx.globalAlpha = 0.1;
  ctx.fillStyle = color;
  ctx.lineTo(padding.left + chartW, padding.top + chartH);
  ctx.lineTo(padding.left, padding.top + chartH);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  // Draw time labels
  ctx.fillStyle = '#616161';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'center';
  const labelCount = 4;
  for (let i = 0; i <= labelCount; i++) {
    const t = minTime + (timeRange / labelCount) * i;
    const x = padding.left + (chartW / labelCount) * i;
    const d = new Date(t);
    const label = activeRange === '24h'
      ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
    ctx.fillText(label, x, h - 4);
  }
}

async function loadMetrics(): Promise<void> {
  // Load latest values
  const latest = await (window as any).onlycat.getLatestTelemetry() as TelemetryPoint[];

  for (const metric of metrics) {
    const latestPoint = latest.find(p => p.measureName === metric.measureName);
    const valueEl = document.getElementById(metric.valueId);
    if (valueEl && latestPoint) {
      valueEl.textContent = metric.format(latestPoint.value);
    }

    // Load time series
    const points = await (window as any).onlycat.getTelemetry(metric.measureName, activeRange) as TelemetryPoint[];
    const canvas = document.getElementById(metric.canvasId) as HTMLCanvasElement;
    if (canvas && points.length > 0) {
      drawChart(canvas, points, metric.color, metric.chartFormat);
    } else if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);
        ctx.fillStyle = '#616161';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No data yet — check back in an hour', rect.width / 2, rect.height / 2);
      }
    }
  }
}

// Time range buttons
document.querySelectorAll<HTMLButtonElement>('.range-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeRange = btn.dataset.range ?? '24h';
    loadMetrics();
  });
});

// Initial load
loadMetrics();
