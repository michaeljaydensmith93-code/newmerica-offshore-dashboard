const API_KEY = window.API_KEY || '731a391e2f41251b8bcc';
const NATION_ID = 768640;
const RESOURCE_TYPES = ['food','coal','oil','uranium','iron','bauxite','lead','gasoline','munitions','steel','aluminum'];
const GRAPHQL_URL = `https://api.politicsandwar.com/graphql?api_key=${API_KEY}`;

const state = { orders: {}, lastFetched: null, pollingId: null, interval: 10000, enabledResources: new Set(RESOURCE_TYPES) };

function setStatus(text){ const n = document.getElementById('last-update'); if(n) n.textContent = `Last update: ${text}`; }

async function tryQuery(query, variables){
  try{
    const resp = await fetch(GRAPHQL_URL, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ query, variables }) });
    const j = await resp.json();
    return j;
  }catch(e){ return { error: e.message }; }
}

// Attempt to discover a suitable orders field and use it. This is best-effort.
async function fetchOrdersForResource(resource){
  // Candidate query trying a 'tradeorders' field common to P&W GraphQL (best guess)
  const q = `query Orders($res:String!,$first:Int){ tradeorders(resource:$res, first:$first) { data { id order_price order_quantity order_type resource creator_id created_at } } }`;
  const res = await tryQuery(q, { res: resource, first: 500 });
  if(res && res.data && res.data.tradeorders && Array.isArray(res.data.tradeorders.data)){
    return res.data.tradeorders.data.map(o=>({ id:o.id, price: Number(o.order_price||o.price||0), quantity: Number(o.order_quantity||o.quantity||0), type: o.order_type||o.type||'unknown', resource: o.resource||resource, creator: o.creator_id||null, raw: o }));
  }
  // second attempt with 'orders'
  const q2 = `query Orders($res:String!,$first:Int){ orders(resource:$res, first:$first) { data { id price quantity type resource creator_id created_at } } }`;
  const res2 = await tryQuery(q2, { res: resource, first: 500 });
  if(res2 && res2.data && res2.data.orders && Array.isArray(res2.data.orders.data)){
    return res2.data.orders.data.map(o=>({ id:o.id, price: Number(o.price||0), quantity: Number(o.quantity||0), type: o.type||'unknown', resource: o.resource||resource, creator: o.creator_id||null, raw: o }));
  }
  // If both failed, return null to indicate API doesn't expose orders via GraphQL
  return null;
}

async function pollAll(){
  const now = new Date();
  setStatus(now.toLocaleString());
  const resources = Array.from(state.enabledResources);
  const newOrders = {};
  for(const r of resources){
    const res = await fetchOrdersForResource(r);
    if(res === null){
      // API not exposing orders; bail out early
      document.getElementById('orders-list').innerHTML = `<div class="muted">API does not expose orders via GraphQL. Unable to fetch order book. If you have an alternative endpoint, configure it in code.</div>`;
      clearInterval(state.pollingId); state.pollingId = null; return;
    }
    newOrders[r] = res;
  }
  state.orders = newOrders; state.lastFetched = now;
  renderOrders();
}

function renderOrders(){
  const container = document.getElementById('orders-list');
  if(!container) return;
  const parts = [];
  for(const r of Object.keys(state.orders)){
    const rows = state.orders[r];
    // summary
    const totalBuy = rows.filter(x=>/(buy|bid)/i.test(x.type)).reduce((s,x)=>s + x.quantity,0);
    const totalSell = rows.filter(x=>/(sell|ask)/i.test(x.type)).reduce((s,x)=>s + x.quantity,0);
    const bestBuy = rows.filter(x=>/(buy|bid)/i.test(x.type)).sort((a,b)=>b.price-a.price)[0];
    const bestSell = rows.filter(x=>/(sell|ask)/i.test(x.type)).sort((a,b)=>a.price-b.price)[0];
    const header = `<div style="margin-bottom:6px;display:flex;justify-content:space-between;align-items:center"><div><strong style="color:#d1ad4a">${r.toUpperCase()}</strong> <span class="muted">Buy:${totalBuy.toLocaleString()} Sell:${totalSell.toLocaleString()}</span></div><div><span class="tag">Best Bid: ${bestBuy? window.marketUtils.formatMoney(bestBuy.price):'N/A'}</span> <span class="tag">Best Ask: ${bestSell? window.marketUtils.formatMoney(bestSell.price):'N/A'}</span></div></div>`;
    const table = `<table><thead><tr><th>Type</th><th>Price</th><th>Quantity</th><th>Creator</th></tr></thead><tbody>${rows.map(o=>`<tr data-resource="${r}" data-id="${o.id}" class="order-row"><td class="stat-label">${o.type}</td><td class="stat-label">${window.marketUtils.formatMoney(o.price)}</td><td class="stat-label">${o.quantity.toLocaleString()}</td><td class="stat-label">${o.creator||''}</td></tr>`).join('')}</tbody></table>`;
    parts.push(`<section style="margin-bottom:12px">${header}${table}</section>`);
  }
  container.innerHTML = parts.join('');
  // hook rows
  container.querySelectorAll('.order-row').forEach(r=> r.addEventListener('click', ()=>{ const id=r.dataset.id; const resource=r.dataset.resource; const ord = (state.orders[resource]||[]).find(x=>String(x.id)===String(id)); renderDetail(ord); }));
}

function renderDetail(ord){
  const out = document.getElementById('detail-body');
  if(!ord){ out.innerHTML = '<div class="muted">No order</div>'; return; }
  out.innerHTML = `<div><strong>${ord.resource.toUpperCase()} — ${ord.type}</strong></div><div style="margin-top:8px">Price: ${window.marketUtils.formatMoney(ord.price)}</div><div>Quantity: ${ord.quantity.toLocaleString()}</div><pre style="margin-top:8px;background:rgba(0,0,0,0.4);padding:8px;border-radius:6px;color:#cfe8ff;overflow:auto">${JSON.stringify(ord.raw, null, 2)}</pre>`;
}

function downloadJSON(){
  const blob = new Blob([JSON.stringify({ fetched: state.lastFetched, orders: state.orders }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `orders-${Date.now()}.json`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

function buildResourceFilter(){
  const container = document.getElementById('resource-filter');
  container.innerHTML = RESOURCE_TYPES.map(r=>`<label style="display:inline-flex;align-items:center;gap:6px"><input type="checkbox" data-resource="${r}" checked/> ${r.toUpperCase()}</label>`).join('');
  container.querySelectorAll('input[type=checkbox]').forEach(cb=> cb.addEventListener('change', ()=>{ const r=cb.dataset.resource; if(cb.checked) state.enabledResources.add(r); else state.enabledResources.delete(r); }));
}

function startPolling(){ if(state.pollingId) clearInterval(state.pollingId); state.pollingId = setInterval(pollAll, state.interval); }

document.getElementById && document.addEventListener('DOMContentLoaded', ()=>{
  buildResourceFilter();
  document.getElementById('refresh-now').addEventListener('click', pollAll);
  document.getElementById('download-json').addEventListener('click', downloadJSON);
  document.getElementById('poll-interval').addEventListener('change', (e)=>{ state.interval = Number(e.target.value); startPolling(); });
  // initial run
  pollAll(); startPolling();
});
