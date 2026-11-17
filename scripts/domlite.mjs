// テスト用の最小 DOM。
// assets/app.js を Node で動かすために必要な分だけを実装している。
// index.html から id / class / data-view を読み取って要素を組み立てるので、
// HTML 側の id を変えるとテストも追従する。

class El {
  constructor(tag, doc) {
    this.tagName = String(tag).toUpperCase();
    this._doc = doc;
    this.children = [];
    this.parent = null;
    this._text = '';
    this._cls = new Set();
    this.attrs = {};
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.disabled = false;
    this.type = '';
    this.value = '';
    this._on = {};
    const self = this;
    this.classList = {
      add: (...c) => c.forEach((x) => x && self._cls.add(x)),
      remove: (...c) => c.forEach((x) => self._cls.delete(x)),
      contains: (c) => self._cls.has(c),
      toggle: (c, force) => {
        const want = force === undefined ? !self._cls.has(c) : !!force;
        if (want) self._cls.add(c); else self._cls.delete(c);
        return want;
      },
    };
  }

  get className() { return Array.from(this._cls).join(' '); }
  set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }

  get textContent() {
    if (this.children.length) return this.children.map((c) => c.textContent).join('');
    return this._text;
  }
  set textContent(v) { this._text = String(v); this.children.forEach((c) => (c.parent = null)); this.children = []; }

  get innerHTML() { return ''; }
  set innerHTML(v) {
    if (v !== '') throw new Error('domlite: innerHTML への代入は空文字のみ対応');
    this.children.forEach((c) => (c.parent = null));
    this.children = [];
    this._text = '';
  }

  appendChild(c) { c.parent = this; this.children.push(c); return c; }

  setAttribute(k, v) {
    this.attrs[k] = String(v);
    if (k === 'class') this.className = String(v);
    if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-(.)/g, (_, c) => c.toUpperCase())] = String(v);
  }
  getAttribute(k) { return this.attrs[k] ?? null; }

  addEventListener(ev, fn) { (this._on[ev] ||= []).push(fn); }
  click() { this.fire('click'); }
  fire(ev) { (this._on[ev] || []).forEach((f) => f.call(this, { target: this })); }

  /** 子孫を深さ優先で走査 */
  *walk() { for (const c of this.children) { yield c; yield* c.walk(); } }

  matches(sel) {
    if (sel.startsWith('.')) {
      const m = sel.match(/^\.([\w-]+)(?:\[data-([\w-]+)="([^"]+)"\])?$/);
      if (!m) return false;
      if (!this._cls.has(m[1])) return false;
      if (m[2] && this.getAttribute('data-' + m[2]) !== m[3]) return false;
      return true;
    }
    return false;
  }

  querySelectorAll(sel) { return Array.from(this.walk()).filter((e) => e.matches(sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

export class JSDOMLite {
  constructor(html) {
    this.ids = {};
    this.root = new El('body', this);

    // index.html から id を持つ要素を拾う（出現順に body 直下へ並べる。
    // app.js は親子関係に依存せず getElementById と querySelectorAll しか使わない）
    const idRe = /<(\w+)[^>]*\bid="([\w-]+)"[^>]*>/g;
    let m;
    while ((m = idRe.exec(html))) {
      const el = new El(m[1], this);
      const tagSrc = m[0];
      const cls = tagSrc.match(/\bclass="([^"]*)"/);
      if (cls) el.className = cls[1];
      if (/\bhidden\b/.test(tagSrc)) el.hidden = true;
      this.ids[m[2]] = el;
      this.root.appendChild(el);
    }

    // タブ（id を持たないので class と data-view から作る）
    const tabRe = /<button[^>]*class="tab[^"]*"[^>]*data-view="(\w+)"[^>]*>/g;
    while ((m = tabRe.exec(html))) {
      const el = new El('button', this);
      el.className = /class="([^"]*)"/.exec(m[0])[1];
      el.setAttribute('data-view', m[1]);
      this.root.appendChild(el);
    }

    // app.js は $('view-today') のような id で参照するので、無ければ作る
    for (const v of ['today', 'archive', 'stats']) {
      if (!this.ids['view-' + v]) {
        const el = new El('section', this);
        el.hidden = v !== 'today';
        this.ids['view-' + v] = el;
        this.root.appendChild(el);
      }
    }

    this.storage = null;
  }

  byId(id) { return this.ids[id] || null; }
  querySelector(sel) { return this.root.querySelector(sel); }
  querySelectorAll(sel) { return this.root.querySelectorAll(sel); }

  /** app.js を実行するためのグローバル（this）を作る */
  globals({ storageWorks = true, seed = null } = {}) {
    const dom = this;
    const doc = {
      getElementById: (id) => dom.byId(id),
      createElement: (t) => new El(t, dom),
      createElementNS: (ns, t) => new El(t, dom),
      createTextNode: (s) => { const t = new El("#text", dom); t._text = String(s); return t; },
      querySelector: (s) => dom.querySelector(s),
      querySelectorAll: (s) => dom.querySelectorAll(s),
      documentElement: {
        _attrs: {},
        setAttribute(k, v) { this._attrs[k] = v; },
        removeAttribute(k) { delete this._attrs[k]; },
        getAttribute(k) { return this._attrs[k] ?? null; },
      },
    };

    let mem = seed ? { 'spi-set-v1': seed } : {};
    const storage = storageWorks
      ? {
          getItem: (k) => (k in mem ? mem[k] : null),
          setItem: (k, v) => { mem[k] = String(v); },
          removeItem: (k) => { delete mem[k]; },
        }
      : {
          getItem() { throw new Error('storage disabled'); },
          setItem() { throw new Error('storage disabled'); },
          removeItem() { throw new Error('storage disabled'); },
        };
    dom.storage = storage;

    const win = {
      localStorage: storage,
      scrollTo() {},
      confirm: () => true,
      SPI_QUESTIONS: undefined,
    };

    const g = Object.create(globalThis);
    g.document = doc;
    g.window = win;
    g.localStorage = storage;
    g.setInterval = () => 0;
    g.clearInterval = () => {};
    g.globalThis = g;

    // data/questions.js は window.SPI_QUESTIONS に代入するので、両方から見えるようにする
    Object.defineProperty(g, 'SPI_QUESTIONS', {
      get: () => win.SPI_QUESTIONS,
      set: (v) => { win.SPI_QUESTIONS = v; },
      configurable: true,
    });

    return g;
  }

  /** ブラウザの <script> と同じようにソースを実行する。
   *  new Function の中では素の window / document が見えないので、引数として渡す。 */
  run(g, src, label) {
    try {
      const fn = new Function('window', 'document', 'localStorage', 'globalThis', 'setInterval', 'clearInterval', src);
      fn.call(g, g.window, g.document, g.localStorage, g, g.setInterval, g.clearInterval);
    } catch (e) {
      throw new Error(`${label} の実行でエラー: ${e.message}`);
    }
  }
}
