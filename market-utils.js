// Shared utilities for market pages
function safeNumber(v){ const n = Number(v); return Number.isFinite(n)?n:0; }
function formatMoney(v){ const n=safeNumber(v); const sign = n<0?'-':''; return `${sign}$${Math.abs(Math.round(n)).toLocaleString()}`; }
function formatNumber(v){ return safeNumber(v).toLocaleString(); }
function sparklineSVG(values, width=360, height=48, stroke='#d1ad4a'){
    if(!values || values.length === 0) return '';
    const nums = values.map(v=>Number(v||0));
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const range = (max - min) || 1;
    const step = width / Math.max(1, nums.length - 1);
    const points = nums.map((v,i)=>`${(i*step).toFixed(2)},${(height - ((v - min) / range) * height).toFixed(2)}`).join(' ');
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" style="display:block;margin-bottom:8px"><polyline fill="none" stroke="${stroke}" stroke-width="2" points="${points}" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

// Export helpers to window for other scripts
window.marketUtils = { safeNumber, formatMoney, formatNumber, sparklineSVG };
