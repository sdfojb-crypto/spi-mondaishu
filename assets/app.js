/* SPI 問題集
 *
 * 一覧から選んで解くほか、問題数を決めたランダム出題と、
 * 1問間違えたら終わる連続正解チャレンジがある。
 * 解答・メモ・進み具合は問題のIDで localStorage に保存する。
 * 保存が使えない環境でも問題と解説は読めるよう、読み書きは必ず try/catch で囲む。
 */
(function () {
  'use strict';

  var DATA = (window.SPI_QUESTIONS && window.SPI_QUESTIONS.questions) || [];
  var N = DATA.length;
  var KEY = 'spi-set-v1';
  var LETTERS = 'ABCDEFGHIJ';

  var INDEX_BY_ID = {};
  DATA.forEach(function (q, i) { INDEX_BY_ID[q.id] = i; });

  // ───────── 保存 ─────────

  var store = {
    results: {},            // { 問題ID: { choice, correct, at } }
    memos: {},              // { 問題ID: メモの文字列 }
    filterCat: 'all',       // all | 非言語 | 言語
    filterDiff: 'all',      // all | 1 | 2 | 3
    filterState: 'all',     // all | unsolved | wrong
    hideTimer: false,
    theme: 'auto',
    toolsOpen: false,
    bestPts: {}             // { '分野|難易度': 連続正解チャレンジの最高得点 }
  };
  var storeOK = true;

  function loadStore() {
    try {
      var raw = window.localStorage.getItem(KEY);
      if (!raw) return;
      var o = JSON.parse(raw);
      if (!o || typeof o !== 'object') return;
      if (o.results && typeof o.results === 'object') store.results = o.results;
      if (o.memos && typeof o.memos === 'object') store.memos = o.memos;
      if (o.filterCat === '非言語' || o.filterCat === '言語') store.filterCat = o.filterCat;
      if (o.filterDiff === '1' || o.filterDiff === '2' || o.filterDiff === '3') store.filterDiff = o.filterDiff;
      if (o.filterState === 'unsolved' || o.filterState === 'wrong') store.filterState = o.filterState;
      store.hideTimer = !!o.hideTimer;
      store.toolsOpen = !!o.toolsOpen;
      if (o.theme === 'light' || o.theme === 'dark') store.theme = o.theme;
      // 以前の best（正解数）は単位が違うので読まない
      if (o.bestPts && typeof o.bestPts === 'object') {
        Object.keys(o.bestPts).forEach(function (k) {
          var v = o.bestPts[k];
          if (typeof v === 'number' && v >= 0 && v === Math.floor(v)) store.bestPts[k] = v;
        });
      }
    } catch (e) {
      storeOK = false;
    }
  }

  function saveStore() {
    try { window.localStorage.setItem(KEY, JSON.stringify(store)); }
    catch (e) { storeOK = false; }
  }

  // ───────── 画面の要素 ─────────

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    themeBtn: $('themeBtn'), themeIcon: $('themeIcon'),
    challengeBtn: $('challengeBtn'), bestScore: $('bestScore'), liveScore: $('liveScore'),
    filterCat: $('filterCat'), filterDiff: $('filterDiff'), filterState: $('filterState'),
    sizeRow: $('sizeRow'), poolCount: $('poolCount'),
    listCount: $('listCount'), qlist: $('qlist'),
    backToList: $('backToList'), quizPos: $('quizPos'),
    mNum: $('mNum'), mCat: $('mCat'), mTopic: $('mTopic'), mDiff: $('mDiff'), timer: $('timer'),
    qtext: $('qtext'), choices: $('choices'),
    hintBtn: $('hintBtn'), hintCaret: $('hintCaret'), hintBody: $('hintBody'), hintLabel: $('hintLabel'),
    hintWrap: $('hintWrap'), hintFig: $('hintFig'), qFig: $('qFig'), expFig: $('expFig'),
    result: $('result'), verdict: $('verdict'), explanation: $('explanation'),
    refline: $('refline'), retryBtn: $('retryBtn'),
    prevQ: $('prevQ'), nextQ: $('nextQ'), timerToggle: $('timerToggle'),
    tools: $('tools'), toolsBtn: $('toolsBtn'), toolsCaret: $('toolsCaret'), toolsBody: $('toolsBody'),
    calcOut: $('calcOut'), calcKeys: $('calcKeys'), toMemo: $('toMemo'), memoBox: $('memoBox'),
    scoreBig: $('scoreBig'), scoreSub: $('scoreSub'), resultList: $('resultList'),
    againBtn: $('againBtn'), toListBtn: $('toListBtn'),
    sSolved: $('sSolved'), sRate: $('sRate'), sWrong: $('sWrong'),
    topicStats: $('topicStats'), diffStats: $('diffStats'),
    storeNote: $('storeNote'), resetBtn: $('resetBtn')
  };

  var current = null;   // いま開いている問題の DATA 上の添字
  var tick = null;

  // ランダム出題のひとまとまり。一覧から直接開いたときは null
  //   ids     … 出題する問題IDの並び
  //   pos     … 何問目か（0 から）
  //   answers … このまとまりの中での解答 { 問題ID: 選んだ番号 }
  //   cat,size… もう一度やるときのための条件
  //   mode    … 'set'（問題数を決めた出題）か 'challenge'（連続正解チャレンジ）
  //   score   … チャレンジの得点。streak は連続正解数、pts は問題ごとの得点
  //   qStart  … いまの問題を出した時刻。over は間違えて終わったら true
  var session = null;

  // ───────── テーマ ─────────

  function applyTheme() {
    if (store.theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', store.theme);
    el.themeIcon.textContent = store.theme === 'light' ? '☀' : store.theme === 'dark' ? '☾' : '◐';
    el.themeBtn.setAttribute('title',
      store.theme === 'auto' ? '端末の設定にあわせています' : store.theme === 'light' ? 'ライト表示' : 'ダーク表示');
  }

  el.themeBtn.addEventListener('click', function () {
    store.theme = store.theme === 'auto' ? 'light' : store.theme === 'light' ? 'dark' : 'auto';
    applyTheme();
    saveStore();
  });

  // ───────── 画面の切り替え ─────────

  function showView(v) {
    ['list', 'quiz', 'result', 'stats'].forEach(function (x) { $('view-' + x).hidden = (x !== v); });
    // 問題を解いている間も「問題一覧」のタブを選んだままにする
    var tabFor = (v === 'stats') ? 'stats' : 'list';
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      var on = t.getAttribute('data-view') === tabFor;
      t.classList.toggle('is-on', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    window.scrollTo(0, 0);
  }

  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
    b.addEventListener('click', function () {
      var v = b.getAttribute('data-view');
      if (v === 'stats') { renderStats(); showView('stats'); }
      else { renderList(); showView('list'); }
    });
  });

  // ───────── しぼりこみ ─────────

  var CAT_FILTERS = [['all', 'すべて'], ['非言語', '非言語'], ['言語', '言語']];
  var DIFF_FILTERS = [['all', 'すべて'], ['1', '★1'], ['2', '★2'], ['3', '★3']];
  var STATE_FILTERS = [['all', 'すべて'], ['unsolved', '未解答'], ['wrong', '間違えた']];

  function buildFilters() {
    var make = function (box, defs, get, set) {
      defs.forEach(function (d) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'fchip';
        b.textContent = d[1];
        b.setAttribute('data-f', d[0]);
        b.addEventListener('click', function () { set(d[0]); saveStore(); renderList(); });
        box.appendChild(b);
      });
    };
    make(el.filterCat, CAT_FILTERS, null, function (v) { store.filterCat = v; });
    make(el.filterDiff, DIFF_FILTERS, null, function (v) { store.filterDiff = v; });
    make(el.filterState, STATE_FILTERS, null, function (v) { store.filterState = v; });

    SIZES.forEach(function (n) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'sizebtn';
      b.textContent = n + '問';
      b.setAttribute('data-size', String(n));
      b.addEventListener('click', function () { startSession(store.filterCat, store.filterDiff, n); });
      el.sizeRow.appendChild(b);
    });
  }

  var SIZES = [1, 3, 5, 10];

  /** 配列をその場でシャッフルする */
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /** 分野に合う問題から n 問をランダムに選ぶ。まだ解いていない問題を先に使う */
  /** 分野と難易度に合う問題のID。状態（未解答・間違えた）はランダム出題では見ない */
  function pool(cat, diff) {
    var out = [];
    for (var i = 0; i < N; i++) {
      var q = DATA[i];
      if (cat !== 'all' && q.category !== cat) continue;
      if (diff !== 'all' && String(q.difficulty) !== diff) continue;
      out.push(q.id);
    }
    return out;
  }

  function pickRandom(cat, diff, n) {
    var ids = pool(cat, diff);
    var fresh = [], used = [];
    ids.forEach(function (id) { (store.results[id] ? used : fresh).push(id); });
    return shuffle(fresh).concat(shuffle(used)).slice(0, n);
  }

  function startSession(cat, diff, n) {
    var ids = pickRandom(cat, diff, n);
    if (!ids.length) return;
    session = { mode: 'set', ids: ids, pos: 0, answers: {}, cat: cat, diff: diff, size: n };
    openQuestion(INDEX_BY_ID[ids[0]]);
  }

  // ───────── 連続正解チャレンジ ─────────
  //
  // 条件に合う問題を全部シャッフルして順に出す。間違えたらそこで終わり。
  // 正解の得点は早いほど高い：すぐ答えれば 1000点、制限時間ちょうどで 100点、
  // その間はまっすぐ下がる。制限時間を過ぎてからの正解は一律 100点。
  // 最高得点は分野と難易度の組ごとに残す。

  var PTS_MAX = 1000, PTS_MIN = 100;

  function pointsFor(sec, limit) {
    if (!(limit > 0) || sec >= limit) return PTS_MIN;
    var r = 1 - Math.max(0, sec) / limit;
    return PTS_MIN + Math.round((PTS_MAX - PTS_MIN) * r);
  }

  /** 1234567 → 1,234,567 */
  function fmtNum(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  function bestKey(cat, diff) { return cat + '|' + diff; }
  function bestOf(cat, diff) { return store.bestPts[bestKey(cat, diff)] || 0; }

  function startChallenge(cat, diff) {
    var ids = shuffle(pool(cat, diff));
    if (!ids.length) return;
    session = { mode: 'challenge', ids: ids, pos: 0, answers: {}, cat: cat, diff: diff,
      score: 0, streak: 0, pts: {}, qStart: 0, over: false };
    openQuestion(INDEX_BY_ID[ids[0]]);
  }

  function isChallenge() { return !!session && session.mode === 'challenge'; }

  /** 最高スコアを更新したら true */
  function recordBest() {
    if (!isChallenge()) return false;
    var k = bestKey(session.cat, session.diff);
    if (session.score > (store.bestPts[k] || 0)) { store.bestPts[k] = session.score; saveStore(); return true; }
    return false;
  }

  el.challengeBtn.addEventListener('click', function () { startChallenge(store.filterCat, store.filterDiff); });

  function paintFilters() {
    var paint = function (box, val) {
      Array.prototype.forEach.call(box.querySelectorAll('.fchip'), function (b) {
        b.classList.toggle('is-on', b.getAttribute('data-f') === val);
      });
    };
    paint(el.filterCat, store.filterCat);
    paint(el.filterDiff, store.filterDiff);
    paint(el.filterState, store.filterState);
  }

  /** いまのしぼりこみに合う問題の添字の配列 */
  function filtered() {
    var out = [];
    for (var i = 0; i < N; i++) {
      var q = DATA[i];
      var r = store.results[q.id];
      if (store.filterCat !== 'all' && q.category !== store.filterCat) continue;
      if (store.filterDiff !== 'all' && String(q.difficulty) !== store.filterDiff) continue;
      if (store.filterState === 'unsolved' && r) continue;
      if (store.filterState === 'wrong' && (!r || r.correct)) continue;
      out.push(i);
    }
    return out;
  }

  // ───────── 一覧 ─────────

  function snippet(s) {
    var t = String(s).replace(/\s+/g, ' ').trim();
    return t.length > 42 ? t.slice(0, 42) + '…' : t;
  }

  function renderList() {
    paintFilters();

    var poolN = pool(store.filterCat, store.filterDiff).length;
    el.poolCount.textContent = '当てはまる問題は ' + poolN + '問です。'
      + (poolN === 0 ? '' : (poolN < 10 ? 'これより多い問数を押しても' + poolN + '問だけ出ます。' : ''));
    Array.prototype.forEach.call(el.sizeRow.querySelectorAll('.sizebtn'), function (b) {
      b.disabled = (poolN === 0);
    });
    el.challengeBtn.disabled = (poolN === 0);
    el.bestScore.textContent = '自己ベスト ' + fmtNum(bestOf(store.filterCat, store.filterDiff)) + '点';

    var list = filtered();
    el.listCount.textContent = list.length ? list.length + '問' : '当てはまる問題がありません。しぼりこみを変えてください。';

    el.qlist.innerHTML = '';
    list.forEach(function (idx) {
      var q = DATA[idx];
      var r = store.results[q.id];

      var liEl = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'qrow' + (r ? (r.correct ? ' done-ok' : ' done-ng') : '');

      var dot = document.createElement('span');
      dot.className = 'qdot' + (r ? (r.correct ? ' ok' : ' ng') : '');
      dot.textContent = r ? (r.correct ? '○' : '×') : '';

      var mid = document.createElement('span');
      mid.className = 'qmid';
      var head = document.createElement('span');
      head.className = 'qhead-line';
      head.textContent = '第' + (idx + 1) + '問　' + q.category + '／' + q.topic + '　★' + q.difficulty;
      var snip = document.createElement('span');
      snip.className = 'qsnip';
      snip.textContent = snippet(q.question);
      mid.appendChild(head);
      mid.appendChild(snip);

      b.appendChild(dot);
      b.appendChild(mid);
      b.addEventListener('click', function () { openQuestion(idx); });
      liEl.appendChild(b);
      el.qlist.appendChild(liEl);
    });
  }

  el.backToList.addEventListener('click', function () {
    recordBest();
    session = null;
    renderList();
    showView('list');
  });

  // ───────── タイマー ─────────

  function stopTimer() { if (tick) { clearInterval(tick); tick = null; } }

  function startTimer(sec) {
    stopTimer();
    // チャレンジは時間で得点が変わるので、隠す設定でも出す
    if (store.hideTimer && !isChallenge()) { el.timer.hidden = true; return; }
    el.timer.hidden = false;
    el.timer.classList.remove('is-over');
    var left = sec;
    var draw = function () {
      var m = Math.floor(Math.abs(left) / 60), s = Math.abs(left) % 60;
      el.timer.textContent = (left < 0 ? '+' : '') + m + ':' + (s < 10 ? '0' : '') + s;
      el.timer.classList.toggle('is-over', left <= 0);
    };
    draw();
    tick = setInterval(function () { left--; draw(); }, 1000);
  }

  el.timerToggle.addEventListener('click', function () {
    store.hideTimer = !store.hideTimer;
    saveStore();
    el.timerToggle.textContent = store.hideTimer ? 'タイマーを表示' : 'タイマーを隠す';
    if (store.hideTimer) { stopTimer(); el.timer.hidden = true; }
    else if (current !== null && !store.results[DATA[current].id]) startTimer(DATA[current].timeLimitSec);
  });

  // ───────── 計算機とメモ（非言語のみ） ─────────
  //
  // 本番で電卓が使えるのは WEB テスティングだけだが、
  // 補助として置いている。eval は使わず、電卓と同じ「保留中の演算はひとつ」方式。

  var calc = { shown: '0', acc: null, op: null, fresh: true, err: false };

  var CALC_KEYS = [
    ['C', 'c', 'fn'], ['⌫', 'back', 'fn'], ['±', 'neg', 'fn'], ['÷', '/', 'op'],
    ['7', '7', ''], ['8', '8', ''], ['9', '9', ''], ['×', '*', 'op'],
    ['4', '4', ''], ['5', '5', ''], ['6', '6', ''], ['−', '-', 'op'],
    ['1', '1', ''], ['2', '2', ''], ['3', '3', ''], ['＋', '+', 'op'],
    ['0', '0', ''], ['.', '.', ''], ['=', '=', 'eq']
  ];

  function buildCalcKeys() {
    CALC_KEYS.forEach(function (k) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ckey' + (k[2] ? ' ' + k[2] : '');
      b.textContent = k[0];
      b.setAttribute('data-k', k[1]);
      b.addEventListener('click', function () { calcPress(k[1]); });
      el.calcKeys.appendChild(b);
    });
  }

  /** 表示用に丸める。小数の誤差（0.1+0.2 など）をそのまま見せない */
  function calcFmt(n) {
    if (!isFinite(n)) return 'エラー';
    if (n !== 0 && (Math.abs(n) >= 1e12 || Math.abs(n) < 1e-9)) return n.toExponential(6);
    return String(Math.round(n * 1e10) / 1e10);
  }

  function calcApply(a, op, b) {
    if (op === '+') return a + b;
    if (op === '-') return a - b;
    if (op === '*') return a * b;
    if (op === '/') return b === 0 ? NaN : a / b;
    return b;
  }

  function calcReset() { calc = { shown: '0', acc: null, op: null, fresh: true, err: false }; }

  function calcPress(k) {
    if (calc.err && k !== 'c') return;

    if (k >= '0' && k <= '9') {
      if (calc.fresh) { calc.shown = k; calc.fresh = false; }
      else if (calc.shown.replace(/[-.]/g, '').length < 12) {
        calc.shown = (calc.shown === '0') ? k : calc.shown + k;
      }
    } else if (k === '.') {
      if (calc.fresh) { calc.shown = '0.'; calc.fresh = false; }
      else if (calc.shown.indexOf('.') < 0) calc.shown += '.';
    } else if (k === 'c') {
      calcReset();
    } else if (k === 'back') {
      if (!calc.fresh) {
        calc.shown = calc.shown.slice(0, -1);
        if (!calc.shown || calc.shown === '-') calc.shown = '0';
      }
    } else if (k === 'neg') {
      if (calc.shown !== '0') {
        calc.shown = calc.shown.charAt(0) === '-' ? calc.shown.slice(1) : '-' + calc.shown;
      }
    } else if (k === '=') {
      if (calc.op !== null) {
        var r = calcApply(calc.acc, calc.op, parseFloat(calc.shown));
        if (!isFinite(r)) { calc.shown = 'エラー'; calc.err = true; }
        else calc.shown = calcFmt(r);
        calc.acc = null;
        calc.op = null;
      }
      calc.fresh = true;
    } else {
      if (calc.op !== null && !calc.fresh) {
        var r2 = calcApply(calc.acc, calc.op, parseFloat(calc.shown));
        if (!isFinite(r2)) { calc.shown = 'エラー'; calc.err = true; calc.op = null; calc.acc = null; }
        else { calc.shown = calcFmt(r2); calc.acc = r2; calc.op = k; }
      } else {
        calc.acc = parseFloat(calc.shown);
        calc.op = k;
      }
      calc.fresh = true;
    }

    el.calcOut.textContent = calc.shown;
  }

  function memoKey() { return current === null ? null : DATA[current].id; }

  function loadMemo() {
    var k = memoKey();
    el.memoBox.value = (k && store.memos[k]) || '';
  }

  function saveMemo() {
    var k = memoKey();
    if (!k) return;
    if (el.memoBox.value) store.memos[k] = el.memoBox.value;
    else delete store.memos[k];
    saveStore();
  }

  el.memoBox.addEventListener('input', saveMemo);

  el.toMemo.addEventListener('click', function () {
    if (calc.err) return;
    var v = el.memoBox.value;
    el.memoBox.value = v ? v.replace(/\s+$/, '') + '\n' + calc.shown : calc.shown;
    saveMemo();
  });

  function setHintOpen(open) {
    el.hintWrap.hidden = !open;
    el.hintBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    el.hintCaret.textContent = open ? '▴' : '▾';
    el.hintLabel.textContent = open ? 'ヒントを閉じる' : 'ヒントを見る';
  }

  el.hintBtn.addEventListener('click', function () {
    setHintOpen(el.hintWrap.hidden);
  });

  function setToolsOpen(open) {
    el.toolsBody.hidden = !open;
    el.toolsBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    el.toolsCaret.textContent = open ? '▴' : '▾';
  }

  el.toolsBtn.addEventListener('click', function () {
    var open = el.toolsBody.hidden;
    setToolsOpen(open);
    store.toolsOpen = open;
    saveStore();
  });

  // ───────── 図 ─────────
  //
  // 図はデータ側に書いた指定（type と中身）から組み立てる。
  // HTML を文字列で流し込まず、要素を1つずつ作るので、取り違えや壊れた印が入らない。
  // 色はすべて CSS の変数から来るので、ライトでもダークでも読める。

  var SVGNS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, attrs[k]);
    return e;
  }

  function svgText(x, y, str, cls) {
    var t = svgEl('text', { x: x, y: y });
    if (cls) t.setAttribute('class', cls);
    t.textContent = str;
    return t;
  }

  /** 表。head が見出しの行、rows が中身。先頭の列は見出し扱いにする */
  function buildTable(spec) {
    var scroll = document.createElement('div');
    scroll.className = 'fig-scroll';
    var tb = document.createElement('table');
    tb.className = 'fig-table';

    if (spec.head) {
      var thead = document.createElement('thead');
      var tr = document.createElement('tr');
      spec.head.forEach(function (h) {
        var th = document.createElement('th');
        th.textContent = h;
        tr.appendChild(th);
      });
      thead.appendChild(tr);
      tb.appendChild(thead);
    }

    var tbody = document.createElement('tbody');
    (spec.rows || []).forEach(function (row) {
      var tr = document.createElement('tr');
      row.forEach(function (cell, i) {
        var td = document.createElement('td');
        var text = cell, em = false;
        if (cell && typeof cell === 'object') { text = cell.t; em = !!cell.em; }
        td.textContent = text;
        if (i === 0 && spec.rowHead !== false) td.className = 'rowhead';
        else if (em) td.className = 'em';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    tb.appendChild(tbody);
    scroll.appendChild(tb);
    return scroll;
  }

  /** 帯グラフ。segs の w は全体に対する割合（合計100） */
  function buildBars(spec) {
    var box = document.createElement('div');
    box.className = 'fig-bars';
    (spec.rows || []).forEach(function (row) {
      var r = document.createElement('div');
      r.className = 'fig-bar-row';
      if (row.label) {
        var lb = document.createElement('span');
        lb.className = 'fig-bar-label';
        lb.textContent = row.label;
        r.appendChild(lb);
      }
      var bar = document.createElement('div');
      bar.className = 'fig-bar';
      (row.segs || []).forEach(function (sg) {
        var d = document.createElement('div');
        d.className = 'fig-seg ' + (sg.kind || 'cost');
        d.style.flex = '0 0 ' + sg.w + '%';
        d.textContent = sg.t || '';
        bar.appendChild(d);
      });
      r.appendChild(bar);
      box.appendChild(r);
    });
    return box;
  }

  /** 2つの集合のベン図 */
  function buildVenn2(spec) {
    var sv = svgEl('svg', { viewBox: '0 0 320 190', class: 'fig-venn', role: 'img' });
    if (spec.total) {
      var ttl = svgEl('title');
      ttl.textContent = spec.total;
      sv.appendChild(ttl);
    }

    sv.appendChild(svgEl('rect', { x: 6, y: 22, width: 308, height: 150, rx: 6, class: 'vn-box' }));
    if (spec.total) sv.appendChild(svgText(14, 16, spec.total, 'vn-small vn-left'));

    sv.appendChild(svgEl('circle', { cx: 125, cy: 100, r: 62, class: 'vn-ring' }));
    sv.appendChild(svgEl('circle', { cx: 195, cy: 100, r: 62, class: 'vn-ring' }));

    if (spec.aLabel) sv.appendChild(svgText(14, 40, spec.aLabel, 'vn-small vn-left'));
    if (spec.bLabel) sv.appendChild(svgText(306, 40, spec.bLabel, 'vn-small vn-right'));

    var put = function (x, v) {
      if (v === undefined || v === null || v === '') return;
      var em = false, text = v;
      if (typeof v === 'object') { text = v.t; em = !!v.em; }
      sv.appendChild(svgText(x, 105, text, em ? 'vn-em' : null));
    };
    put(90, spec.aOnly);
    put(160, spec.both);
    put(230, spec.bOnly);

    if (spec.outside !== undefined && spec.outside !== null && spec.outside !== '') {
      var o = spec.outside, em = false, text = o;
      if (typeof o === 'object') { text = o.t; em = !!o.em; }
      sv.appendChild(svgText(18, 165, text, (em ? 'vn-em' : 'vn-small') + ' vn-left'));
    }
    return sv;
  }

  /** 図の指定から要素を作る。指定がなければ null */
  function buildFigure(spec) {
    if (!spec || !spec.type) return null;
    var inner = null;
    if (spec.type === 'table') inner = buildTable(spec);
    else if (spec.type === 'bars') inner = buildBars(spec);
    else if (spec.type === 'venn2') inner = buildVenn2(spec);
    if (!inner) return null;

    var box = document.createElement('div');
    box.className = 'fig';
    box.appendChild(inner);
    if (spec.caption) {
      var c = document.createElement('p');
      c.className = 'fig-cap';
      c.textContent = spec.caption;
      box.appendChild(c);
    }
    return box;
  }

  /** 置き場をいったん空にしてから、図があれば入れる */
  function putFigure(box, spec) {
    box.innerHTML = '';
    var f = buildFigure(spec);
    if (f) box.appendChild(f);
  }

  // ───────── 問題 ─────────

  function openQuestion(idx) {
    if (idx < 0 || idx >= N) return;
    current = idx;
    if (session) session.pos = session.ids.indexOf(DATA[idx].id);
    renderQuiz();
    showView('quiz');
  }

  /** いまの問題の解答。出題中はそのまとまりの中の解答を見る */
  function answerOf(q) {
    if (session) {
      var a = session.answers[q.id];
      return a === undefined ? null : { choice: a, correct: a === q.answer };
    }
    return store.results[q.id] || null;
  }

  /** 上の「何問目」と、前へ・次へのボタン */
  function paintNav(q) {
    var answered = !!answerOf(q);
    el.liveScore.hidden = !isChallenge();
    if (isChallenge()) {
      el.quizPos.textContent = (session.pos + 1) + '問目';
      el.liveScore.textContent = 'スコア ' + fmtNum(session.score);
      el.prevQ.disabled = true;
      // 答えるまで先へは進めない
      el.nextQ.disabled = !answered;
      var last = session.over || session.pos >= session.ids.length - 1;
      el.nextQ.textContent = (answered && last) ? '結果を見る →' : '次の問題 →';
      el.backToList.textContent = '← やめる';
    } else if (session) {
      el.quizPos.textContent = (session.pos + 1) + ' / ' + session.ids.length + ' 問目';
      el.prevQ.disabled = session.pos <= 0;
      el.nextQ.disabled = false;
      el.nextQ.textContent = (session.pos >= session.ids.length - 1) ? '結果を見る →' : '次の問題 →';
      el.backToList.textContent = '← やめる';
    } else {
      var list = filtered();
      var pos = list.indexOf(current);
      el.quizPos.textContent = pos >= 0
        ? (pos + 1) + ' / ' + list.length + ' 問目'
        : '第' + (current + 1) + '問';
      el.prevQ.disabled = pos <= 0;
      el.nextQ.disabled = pos < 0 || pos >= list.length - 1;
      el.nextQ.textContent = '次の問題 →';
      el.backToList.textContent = '← 一覧へ';
    }
  }

  function renderQuiz() {
    var q = DATA[current];
    var saved = answerOf(q);

    paintNav(q);

    el.mNum.textContent = '第' + (current + 1) + '問';
    el.mCat.textContent = q.category;
    el.mTopic.textContent = q.topic;
    el.mDiff.textContent = '★' + q.difficulty;
    el.mDiff.setAttribute('title', '難易度 ' + q.difficulty);
    el.qtext.textContent = q.question;

    putFigure(el.qFig, q.figure);

    // ヒントは問題を変えるたびに閉じた状態に戻す
    el.hintBody.textContent = q.hint || '';
    putFigure(el.hintFig, q.hintFigure);
    setHintOpen(false);

    var isMath = q.category === '非言語';
    el.tools.hidden = !isMath;
    if (isMath) {
      calcReset();
      el.calcOut.textContent = calc.shown;
      loadMemo();
      setToolsOpen(!!store.toolsOpen);
    }

    el.choices.innerHTML = '';
    q.choices.forEach(function (text, i) {
      var liEl = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'choice';
      var k = document.createElement('span');
      k.className = 'key';
      k.textContent = LETTERS[i] || String(i + 1);
      var t = document.createElement('span');
      t.textContent = text;
      b.appendChild(k); b.appendChild(t);
      b.addEventListener('click', function () { answer(i); });
      liEl.appendChild(b);
      el.choices.appendChild(liEl);
    });

    el.retryBtn.hidden = !!session;

    if (saved) {
      stopTimer();
      el.timer.hidden = true;
      showResult(q, saved.choice);
    } else {
      el.result.hidden = true;
      if (isChallenge()) session.qStart = Date.now();
      startTimer(q.timeLimitSec);
    }
  }

  function answer(i) {
    if (current === null) return;
    var q = DATA[current];
    if (answerOf(q)) return;
    stopTimer();
    el.timer.hidden = true;
    if (session) session.answers[q.id] = i;
    store.results[q.id] = { choice: i, correct: i === q.answer, at: Date.now() };
    saveStore();
    if (isChallenge() && !session.over) {
      if (i === q.answer) {
        var sec = (Date.now() - session.qStart) / 1000;
        var p = pointsFor(sec, q.timeLimitSec);
        session.pts[q.id] = { p: p, sec: Math.round(sec) };
        session.score += p;
        session.streak++;
        el.liveScore.classList.remove('bump');
        void el.liveScore.offsetWidth;   // アニメーションをかけ直す
        el.liveScore.classList.add('bump');
      } else {
        session.over = true;
      }
    }
    showResult(q, i);
    paintNav(q);
  }

  function showResult(q, picked) {
    var btns = el.choices.querySelectorAll('.choice');
    Array.prototype.forEach.call(btns, function (b, i) {
      b.disabled = true;
      if (i === q.answer) b.classList.add('is-correct');
      else if (i === picked) b.classList.add('is-wrong');
      else b.classList.add('is-dim');
    });

    var ok = picked === q.answer;
    el.verdict.className = 'verdict ' + (ok ? 'ok' : 'ng');
    el.verdict.textContent = ok
      ? '正解　' + (LETTERS[q.answer] || '') + '　' + q.choices[q.answer]
      : '不正解　正解は ' + (LETTERS[q.answer] || '') + '　' + q.choices[q.answer];
    if (isChallenge()) {
      var got = session.pts[q.id];
      el.verdict.textContent += (ok && got)
        ? '　＋' + fmtNum(got.p) + '点（' + got.sec + '秒' + (got.sec >= q.timeLimitSec ? '・時間切れ' : '') + '）'
        : (ok ? '' : '　ゲームオーバー');
    }
    el.explanation.textContent = q.explanation;
    putFigure(el.expFig, q.answerFigure);
    el.refline.textContent = q.reference ? '参考にした分野：' + q.reference : '';
    el.result.hidden = false;
  }

  el.retryBtn.addEventListener('click', function () {
    if (current === null) return;
    var q = DATA[current];
    delete store.results[q.id];
    saveStore();
    renderQuiz();
    window.scrollTo(0, 0);
  });

  function step(d) {
    if (current === null) return;

    if (isChallenge()) {
      if (d < 0 || !answerOf(DATA[current])) return;
      if (session.over || session.pos >= session.ids.length - 1) { finishChallenge(); return; }
      openQuestion(INDEX_BY_ID[session.ids[session.pos + 1]]);
      return;
    }

    if (session) {
      var np = session.pos + d;
      if (np < 0) return;
      if (np >= session.ids.length) { finishSession(); return; }
      openQuestion(INDEX_BY_ID[session.ids[np]]);
      return;
    }

    var list = filtered();
    var pos = list.indexOf(current);
    if (pos < 0) {
      // しぼりこみから外れた（解いたので「未解答」から消えた等）。近いものへ移る
      for (var i = 0; i < list.length; i++) {
        if (list[i] > current) { openQuestion(list[i]); return; }
      }
      if (list.length) openQuestion(list[d > 0 ? list.length - 1 : 0]);
      else { renderList(); showView('list'); }
      return;
    }
    var next = pos + d;
    if (next < 0 || next >= list.length) return;
    openQuestion(list[next]);
  }

  el.prevQ.addEventListener('click', function () { if (!el.prevQ.disabled) step(-1); });
  el.nextQ.addEventListener('click', function () { if (!el.nextQ.disabled) step(1); });

  // ───────── 出題の結果 ─────────

  function finishSession() {
    if (!session) return;
    var n = session.ids.length, c = 0;
    session.ids.forEach(function (id) {
      if (session.answers[id] === DATA[INDEX_BY_ID[id]].answer) c++;
    });

    el.scoreBig.textContent = c + ' / ' + n + ' 問正解';
    var catName = session.cat === 'all' ? '全分野' : session.cat;
    var diffName = session.diff === 'all' ? '難易度すべて' : '難易度★' + session.diff;
    var unanswered = n - Object.keys(session.answers).length;
    el.scoreSub.textContent = catName + '　' + diffName + '　' + n + '問'
      + (unanswered ? '　（未解答 ' + unanswered + '問）' : '');

    el.resultList.innerHTML = '';
    session.ids.forEach(function (id, i) {
      el.resultList.appendChild(resultRow(INDEX_BY_ID[id], i, session.answers[id]));
    });

    el.againBtn.textContent = '同じ条件でもう一度';
    showView('result');
  }

  /** 結果の一覧の1行。a は選んだ番号（未解答なら undefined） */
  function resultRow(idx, i, a, extra) {
      var q = DATA[idx];
      var okAns = a === q.answer;

      var liEl = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'qrow' + (a === undefined ? '' : (okAns ? ' done-ok' : ' done-ng'));

      var dot = document.createElement('span');
      dot.className = 'qdot' + (a === undefined ? '' : (okAns ? ' ok' : ' ng'));
      dot.textContent = a === undefined ? '−' : (okAns ? '○' : '×');

      var mid = document.createElement('span');
      mid.className = 'qmid';
      var head = document.createElement('span');
      head.className = 'qhead-line';
      head.textContent = (i + 1) + '問目　' + q.category + '／' + q.topic + '　★' + q.difficulty + (extra || '');
      var snip = document.createElement('span');
      snip.className = 'qsnip';
      snip.textContent = snippet(q.question);
      mid.appendChild(head); mid.appendChild(snip);

      b.appendChild(dot); b.appendChild(mid);
      b.addEventListener('click', function () { openQuestion(idx); });
      liEl.appendChild(b);
      return liEl;
  }

  function finishChallenge() {
    var prev = bestOf(session.cat, session.diff);
    var isNew = recordBest();
    var cleared = !session.over;

    el.scoreBig.textContent = fmtNum(session.score) + '点';
    var catName = session.cat === 'all' ? '全分野' : session.cat;
    var diffName = session.diff === 'all' ? '難易度すべて' : '難易度★' + session.diff;
    el.scoreSub.innerHTML = '';
    el.scoreSub.appendChild(document.createTextNode(
      (cleared ? '全問正解！' : 'ゲームオーバー') + '　連続正解 ' + session.streak + '問　' + catName + '　' + diffName));
    el.scoreSub.appendChild(document.createElement('br'));
    var bl = document.createElement('span');
    if (isNew) { bl.className = 'new-best'; bl.textContent = '自己ベスト更新（前回まで ' + fmtNum(prev) + '点）'; }
    else bl.textContent = '自己ベスト ' + fmtNum(bestOf(session.cat, session.diff)) + '点';
    el.scoreSub.appendChild(bl);

    // 答えた問題だけを並べる。間違えて終わったなら最後の1問がそれ
    el.resultList.innerHTML = '';
    session.ids.forEach(function (id, i) {
      var a = session.answers[id];
      if (a === undefined) return;
      var got = session.pts[id];
      el.resultList.appendChild(resultRow(INDEX_BY_ID[id], i, a,
        got ? '　＋' + fmtNum(got.p) + '点（' + got.sec + '秒）' : ''));
    });

    el.againBtn.textContent = 'もう一度挑戦';
    showView('result');
  }

  el.againBtn.addEventListener('click', function () {
    if (!session) return;
    if (isChallenge()) startChallenge(session.cat, session.diff);
    else startSession(session.cat, session.diff, session.size);
  });

  el.toListBtn.addEventListener('click', function () {
    session = null;
    renderList();
    showView('list');
  });

  // ───────── 記録 ─────────

  function pct(c, n) { return n ? Math.round((c / n) * 100) : 0; }

  function bars(box, rows) {
    box.innerHTML = '';
    if (!rows.length) {
      var p = document.createElement('li');
      p.className = 'note';
      p.textContent = 'まだ記録がありません。1問解くとここに出ます。';
      box.appendChild(p);
      return;
    }
    rows.forEach(function (r) {
      var liEl = document.createElement('li');
      liEl.className = 'trow';
      var nm = document.createElement('span'); nm.className = 'tname'; nm.textContent = r.name;
      var bar = document.createElement('span'); bar.className = 'tbar';
      var fill = document.createElement('i'); fill.style.width = pct(r.c, r.n) + '%';
      bar.appendChild(fill);
      var num = document.createElement('span'); num.className = 'tnum'; num.textContent = r.c + '/' + r.n;
      liEl.appendChild(nm); liEl.appendChild(bar); liEl.appendChild(num);
      box.appendChild(liEl);
    });
  }

  function renderStats() {
    var solved = 0, correct = 0;
    var byTopic = {}, byDiff = {};

    DATA.forEach(function (q) {
      var r = store.results[q.id];
      if (!r) return;
      solved++;
      if (r.correct) correct++;
      if (!byTopic[q.topic]) byTopic[q.topic] = { n: 0, c: 0 };
      byTopic[q.topic].n++; if (r.correct) byTopic[q.topic].c++;
      if (!byDiff[q.difficulty]) byDiff[q.difficulty] = { n: 0, c: 0 };
      byDiff[q.difficulty].n++; if (r.correct) byDiff[q.difficulty].c++;
    });

    el.sSolved.textContent = solved;
    el.sRate.textContent = solved ? pct(correct, solved) + '%' : '—';
    el.sWrong.textContent = solved - correct;

    bars(el.topicStats, Object.keys(byTopic)
      .sort(function (a, b) { return byTopic[b].n - byTopic[a].n; })
      .map(function (t) { return { name: t, n: byTopic[t].n, c: byTopic[t].c }; }));

    bars(el.diffStats, Object.keys(byDiff).sort()
      .map(function (d) { return { name: '難易度 ' + d, n: byDiff[d].n, c: byDiff[d].c }; }));

    el.storeNote.textContent = storeOK
      ? '記録はこの端末のブラウザにだけ保存されます。ほかの人には見えません。'
      : 'この環境ではブラウザに保存できないため、記録は残りません。問題と解説はそのまま使えます。';
  }

  el.resetBtn.addEventListener('click', function () {
    if (!window.confirm('これまでの記録・メモ・チャレンジの自己ベストをすべて消します。元に戻せません。よろしいですか。')) return;
    store.results = {};
    store.memos = {};
    store.bestPts = {};
    saveStore();
    renderStats();
    renderList();
  });

  // ───────── 起動 ─────────

  loadStore();
  applyTheme();
  buildCalcKeys();
  buildFilters();
  el.timerToggle.textContent = store.hideTimer ? 'タイマーを表示' : 'タイマーを隠す';
  renderList();
  showView('list');
})();
