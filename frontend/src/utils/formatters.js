// Utility formatters for industrial telemetry and diagnostics
export function formatTimestamp(epochSecondsOrMs) {
    if (!epochSecondsOrMs || isNaN(epochSecondsOrMs))
        return '—';
    // Check if epoch is in seconds (< 1e11) or ms
    const ms = epochSecondsOrMs < 1e11 ? epochSecondsOrMs * 1000 : epochSecondsOrMs;
    const d = new Date(ms);
    return d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) +
        '.' + String(d.getMilliseconds()).padStart(3, '0');
}
export function formatTimeAgo(epochSecondsOrMs) {
    if (!epochSecondsOrMs)
        return 'No data';
    const ms = epochSecondsOrMs < 1e11 ? epochSecondsOrMs * 1000 : epochSecondsOrMs;
    const diffMs = Math.max(0, Date.now() - ms);
    if (diffMs < 1000) {
        return `${Math.round(diffMs)} ms ago`;
    }
    if (diffMs < 60000) {
        return `${(diffMs / 1000).toFixed(1)} s ago`;
    }
    return `${Math.round(diffMs / 60000)} min ago`;
}
export function formatValue(val, decimals = 2, fallback = '—') {
    if (val === null || val === undefined || isNaN(val))
        return fallback;
    return Number(val).toFixed(decimals);
}
export function formatPercent(val) {
    if (val === null || val === undefined || isNaN(val))
        return '—';
    // If val is 0.0-1.0 scale, multiply by 100
    const pct = val <= 1.0 && val > 0 ? val * 100 : val;
    return `${Math.round(pct)}%`;
}
//# sourceMappingURL=formatters.js.map