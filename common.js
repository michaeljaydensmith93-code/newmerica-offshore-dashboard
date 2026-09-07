if (typeof window.API_KEY === 'undefined') {
    window.API_KEY = "5bc5a81f4c67e52b148c";
}

(function installRoyalPurpleGoldTheme() {
    if (document.getElementById('royal-purple-gold-theme')) return;

    const style = document.createElement('style');
    style.id = 'royal-purple-gold-theme';
    style.textContent = `
        :root {
            --royal-purple: #24063d;
            --royal-purple-deep: #12021f;
            --royal-purple-panel: rgba(43, 13, 73, 0.92);
            --royal-gold: #d4af37;
            --royal-gold-bright: #f5d77a;
        }

        body {
            background:
                radial-gradient(circle at 15% 0%, rgba(126, 55, 190, 0.32), transparent 34%),
                radial-gradient(circle at 90% 100%, rgba(212, 175, 55, 0.12), transparent 30%),
                linear-gradient(145deg, var(--royal-purple) 0%, var(--royal-purple-deep) 100%) !important;
        }

        .page,
        .site-content,
        .nav-menu,
        .stats-bar,
        .card,
        .panel,
        .table-container,
        .tab-content,
        .hero-card,
        .kpi-card,
        .intel-card,
        .stockpile-item,
        .detail-drawer,
        .terminal,
        .api-dump {
            background-color: var(--royal-purple-panel) !important;
            border-color: var(--royal-gold) !important;
            box-shadow: 0 0 0 1px rgba(212, 175, 55, 0.14), 0 18px 45px rgba(12, 2, 25, 0.38) !important;
        }

        .nav-link,
        .sub-link,
        .meta-pill {
            border-color: var(--royal-gold) !important;
        }

        .nav-link:hover,
        .nav-link.active,
        .sub-link:hover,
        .sub-link.active {
            background: rgba(212, 175, 55, 0.2) !important;
            border-color: var(--royal-gold-bright) !important;
            color: var(--royal-gold-bright) !important;
        }

        h1, h2, h3,
        .card-header h3,
        .hero-card h2,
        .kpi-label,
        .intel-label,
        .stockpile-label,
        .detail-title,
        th {
            color: var(--royal-gold-bright) !important;
        }

        a,
        .nav-link,
        .sub-link,
        .hero-value,
        .kpi-value,
        .intel-value,
        .stockpile-value {
            text-shadow: 0 0 8px rgba(212, 175, 55, 0.2);
        }
    `;
    document.head.appendChild(style);
})();

(function installOfflineFetchGuard() {
    const originalFetch = window.fetch ? window.fetch.bind(window) : null;
    if (!originalFetch) return;

    const offlineSafePatterns = [
        /api\.politicsandwar\.com/i,
        /fonts\.googleapis\.com/i,
        /gstatic\.com/i,
        /script\.google\.com/i,
        /docs\.google\.com/i,
        /open-meteo\.com/i,
        /googleapis\.com/i
    ];

    function isOfflineSafeTarget(target) {
        const value = typeof target === 'string' ? target : target?.url || target?.toString?.() || '';
        return offlineSafePatterns.some(pattern => pattern.test(value));
    }

    function createOfflineResponse(target) {
        const isJsonTarget = /graphql|json|api/i.test(String(target || ''));
        const payload = isJsonTarget ? { data: {}, errors: [] } : '';
        return new Response(isJsonTarget ? JSON.stringify(payload) : payload, {
            status: 200,
            headers: { 'Content-Type': isJsonTarget ? 'application/json' : 'text/plain' }
        });
    }

    window.fetch = async function guardedFetch(target, init) {
        try {
            return await originalFetch(target, init);
        } catch (error) {
            if (isOfflineSafeTarget(target)) {
                console.warn('Offline fallback active for request:', target, error?.message || error);
                return createOfflineResponse(target);
            }
            throw error;
        }
    };
})();

const RESOURCE_ICONS = {
    coal: 'https://politicsandwar.com/img/resources/coal.png',
    oil: 'https://politicsandwar.com/img/resources/oil.png',
    uranium: 'https://politicsandwar.com/img/resources/uranium.png',
    lead: 'https://politicsandwar.com/img/resources/lead.png',
    iron: 'https://politicsandwar.com/img/resources/iron.png',
    bauxite: 'https://politicsandwar.com/img/resources/bauxite.png',
    gasoline: 'https://politicsandwar.com/img/resources/gasoline.png',
    munitions: 'https://politicsandwar.com/img/resources/munitions.png',
    steel: 'https://politicsandwar.com/img/resources/steel.png',
    aluminum: 'https://politicsandwar.com/img/resources/aluminum.png',
    food: 'https://politicsandwar.com/img/icons/16/steak_meat.png',
    credits: 'https://politicsandwar.com/img/icons/16/point_gold.png'
};

