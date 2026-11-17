#!/usr/bin/env node
// 問題バンク（scripts/bank/）から、アプリが読む2つのファイルを生成する。
//   node scripts/build-data.mjs
//
//   data/questions.json … 正本。検証用の check は取り除いて書き出す。
//   data/questions.js   … 同じ中身を window.SPI_QUESTIONS に入れただけのもの。
//
// questions.js を置いているのは、file:// で直接開いたときや Teams の
// タブ内で fetch が通らない環境でも、<script> タグなら確実に読めるため。
// 編集するのは scripts/bank/ のほうで、この2つは触らない。

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import bank from './bank/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const FIELDS = ['id', 'category', 'topic', 'difficulty', 'question', 'figure', 'hint', 'hintFigure', 'choices', 'answer', 'explanation', 'answerFigure', 'timeLimitSec', 'reference'];

const questions = bank.map((q) => {
  const out = {};
  for (const f of FIELDS) out[f] = q[f];
  return out;
});

const payload = {
  version: 1,
  generatedAt: new Date().toISOString().slice(0, 10),
  count: questions.length,
  questions,
};

const json = JSON.stringify(payload, null, 2);
writeFileSync(resolve(root, 'data/questions.json'), json + '\n');
writeFileSync(
  resolve(root, 'data/questions.js'),
  '/* 自動生成。編集しない。scripts/bank/ を直して node scripts/build-data.mjs */\n' +
    'window.SPI_QUESTIONS = ' + json + ';\n'
);

console.log(`data/questions.json と data/questions.js を書き出した（${questions.length}問）`);
