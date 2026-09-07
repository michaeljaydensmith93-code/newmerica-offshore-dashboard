const API_KEY = window.API_KEY || '731a391e2f41251b8bcc';
const NATION_ID = 768640;
const RESOURCE_TYPES = ['food','coal','oil','uranium','iron','bauxite','lead','gasoline','munitions','steel','aluminum','credits'];
const STOCKPILE_TYPES = RESOURCE_TYPES.filter(resource => resource !== 'credits');
let currentSummary = null;
let lastRawData = null;
const RESERVE_STORAGE_KEY = 'finance_reserve_targets_v1';
const SAMPLE_NETS_KEY = 'finance_sample_nets_v1';
const ECONOMY_CACHE_KEY = 'finance_economy_snapshot_v1';

// User-provided 1-day baseline (absolute units required to run for a single day)
const USER_ONE_DAY_BASELINE = {
    coal: 6,
    oil: 78,
    lead: 156,
    iron: 6,
    bauxite: 78,
    food: 5446,
    uranium: 105
};

function safeNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function renderMarketResourceDetail(resource, info, summary){
    const panel = document.getElementById('market-insights');
    const trendsNode = document.getElementById('market-trends');
    const detailNode = document.getElementById('market-detail');
    if(!panel || !trendsNode || !detailNode) return;
    panel.style.display = 'block';
    const priceRows = summary.priceRows || [];
    // compute history for resource
    const hist = priceRows.map(rw=>({ date: rw.date, price: Number(rw[resource]||0) })).filter(h=>Number.isFinite(h.price));
    const latest = hist[hist.length-1] || null;
    const prev = hist[hist.length-2] || null;
    const avgPrev3 = (hist.slice(Math.max(0,hist.length-4), hist.length-1).reduce((s,x)=>s+(x.price||0),0) / Math.max(1, Math.min(3, hist.length-1)));
    const pctChange = prev && prev.price ? ((latest.price - prev.price)/Math.abs(prev.price))*100 : (avgPrev3 ? ((latest.price - avgPrev3)/Math.abs(avgPrev3))*100 : 0);

    const histPrices = hist.map(h=>h.price);
    const svg = (window.marketUtils && window.marketUtils.sparklineSVG) ? window.marketUtils.sparklineSVG(histPrices, 360, 48) : '';
    trendsNode.innerHTML = svg + `<strong style="color:var(--accent);">${resource.charAt(0).toUpperCase()+resource.slice(1)} trends:</strong> latest ${latest ? formatMoney(latest.price) : 'N/A'} — ${prev? (pctChange>=0?'+':'')+pctChange.toFixed(2)+'%': 'no prior data'}.`;

    // recommendation logic: if shortfall exists and price trending up -> buy now; trending down -> wait
    const recParts = [];
    if(info.shortfall > 0){
        if(pctChange > 1) recParts.push('Price rising — recommend buying now to cover shortfall.');
        else if(pctChange < -1) recParts.push('Price falling — consider delaying purchases until price stabilizes.');
        else recParts.push('Price stable — opportunistic buying advised based on liquidity.');
    } else {
        if(pctChange > 1) recParts.push('No shortfall but price rising — consider selling surplus for profit.');
        else recParts.push('No action needed.');
    }

    // render simple history table
    const histRows = hist.slice(-8).reverse().map(h=>`<tr><td class="stat-label">${h.date}</td><td class="stat-value">${formatMoney(h.price)}</td></tr>`).join('');
    detailNode.innerHTML = `
        <div style="margin-bottom:8px;color:var(--muted);">Target: ${info.resource==='credits'?formatMoney(info.target):formatNumber(info.target)} • Current: ${info.resource==='credits'?formatMoney(info.cur):formatNumber(info.cur)} • Shortfall: ${info.resource==='credits'?formatMoney(info.shortfall):formatNumber(info.shortfall)}</div>
        <div style="margin-bottom:8px;color:var(--text);">Recommendation: ${recParts.join(' ')}</div>
        <div style="max-width:420px;overflow:auto;"><table class="stat-list"><thead><tr><th>Date</th><th>Price</th></tr></thead><tbody>${histRows}</tbody></table></div>
    `;
    // scroll insights into view
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function formatNumber(value) {
    return safeNumber(value).toLocaleString();
}

function formatMoney(value) {
    const n = safeNumber(value);
    const sign = n < 0 ? '-' : '';
    return `${sign}$${Math.abs(Math.round(n)).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function animateNumber(node, start, end, formatter, duration = 900) {
    if (!node) return;
    const from = safeNumber(start);
    const to = safeNumber(end);
    const startTime = performance.now();

    function step(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const current = from + (to - from) * progress;
        node.textContent = formatter(current);
        if (progress < 1) {
            requestAnimationFrame(step);
        }
    }

    requestAnimationFrame(step);
}

function getPriceMap(prices = {}) {
    return {
        food: safeNumber(prices.food),
        coal: safeNumber(prices.coal),
        oil: safeNumber(prices.oil),
        uranium: safeNumber(prices.uranium),
        iron: safeNumber(prices.iron),
        bauxite: safeNumber(prices.bauxite),
        lead: safeNumber(prices.lead),
        gasoline: safeNumber(prices.gasoline),
        munitions: safeNumber(prices.munitions),
        steel: safeNumber(prices.steel),
        aluminum: safeNumber(prices.aluminum),
        credits: safeNumber(prices.credits)
    };
}

function computeStockpileValue(nation, priceMap) {
    return STOCKPILE_TYPES.reduce((sum, resource) => {
        return sum + safeNumber(nation[resource]) * safeNumber(priceMap[resource]);
    }, 0);
}

function isTcoTransaction(record, nationId, allianceId) {
    const sender = String(record?.sender_id || '');
    const receiver = String(record?.receiver_id || '');
    return (sender === String(nationId) && receiver === String(allianceId)) || (sender === String(allianceId) && receiver === String(nationId));
}

function getLoanTransactionType(record, nationId) {
    const note = String(record?.note || '').toLowerCase();
    const sender = String(record?.sender_id || '');
    const amount = Math.abs(safeNumber(record?.money));
    if (!amount) return '';
    if (note.includes('#loan') || note.includes('loan')) return sender === String(nationId) ? 'repayment' : 'loan';
    if (sender === String(nationId) && !note.includes('#deposit') && !note.includes('deposit') && !note.includes('preparation')) {
        const hasResources = RESOURCE_TYPES.some(resource => safeNumber(record?.[resource]) !== 0);
        if (!hasResources) return 'repayment';
    }
    return '';
}

function calculateAllianceLoan(records, nationId) {
    const ordered = [...records].sort((first, second) => {
        const firstDate = Date.parse(first?.date || '') || 0;
        const secondDate = Date.parse(second?.date || '') || 0;
        return firstDate - secondDate || (Number(first?.id) || 0) - (Number(second?.id) || 0);
    });
    let debt = 0;
    let repayments = 0;
    ordered.forEach(record => {
        const type = getLoanTransactionType(record, nationId);
        const amount = Math.abs(safeNumber(record?.money));
        if (type === 'loan') debt += amount;
        if (type === 'repayment') { repayments += amount; debt = Math.max(0, debt - amount); }
    });
    return { debt, repayments };
}

function buildNationSummary(nation, priceRows) {
    const latest = getLatestMarketRow(priceRows);
    const priceMap = getPriceMap(latest);
    const stockpileValue = computeStockpileValue(nation, priceMap);
    return {
        nation,
        priceMap,
        priceDate: latest.date || 'latest',
        priceRows: Array.isArray(priceRows) ? priceRows : [],
        stockpileValue,
        allianceLoan: { debt: 0, repayments: 0 }
    };
}

function renderHeroCards(summary) {
    const values = {
        'finance-cash': formatMoney(summary.nation.money),
        'finance-credits': formatMoney(summary.nation.credits * safeNumber(summary.priceMap.credits)),
        'finance-stockpile': formatMoney(summary.stockpileValue),
        'finance-loan-debt': formatMoney(-safeNumber(summary.allianceLoan?.debt))
    };
    Object.entries(values).forEach(([id, value]) => {
        const node = document.getElementById(id);
        if (!node) return;
        node.textContent = value;
        animateNumber(node, 0, id === 'finance-cash' ? summary.nation.money : id === 'finance-credits' ? summary.nation.credits * safeNumber(summary.priceMap.credits) : id === 'finance-stockpile' ? summary.stockpileValue : -safeNumber(summary.allianceLoan?.debt), formatMoney, 950);
    });
}

function calculateCommerceIncome(nation, localCities = []) {
    const cities = Array.isArray(nation?.cities) ? nation.cities : [];
    if (!cities.length) {
        return { rows: [], total: 0, commerce: 0 };
    }

    const localById = new Map((Array.isArray(localCities) ? localCities : []).map(city => [String(city.id), city]));
    const localByName = new Map((Array.isArray(localCities) ? localCities : []).map(city => [String(city.name || '').trim().toLowerCase(), city]));
    const nationPopulation = safeNumber(nation?.population);
    const fallbackPopulation = cities.length > 0 ? nationPopulation / cities.length : 0;

    const cityPopulations = cities.map(city => {
        const local = localById.get(String(city.id)) || localByName.get(String(city.name || '').trim().toLowerCase());
        const localPopulation = safeNumber(local?.city_population || local?.population);
        const directPopulation = safeNumber(city.city_population || city.population || city.population_estimate);
        return Math.max(localPopulation, directPopulation, fallbackPopulation, 0);
    });

    const totalCityPopulation = cityPopulations.reduce((sum, value) => sum + value, 0) || Math.max(nationPopulation, 1);

    const rows = cities.map((city, index) => {
        const cityPopulation = cityPopulations[index] || (totalCityPopulation / Math.max(1, cities.length));
        const local = localById.get(String(city.id)) || localByName.get(String(city.name || '').trim().toLowerCase());
        const buildingCommerce = (
            safeNumber(city.supermarket) * 4 +
            safeNumber(city.bank) * 6 +
            safeNumber(city.shopping_mall) * 8 +
            safeNumber(city.stadium) * 10 +
            safeNumber(city.subway) * 8 +
            safeNumber(city.commerce) || 0
        );
        const commerce = safeNumber(city.commerce) || Math.max(buildingCommerce, 0);
        const income = (((commerce / 50) * 0.725) + 0.725) * cityPopulation;
        const sourceText = safeNumber(city.commerce) > 0 ? 'Live commerce' : (local || city.supermarket || city.bank || city.shopping_mall ? 'Building fallback' : 'Population fallback');

        return {
            name: city.name || 'Unnamed city',
            population: cityPopulation,
            commerce,
            income,
            source: `${sourceText}; city population normalized`
        };
    });

    return {
        rows,
        total: rows.reduce((sum, row) => sum + row.income, 0),
        commerce: rows.reduce((sum, row) => sum + row.commerce, 0)
    };
}

function renderCommerceIncome(summary, localCities = []) {
    const section = document.getElementById('income-section');
    const body = document.getElementById('income-body');
    if (!section || !body) return;
    const income = calculateCommerceIncome(summary.nation, localCities);
    section.style.display = 'block';
    document.getElementById('income-total').textContent = formatMoney(income.total);
    document.getElementById('income-average').textContent = formatMoney(income.total / Math.max(1, income.rows.length));
    document.getElementById('income-commerce').textContent = formatNumber(income.commerce);
    body.innerHTML = income.rows.map(row => `<tr><td class="stat-label">${row.name}</td><td class="stat-label">${formatNumber(row.population)}</td><td class="stat-label">${formatNumber(row.commerce)}</td><td class="stat-value">${formatMoney(row.income)}</td><td class="stat-label">${row.source}</td></tr>`).join('') || '<tr><td colspan="5" class="stat-value">No city data returned</td></tr>';
}

function setupSubgroupLogHandlers() {
    document.querySelectorAll('.hero-card[data-group]').forEach(card => {
        card.addEventListener('click', () => {
            const group = card.dataset.group;
            handleSubgroupClick(group);
        });
    });
}

function handleSubgroupClick(group) {
    if (!currentSummary) return;
    renderTransactionLog(currentSummary, group);
    const section = document.getElementById('transaction-log-section');
    if (section) {
        section.style.display = 'block';
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function buildTransactionLog(summary, group) {
    const now = new Date().toLocaleString();
    const cashValue = formatMoney(summary.nation.money);
    const creditPrice = formatMoney(summary.priceMap.credits);
    const creditValue = formatMoney(summary.nation.credits * safeNumber(summary.priceMap.credits));
    const stockpileValue = formatMoney(summary.stockpileValue);

    if (group === 'cash') {
        return [
            { date: now, event: 'Cash balance refreshed', detail: 'Latest liquid cash position calculated', value: cashValue },
            { date: now, event: 'Liquidity status checked', detail: 'Available cash versus recent obligations', value: cashValue },
            { date: summary.priceDate, event: 'Cash benchmark recorded', detail: 'Latest refresh timestamp for cash reserves', value: cashValue }
        ];
    }

    if (group === 'credits') {
        return [
            { date: now, event: 'Credit value updated', detail: `Credits revalued at ${creditPrice} per unit`, value: creditValue },
            { date: now, event: 'Credit exposure review', detail: 'Projected cash equivalence for total credits', value: creditValue },
            { date: summary.priceDate, event: 'Pricing snapshot stored', detail: 'Credit pricing timestamp recorded', value: creditPrice }
        ];
    }

    if (group === 'loan') {
        return [
            { date: now, event: 'Alliance loan balance refreshed', detail: 'TCO loan receipts less verified repayments', value: formatMoney(-safeNumber(summary.allianceLoan?.debt)) },
            { date: now, event: 'Verified repayments counted', detail: 'Cash-only repayments sent to TCO', value: formatMoney(summary.allianceLoan?.repayments) },
            { date: summary.priceDate, event: 'Loan ledger checked', detail: 'Chronological bank transaction scan', value: formatMoney(-safeNumber(summary.allianceLoan?.debt)) }
        ];
    }

    return [
        { date: now, event: 'Stockpile valuation updated', detail: 'Total resource inventory value refreshed', value: stockpileValue },
        { date: now, event: 'Inventory market check', detail: 'Latest trade prices applied to stockpiles', value: stockpileValue },
        { date: summary.priceDate, event: 'Stock values timestamped', detail: 'Stockpile prices aligned with latest trade data', value: stockpileValue }
    ];
}

function renderTransactionLog(summary, group) {
    const rows = buildTransactionLog(summary, group);
    const body = document.getElementById('transaction-log-body');
    const intro = document.getElementById('transaction-log-intro');
    if (intro) {
        intro.textContent = `Showing latest activity for ${group === 'stockpile' ? 'stockpile market value' : group} subgroup.`;
    }
    if (body) {
        body.innerHTML = rows.map(row => `
            <tr>
                <td class="stat-label">${row.date}</td>
                <td class="stat-label">${row.event}</td>
                <td class="stat-label">${row.detail}</td>
                <td class="stat-value">${row.value}</td>
            </tr>`).join('');
    }
}

function renderStockpileBreakdown(summary) {
    const breakdownRows = [];

    breakdownRows.push({
        asset: 'Cash',
        quantity: formatMoney(summary.nation.money),
        price: '$1',
        value: formatMoney(summary.nation.money)
    });

    breakdownRows.push({
        asset: 'Credits',
        quantity: formatNumber(summary.nation.credits),
        price: formatMoney(summary.priceMap.credits),
        value: formatMoney(summary.nation.credits * safeNumber(summary.priceMap.credits))
    });

    STOCKPILE_TYPES.forEach(resource => {
        const quantity = safeNumber(summary.nation[resource]);
        const price = safeNumber(summary.priceMap[resource]);
        breakdownRows.push({
            asset: resource.charAt(0).toUpperCase() + resource.slice(1),
            quantity: formatNumber(quantity),
            price: price ? formatMoney(price) : 'N/A',
            value: formatMoney(quantity * price)
        });
    });

    breakdownRows.push({
        asset: 'Total stockpile value',
        quantity: '-',
        price: '-',
        value: formatMoney(summary.stockpileValue)
    });

    document.getElementById('stockpile-breakdown-body').innerHTML = breakdownRows.map(row => `
        <tr>
            <td class="stat-label">${row.asset}</td>
            <td class="holding-quantity">${row.quantity}</td>
            <td class="holding-market-value">${row.price}</td>
            <td class="holding-market-value">${row.value}</td>
        </tr>
    `).join('');
}

function renderMarketStatus(summary){
    const container = document.getElementById('market-status-section');
    const body = document.getElementById('market-status-body');
    if(!container || !body) return;
    container.style.display = 'block';
    const nation = summary?.nation || {};
    const priceMap = summary?.priceMap || {};
    const targets = Object.assign({}, loadReserveTargets());
    const resources = RESOURCE_TYPES.slice(); if(!resources.includes('credits')) resources.push('credits');

    let totalDeficitValue = 0;
    const rows = resources.map(r=>{
        const target = Number(targets[r]||0);
        const cur = r === 'credits' ? (Number(nation.credits||0) * Number(priceMap.credits||0)) : Number(nation[r]||0);
        let shortfall = 0;
        if(r === 'credits'){
            shortfall = Math.max(0, target - cur);
        } else {
            shortfall = Math.max(0, target - cur);
        }
        const price = Number(priceMap[r]||0);
        const shortfallValue = r === 'credits' ? shortfall : (price ? shortfall * price : 0);
        totalDeficitValue += shortfallValue;
        return { resource: r, target, cur, shortfall, shortfallValue, price };
    });

    // render rows and make clickable for per-resource breakdown
    body.innerHTML = rows.map(it=>{
        const resLabel = it.resource.charAt(0).toUpperCase()+it.resource.slice(1);
        const currentDisplay = it.resource==='credits' ? formatMoney(it.cur) : formatNumber(it.cur);
        const targetDisplay = it.resource==='credits' ? formatMoney(it.target) : formatNumber(it.target);
        const shortfallDisplay = it.resource==='credits' ? formatMoney(it.shortfall) : formatNumber(it.shortfall);
        const shortfallValueDisplay = it.shortfallValue ? formatMoney(it.shortfallValue) : (it.price? formatMoney(it.shortfallValue) : 'N/A');
        return `<tr data-resource="${it.resource}" class="market-row"><td class="stat-label">${resLabel}</td><td class="stat-label">${targetDisplay}</td><td class="stat-label">${currentDisplay}</td><td class="stat-label">${shortfallDisplay}</td><td class="stat-value">${shortfallValueDisplay}</td></tr>`;
    }).join('');

    // attach click handlers to rows
    body.querySelectorAll('.market-row').forEach(row=>{
        row.addEventListener('click', ()=>{
            const r = row.dataset.resource;
            renderMarketResourceDetail(r, rows.find(x=>x.resource===r), summary);
        });
    });

    // summary
    const liquidCash = Number(nation.money || 0) + (Number(nation.credits||0) * Number(priceMap.credits || 0));
    const liquidNode = document.getElementById('market-liquid-cash');
    const deficitNode = document.getElementById('market-total-deficit');
    const operNode = document.getElementById('market-operability');
    if(liquidNode) liquidNode.textContent = formatMoney(liquidCash);
    if(deficitNode) deficitNode.textContent = formatMoney(totalDeficitValue);
    if(operNode){
        if(totalDeficitValue <= 0){
            operNode.textContent = 'Fully funded — can operate normally';
            operNode.style.color = 'var(--positive)';
        } else if(liquidCash >= totalDeficitValue){
            const pct = Math.round((liquidCash/totalDeficitValue)*100);
            operNode.textContent = `Operable — funds cover ${pct}% of shortfall (ready to buy)`;
            operNode.style.color = 'var(--positive)';
        } else {
            const pct = Math.round((liquidCash/totalDeficitValue)*100);
            operNode.textContent = `Not operable — funds cover ${pct}% of shortfall (insufficient)`;
            operNode.style.color = 'var(--negative)';
        }
    }
    // update top hero card summary
    const heroVal = document.getElementById('market-hero-value');
    const heroNote = document.getElementById('market-hero-note');
    if(heroVal) heroVal.textContent = totalDeficitValue ? formatMoney(totalDeficitValue) : '$0';
    if(heroNote) heroNote.textContent = totalDeficitValue <= 0 ? 'Fully funded — operates normally' : (liquidCash >= totalDeficitValue ? 'Operable — funds sufficient to purchase shortfall' : 'Not operable — insufficient liquid funds');
}

function loadReserveTargets() {
    try {
        const raw = localStorage.getItem(RESERVE_STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
}

function saveReserveTargets(obj) {
    try { localStorage.setItem(RESERVE_STORAGE_KEY, JSON.stringify(obj)); } catch (e) {}
}

// expose current targets to other scripts
function exposeReserveTargets(){
    try{ window.financeReserveTargets = loadReserveTargets(); }catch(e){ window.financeReserveTargets = {}; }
}

function getPerCapitaMap() {
    return { food:0.001, coal:0.0001, oil:0.00008, gasoline:0.00005, uranium:0.000001, iron:0.00005, bauxite:0.00003, lead:0.00002, munitions:0.00001, steel:0.00002, aluminum:0.000015 };
}

function computeDefaultTargetUnits(resource, population, priceMap, days){
    const perCapita = getPerCapitaMap();
    if(resource === 'credits'){
        // estimate money needed to buy daily consumption across resources for `days`
        const dailyCost = Object.keys(perCapita).reduce((s,r)=>{
            const pc = Number(perCapita[r]||0);
            const price = Number(priceMap[r]||0);
            return s + pc * Number(population||0) * price;
        },0);
        return Math.round(dailyCost * days);
    }
    const pc = Number(perCapita[resource]||0);
    return Math.round(pc * Number(population||0) * Number(days||10));
}

async function fetchLiveProductionConsumption(summary){
    const cachedCities = Array.isArray(summary?.nation?.cities) ? summary.nation.cities : [];
    if(cachedCities.length) return calculateLiveProductionConsumption(summary.nation, cachedCities);
    const query = `query { nations(id: [${NATION_ID}], first: 1) { data { population num_cities cities { id name land farm iron_mine coal_mine lead_mine bauxite_mine oil_well uranium_mine steel_mill oil_refinery aluminum_refinery munitions_factory } } } }`;
    const response = await fetch(`https://api.politicsandwar.com/graphql?api_key=${API_KEY}`, { method:'POST', cache:'no-store', headers:{'Content-Type':'application/json'}, body:JSON.stringify({query}) });
    const json = await response.json();
    if(json.errors?.length) throw new Error(json.errors[0].message || 'City production query failed');
    const nation = json.data?.nations?.data?.[0];
    const cities = Array.isArray(nation?.cities) ? nation.cities : [];
    if(!cities.length) throw new Error('No city production data returned');
    return calculateLiveProductionConsumption(nation, cities);
}

function calculateLiveProductionConsumption(nation, cities){
    const production = {};
    const consumption = {};
    const add = (map, resource, amount) => { map[resource] = (map[resource] || 0) + amount; };
    cities.forEach(city => {
        const count = key => Math.max(0, Number(city[key]) || 0);
        const cappedOutput = (key, max) => 0.25 * (1 + Math.min(count(key), max) / max * 0.5) * count(key) * 12;
        add(production, 'food', count('farm') * ((Number(city.land) || 0) / 500) * 12);
        add(production, 'iron', cappedOutput('iron_mine', 10));
        add(production, 'coal', cappedOutput('coal_mine', 10));
        add(production, 'lead', cappedOutput('lead_mine', 10));
        add(production, 'bauxite', cappedOutput('bauxite_mine', 10));
        add(production, 'oil', cappedOutput('oil_well', 10));
        add(production, 'uranium', cappedOutput('uranium_mine', 5));
        add(production, 'steel', count('steel_mill') * 0.75 * 12);
        add(production, 'gasoline', count('oil_refinery') * 0.5 * 12);
        add(production, 'aluminum', count('aluminum_refinery') * 0.75 * 12);
        add(production, 'munitions', count('munitions_factory') * 1.5 * 12);
        add(consumption, 'iron', count('steel_mill') * 12);
        add(consumption, 'coal', count('steel_mill') * 12);
        add(consumption, 'oil', count('oil_refinery') * 12);
        add(consumption, 'bauxite', count('aluminum_refinery') * 12);
        add(consumption, 'lead', count('munitions_factory') * 12);
        const cityPopulation = Number(city.population || 0) || (Number(nation.population || 0) / Math.max(1, Number(nation.num_cities) || cities.length));
        Object.entries(getPerCapitaMap()).forEach(([resource, rate]) => add(consumption, resource, cityPopulation * rate * 12));
    });
    return { production, consumption };
}

async function applyLiveProductionConsumptionTargets(summary){
    const totals = await fetchLiveProductionConsumption(summary);
    const currentTargets = loadReserveTargets();
    const priceMap = summary?.priceMap || {};
    const resources = RESOURCE_TYPES.slice();
    if(!resources.includes('credits')) resources.push('credits');
    const creditCost = Object.keys(totals.consumption).reduce((sum, resource) => sum + Number(totals.consumption[resource] || 0) * Number(priceMap[resource] || 0), 0);
    resources.forEach(resource => {
        currentTargets[resource] = resource === 'credits'
            ? Math.round(creditCost)
            : Math.round(Math.max(Number(totals.production[resource] || 0), Number(totals.consumption[resource] || 0)));
    });
    saveReserveTargets(currentTargets);
    renderReserves(summary);
}

function renderReserves(summary) {
    const container = document.getElementById('reserves-section');
    const body = document.getElementById('reserves-body');
    if (!container || !body) return;

    const nation = summary?.nation || {};
    const priceMap = summary?.priceMap || {};
    const population = Number(nation.population || 0);
    // resources include credits
    const resources = RESOURCE_TYPES.slice();
    if(!resources.includes('credits')) resources.push('credits');

    container.style.display = 'block';

    const targets = Object.assign({}, loadReserveTargets());
    const defaultDaysInput = document.getElementById('reserve-days');
    const days = Number(defaultDaysInput ? Number(defaultDaysInput.value) : 10) || 10;

    // ensure defaults exist for missing resources
    resources.forEach(r=>{ if(targets[r]===undefined) targets[r] = computeDefaultTargetUnits(r, population, priceMap, days); });

    // render rows
    body.innerHTML = resources.map(resource=>{
        const cur = resource === 'credits' ? (Number(nation.credits||0) * Number(priceMap.credits||0)) : Number(nation[resource]||0);
        const target = Number(targets[resource]||0);
        // percent of target that is currently met (cur / target * 100)
        const pct = target > 0 ? (cur / target) * 100 : 0;
        const met = cur >= target;
        const shortfall = met ? 0 : Math.max(0, Math.round(target - cur));
            // Calculate how many days current stockpile will cover
            let daysCovered = '-';
            const sampleNets = window.financeSampleDailyNets || null;
            // Determine daily need (units of resource consumed per day)
            let dailyNeed = null;
            if(sampleNets && sampleNets.hasOwnProperty(resource)){
                const net = Number(sampleNets[resource]||0);
                if(net < 0){
                    dailyNeed = Math.abs(net);
                } else if(net > 0){
                    // net positive (surplus each day) -> effectively infinite coverage
                    daysCovered = '∞';
                } else {
                    // zero net change -> if we have any stock, it's effectively infinite
                    dailyNeed = 0;
                }
            }
            // If no sample net supplied, use the user 1-day baseline if available, else per-capita fallback
            if(dailyNeed === null){
                if(resource === 'credits'){
                    dailyNeed = computeDefaultTargetUnits('credits', population, priceMap, 1);
                } else {
                    const one = Number(USER_ONE_DAY_BASELINE[resource] || 0);
                    if(one > 0) dailyNeed = one;
                    else dailyNeed = computeDefaultTargetUnits(resource, population, priceMap, 1);
                }
            }
            // Compute days covered when not already infinite
            if(daysCovered !== '∞'){
                if(dailyNeed === null || dailyNeed === 0){
                    daysCovered = cur > 0 ? '∞' : '0';
                } else {
                    const raw = Number(cur) / Number(dailyNeed);
                    if(!Number.isFinite(raw)){
                        daysCovered = '0';
                    } else {
                        // show fractional days with up to 2 decimal places
                        const rounded = Number(raw.toFixed(2));
                        daysCovered = rounded.toLocaleString(undefined, { maximumFractionDigits: 2 });
                    }
                }
            }
            return `
            <tr>
                <td class="stat-label">${resource.charAt(0).toUpperCase()+resource.slice(1)}</td>
                <td class="stat-label">${resource==='credits'?formatMoney(cur):formatNumber(cur)}</td>
                <td class="stat-label"><input data-resource="${resource}" class="reserve-input" type="number" min="0" value="${target}" style="width:140px;padding:6px;border-radius:6px;border:1px solid rgba(255,255,255,0.04);background:transparent;color:var(--text);"/></td>
                <td class="stat-label">${Math.round(pct)}%</td>
                <td class="stat-label">${daysCovered}</td>
                <td class="stat-value" style="color:${met? 'var(--positive)': 'var(--negative)'}">${met? 'Met' : (shortfall.toLocaleString() + (resource==='credits' ? ' $' : ' units'))}</td>
            </tr>`;
    }).join('');

    // wire inputs
    body.querySelectorAll('.reserve-input').forEach(inp=>{
        inp.addEventListener('change', (ev)=>{
            const r = inp.dataset.resource;
            const val = Number(inp.value||0);
            const currentTargets = loadReserveTargets();
            currentTargets[r] = val;
            saveReserveTargets(currentTargets);
            // re-render to update percent/status
            renderReserves(summary);
        });
    });

    // wire apply/reset buttons
    const applyBtn = document.getElementById('apply-10day');
    if(applyBtn) applyBtn.onclick = ()=>{
        const currentTargets = loadReserveTargets();
        // If a user-provided 1-day baseline is available, use it and multiply by days
        if(USER_ONE_DAY_BASELINE && Object.keys(USER_ONE_DAY_BASELINE).length){
            resources.forEach(r=>{
                if(r === 'credits'){
                    currentTargets[r] = computeDefaultTargetUnits(r, population, priceMap, days);
                } else {
                    const one = Number(USER_ONE_DAY_BASELINE[r]||0);
                    currentTargets[r] = Math.round(one * days);
                }
            });
        } else {
            resources.forEach(r=>{ currentTargets[r] = computeDefaultTargetUnits(r, population, priceMap, days); });
        }
        saveReserveTargets(currentTargets);
        renderReserves(summary);
    };

    const resetBtn = document.getElementById('reset-reserves');
    if(resetBtn) resetBtn.onclick = ()=>{
        localStorage.removeItem(RESERVE_STORAGE_KEY);
        localStorage.removeItem(SAMPLE_NETS_KEY);
        window.financeSampleDailyNets = null;
        renderReserves(summary);
    };
    const prodConsBtn = document.getElementById('apply-prodcons-1day');
    if(prodConsBtn){
        prodConsBtn.onclick = async ()=>{
            try {
                await applyLiveProductionConsumptionTargets(summary);
            alert('Applied live daily production and consumption totals as 1-day reserve targets.');
            } catch(error) {
                alert(`Live production/consumption totals unavailable: ${error.message || error}`);
            }
        };
    }
    // update exposed window variable
    exposeReserveTargets();
}

function loadSampleNets(){ try{ const raw = localStorage.getItem(SAMPLE_NETS_KEY); return raw?JSON.parse(raw):null; }catch(e){return null;} }
function saveSampleNets(obj){ try{ localStorage.setItem(SAMPLE_NETS_KEY, JSON.stringify(obj)); }catch(e){} }

function applySampleDailyMap(map, opts={autoApplyTargets:true}){
    if(!map) return;
    window.financeSampleDailyNets = map;
    saveSampleNets(map);
    // optionally auto-apply to reserve targets
    if(opts.autoApplyTargets && currentSummary){
        try{
            const daysInput = document.getElementById('reserve-days');
            const days = Number(daysInput && Number(daysInput.value)) || 10;
            const currentTargets = loadReserveTargets();
            const nation = currentSummary ? currentSummary.nation : {};
            const priceMap = currentSummary ? currentSummary.priceMap : {};
            const resources = RESOURCE_TYPES.slice(); if(!resources.includes('credits')) resources.push('credits');
            resources.forEach(r=>{
                const cur = r === 'credits' ? (Number(nation.credits||0) * Number(priceMap.credits||0)) : Number(nation[r]||0);
                const net = Number(map[r]||0);
                let newTarget = Number(currentTargets[r]||0);
                if(net < 0){
                    newTarget = Math.max(newTarget, Math.round(cur + Math.abs(net) * days));
                } else if(net > 0){
                    newTarget = Math.max(newTarget, Math.round(cur));
                } else {
                    newTarget = Math.max(newTarget, Math.round(cur));
                }
                currentTargets[r] = newTarget;
            });
            saveReserveTargets(currentTargets);
            renderReserves(currentSummary);
        }catch(err){ console.error('applySampleDailyMap failed',err); }
    }
}

function extractNetIncomeFromNation(nation){
    if(!nation) return null;
    const map = {};
    const keys = Object.keys(nation||{});
    const lowerKeys = keys.map(k=>k.toLowerCase());
    // for each resource, try common key patterns
    const resources = RESOURCE_TYPES.slice(); if(!resources.includes('credits')) resources.push('credits');
    resources.forEach(r=>{
        const patterns = [
            `${r}_net`, `${r}_net_income`, `net_${r}`, `${r}net`, `${r}_income`, `${r}_change`, `${r}change`, `${r}_delta`, `${r}delta`
        ];
        for(const p of patterns){
            const idx = lowerKeys.indexOf(p);
            if(idx !== -1){ const val = Number(nation[keys[idx]]); if(Number.isFinite(val)){ map[r] = val; return; } }
        }
        // fallback: find any key that contains resource name and 'net' or 'income'
        for(let i=0;i<keys.length;i++){
            const k = lowerKeys[i];
            if(k.includes(r) && (k.includes('net') || k.includes('income') || k.includes('change') || k.includes('delta'))){ const val = Number(nation[keys[i]]); if(Number.isFinite(val)){ map[r]=val; return; } }
        }
    });
    // if map empty, try scanning all numeric keys for small numbers and matching resource names
    if(Object.keys(map).length === 0){
        for(let i=0;i<keys.length;i++){
            const k = lowerKeys[i];
            const val = Number(nation[keys[i]]);
            if(!Number.isFinite(val)) continue;
            // try to map by resource token
            for(const r of resources){ if(k.includes(r) && Math.abs(val) < 100000){ map[r]=val; break; } }
        }
    }
    return Object.keys(map).length ? map : null;
}

function toggleRawDataPanel(payload) {
    const panel = document.getElementById('raw-nation-json');
    if (!panel) return;
    if (!payload) {
        panel.style.display = 'none';
        return;
    }
    panel.textContent = JSON.stringify(payload, null, 2);
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

async function fetchEconomyData() {
    const nationQuery = `query { nations(id: [${NATION_ID}], first: 1) { data { nation_name leader_name population num_cities score money credits food coal oil uranium iron bauxite lead gasoline munitions steel aluminum emergency_gasoline_reserve alliance { id } cities { id name land supermarket bank shopping_mall stadium subway farm iron_mine coal_mine lead_mine bauxite_mine oil_well uranium_mine steel_mill oil_refinery aluminum_refinery munitions_factory } } } }`;
    const priceQuery = `query { tradeprices(first: 10) { data { date food coal oil uranium iron bauxite lead gasoline munitions steel aluminum credits } } }`;

    const [nationResp, priceResp, localResp] = await Promise.all([
        fetch(`https://api.politicsandwar.com/graphql?api_key=${API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: nationQuery })
        }),
        fetch(`https://api.politicsandwar.com/graphql?api_key=${API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: priceQuery })
        }),
        fetch('cities_parsed_enriched_merged.json').catch(() => null)
    ]);

    const nationJson = await nationResp.json();
    const priceJson = await priceResp.json();

    if (nationJson?.errors?.length) {
        throw new Error(nationJson.errors[0]?.message || 'GraphQL nation query error');
    }
    if (priceJson?.errors?.length) {
        throw new Error(priceJson.errors[0]?.message || 'GraphQL price query error');
    }

    const nation = nationJson?.data?.nations?.data?.[0];
    const localJson = localResp?.ok ? await localResp.json() : { cities: [] };
    const priceRows = sortMarketRowsNewestFirst(priceJson?.data?.tradeprices?.data);
    const allianceId = nation?.alliance?.id;
    const loanRecords = [];
    let bankDataAvailable = true;
    if (allianceId) {
        for (let page = 1; page <= 10; page += 1) {
            try {
                const bankQuery = `{ bankrecs(first: 100, page: ${page}, or_id: [${NATION_ID}, ${allianceId}]) { data { id date sender_id receiver_id money note ${RESOURCE_TYPES.filter(resource => resource !== 'credits').join(' ')} } } }`;
                const bankResponse = await fetch(`https://api.politicsandwar.com/graphql?api_key=${API_KEY}`, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: bankQuery }) });
                const bankJson = await bankResponse.json();
                if (!bankResponse.ok || bankJson?.errors?.length) throw new Error(bankJson?.errors?.[0]?.message || `HTTP ${bankResponse.status}`);
                const pageRecords = bankJson?.data?.bankrecs?.data || [];
                loanRecords.push(...pageRecords.filter(record => isTcoTransaction(record, NATION_ID, allianceId)));
                if (pageRecords.length < 100) break;
            } catch (bankError) {
                bankDataAvailable = false;
                break;
            }
        }
    }
    let allianceLoan = calculateAllianceLoan(loanRecords, NATION_ID);
    if (!bankDataAvailable) {
        try {
            const cached = JSON.parse(localStorage.getItem(ECONOMY_CACHE_KEY) || 'null');
            allianceLoan = cached?.allianceLoan || allianceLoan;
        } catch (cacheError) {}
    }
    return { nation, priceRows, localCities: Array.isArray(localJson?.cities) ? localJson.cities : [], allianceLoan };
}

