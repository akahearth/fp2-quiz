// 問題・演習・履歴とは独立した、同じブラウザタブ内の作業メモ。
export const MEMO_KEY = 'fp2-trainer:memo:v1';
export function createMemo(storage) {
  let text = '', open = false, available = !!storage;
  try {
    const saved = storage?.getItem(MEMO_KEY);
    if (saved) {
      const value = JSON.parse(saved);
      if (typeof value.text === 'string' && typeof value.open === 'boolean') {
        text = value.text; open = value.open;
      }
    }
  } catch { available = false; }
  function persist() {
    try { storage?.setItem(MEMO_KEY, JSON.stringify({text,open})); }
    catch { available = false; }
  }
  return {
    get text() { return text; }, get open() { return open; },
    get available() { return available; },
    setText(value) { text = value; persist(); },
    setOpen(value) { open = value; persist(); }
  };
}
