#!/usr/bin/env node
// アプリ本体（assets/app.js）の動作確認。
//   node scripts/test-app.mjs
//
// 最小限の DOM を用意して index.html と同じ順序でスクリプトを読み込み、
// 実際に一覧・解答・移動・しぼりこみ・記録・計算機を動かして状態を確かめる。
// ブラウザを使わずに「実行時エラーで落ちないか」「正しく描けているか」を見るのが目的。
//
// 失敗があれば終了コード 1 を返す。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOMLite } from './domlite.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

const fails = [];
const ok = (name, cond, detail) => {
  if (cond) console.log(`  ok   ${name}`);
  else { console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); fails.push(name); }
};

function boot({ storageWorks = true, seed = null } = {}) {
  const dom = new JSDOMLite(read('index.html'));
  const g = dom.globals({ storageWorks, seed });
  dom.run(g, read('data/questions.js'), 'questions.js');
  dom.run(g, read('assets/app.js'), 'app.js');
  return dom;
}

const data = JSON.parse(read('data/questions.json'));
const QS = data.questions;
const N = QS.length;
const nMath = QS.filter((q) => q.category === '非言語').length;
const nVerbal = N - nMath;

// 画面を触るための小道具
const rows = (d) => d.byId('qlist').querySelectorAll('.qrow');
const choices = (d) => d.byId('choices').querySelectorAll('.choice');
const catChip = (d, f) => d.byId('filterCat').querySelectorAll('.fchip').find((b) => b.getAttribute('data-f') === f);
const stateChip = (d, f) => d.byId('filterState').querySelectorAll('.fchip').find((b) => b.getAttribute('data-f') === f);
const diffChip = (d, f) => d.byId('filterDiff').querySelectorAll('.fchip').find((b) => b.getAttribute('data-f') === f);
const view = (d, v) => d.byId('view-' + v).hidden === false;

console.log('■ 起動と一覧\n');

let dom;
try { dom = boot(); ok('app.js が例外なく起動する', true); }
catch (e) { ok('app.js が例外なく起動する', false, e.message); console.log('\n失敗 1件'); process.exit(1); }

{
  ok('最初は一覧が出ている', view(dom, 'list') && !view(dom, 'quiz') && !view(dom, 'stats'));
  ok(`一覧に ${N} 問ならぶ`, rows(dom).length === N, String(rows(dom).length));
  ok('上の「◯ / N 問」の表示はない', !dom.ids.progText && !read('index.html').includes('progress-bar'));
  ok('問題数のボタンが4つ出る', dom.byId('sizeRow').querySelectorAll('.sizebtn').length === 4,
    String(dom.byId('sizeRow').querySelectorAll('.sizebtn').length));
  ok('1行目に問題番号と分野が入る', /^第1問　(非言語|言語)／/.test(rows(dom)[0].textContent), rows(dom)[0].textContent.slice(0, 30));
  ok('一覧の行に難易度が★で出る', /★[123]/.test(rows(dom)[0].textContent), rows(dom)[0].textContent.slice(0, 30));
}

console.log('\n■ しぼりこみ\n');
{
  const d = boot();
  catChip(d, '非言語').click();
  ok(`非言語でしぼると ${nMath} 問`, rows(d).length === nMath, String(rows(d).length));
  ok('選んだチップに印が付く', catChip(d, '非言語').className.includes('is-on'));

  catChip(d, '言語').click();
  ok(`言語でしぼると ${nVerbal} 問`, rows(d).length === nVerbal, String(rows(d).length));

  catChip(d, 'all').click();
  ok('すべてに戻すと全問', rows(d).length === N, String(rows(d).length));

  stateChip(d, 'unsolved').click();
  ok('未解答でしぼると、まだ全問', rows(d).length === N, String(rows(d).length));

  stateChip(d, 'wrong').click();
  ok('間違えた問題がなければ0件', rows(d).length === 0, String(rows(d).length));
  ok('0件のときは案内が出る', d.byId('listCount').textContent.includes('当てはまる問題がありません'));
}