function updateTimestamp(date = new Date()) {
    const node = document.getElementById('last-update');
    if (!node) return;
    node.textContent = `Last update: ${date.toLocaleString()}`;
}

function updateNextTimestamp(date = new Date()) {
    const node = document.getElementById('next-update');
    if (!node) return;
    node.textContent = `Next update: ${date.toLocaleString()}`;
}

// Programmatic helpers exposed for user actions
window.applyUserBaseline = function(days){
    const d = Number(days) || (Number(document.getElementById('reserve-days')?.value) || 10);
    const currentTargets = loadReserveTargets();
    const resources = RESOURCE_TYPES.slice(); if(!resources.includes('credits')) resources.push('credits');
    resources.forEach(r=>{
        if(r === 'credits'){
            // compute estimate for credits
            const population = Number(currentSummary?.nation?.population || 0);
            const priceMap = currentSummary?.priceMap || {};
            currentTargets[r] = computeDefaultTargetUnits(r, population, priceMap, d);
        } else {
            const one = Number(USER_ONE_DAY_BASELINE[r]||0);
            currentTargets[r] = Math.round(one * d);
        }
    });
    saveReserveTargets(currentTargets);
    if(currentSummary) renderReserves(currentSummary);
    return currentTargets;
};

window.clearFinanceStorage = function(){
    try{ localStorage.removeItem(RESERVE_STORAGE_KEY); localStorage.removeItem(SAMPLE_NETS_KEY); window.financeSampleDailyNets = null; }catch(e){}
    if(currentSummary) renderReserves(currentSummary);
};

