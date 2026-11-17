import nonverbal from './nonverbal.mjs';
import verbal from './verbal.mjs';
import nonverbal2 from './nonverbal2.mjs';
import verbal2 from './verbal2.mjs';

// 並び順がそのまま「第◯問」の番号になる。
// 既存の番号をずらさないよう、追加分は必ず末尾に足すこと。
export default [...nonverbal, ...verbal, ...nonverbal2, ...verbal2];