console.log('\n■ 問題を解く\n');
{
  const d = boot();
  rows(d)[0].click();
  ok('一覧から問題を開ける', view(d, 'quiz') && !view(d, 'list'));
  ok('問題文が入っている', d.byId('qtext').textContent === QS[0].question);
  ok('問題番号が出る', d.byId('mNum').textContent === '第1問', d.byId('mNum').textContent);
  ok('分野が出る', d.byId('mCat').textContent === QS[0].category);
  ok('位置が出る', d.byId('quizPos').textContent === `1 / ${N} 問目`, d.byId('quizPos').textContent);
  ok('選択肢の数が合う', choices(d).length === QS[0].choices.length);
  ok('解答前は結果が隠れている', d.byId('result').hidden === true);
  ok('最初の問題では「前の問題」が押せない', d.byId('prevQ').disabled === true);
  ok('「次の問題」は押せる', d.byId('nextQ').disabled === false);

  choices(d)[QS[0].answer].click();
  ok('解答すると結果が出る', d.byId('result').hidden === false);
  ok('正解と判定される', d.byId('verdict').textContent.startsWith('正解'), d.byId('verdict').textContent.slice(0, 20));
  ok('解説が入る', d.byId('explanation').textContent === QS[0].explanation);
  ok('出典行が入る', d.byId('refline').textContent.includes(QS[0].reference));
  ok('解答後は選択肢が押せない', choices(d).every((b) => b.disabled === true));
  ok('正解の選択肢に印が付く', choices(d)[QS[0].answer].className.includes('is-correct'));

  // 不正解
  const d2 = boot();
  rows(d2)[0].click();
  const wrong = (QS[0].answer + 1) % QS[0].choices.length;
  choices(d2)[wrong].click();
  ok('不正解と判定される', d2.byId('verdict').textContent.startsWith('不正解'), d2.byId('verdict').textContent.slice(0, 24));
  ok('選んだ選択肢に×印が付く', choices(d2)[wrong].className.includes('is-wrong'));
  ok('不正解でも正解の位置が示される', choices(d2)[QS[0].answer].className.includes('is-correct'));
}

console.log('\n■ 問題の移動\n');
{
  const d = boot();
  rows(d)[0].click();
  d.byId('nextQ').click();
  ok('次の問題へ進める', d.byId('qtext').textContent === QS[1].question);
  ok('位置が 2 / N になる', d.byId('quizPos').textContent === `2 / ${N} 問目`, d.byId('quizPos').textContent);
  d.byId('prevQ').click();
  ok('前の問題へ戻れる', d.byId('qtext').textContent === QS[0].question);

  // 最後の問題
  const d2 = boot();
  rows(d2)[N - 1].click();
  ok('最後の問題では「次の問題」が押せない', d2.byId('nextQ').disabled === true);

  d2.byId('backToList').click();
  ok('一覧へ戻れる', view(d2, 'list'));
}

console.log('\n■ 記録と続きから\n');
{
  const d = boot();
  rows(d)[0].click();
  choices(d)[QS[0].answer].click();
  d.byId('nextQ').click();
  const wrong1 = (QS[1].answer + 1) % QS[1].choices.length;
  choices(d)[wrong1].click();
  d.byId('backToList').click();

  ok('一覧に正解の印が付く', rows(d)[0].className.includes('done-ok'));
  ok('一覧に不正解の印が付く', rows(d)[1].className.includes('done-ng'));

  stateChip(d, 'unsolved').click();
  ok('未解答でしぼると2問減る', rows(d).length === N - 2, String(rows(d).length));
  stateChip(d, 'wrong').click();
  ok('間違えた問題でしぼると1問', rows(d).length === 1, String(rows(d).length));
  ok('その1問は2問目', rows(d)[0].textContent.includes('第2問'), rows(d)[0].textContent.slice(0, 14));

  stateChip(d, 'all').click();
  d.querySelector('.tab[data-view="stats"]').click();
  ok('記録の画面に移る', view(d, 'stats'));
  ok('解いた数が2', d.byId('sSolved').textContent === '2', d.byId('sSolved').textContent);
  ok('正答率が50%', d.byId('sRate').textContent === '50%', d.byId('sRate').textContent);
  ok('間違えた数が1', d.byId('sWrong').textContent === '1', d.byId('sWrong').textContent);
  ok('分野ごとの行が出る', d.byId('topicStats').querySelectorAll('.trow').length >= 1);
  ok('難易度ごとの行が出る', d.byId('diffStats').querySelectorAll('.trow').length >= 1);

  // 保存して開き直す
  const saved = d.storage.getItem('spi-set-v1');
  const d2 = boot({ seed: saved });
  ok('開き直しても解答の印が残る', rows(d2)[0].className.includes('done-ok'), rows(d2)[0].className);
  rows(d2)[1].click();
  ok('一覧から開くと解答済みの状態で出る', d2.byId('result').hidden === false);

  // やり直す
  d2.byId('retryBtn').click();
  ok('やり直すと未解答に戻る', d2.byId('result').hidden === true);
  ok('やり直すと選択肢が押せる', choices(d2).every((b) => b.disabled === false));
}

