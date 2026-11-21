// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, a filterable table, a per-protocol detail view with the model's own inputs and the
// protocol's farm plan, the live-token comparables, and the model itself. No network: every byte it
// shows is in data.js. The page recomputes a row from the snapshot figures and checks the number
// board.json carries, so the page's code and the board's data are visibly the same arithmetic.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('board');
  if (!DATA || !app) return;
  var MODEL = DATA.model;
  var state = { tab: 'board', q: '', category: 'all', chain: 'all', sort: 'implied', dir: -1, selected: null };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return n === null || n === undefined ? 'n/a' : n.toFixed(3) + 'x'; }

  // The model in one function: TVL x the category's live-token multiple, then growth, maturity and
  // chain reach. The same arithmetic main.ts writes to board.json.
  function impliedOf(row) {
    var growth = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * MODEL.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? MODEL.unknown_age_days : row.age_days;
    var maturity = MODEL.maturity_floor + (Math.min(Math.max(age, 0), MODEL.maturity_days) / MODEL.maturity_days) * MODEL.maturity_range;
    var chainMult = 1 + Math.min(Math.max((row.chains ? row.chains.length : 1) - 1, 0), MODEL.chain_max_steps) * MODEL.chain_step;
    return {
      implied: Math.max(1, Math.round(row.tvl_usd * row.category_multiple * growthMult * maturity * chainMult)),
      growth: growth, growthMult: growthMult, maturity: maturity, chainMult: chainMult, age: age
    };
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open; borrow a small amount against it once so the borrow side is counted too.';
    if (c.indexOf('dex') >= 0 || c.indexOf('liquidity manager') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open through at least one fee cycle.';
    if (c.indexOf('risk curat') >= 0 || c.indexOf('capital allocator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and hold the vault shares; the vault, not a pool, is where its activity is counted.';
    if (c.indexOf('rwa') >= 0 || c.indexOf('real world') >= 0) return 'Mint $' + capital + " of the protocol's yield-bearing asset through " + name + ' on ' + chain + ' and hold it; keep the receipt, it is the position.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app, so the bridge and the destination are both used.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' and keep the receipt token; unstake only after the qualifying window.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged position, then close it; size it so a move against you costs little.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + ', then settle it; one real position counts more than many tiny ones.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it through a full month.';
    if (c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0 || c.indexOf('aggregator') >= 0) return 'Deposit $' + capital + " into " + name + "'s highest-TVL strategy on " + chain + ' and let it compound; do not hop strategies weekly.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active for the full term.';
    if (c.indexOf('payment') >= 0) return 'Move $' + capital + ' through ' + name + ' on ' + chain + ' for a real payment, then keep a small balance in the app.';
    if (c.indexOf('chain') >= 0) return 'Bridge $' + capital + " onto " + name + "'s chain and use one of its native apps, so the chain sees a funded, active wallet.";
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var action = actionFor(p, capital, chain);
    var steps = [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: action, cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: "Open " + p.name + "'s own points or rewards page and check whether it tracks points, a leaderboard or quests; join only through the link the protocol itself publishes.", cost: 'no fee to check', time: '10 minutes' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, so the wallet looks active across snapshots rather than once.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, check the protocol's own announcement channel for a token or airdrop post, and claim only from the link it publishes; never pay anyone to claim for you. No token is guaranteed, and the position can lose value.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' }
    ];
    return steps.map(function (s) {
      var t = s.text + ' Cost: ' + s.cost + '. Time: ' + s.time + '.';
      if (t.length > 600) t = t.slice(0, 596) + '...';
      if (t.length < 20) t += ' Hold the position and check the protocol\u2019s own page.';
      return { text: s.text, cost: s.cost, time: s.time, full: t };
    });
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function categories() {
    var seen = {};
    DATA.rows.forEach(function (r) { if (r.category) seen[r.category] = true; });
    return Object.keys(seen).sort();
  }
  function chains() {
    var seen = {};
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { seen[c] = true; }); });
    return Object.keys(seen).sort();
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).indexOf(state.chain) >= 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = state.sort;
    var dir = state.dir;
    rows.sort(function (a, b) {
      var av, bv;
      if (key === 'implied') { av = a.implied_value_usd; bv = b.implied_value_usd; }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'change') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? -1 : a.age_days; bv = b.age_days === null ? -1 : b.age_days; }
      else if (key === 'name') { return dir * (a.name < b.name ? -1 : a.name > b.name ? 1 : 0); }
      else { av = a.rank; bv = b.rank; }
      return dir * (av - bv) || (a.rank - b.rank);
    });
    return rows;
  }

  function boardTable(rows) {
    var maxImp = DATA.rows.length ? DATA.rows[0].implied_value_usd : 1;
    var cols = [
      { key: 'rank', label: '#', cls: '' },
      { key: 'name', label: 'Protocol', cls: '' },
      { key: 'category', label: 'Category', cls: '' },
      { key: 'chains', label: 'Chains', cls: '' },
      { key: 'tvl', label: 'TVL', cls: 'num' },
      { key: 'change', label: '7d', cls: 'num' },
      { key: 'age', label: 'Age', cls: 'num' },
      { key: 'implied', label: 'Implied value', cls: 'num' }
    ];
    var head = el('thead', null, el('tr', null, cols.map(function (c) {
      var arrow = state.sort === c.key ? (state.dir === -1 ? ' \u25bc' : ' \u25b2') : '';
      return el('th', { class: c.cls, onclick: function () {
        if (state.sort === c.key) state.dir = -state.dir;
        else { state.sort = c.key; state.dir = c.key === 'name' ? 1 : -1; }
        render();
      } }, c.label + arrow);
    })));
    var body = el('tbody');
    if (rows.length === 0) {
      body.appendChild(el('tr', null, el('td', { colspan: '8', class: 'empty' }, 'No protocols match this filter. Clear the search or pick another category.')));
    }
    rows.forEach(function (r) {
      var pct = r.change_7d;
      var tr = el('tr', { class: (r.rank <= 3 ? 'top3 ' : '') + (state.selected === r.slug ? 'sel' : ''), onclick: function () { select(r.slug, true); } },
        el('td', null, el('span', { class: 'rank', text: String(r.rank) })),
        el('td', null, el('div', { class: 'name', text: r.name }), el('div', { class: 'slug', text: r.slug })),
        el('td', null, el('span', { class: 'pill', text: r.category || 'n/a' })),
        el('td', null, (r.chains || []).slice(0, 3).map(function (c) { return el('span', { class: 'pill', text: c }); })),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (pct === null ? '' : pct >= 0 ? 'up' : 'down'), text: fmtPct(pct) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num' },
          el('div', { class: 'imp', text: fmtUsd(r.implied_value_usd) }),
          el('div', { class: 'bar' }, el('i', { style: 'width:' + Math.max(2, Math.round(100 * r.implied_value_usd / maxImp)) + '%' })))
      );
      body.appendChild(tr);
    });
    return el('table', { class: 'board' }, head, body);
  }

  function detailView(row) {
    var calc = impliedOf(row);
    var steps = farmSteps(row);
    var comp = row.comparables > 0
      ? row.comparables + ' live ' + (row.category || '') + ' tokens set this multiple (median mcap/TVL)'
      : 'no live ' + (row.category || '') + ' comparables in the snapshot, so the whole market median ' + fmtMult(DATA.global_multiple) + ' applies';
    var kv = el('div', { class: 'kv' },
      el('div', null, el('div', { class: 'k', text: 'Implied value' }), el('div', { class: 'v', text: fmtUsd(row.implied_value_usd) })),
      el('div', null, el('div', { class: 'k', text: 'TVL' }), el('div', { class: 'v', text: fmtUsd(row.tvl_usd) })),
      el('div', null, el('div', { class: 'k', text: '7-day change' }), el('div', { class: 'v', text: fmtPct(row.change_7d) })),
      el('div', null, el('div', { class: 'k', text: 'Age (no token)' }), el('div', { class: 'v', text: fmtAge(row.age_days) })),
      el('div', null, el('div', { class: 'k', text: 'Category' }), el('div', { class: 'v', text: row.category || 'n/a' }))
    );
    var math = el('div', { class: 'math' },
      el('div', { class: 'row' }, el('span', null, 'TVL \u00d7 category multiple'), el('b', null, fmtUsd(row.tvl_usd) + ' \u00d7 ' + fmtMult(row.category_multiple) + ' = ' + fmtUsd(row.tvl_usd * row.category_multiple))),
      el('div', { class: 'row' }, el('span', null, 'Growth \u00d7 ' + fmtPct(calc.growth)), el('b', null, '\u00d7 ' + calc.growthMult.toFixed(3))),
      el('div', { class: 'row' }, el('span', null, 'Maturity \u00d7 ' + fmtAge(row.age_days)), el('b', null, '\u00d7 ' + calc.maturity.toFixed(3))),
      el('div', { class: 'row' }, el('span', null, 'Chain reach \u00d7 ' + (row.chains || []).length + ' chains'), el('b', null, '\u00d7 ' + calc.chainMult.toFixed(3))),
      el('div', { class: 'row' }, el('span', null, 'Implied value (recomputed in this page)'), el('b', null, fmtUsd(calc.implied) + (calc.implied === row.implied_value_usd ? ' \u2713 matches the board' : '')))
    );
    var farm = el('ol', { class: 'farm' }, steps.map(function (s) {
      return el('li', null, el('div', { text: s.text }), el('div', { class: 'meta' }, 'Cost: ', el('b', { text: s.cost }), ' \u00b7 Time: ', el('b', { text: s.time })));
    }));
    var panel = el('section', { class: 'detail', id: 'detail' },
      el('button', { class: 'close', 'aria-label': 'Close detail', onclick: function () { state.selected = null; try { history.replaceState(null, '', '#'); } catch (e) {} render(); } }, '\u00d7'),
      el('h2', null, '#' + row.rank + ' ' + row.name),
      el('p', { class: 'sub', text: row.slug + ' \u00b7 ' + (row.category || 'no category') + ' \u00b7 ' + (row.chains || []).join(', ') + ' \u00b7 tracked since ' + (row.listed_at || 'unknown') + ' \u00b7 records no token' }),
      kv, math,
      el('p', { class: 'note', text: 'Multiple: ' + comp + '.' }),
      el('h3', { text: 'How to farm it' }),
      farm,
      el('p', { class: 'note' }, el('b', { text: 'Read this as a plan, not a promise. ' }), 'The implied value is this entry\u2019s claim from the snapshot\u2019s figures, not a prediction: no token is guaranteed, and a position can lose value.')
    );
    return el('div', { class: 'modal-backdrop', onclick: function (e) { if (e.target === e.currentTarget) { state.selected = null; try { history.replaceState(null, '', '#'); } catch (e2) {} render(); } } },
      el('div', { class: 'modal' }, panel));
  }

  function liveTable() {
    var head = el('thead', null, el('tr', null,
      el('th', { text: 'Protocol' }), el('th', { text: 'Category' }),
      el('th', { class: 'num', text: 'TVL' }), el('th', { class: 'num', text: 'Market cap' }),
      el('th', { class: 'num', text: 'Mcap / TVL' }), el('th', { class: 'num', text: '7d' })));
    var body = el('tbody');
    DATA.live.forEach(function (p) {
      body.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'name', text: p.name }), el('div', { class: 'slug', text: p.slug })),
        el('td', null, el('span', { class: 'pill', text: p.category || 'n/a' })),
        el('td', { class: 'num', text: fmtUsd(p.tvl_usd) }),
        el('td', { class: 'num', text: fmtUsd(p.mcap_usd) }),
        el('td', { class: 'num', text: fmtMult(p.mcap_tvl) }),
        el('td', { class: 'num ' + (p.change_7d === null ? '' : p.change_7d >= 0 ? 'up' : 'down'), text: fmtPct(p.change_7d) })));
    });
    return el('table', { class: 'plain' }, head, body);
  }

  function modelView() {
    var head = el('thead', null, el('tr', null,
      el('th', { text: 'Category' }), el('th', { class: 'num', text: 'Live comparables' }),
      el('th', { class: 'num', text: 'Median mcap / TVL' }), el('th', { text: 'How the multiple is set' })));
    var body = el('tbody');
    DATA.multiples.forEach(function (m) {
      body.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'pill', text: m.category })),
        el('td', { class: 'num', text: String(m.comparables) }),
        el('td', { class: 'num imp', text: fmtMult(m.multiple) }),
        el('td', null, 'median of ' + m.comparables + ' live ' + m.category + ' tokens in this snapshot')));
    });
    body.appendChild(el('tr', null,
      el('td', null, el('span', { class: 'pill', text: 'Any other category' })),
      el('td', { class: 'num', text: '\u2014' }),
      el('td', { class: 'num imp', text: fmtMult(DATA.global_multiple) }),
      el('td', null, 'whole-market median (128 live tokens), used when a category has fewer than 3 live comparables')));
    return el('section', { class: 'panel' },
      el('h2', { text: 'The model: radar-2' }),
      el('p', null, 'Implied value = ', el('b', { text: 'TVL \u00d7 category multiple \u00d7 growth \u00d7 maturity \u00d7 chain reach' }), '. Every input comes from the snapshot itself: the TVL, the seven-day change, how long the protocol has run with no token, and the chains it runs on.'),
      el('p', null, 'The category multiple is the median market-cap-to-TVL ratio of the live tokens in that category, clamped to 0.05\u20131.00. A DEX token trades at a higher multiple of TVL than a lending token, and a bridge higher still; the snapshot\u2019s own live market says so, so the model lets it say so. No protocol name is special-cased: the same function scores every row.'),
      el('p', null, 'Growth is the seven-day TVL change clamped to \u221260%…+120% and weighted by 0.5. Maturity is 0.6 + up to 0.4 for three years tracked with no token (unknown age counts as one year). Chain reach adds 2% per extra chain, up to five.'),
      el('table', { class: 'plain' }, head, body),
      el('p', { class: 'note' }, 'The watchlist is the floor, never the ceiling: the board ranks all 40 watchlist protocols plus ' + DATA.early_size + ' pre-token protocols below the $50M floor that are genuine launch candidates. Wrapped, staked and bridged products are left out of the early rows for the same reason the watchlist leaves them out.')
    );
  }

  function select(slug, scroll) {
    state.selected = slug;
    try { history.replaceState(null, '', '#detail/' + slug); } catch (e) {}
    render();
  }

  function render() {
    app.removeAttribute('aria-busy');
    app.innerHTML = '';
    var wrap = el('div', { class: 'wrap' });
    var hero = el('header', { class: 'hero' },
      el('div', { class: 'eyebrow', text: 'Token Radar \u00b7 make.fun token-radar-01' }),
      el('h1', null, 'Token Radar ', el('span', { class: 'thin', text: '\u2014 pre-token protocols, ranked by what a launch would be worth' })),
      el('p', { class: 'lede' }, 'Every protocol in the snapshot that records no token, ranked by implied value: ', el('b', { text: 'TVL \u00d7 the live market\u2019s own multiple for its category' }), ', then growth, age and chain reach. Each row carries the steps to farm it. The implied value is this entry\u2019s claim from the snapshot\u2019s figures, not a prediction.'),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('div', { class: 'v gold', text: fmtUsd(DATA.total_implied_usd) }), el('div', { class: 'k', text: 'total implied value' })),
        el('div', { class: 'stat' }, el('div', { class: 'v', text: String(DATA.board_size) }), el('div', { class: 'k', text: 'protocols ranked' })),
        el('div', { class: 'stat' }, el('div', { class: 'v', text: String(DATA.watchlist_size) }), el('div', { class: 'k', text: 'on the watchlist' })),
        el('div', { class: 'stat' }, el('div', { class: 'v', text: String(DATA.early_size) }), el('div', { class: 'k', text: 'early finds below the floor' })),
        el('div', { class: 'stat' }, el('div', { class: 'v', text: String(DATA.live_size) }), el('div', { class: 'k', text: 'live comparables' }))
      ),
      el('div', { class: 'modelbar' },
        el('b', { text: 'Model radar-2: ' }),
        'implied = TVL \u00d7 category multiple (median mcap/TVL of live tokens in the category) \u00d7 growth \u00d7 maturity \u00d7 chain reach. ',
        'Snapshot as of ', el('code', { text: DATA.as_of }), ' \u00b7 floor ', el('code', { text: fmtUsd(DATA.floor_usd) }), ' \u00b7 source: DefiLlama protocols, fetched 2026-11-14.'
      )
    );
    wrap.appendChild(hero);

    var tabs = el('div', { class: 'tabs', role: 'tablist' }, [
      { id: 'board', label: 'Pre-token board (' + DATA.board_size + ')' },
      { id: 'live', label: 'Live tokens (' + DATA.live_size + ')' },
      { id: 'model', label: 'The model' }
    ].map(function (t) {
      return el('button', { class: 'tab', role: 'tab', 'aria-selected': state.tab === t.id ? 'true' : 'false', onclick: function () { state.tab = t.id; render(); } }, t.label);
    }));
    wrap.appendChild(tabs);

    if (state.tab === 'board') {
      var controls = el('div', { class: 'controls' },
        el('input', { type: 'search', placeholder: 'Search a protocol\u2026', value: state.q, oninput: function (e) { state.q = e.target.value; render(); } }),
        el('select', { onchange: function (e) { state.category = e.target.value; render(); } },
          el('option', { value: 'all', text: 'All categories' }),
          categories().map(function (c) { return el('option', { value: c, selected: state.category === c ? 'selected' : null, text: c }); })),
        el('select', { onchange: function (e) { state.chain = e.target.value; render(); } },
          el('option', { value: 'all', text: 'All chains' }),
          chains().map(function (c) { return el('option', { value: c, selected: state.chain === c ? 'selected' : null, text: c }); }))
      );
      var rows = filteredRows();
      controls.appendChild(el('span', { class: 'count', text: rows.length + ' of ' + DATA.board_size + ' shown \u00b7 click a row for its detail and farm plan' }));
      wrap.appendChild(controls);
      wrap.appendChild(boardTable(rows));
    } else if (state.tab === 'live') {
      wrap.appendChild(el('section', { class: 'panel' },
        el('h2', { text: 'Live tokens: the market\u2019s own values' }),
        el('p', null, 'These protocols already trade, so the board shows the market\u2019s value for them, never a model\u2019s. They are the comparables the category multiples come from: a live DEX trades at a median ', el('b', { text: '0.342\u00d7 TVL' }), ', a live lending protocol at ', el('b', { text: '0.132\u00d7' }), '.'),
        liveTable()));
    } else {
      wrap.appendChild(modelView());
    }

    wrap.appendChild(el('footer', null,
      'Token Radar, model radar-2. Data: DefiLlama protocols snapshot, as of ' + DATA.as_of + ' (' + DATA.rows.length + ' protocols ranked, ' + DATA.watchlist_size + ' on the watchlist, floor ' + fmtUsd(DATA.floor_usd) + '). ',
      'A protocol is listed as pre-token when its record carries no token; the record is not proof it has none. ',
      'Implied values are this entry\u2019s claim from the snapshot\u2019s figures, not a prediction of a launch or a price.'));
    app.appendChild(wrap);
    if (state.tab === 'board' && state.selected) {
      var sel = DATA.rows.filter(function (r) { return r.slug === state.selected; })[0];
      if (sel) app.appendChild(detailView(sel));
    }
  }

  // Deep links for the screenshots: #detail/<slug> opens a protocol, #filter/<category> filters the board.
  function fromHash() {
    var h = (location.hash || '').replace(/^#/, '');
    if (h.indexOf('detail/') === 0) {
      var slug = h.slice(7);
      if (DATA.rows.some(function (r) { return r.slug === slug; })) { state.selected = slug; state.tab = 'board'; }
    } else if (h.indexOf('filter/') === 0) {
      var cat = decodeURIComponent(h.slice(7));
      if (categories().indexOf(cat) >= 0) { state.category = cat; state.tab = 'board'; }
    } else if (h.indexOf('tab/') === 0) {
      var tab = h.slice(4);
      if (tab === 'live' || tab === 'model' || tab === 'board') state.tab = tab;
    }
  }
  fromHash();
  render();
})();
