#!/usr/bin/env node
// 問題バンクの検証。
//   node scripts/verify.mjs
//
// 1) 構造チェック … 全60問（ID重複、必須フィールド、answer の範囲、選択肢の重複など）
// 2) 答えの再計算 … 非言語のみ。check(h) が返すインデックスと answer が一致するか。
//    check は問題を作ったときとは別経路で書く。列挙できるものは総当たりで数える。
//
// 失敗があれば終了コード 1 を返す。

import bank from './bank/index.mjs';

// ───────── 検証用ヘルパー ─────────

/** 選択肢の文字列から数値を取り出す。"2,000円" → 2000、"5/14" → 0.357…、"時速24km" → 24 */
function parseVal(s) {
  const t = String(s).replace(/,/g, '');
  const frac = t.match(/(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const num = t.match(/-?\d+(?:\.\d+)?/);
  return num ? Number(num[0]) : NaN;
}

function makeHelpers(choices) {
  const EPS = 1e-9;
  const pick = (v) => {
    const idx = choices.findIndex((c) => {
      const n = parseVal(c);
      return Number.isFinite(n) && Math.abs(n - v) < Math.max(EPS, Math.abs(v) * 1e-9);
    });
    if (idx < 0) throw new Error(`pick(${v}) に一致する選択肢がない`);
    return idx;
  };
  const pickLabel = (s) => {
    const idx = choices.indexOf(s);
    if (idx < 0) throw new Error(`pickLabel(${s}) に一致する選択肢がない`);
    return idx;
  };
  const range = (n) => Array.from({ length: n }, (_, i) => i);
  const perms = (arr) => {
    if (arr.length <= 1) return [arr.slice()];
    const out = [];
    arr.forEach((x, i) => {
      const rest = arr.slice(0, i).concat(arr.slice(i + 1));
      for (const p of perms(rest)) out.push([x, ...p]);
    });
    return out;
  };
  const combos = (arr, k) => {
    const out = [];
    const rec = (start, acc) => {
      if (acc.length === k) { out.push(acc.slice()); return; }
      for (let i = start; i < arr.length; i++) { acc.push(arr[i]); rec(i + 1, acc); acc.pop(); }
    };
    rec(0, []);
    return out;
  };
  /** ア/イ/ウ の真偽から A〜H のインデックスへ。A アだけ / B イだけ / C ウだけ / D アとイ / E アとウ / F イとウ / G すべて / H なし */
  const labelABC = (a, b, c) => {
    const key = `${a ? 1 : 0}${b ? 1 : 0}${c ? 1 : 0}`;
    const map = { '100': 0, '010': 1, '001': 2, '110': 3, '101': 4, '011': 5, '111': 6, '000': 7 };
    if (!(key in map)) throw new Error(`labelABC: 想定外 ${key}`);
    return map[key];
  };
  return { CHOICES: choices, pick, pickLabel, range, perms, combos, labelABC, parseVal };
}

// ───────── 検証本体 ─────────

const REQUIRED = ['id', 'category', 'topic', 'difficulty', 'question', 'hint', 'choices', 'answer', 'explanation', 'timeLimitSec', 'reference'];
const CATEGORIES = new Set(['非言語', '言語']);

const errors = [];
const warnings = [];
const seenIds = new Set();

for (const q of bank) {
  const at = q.id ?? '(id なし)';

  for (const f of REQUIRED) {
    if (q[f] === undefined || q[f] === null || q[f] === '') errors.push(`${at}: 必須フィールド ${f} がない`);
  }
  if (seenIds.has(q.id)) errors.push(`${at}: ID が重複している`);
  seenIds.add(q.id);

  if (!CATEGORIES.has(q.category)) errors.push(`${at}: category が不正 (${q.category})`);
  if (![1, 2, 3].includes(q.difficulty)) errors.push(`${at}: difficulty は 1〜3 (${q.difficulty})`);

  if (!Array.isArray(q.choices) || q.choices.length < 2) {
    errors.push(`${at}: choices が配列でないか少なすぎる`);
  } else {
    if (new Set(q.choices).size !== q.choices.length) errors.push(`${at}: 選択肢に重複がある`);
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.choices.length) {
      errors.push(`${at}: answer が選択肢の範囲外 (${q.answer} / 0〜${q.choices.length - 1})`);
    }
  }

  if (typeof q.hint === 'string') {
    if (q.hint.length < 10) errors.push(`${at}: hint が短すぎる (${q.hint.length}字)`);
    if (q.hint.length > 90) warnings.push(`${at}: hint が長い (${q.hint.length}字) — ヒントは1〜2文に収める`);
    if (q.hint.indexOf(String(q.choices && q.choices[q.answer])) >= 0) {
      errors.push(`${at}: hint に答えそのものが入っている`);
    }
  }

  // 図の指定を検査する
  ['figure', 'hintFigure', 'answerFigure'].forEach((slot) => {
    const f = q[slot];
    if (f === undefined) return;
    if (!f || typeof f !== 'object') { errors.push(`${at}: ${slot} が object でない`); return; }
    if (!['table', 'bars', 'venn2'].includes(f.type)) {
      errors.push(`${at}: ${slot}.type が不明 (${f.type})`); return;
    }
    if (f.type === 'table') {
      if (!Array.isArray(f.rows) || !f.rows.length) errors.push(`${at}: ${slot} に rows がない`);
      else if (Array.isArray(f.head)) {
        f.rows.forEach((r, i) => {
          if (!Array.isArray(r)) errors.push(`${at}: ${slot}.rows[${i}] が配列でない`);
          else if (r.length !== f.head.length) {
            errors.push(`${at}: ${slot}.rows[${i}] の列数が見出しと合わない (${r.length} / ${f.head.length})`);
          }
        });
      }
    }
    if (f.type === 'bars') {
      if (!Array.isArray(f.rows) || !f.rows.length) { errors.push(`${at}: ${slot} に rows がない`); return; }
      f.rows.forEach((r, i) => {
        if (!Array.isArray(r.segs) || !r.segs.length) { errors.push(`${at}: ${slot}.rows[${i}] に segs がない`); return; }
        const sum = r.segs.reduce((a, sg) => a + (Number(sg.w) || 0), 0);
        if (Math.abs(sum - 100) > 1.5) {
          errors.push(`${at}: ${slot}.rows[${i}] の幅の合計が100にならない (${sum.toFixed(1)})`);
        }
      });
    }
    if (f.type === 'venn2') {
      if (!f.aLabel || !f.bLabel) warnings.push(`${at}: ${slot} に aLabel / bLabel がない`);
    }
    if (f.caption && f.caption.length > 120) warnings.push(`${at}: ${slot}.caption が長い (${f.caption.length}字)`);
  });

  if (typeof q.explanation === 'string' && q.explanation.length < 80) {
    warnings.push(`${at}: explanation が短い (${q.explanation.length}字)`);
  }
  if (typeof q.question === 'string' && q.question.length > 420) {
    warnings.push(`${at}: question が長い (${q.question.length}字) — スマホで読みづらい可能性`);
  }
  if (!Number.isInteger(q.timeLimitSec) || q.timeLimitSec < 20 || q.timeLimitSec > 300) {
    errors.push(`${at}: timeLimitSec が不自然 (${q.timeLimitSec})`);
  }

  // 言語は check を持たないかわりに、解説が根拠を示しているかだけ見る
  if (q.category === '言語') {
    if (q.check) warnings.push(`${at}: 言語に check がある（想定外ではないが未使用）`);
    if (typeof q.explanation === 'string' && q.explanation.length < 200) {
      warnings.push(`${at}: 言語の explanation が短い。正解の根拠と誤答が外れる理由を書くこと`);
    }
  }
}

// 非言語は答えを再計算する
let checked = 0;
for (const q of bank) {
  if (q.category !== '非言語') continue;
  if (typeof q.check !== 'function') {
    errors.push(`${q.id}: 非言語なのに check がない`);
    continue;
  }
  let got;
  try {
    got = q.check(makeHelpers(q.choices));
  } catch (e) {
    errors.push(`${q.id}: check の実行でエラー — ${e.message}`);
    continue;
  }
  checked++;
  if (got !== q.answer) {
    errors.push(`${q.id}: 答えが一致しない — check=${got} (${q.choices[got]}) / answer=${q.answer} (${q.choices[q.answer]})`);
  }
}

// ───────── 集計 ─────────

const byCat = {};
const byTopic = {};
const byDiff = { 1: 0, 2: 0, 3: 0 };
for (const q of bank) {
  byCat[q.category] = (byCat[q.category] ?? 0) + 1;
  byTopic[q.topic] = (byTopic[q.topic] ?? 0) + 1;
  byDiff[q.difficulty]++;
}

console.log(`問題数: ${bank.length}（${Object.entries(byCat).map(([k, v]) => `${k} ${v}`).join(' / ')}）`);
console.log(`難易度: 1=${byDiff[1]}  2=${byDiff[2]}  3=${byDiff[3]}`);
console.log(`分野: ${Object.entries(byTopic).map(([k, v]) => `${k}${v}`).join('、')}`);
console.log(`答えを再計算した問題: ${checked}問`);

const figCount = bank.filter((q) => q.figure || q.hintFigure || q.answerFigure).length;
const figSlots = bank.reduce((a, q) => a + ['figure', 'hintFigure', 'answerFigure'].filter((k) => q[k]).length, 0);
console.log(`図のある問題: ${figCount}問（図は全部で${figSlots}枚）`);

if (warnings.length) {
  console.log(`\n警告 ${warnings.length}件`);
  for (const w of warnings) console.log(`  ! ${w}`);
}

if (errors.length) {
  console.log(`\nエラー ${errors.length}件`);
  for (const e of errors) console.log(`  x ${e}`);
  process.exit(1);
}

console.log('\nすべて通過。');