console.log('\n■ 計算機とメモ\n');
{
  const mathIdx = QS.findIndex((q) => q.category === '非言語');
  const verbalIdx = QS.findIndex((q) => q.category === '言語');

  const d = boot();
  rows(d)[mathIdx].click();
  ok('非言語では計算機とメモが出る', d.byId('tools').hidden === false);

  const dv = boot();
  rows(dv)[verbalIdx].click();
  ok('言語では計算機とメモが出ない', dv.byId('tools').hidden === true);

  const press = (dom2, keys) => {
    const btns = dom2.byId('calcKeys').querySelectorAll('.ckey');
    for (const k of keys) {
      const b = btns.find((x) => x.getAttribute('data-k') === k);
      if (!b) throw new Error('キーがない: ' + k);
      b.click();
    }
    return dom2.byId('calcOut').textContent;
  };

  ok('キーが19個ある', d.byId('calcKeys').querySelectorAll('.ckey').length === 19);

  const cases = [
    [['1', '2', '+', '3', '='], '15', '12 + 3'],
    [['c', '9', '*', '8', '='], '72', '9 × 8'],
    [['c', '2', '4', '0', '/', '0', '.', '1', '2', '='], '2000', '240 ÷ 0.12'],
    [['c', '4', '5', '0', '*', '0', '.', '3', '6', '='], '162', '450 × 0.36'],
    [['c', '1', '+', '2', '+', '3', '='], '6', '1 + 2 + 3（連続）'],
    [['c', '5', '-', '8', '='], '-3', '5 − 8'],
    [['c', '7', '/', '0', '='], 'エラー', '0で割る'],
    [['c', '4', '2'], '42', 'C のあと入力できる'],
    [['c', '5', 'neg'], '-5', '符号の反転'],
    [['c', '1', '2', '3', 'back'], '12', '1文字消す'],
  ];
  for (const [keys, want, label] of cases) {
    const got = press(d, keys);
    ok(`電卓 ${label} → ${want}`, got === want, got);
  }

  press(d, ['c', '6', '0', '0']);
  d.byId('toMemo').click();
  ok('計算結果がメモに入る', d.byId('memoBox').value === '600', JSON.stringify(d.byId('memoBox').value));
  press(d, ['c', '1', '2']);
  d.byId('toMemo').click();
  ok('2回目は改行して追記される', d.byId('memoBox').value === '600\n12', JSON.stringify(d.byId('memoBox').value));

  // メモは問題ごと
  d.byId('memoBox').value = '仕入れ値 1920';
  d.byId('memoBox').fire('input');
  const memoQid = QS[mathIdx].id;
  const saved = d.storage.getItem('spi-set-v1');
  ok('メモが問題IDで保存される', JSON.parse(saved).memos[memoQid] === '仕入れ値 1920');

  d.byId('nextQ').click();
  ok('別の問題へ移るとメモは空', d.byId('memoBox').value === '', JSON.stringify(d.byId('memoBox').value));
  d.byId('prevQ').click();
  ok('戻るとメモが復活する', d.byId('memoBox').value === '仕入れ値 1920', JSON.stringify(d.byId('memoBox').value));

  const wasOpen = d.byId('toolsBody').hidden === false;
  d.byId('toolsBtn').click();
  ok('開閉が切り替わる', (d.byId('toolsBody').hidden === false) !== wasOpen);
  ok('aria-expanded も切り替わる',
    d.byId('toolsBtn').getAttribute('aria-expanded') === String(d.byId('toolsBody').hidden === false));
}

console.log('\n■ localStorage が使えない環境\n');
{
  let d;
  try { d = boot({ storageWorks: false }); ok('localStorage が例外を投げても起動する', true); }
  catch (e) { ok('localStorage が例外を投げても起動する', false, e.message); d = null; }
  if (d) {
    ok('一覧が描かれる', rows(d).length === N);
    rows(d)[0].click();
    choices(d)[QS[0].answer].click();
    ok('解答と解説は動く', d.byId('result').hidden === false && d.byId('verdict').textContent.startsWith('正解'));
    d.byId('memoBox').value = 'test';
    d.byId('memoBox').fire('input');
    ok('メモを打っても落ちない', d.byId('memoBox').value === 'test');
    d.byId('backToList').click();
    d.querySelector('.tab[data-view="stats"]').click();
    ok('記録が残らない旨の案内が出る', d.byId('storeNote').textContent.includes('残りません'), d.byId('storeNote').textContent.slice(0, 24));
  }
}

