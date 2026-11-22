// 😼 The Meatball cat (same pictures as the rest of the Meatball line). Its face shows Meatball's state at a glance:
// sorting → thinking · a guard warning → surprised · falling ready → party · stopped after failures → sad · off → asleep.
// Poke it: a short reaction and a speech bubble. No sound, no AI call, nothing saved.
const FACES = ['idle', 'happy', 'think', 'surprise', 'sad', 'sleep', 'party'];
export const mascotUrl = (f) => new URL(`../../img/mascot_${FACES.includes(f) ? f : 'idle'}.webp`, import.meta.url).href;
export const mascotImg = (face, title = '') => `<img class="mb3-cat" data-face="${face}" src="${mascotUrl(face)}" alt="" title="${title}" draggable="false">`;

const ko = (navigator.language || '').startsWith('ko');
const LINES = ko ? ['냥!', '냥냥!', '냐옹?', '미트볼!'] : ['meow!', 'mrrp?', 'meow meow!'];
const CRY = ko ? ['그만 눌러…', '캬옹!'] : ['stop poking…', 'hss!'];
let annoy = 0, annoyT = 0;
function bubble(img, text) {
  const r = img.getBoundingClientRect(); if (!r.width) return;
  const b = document.createElement('div'); b.className = 'mb3-cat-bubble'; b.textContent = text;
  (img.closest('dialog') ?? document.body).appendChild(b);
  b.style.left = `${Math.max(6, Math.min(window.innerWidth - b.offsetWidth - 6, r.left + r.width / 2 - b.offsetWidth / 2))}px`;
  b.style.top = `${Math.max(6, r.top - b.offsetHeight - 6)}px`;
  setTimeout(() => b.remove(), 1100);
}
export function poke(img) {
  const now = Date.now();
  annoy = Math.max(0, annoy - Math.floor((now - annoyT) / 600)) + 1; annoyT = now;
  const back = img.dataset.face || 'idle', sad = annoy >= 10;
  if (sad) annoy = 0;
  img.src = mascotUrl(sad ? 'sad' : ['happy', 'surprise', 'happy', 'party'][Math.floor(Math.random() * 4)]);
  img.classList.remove('poke'); void img.offsetWidth; img.classList.add('poke');
  clearTimeout(img._back); img._back = setTimeout(() => { img.src = mascotUrl(back); }, sad ? 2500 : 900);
  bubble(img, (sad ? CRY : LINES)[Math.floor(Math.random() * (sad ? CRY : LINES).length)]);
}
