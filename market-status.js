const API_KEY = window.API_KEY || '731a391e2f41251b8bcc';
const NATION_ID = 768640;
const RESOURCE_TYPES = ['food','coal','oil','uranium','iron','bauxite','lead','gasoline','munitions','steel','aluminum','credits'];
const SAMPLE_NETS_KEY = 'finance_sample_nets_v1';
const RESERVE_STORAGE_KEY = 'finance_reserve_targets_v1';

function safeNumber(v){ const n = Number(v); return Number.isFinite(n)?n:0; }
function formatMoney(v){ const n=safeNumber(v); const sign = n<0?'-':''; return `${sign}$${Math.abs(Math.round(n)).toLocaleString()}`; }
function formatNumber(v){ return safeNumber(v).toLocaleString(); }

function getPriceMap(pr){ return { food: safeNumber(pr.food), coal: safeNumber(pr.coal), oil: safeNumber(pr.oil), uranium: safeNumber(pr.uranium), iron: safeNumber(pr.iron), bauxite: safeNumber(pr.bauxite), lead: safeNumber(pr.lead), gasoline: safeNumber(pr.gasoline), munitions: safeNumber(pr.munitions), steel: safeNumber(pr.steel), aluminum: safeNumber(pr.aluminum), credits: safeNumber(pr.credits) }; }
function computeStockpileValue(nation, priceMap){ return RESOURCE_TYPES.reduce((s,r)=>{ if(r==='credits') return s; return s + safeNumber(nation[r])*safeNumber(priceMap[r]); },0); }

function loadReserveTargets(){ try{ const r=localStorage.getItem(RESERVE_STORAGE_KEY); return r?JSON.parse(r):{};}catch(e){return{}} }
function loadSampleNets(){ try{ const r=localStorage.getItem(SAMPLE_NETS_KEY); return r?JSON.parse(r):null;}catch(e){return null;} }

async function fetchEconomyData(){
    const nationQuery = `query { nations(id: [${NATION_ID}], first: 1) { data { nation_name leader_name population num_cities score money credits food coal oil uranium iron bauxite lead gasoline munitions steel aluminum emergency_gasoline_reserve } } }`;
    const priceQuery = `query { tradeprices(first: 20) { data { date food coal oil uranium iron bauxite lead gasoline munitions steel aluminum credits } } }`;
    const [nR,pR] = await Promise.all([
        fetch(`https://api.politicsandwar.com/graphql?api_key=${API_KEY}`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ query: nationQuery }) }),
        fetch(`https://api.politicsandwar.com/graphql?api_key=${API_KEY}`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ query: priceQuery }) })
    ]);
    const nj = await nR.json(); const pj = await pR.json();
    const nation = nj?.data?.nations?.data?.[0] || null;
    const priceRows = sortMarketRowsNewestFirst(pj?.data?.tradeprices?.data);
    return { nation, priceRows };
}

function computeMarketStatus(nation, priceRows){
    const latest = getLatestMarketRow(priceRows);
    const priceMap = getPriceMap(latest);
    const targets = loadReserveTargets();
    const sample = loadSampleNets();
    const resources = RESOURCE_TYPES.slice(); if(!resources.includes('credits')) resources.push('credits');
    let totalDeficitValue = 0;
    const rows = resources.map(r=>{
        const cur = r==='credits' ? Number(nation.credits||0) * Number(priceMap.credits||0) : Number(nation[r]||0);
        const target = Number(targets[r]||0);
        const shortfall = Math.max(0, target - cur);
        const sValue = r==='credits' ? shortfall : (priceMap[r] ? shortfall * priceMap[r] : 0);
        totalDeficitValue += sValue;
        return { resource:r, cur, target, shortfall, shortfallValue:sValue, price: priceMap[r] };
    });
    return { rows, totalDeficitValue, liquidCash: Number(nation.money || 0) + (Number(nation.credits||0) * Number(priceMap.credits || 0)), priceRows };
}

// use sparklineSVG from market-utils.js via window.marketUtils.sparklineSVG