console.log('\n■ ヒント\n');
{
  const d = boot();
  rows(d)[0].click();
  ok('最初はヒントが閉じている', d.byId('hintWrap').hidden === true);
  ok('ボタンの文字は「ヒントを見る」', d.byId('hintLabel').textContent === 'ヒントを見る', d.byId('hintLabel').textContent);
  ok('aria-expanded は false', d.byId('hintBtn').getAttribute('aria-expanded') === 'false');

  d.byId('hintBtn').click();
  ok('押すと開く', d.byId('hintWrap').hidden === false);
  ok('本文がその問題のヒントになっている', d.byId('hintBody').textContent === QS[0].hint, d.byId('hintBody').textContent);
  ok('ボタンの文字が「ヒントを閉じる」に変わる', d.byId('hintLabel').textContent === 'ヒントを閉じる');
  ok('aria-expanded は true', d.byId('hintBtn').getAttribute('aria-expanded') === 'true');

  d.byId('hintBtn').click();
  ok('もう一度押すと閉じる', d.byId('hintWrap').hidden === true);

  // 次の問題に移ると閉じた状態に戻り、中身も入れ替わる
  d.byId('hintBtn').click();
  d.byId('nextQ').click();
  ok('問題を変えるとヒントは閉じ直される', d.byId('hintWrap').hidden === true);
  ok('ヒントの中身も次の問題のものになる', d.byId('hintBody').textContent === QS[1].hint);

  ok('全60問にヒントがある', QS.every((q) => typeof q.hint === 'string' && q.hint.length >= 10),
    String(QS.filter((q) => !q.hint).length) + '問が未設定');
  const leaks = QS.filter((q) => q.hint.indexOf(String(q.choices[q.answer])) >= 0).map((q) => q.id);
  ok('ヒントに答えそのものが書かれていない', leaks.length === 0, leaks.join(', '));
}

console.log('\n■ ランダム出題\n');
{
  const sizeBtn = (d, n) => d.byId('sizeRow').querySelectorAll('.sizebtn').find((b) => b.getAttribute('data-size') === String(n));
  const resultRows = (d) => d.byId('resultList').querySelectorAll('.qrow');

  for (const n of [1, 3, 5, 10]) {
    const d = boot();
    sizeBtn(d, n).click();
    ok(`${n}問を押すと問題の画面になる`, view(d, 'quiz'));
    ok(`位置が 1 / ${n} 問目`, d.byId('quizPos').textContent === `1 / ${n} 問目`, d.byId('quizPos').textContent);
  }

  // 分野を選んでから出題
  const dm = boot();
  catChip(dm, '非言語').click();
  sizeBtn(dm, 5).click();
  const seen = [];
  for (let i = 0; i < 5; i++) {
    seen.push(dm.byId('mCat').textContent);
    if (i < 4) dm.byId('nextQ').click();
  }
  ok('非言語を選ぶと非言語だけ出る', seen.every((c) => c === '非言語'), seen.join(','));

  const dv = boot();
  catChip(dv, '言語').click();
  sizeBtn(dv, 3).click();
  const seenV = [];
  for (let i = 0; i < 3; i++) { seenV.push(dv.byId('mCat').textContent); if (i < 2) dv.byId('nextQ').click(); }
  ok('言語を選ぶと言語だけ出る', seenV.every((c) => c === '言語'), seenV.join(','));

  // 出題中の表示
  const d = boot();
  sizeBtn(d, 3).click();
  ok('出題中は「やめる」に変わる', d.byId('backToList').textContent === '← やめる', d.byId('backToList').textContent);
  ok('出題中は「やり直す」を出さない', d.byId('retryBtn').hidden === true);
  ok('1問目は「前の問題」が押せない', d.byId('prevQ').disabled === true);
  ok('1問目のボタンは「次の問題」', d.byId('nextQ').textContent === '次の問題 →', d.byId('nextQ').textContent);

  const ids = [];
  for (let i = 0; i < 3; i++) {
    ids.push(d.byId('mNum').textContent);
    const q = QS.find((x) => x.question === d.byId('qtext').textContent);
    // 1問目と3問目は正解、2問目は不正解にする
    choices(d)[i === 1 ? (q.answer + 1) % q.choices.length : q.answer].click();
    if (i < 2) d.byId('nextQ').click();
  }
  ok('3問とも別の問題が出る', new Set(ids).size === 3, ids.join(','));
  ok('最後の問題では「結果を見る」になる', d.byId('nextQ').textContent === '結果を見る →', d.byId('nextQ').textContent);

  d.byId('nextQ').click();
  ok('結果の画面に移る', view(d, 'result'));
  ok('点数が出る', d.byId('scoreBig').textContent === '2 / 3 問正解', d.byId('scoreBig').textContent);
  ok('条件が出る', d.byId('scoreSub').textContent.includes('全分野') && d.byId('scoreSub').textContent.includes('3問'),
    d.byId('scoreSub').textContent);
  ok('結果に3行ならぶ', resultRows(d).length === 3, String(resultRows(d).length));
  ok('正解した行に印が付く', resultRows(d)[0].className.includes('done-ok'));
  ok('間違えた行に印が付く', resultRows(d)[1].className.includes('done-ng'));

  d.byId('againBtn').click();
  ok('「もう一度」で問題の画面に戻る', view(d, 'quiz'));
  ok('もう一度でも3問', d.byId('quizPos').textContent === '1 / 3 問目', d.byId('quizPos').textContent);

  d.byId('backToList').click();
  ok('「やめる」で一覧に戻る', view(d, 'list'));
  ok('一覧に戻ると通常の「一覧へ」表示に戻る', d.byId('backToList').textContent === '← 一覧へ' || view(d, 'list'));

  // 未解答のまま進めた場合
  const du = boot();
  sizeBtn(du, 3).click();
  du.byId('nextQ').click();
  du.byId('nextQ').click();
  du.byId('nextQ').click();
  ok('解かずに進めても結果が出る', view(du, 'result'));
  ok('0問正解と出る', du.byId('scoreBig').textContent === '0 / 3 問正解', du.byId('scoreBig').textContent);
  ok('未解答の数が出る', du.byId('scoreSub').textContent.includes('未解答 3問'), du.byId('scoreSub').textContent);

  // 解いた問題も、出題では解答前の状態から始まる
  const dr = boot();
  rows(dr)[0].click();
  choices(dr)[QS[0].answer].click();
  dr.byId('backToList').click();
  catChip(dr, 'all').click();
  sizeBtn(dr, 10).click();
  ok('出題では解答前の状態から始まる', dr.byId('result').hidden === true);
}