async function refreshEconomyData() {
    try {
        const { nation, priceRows, localCities, allianceLoan } = await fetchEconomyData();
        if (!nation) {
            throw new Error('Unable to load nation data.');
        }

        const summary = buildNationSummary(nation, priceRows);
        summary.allianceLoan = allianceLoan;
        try { localStorage.setItem(ECONOMY_CACHE_KEY, JSON.stringify({ nation, priceRows, localCities, allianceLoan, updatedAt: Date.now() })); } catch (cacheError) {}
        currentSummary = summary;
        renderHeroCards(summary);
        renderCommerceIncome(summary, localCities);
        renderStockpileBreakdown(summary);
        renderReserves(summary);
        renderMarketStatus(summary);
        const hero = document.getElementById('market-hero-card');
        if (hero) {
            hero.style.cursor = 'pointer';
            hero.onclick = () => {
                window.location.href = 'market-status.html';
            };
        }
        lastRawData = { nation, priceRows };
        const reserveSec = document.getElementById('reserves-section'); if (reserveSec) reserveSec.style.display = 'block';
        const persisted = loadSampleNets();
        if (persisted) applySampleDailyMap(persisted, {autoApplyTargets:false});
        const autoCheckbox = document.getElementById('auto-use-netincome');
        const extracted = extractNetIncomeFromNation(nation);
        if (extracted && autoCheckbox && autoCheckbox.checked) { applySampleDailyMap(extracted, {autoApplyTargets:true}); }
        const now = new Date();
        updateTimestamp(now);
        updateNextTimestamp(new Date(now.getTime() + REFRESH_INTERVAL_MS));
    } catch (error) {
        try {
            const cached = JSON.parse(localStorage.getItem(ECONOMY_CACHE_KEY) || 'null');
            if (cached?.nation) {
                const cachedSummary = buildNationSummary(cached.nation, cached.priceRows || []);
                cachedSummary.allianceLoan = cached.allianceLoan || { debt: 0, repayments: 0 };
                currentSummary = cachedSummary;
                renderHeroCards(cachedSummary);
                renderCommerceIncome(cachedSummary, cached.localCities || []);
                renderStockpileBreakdown(cachedSummary);
                renderReserves(cachedSummary);
                renderMarketStatus(cachedSummary);
                updateTimestamp(new Date(cached.updatedAt || Date.now()));
                updateNextTimestamp(new Date(Date.now() + REFRESH_INTERVAL_MS));
                return;
            }
        } catch (cacheError) {}
        const cashNode = document.getElementById('finance-cash');
        const creditsNode = document.getElementById('finance-credits');
        const stockNode = document.getElementById('finance-stockpile');
        if (cashNode) cashNode.textContent = '$0';
        if (creditsNode) creditsNode.textContent = '$0';
        if (stockNode) stockNode.textContent = '$0';
        const breakdown = document.getElementById('stockpile-breakdown-body');
        if (breakdown) {
            breakdown.innerHTML = `<tr><td colspan="4" class="stat-value">Offline or API unavailable: ${String(error?.message || error || 'Unknown').slice(0, 120)}</td></tr>`;
        }
    }
}

const REFRESH_INTERVAL_MS = 30000;

async function initialize() {
    setupSubgroupLogHandlers();
    await refreshEconomyData();

    try {
        await applyLiveProductionConsumptionTargets(currentSummary);
    } catch(error) {
        console.warn('Live reserve targets unavailable', error);
    }

    const toggleBtn = document.getElementById('toggle-raw-data');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => toggleRawDataPanel(lastRawData));
    }

    // debug panel removed; no debug breakdown handler
    // sample import UI removed; persisted sample nets still applied if present

    window.requestAnimationFrame(() => {
        document.body.classList.add('page-ready');
    });

    setInterval(() => {
        if (document.visibilityState === 'visible') refreshEconomyData();
    }, 120000);
}

initialize();