function getResourceIconHtml(resourceName, size = 16) {
    if (!resourceName) return '';
    const key = String(resourceName || '').toLowerCase().trim();
    const url = RESOURCE_ICONS[key];
    if (!url) return '';
    return `<img src="${url}" alt="${key}" style="width:${size}px;height:${size}px;vertical-align:middle;margin-right:6px;">`;
}

function switchTab(tabId, el) {
    document.querySelectorAll('.tab-content').forEach((tab) => tab.classList.remove('active'));
    document.querySelectorAll('.sub-link').forEach((link) => link.classList.remove('active'));
    const target = document.getElementById(tabId);
    if (target) target.classList.add('active');
    if (el) el.classList.add('active');
    setHiddenTradeLogLinkVisible(tabId === 'sub3');
}

function setHiddenTradeLogLinkVisible(show) {
    const link = document.getElementById('hidden-trade-log-link');
    if (!link) return;
    link.style.display = show ? 'inline-flex' : 'none';
    if (show) {
        const payload = localStorage.getItem('personalTradeLog') || 'No personal trade backup available yet.';
        const blob = new Blob([payload], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        link.href = url;
    }
}

function safeFormatNumber(value) {
    return typeof value === 'number' && !Number.isNaN(value) ? value.toLocaleString() : String(value || '-');
}

function safeDate(value) {
    const date = new Date(value);
    return isNaN(date.getTime()) ? String(value || 'Unknown') : date.toLocaleString();
}

function sortMarketRowsNewestFirst(rows) {
    return (Array.isArray(rows) ? rows : []).slice().sort((a, b) => {
        const timeA = Date.parse(a?.date || '') || 0;
        const timeB = Date.parse(b?.date || '') || 0;
        return timeB - timeA;
    });
}

function getLatestMarketRow(rows) {
    return sortMarketRowsNewestFirst(rows)[0] || {};
}

async function fetchMarketRows(query) {
    const response = await fetch(`https://api.politicsandwar.com/graphql?api_key=${window.API_KEY || ''}`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
    });
    if (!response.ok) throw new Error(`Market API HTTP ${response.status}`);
    const json = await response.json();
    if (json.errors?.length) throw new Error(json.errors.map(error => error.message).join('; '));
    return sortMarketRowsNewestFirst(json.data?.tradeprices?.data);
}

async function fetchSharedNationSnapshot() {
    const query = `query { nations(id: [768640], first: 1) { data { nation_name leader_name population num_cities score alliance_position soldiers tanks aircraft ships money alliance { id name acronym color accept_members } wars { id war_type reason turns_left } } } }`;
    const response = await fetch(`https://api.politicsandwar.com/graphql?api_key=${window.API_KEY}`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
    });

    const json = await response.json();
    if (json.errors || !json.data?.nations?.data?.length) {
        throw new Error('Nation snapshot unavailable');
    }

    return json.data.nations.data[0];
}

function setPageLiveMeta(statusText, detailText, sourceText = 'Politics & War') {
    const statusEl = document.getElementById('page-status');
    const detailEl = document.getElementById('page-updated');
    const sourceEl = document.getElementById('page-source');

    if (statusEl) statusEl.textContent = statusText;
    if (detailEl) detailEl.textContent = `Last update: ${detailText}`;
    if (sourceEl) sourceEl.textContent = `Source: ${sourceText}`;
}

function renderSharedNationCard(containerId, nation) {
    const container = document.getElementById(containerId);
    if (!container || !nation) return;

    const metrics = [
        ['Nation', nation.nation_name || 'Unknown'],
        ['Commander', nation.leader_name || 'Unknown'],
        ['Cities', safeFormatNumber(nation.num_cities || 0)],
        ['Population', safeFormatNumber(nation.population || 0)],
        ['Military', safeFormatNumber(nation.soldiers || 0)],
        ['Alliance', nation.alliance?.name || (nation.alliance_id ? `ID ${nation.alliance_id}` : 'Independent')]
    ];

    container.innerHTML = metrics.map(([label, value]) => `
        <div class="status-cell">
            <span class="status-label">${label}</span>
            <span class="status-value">${value}</span>
        </div>
    `).join('');
}