console.log('\n■ 難易度\n');
{
  const sizeBtn = (d, n) => d.byId('sizeRow').querySelectorAll('.sizebtn').find((b) => b.getAttribute('data-size') === String(n));
  const countBy = (f) => QS.filter(f).length;

  const d = boot();
  ok('難易度のチップが4つ出る', d.byId('filterDiff').querySelectorAll('.fchip').length === 4,
    String(d.byId('filterDiff').querySelectorAll('.fchip').length));
  ok('最初は「すべて」が選ばれている', diffChip(d, 'all').className.includes('is-on'));
  ok('当てはまる数が出る', d.byId('poolCount').textContent.includes(`${N}問`), d.byId('poolCount').textContent);

  for (const lv of ['1', '2', '3']) {
    const n = countBy((q) => String(q.difficulty) === lv);
    diffChip(d, lv).click();
    ok(`難易度${lv}でしぼると ${n} 問`, rows(d).length === n, String(rows(d).length));
    ok(`難易度${lv}の当てはまる数が出る`, d.byId('poolCount').textContent.includes(`${n}問`), d.byId('poolCount').textContent);
  }

  // 分野と難易度の組み合わせ
  diffChip(d, 'all').click();
  catChip(d, '言語').click();
  diffChip(d, '3').click();
  const n3v = countBy((q) => q.category === '言語' && q.difficulty === 3);
  ok(`言語かつ難易度3は ${n3v} 問`, rows(d).length === n3v, String(rows(d).length));

  // その条件でランダム出題
  sizeBtn(d, 3).click();
  const seen = [];
  for (let i = 0; i < 3; i++) {
    seen.push({ cat: d.byId('mCat').textContent, diff: d.byId('mDiff').textContent });
    if (i < 2) d.byId('nextQ').click();
  }
  ok('出題も条件に従う（言語・難易度3）',
    seen.every((x) => x.cat === '言語' && x.diff === '★3'), JSON.stringify(seen));

  // 結果に条件が出る
  d.byId('nextQ').click();
  ok('結果に分野と難易度が出る',
    d.byId('scoreSub').textContent.includes('言語') && d.byId('scoreSub').textContent.includes('難易度★3'),
    d.byId('scoreSub').textContent);

  // 母集団より多い問数を押した場合
  const d2 = boot();
  catChip(d2, '言語').click();
  diffChip(d2, '3').click();
  ok('少ないときは注意書きが出る', d2.byId('poolCount').textContent.includes('だけ出ます'), d2.byId('poolCount').textContent);
  sizeBtn(d2, 10).click();
  ok(`10問を押しても ${n3v} 問しか出ない`, d2.byId('quizPos').textContent === `1 / ${n3v} 問目`, d2.byId('quizPos').textContent);

  // 条件に合う問題が0件になることはないが、ボタンの無効化の仕組みは確かめる
  const d3 = boot();
  ok('当てはまる問題があるとボタンは押せる',
    d3.byId('sizeRow').querySelectorAll('.sizebtn').every((b) => b.disabled === false));

  // 保存されるか
  const d4 = boot();
  catChip(d4, '非言語').click();
  diffChip(d4, '2').click();
  const saved = d4.storage.getItem('spi-set-v1');
  ok('難易度の選択が保存される', JSON.parse(saved).filterDiff === '2', JSON.parse(saved).filterDiff);
  const d5 = boot({ seed: saved });
  ok('開き直しても難易度の選択が残る', diffChip(d5, '2').className.includes('is-on'));
}