function renderMarketPage(status){
    document.getElementById('ms-liquid').textContent = formatMoney(status.liquidCash);
    document.getElementById('ms-deficit').textContent = formatMoney(status.totalDeficitValue);
    const oper = document.getElementById('ms-oper');
    if(status.totalDeficitValue <= 0){ oper.textContent = 'Fully funded — normal operations'; oper.style.color = '#6dd0ad'; }
    else if(status.liquidCash >= status.totalDeficitValue){ oper.textContent = 'Operable — funds cover shortfall'; oper.style.color = '#6dd0ad'; }
    else { oper.textContent = 'Not operable — insufficient funds'; oper.style.color = '#ff8b7d'; }

    const body = document.getElementById('ms-body');
    body.innerHTML = status.rows.map(it=>{
        const label = it.resource.charAt(0).toUpperCase()+it.resource.slice(1);
        const cur = it.resource==='credits'? formatMoney(it.cur): formatNumber(it.cur);
        const tgt = it.resource==='credits'? formatMoney(it.target): formatNumber(it.target);
        const sh = it.resource==='credits'? formatMoney(it.shortfall): formatNumber(it.shortfall);
        const sval = it.shortfallValue? formatMoney(it.shortfallValue) : 'N/A';
        return `<tr class="ms-row" data-resource="${it.resource}"><td class="stat-label">${label}</td><td class="stat-label">${tgt}</td><td class="stat-label">${cur}</td><td class="stat-label">${sh}</td><td class="stat-value">${sval}</td></tr>`;
    }).join('');

    // attach click handlers
    document.querySelectorAll('.ms-row').forEach(r=>{
        r.addEventListener('click', ()=>{
            const res = r.dataset.resource;
            renderDetail(res, status, status.priceRows);
        });
    });
}

function renderDetail(resource, status, priceRows){
    const panel = document.getElementById('ms-insights');
    const trends = document.getElementById('ms-trends');
    const detail = document.getElementById('ms-detail');
    panel.style.display = 'block';
    const hist = (priceRows||[]).map(rw=>({date:rw.date, price: Number(rw[resource]||0)})).filter(h=>Number.isFinite(h.price));
    const latest = hist[hist.length-1] || null; const prev = hist[hist.length-2] || null;
    const avgPrev3 = (hist.slice(Math.max(0,hist.length-4), hist.length-1).reduce((s,x)=>s+(x.price||0),0) / Math.max(1, Math.min(3, hist.length-1)));
    const pctChange = prev && prev.price ? ((latest.price - prev.price)/Math.abs(prev.price))*100 : (avgPrev3 ? ((latest.price - avgPrev3)/Math.abs(avgPrev3))*100 : 0);
    // render sparkline + trend summary
    const histPrices = hist.map(h=>h.price);
    const svg = sparklineSVG(histPrices, 360, 48);
    trends.innerHTML = svg + `<strong style="color:#d1ad4a">${resource.charAt(0).toUpperCase()+resource.slice(1)} trends:</strong> latest ${latest? formatMoney(latest.price):'N/A'} — ${prev? (pctChange>=0?'+':'')+pctChange.toFixed(2)+'%':'no prior data'}`;
    // recommendation
    const targets = loadReserveTargets(); const row = status.rows.find(r=>r.resource===resource);
    const rec = [];
    if(row.shortfall>0){ if(pctChange>1) rec.push('Price rising — buy now to cover shortfall'); else if(pctChange < -1) rec.push('Price falling — consider delaying purchases'); else rec.push('Stable price — buy opportunistically'); }
    else { if(pctChange>1) rec.push('No shortfall; price rising — consider selling surplus'); else rec.push('No action needed'); }

    const histRows = hist.slice(-10).reverse().map(h=>`<tr><td class="stat-label">${h.date}</td><td class="stat-value">${formatMoney(h.price)}</td></tr>`).join('');
    detail.innerHTML = `<div style="color:#99a7c0;margin-bottom:8px">Target: ${row.resource==='credits'?formatMoney(row.target):formatNumber(row.target)} • Current: ${row.resource==='credits'?formatMoney(row.cur):formatNumber(row.cur)} • Shortfall: ${row.resource==='credits'?formatMoney(row.shortfall):formatNumber(row.shortfall)}</div><div style="color:#eef3f9;margin-bottom:8px">Recommendation: ${rec.join('. ')}</div><table style="width:100%"><thead><tr><th>Date</th><th>Price</th></tr></thead><tbody>${histRows}</tbody></table>`;
    panel.scrollIntoView({ behavior:'smooth', block:'center' });
}

async function initMarketPage(){
    try{
        const { nation, priceRows } = await fetchEconomyData();
        if(!nation) throw new Error('Nation data not available');
        const status = computeMarketStatus(nation, priceRows);
        renderMarketPage(status);
    }catch(e){ console.error('market page error', e); }
}

initMarketPage();