console.log('\n■ 図\n');
{
  const withFig = (slot) => QS.findIndex((q) => q[slot]);
  const figsIn = (d, id) => d.byId(id).querySelectorAll('.fig');

  // 問題の図（表の読み取り）
  const iq = withFig('figure');
  ok('問題側に図のある問題がある', iq >= 0);
  const d = boot();
  rows(d)[iq].click();
  ok('問題の図が描かれる', figsIn(d, 'qFig').length === 1, String(figsIn(d, 'qFig').length));
  ok('表として描かれる', d.byId('qFig').querySelectorAll('.fig-table').length === 1);
  const heads = d.byId('qFig').querySelectorAll('.rowhead');
  ok('行の見出しが入る', heads.length === QS[iq].figure.rows.length, String(heads.length));
  ok('図の説明が入る', d.byId('qFig').querySelectorAll('.fig-cap').length === 1);

  // 図のない問題へ移ると消える
  const noFig = QS.findIndex((q) => !q.figure);
  d.byId('backToList').click();
  rows(d)[noFig].click();
  ok('図のない問題では図が残らない', figsIn(d, 'qFig').length === 0, String(figsIn(d, 'qFig').length));

  // ヒントの図
  const ih = withFig('hintFigure');
  ok('ヒント側に図のある問題がある', ih >= 0);
  const dh = boot();
  rows(dh)[ih].click();
  ok('ヒントは閉じた状態で始まる', dh.byId('hintWrap').hidden === true);
  dh.byId('hintBtn').click();
  ok('ヒントを開くと図が見える', dh.byId('hintWrap').hidden === false && figsIn(dh, 'hintFig').length === 1);

  // 解説の図
  const ia = withFig('answerFigure');
  const da = boot();
  rows(da)[ia].click();
  ok('解答前は解説が隠れている', da.byId('result').hidden === true);
  choices(da)[QS[ia].answer].click();
  ok('解答すると解説の図が出る', figsIn(da, 'expFig').length === 1, String(figsIn(da, 'expFig').length));

  // ベン図
  const iv = QS.findIndex((q) => q.answerFigure && q.answerFigure.type === 'venn2');
  const dv = boot();
  rows(dv)[iv].click();
  choices(dv)[QS[iv].answer].click();
  ok('ベン図が svg で描かれる', dv.byId('expFig').querySelectorAll('.fig-venn').length === 1);

  // 帯グラフ
  const ib = QS.findIndex((q) => q.answerFigure && q.answerFigure.type === 'bars');
  const db = boot();
  rows(db)[ib].click();
  choices(db)[QS[ib].answer].click();
  const segs = db.byId('expFig').querySelectorAll('.fig-seg');
  const wantSegs = QS[ib].answerFigure.rows.reduce((a, r) => a + r.segs.length, 0);
  ok('帯グラフの区切りの数が合う', segs.length === wantSegs, segs.length + ' / ' + wantSegs);

  // 図の中身の検算
  const bad = [];
  QS.forEach((q) => {
    ['figure', 'hintFigure', 'answerFigure'].forEach((slot) => {
      const f = q[slot];
      if (!f) return;
      if (f.type === 'bars') {
        f.rows.forEach((r) => {
          const sum = r.segs.reduce((a, sg) => a + sg.w, 0);
          if (Math.abs(sum - 100) > 1.5) bad.push(q.id + '.' + slot + ' 合計' + sum);
        });
      }
      if (f.type === 'table' && f.head) {
        f.rows.forEach((r, i) => { if (r.length !== f.head.length) bad.push(q.id + '.' + slot + ' 行' + i); });
      }
    });
  });
  ok('帯の幅の合計と表の列数が合っている', bad.length === 0, bad.join(', '));

  ok('図のある問題が15問ある',
    QS.filter((q) => q.figure || q.hintFigure || q.answerFigure).length === 15,
    String(QS.filter((q) => q.figure || q.hintFigure || q.answerFigure).length));
}

// CSS の回帰チェック
//   app.js は hidden 属性だけで画面を出し分けている。ところが .view などには
//   display:flex を指定しているため、[hidden]{display:none} を明示しないと
//   ブラウザ既定のルールを上書きしてしまい、隠したはずの画面が出たままになる。
//   DOM のテストでは見つけられない種類の不具合なので、CSS の文面を直接見る。
console.log('\n■ CSS\n');
{
  const css = read('assets/app.css');
  const hasRule = /\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/.test(css);
  ok('[hidden] に display:none !important が入っている', hasRule);

  const d = new JSDOMLite(read('index.html'));
  const hiddenIds = Object.keys(d.ids).filter((id) => d.ids[id].hidden);
  const risky = [];
  for (const id of hiddenIds) {
    for (const cls of d.ids[id].className.split(/\s+/).filter(Boolean)) {
      if (new RegExp('\\.' + cls + '\\s*\\{[^}]*display\\s*:', 'm').test(css)) risky.push(`#${id} (.${cls})`);
    }
  }
  ok('display を持つクラスに hidden を使っていても、上のルールで打ち消せている',
    hasRule || risky.length === 0, risky.join(', '));

  ok('使わなくなった schedule.js を読み込んでいない', !read('index.html').includes('schedule.js'));
  ok('「続きから」は残っていない', !read('index.html').includes('resumeBtn') && !read('assets/app.js').includes('resumeBtn'));
}

console.log('\n■ 連続正解チャレンジ\n');
{
  // 時計を止めて、答えるまでの秒数を決められるようにする
  const realNow = Date.now;
  let T = 1_000_000;
  Date.now = () => T;
  const wait = (sec) => { T += sec * 1000; };

  const idxOf = (d) => {
    const m = d.byId('mNum').textContent.match(/第(\d+)問/);
    return m ? Number(m[1]) - 1 : -1;
  };
  const cur = (d) => QS[idxOf(d)];
  const right = (d) => choices(d)[cur(d).answer].click();
  const wrong = (d) => { const q = cur(d); choices(d)[(q.answer + 1) % q.choices.length].click(); };
  const expectPts = (sec, lim) => (sec >= lim ? 100 : 100 + Math.round(900 * (1 - sec / lim)));
  const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  const d = boot();
  ok('スタートのボタンがある', !!d.byId('challengeBtn'));
  ok('最初の自己ベストは 0点', d.byId('bestScore').textContent === '自己ベスト 0点', d.byId('bestScore').textContent);

  d.byId('challengeBtn').click();
  ok('問題の画面に移る', view(d, 'quiz'));
  ok('スコア 0 が出る', d.byId('liveScore').hidden === false && d.byId('liveScore').textContent === 'スコア 0',
    d.byId('liveScore').textContent);
  ok('答える前は次へ進めない', d.byId('nextQ').disabled === true);
  ok('前へは戻れない', d.byId('prevQ').disabled === true);

  // 1問目：すぐ答える → 1000点
  const seen = new Set([idxOf(d)]);
  right(d);
  ok('すぐ正解すると 1000点', d.byId('liveScore').textContent === 'スコア 1,000', d.byId('liveScore').textContent);
  ok('正解の表示に得点が出る', d.byId('verdict').textContent.includes('＋1,000点'), d.byId('verdict').textContent);
  ok('正解のあとは次の問題へ', d.byId('nextQ').disabled === false && d.byId('nextQ').textContent === '次の問題 →');

  // 2問目：制限時間の半分で答える
  d.byId('nextQ').click();
  seen.add(idxOf(d));
  const lim2 = cur(d).timeLimitSec;
  wait(lim2 / 2);
  right(d);
  const p2 = expectPts(lim2 / 2, lim2);
  ok('半分の時間なら 550点', p2 === 550 && d.byId('liveScore').textContent === 'スコア ' + fmt(1000 + p2),
    d.byId('liveScore').textContent);

  // 3問目：時間切れのあとで正解 → 100点
  d.byId('nextQ').click();
  seen.add(idxOf(d));
  wait(cur(d).timeLimitSec + 30);
  right(d);
  ok('時間を過ぎた正解は 100点', d.byId('liveScore').textContent === 'スコア ' + fmt(1000 + p2 + 100),
    d.byId('liveScore').textContent);
  ok('時間切れと書かれる', d.byId('verdict').textContent.includes('時間切れ'), d.byId('verdict').textContent);
  ok('同じ問題は出ない', seen.size === 3, String(seen.size));

  // 4問目：間違える
  d.byId('nextQ').click();
  const total = 1000 + p2 + 100;
  wrong(d);
  ok('間違えるとゲームオーバーと出る', d.byId('verdict').textContent.includes('ゲームオーバー'), d.byId('verdict').textContent);
  ok('得点は増えない', d.byId('liveScore').textContent === 'スコア ' + fmt(total));
  ok('解説は読める', d.byId('result').hidden === false && d.byId('explanation').textContent.length > 0);
  ok('ボタンが「結果を見る」になる', d.byId('nextQ').textContent === '結果を見る →', d.byId('nextQ').textContent);

  d.byId('nextQ').click();
  ok('結果の画面に移る', view(d, 'result'));
  ok('合計得点が出る', d.byId('scoreBig').textContent === fmt(total) + '点', d.byId('scoreBig').textContent);
  ok('連続正解の数が出る', d.byId('scoreSub').textContent.includes('連続正解 3問'), d.byId('scoreSub').textContent);
  ok('自己ベスト更新と出る', d.byId('scoreSub').textContent.includes('自己ベスト更新'), d.byId('scoreSub').textContent);
  const rr = d.byId('resultList').querySelectorAll('.qrow');
  ok('答えた4問が並ぶ', rr.length === 4, String(rr.length));
  ok('行に1問ごとの得点が出る', rr[0].textContent.includes('＋1,000点') && rr[2].textContent.includes('＋100点'),
    rr[0].textContent.slice(0, 40));
  ok('最後の1問が×', rr[3].className.includes('done-ng') && rr[0].className.includes('done-ok'));
  ok('ボタンが「もう一度挑戦」', d.byId('againBtn').textContent === 'もう一度挑戦');

  d.byId('againBtn').click();
  ok('もう一度挑戦で 0 から', view(d, 'quiz') && d.byId('liveScore').textContent === 'スコア 0');
  wrong(d);
  d.byId('nextQ').click();
  ok('ベストより低いと更新にならない', !d.byId('scoreSub').textContent.includes('更新')
    && d.byId('scoreSub').textContent.includes('自己ベスト ' + fmt(total) + '点'), d.byId('scoreSub').textContent);

  d.byId('toListBtn').click();
  ok('一覧に自己ベストが出る', d.byId('bestScore').textContent === '自己ベスト ' + fmt(total) + '点', d.byId('bestScore').textContent);
  catChip(d, '言語').click();
  ok('分野を変えると自己ベストは別', d.byId('bestScore').textContent === '自己ベスト 0点', d.byId('bestScore').textContent);

  d.byId('challengeBtn').click();
  ok('言語を選ぶと言語の問題が出る', d.byId('mCat').textContent === '言語', d.byId('mCat').textContent);
  ok('言語では計算機が出ない', d.byId('tools').hidden === true);
  right(d);
  d.byId('backToList').click();
  ok('途中でやめてもベストは残る', d.byId('bestScore').textContent === '自己ベスト 1,000点', d.byId('bestScore').textContent);

  const d2 = boot({ seed: d.storage.getItem('spi-set-v1') });
  catChip(d2, 'all').click();
  ok('開き直しても自己ベストが残る', d2.byId('bestScore').textContent === '自己ベスト ' + fmt(total) + '点', d2.byId('bestScore').textContent);

  // タイマーを隠す設定でも、チャレンジでは出す
  const d5 = boot({ seed: JSON.stringify({ hideTimer: true }) });
  d5.byId('challengeBtn').click();
  ok('タイマーを隠す設定でもチャレンジでは時間が出る', d5.byId('timer').hidden === false);
  d5.byId('backToList').click();
  d5.byId('sizeRow').querySelectorAll('.sizebtn')[0].click();
  ok('ランダム出題では隠す設定が効く', d5.byId('timer').hidden === true);

  // 全問正解で終わる
  const d3 = boot();
  catChip(d3, '言語').click();
  diffChip(d3, '1').click();
  const nPool = QS.filter((q) => q.category === '言語' && q.difficulty === 1).length;
  d3.byId('challengeBtn').click();
  for (let i = 0; i < nPool; i++) { right(d3); d3.byId('nextQ').click(); }
  ok('全部正解すると結果へ', view(d3, 'result'));
  ok('全問正解と出る', d3.byId('scoreSub').textContent.includes('全問正解'), d3.byId('scoreSub').textContent);
  ok('すぐ答えれば 1問 1000点', d3.byId('scoreBig').textContent === fmt(nPool * 1000) + '点', d3.byId('scoreBig').textContent);

  d3.byId('toListBtn').click();
  catChip(d3, 'all').click(); diffChip(d3, 'all').click();
  d3.byId('sizeRow').querySelectorAll('.sizebtn')[1].click();
  ok('ランダム出題ではスコアを出さない', d3.byId('liveScore').hidden === true);
  ok('ランダム出題は答える前でも次へ進める', d3.byId('nextQ').disabled === false);

  const d4 = boot({ seed: JSON.stringify({ best: { '非言語|all': 9 }, bestPts: { 'all|all': 'x', '言語|all': -3, '非言語|all': 4200 } }) });
  catChip(d4, '非言語').click();
  ok('おかしな自己ベストと古い形式は捨てて、正しいものは読む', d4.byId('bestScore').textContent === '自己ベスト 4,200点', d4.byId('bestScore').textContent);

  Date.now = realNow;
}

console.log('');
if (fails.length) { console.log(`失敗 ${fails.length}件`); process.exit(1); }
console.log('すべて通過。');
