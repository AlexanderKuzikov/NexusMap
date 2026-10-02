'use strict';

const MIN_SIDE = 8;
const MAX_SIDE = 96;
const MAX_ZOOM = 32;
const MARGIN = 12;
const HISTORY_LIMIT = 50;
const SWATCH = 40;

// Символ клетки и символ в файле — одно и то же поле: клетка хранит код символа.
// Таблицы «тип → символ» не существует, поэтому разойтись с файлом она не может.
const FREE = '.'.charCodeAt(0);
const ROAD = '#'.charCodeAt(0);
const TAKEN = 'X'.charCodeAt(0);
const KINDS = [FREE, ROAD, TAKEN];

const C_OUTSIDE = '#0e1014';
const C_FREE = '#d9d9d4';
const C_ROAD = '#7d8794';
const C_TAKEN = '#23262e';
const C_GRID = 'rgba(0,0,0,0.10)';
const C_EDGE = '#5a616e';

const view = document.getElementById('view');
const ctx = view.getContext('2d');
const bar = document.getElementById('bar');
const brushesBox = document.getElementById('brushes');
const nameInput = document.getElementById('name');
const fileInput = document.getElementById('file');
const saveBtn = document.getElementById('save');
const openBtn = document.getElementById('open');

let width = MAX_SIDE;
let height = MAX_SIDE;
let grid = newField(width, height);
let brush = ROAD;

let viewW = 0;
let viewH = 0;
let dpr = 1;
let scale = 1;
let minScale = 1;
let tx = 0;
let ty = 0;

let stroking = false;
let panning = false;
let spaceDown = false;
let strokeValue = FREE;
let lastX = 0;
let lastY = 0;
let panX = 0;
let panY = 0;
let panTX = 0;
let panTY = 0;
let history = [];

// Uint8Array забит нулями, а ноль — не «.», поэтому поле заполняется явно.
function newField(w, h) {
  const field = new Uint8Array(w * h);
  field.fill(FREE);
  return field;
}

function colorOf(code) {
  if (code === ROAD) return C_ROAD;
  if (code === TAKEN) return C_TAKEN;
  return C_FREE;
}

function buildBrushes() {
  const titles = ['Свободно', 'Дорога', 'Занято'];
  KINDS.forEach((code, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'brush';
    b.title = titles[i] + ' — клавиша ' + (i + 1);
    b.setAttribute('aria-label', b.title);
    b.setAttribute('aria-pressed', 'false');

    const swatch = document.createElement('canvas');
    swatch.width = Math.round(SWATCH * dpr);
    swatch.height = Math.round(SWATCH * dpr);
    swatch.style.width = SWATCH + 'px';
    swatch.style.height = SWATCH + 'px';
    const sc = swatch.getContext('2d');
    sc.setTransform(dpr, 0, 0, dpr, 0, 0);
    sc.fillStyle = colorOf(code);
    sc.fillRect(0, 0, SWATCH, SWATCH);
    b.appendChild(swatch);

    b.addEventListener('click', () => setBrush(code));
    brushesBox.appendChild(b);
  });
}

function setBrush(code) {
  brush = code;
  Array.from(brushesBox.children).forEach((b, i) => {
    b.setAttribute('aria-pressed', KINDS[i] === code ? 'true' : 'false');
  });
}

function fitScale() {
  const availW = viewW - 2 * MARGIN;
  const availH = viewH - bar.offsetHeight - 2 * MARGIN;
  return Math.max(1, Math.min(MAX_ZOOM, availW / width, availH / height));
}

function fit() {
  const availW = viewW;
  const availH = viewH - bar.offsetHeight;
  scale = fitScale();
  minScale = scale;
  tx = (availW - width * scale) / 2;
  ty = bar.offsetHeight + (availH - height * scale) / 2;
}

function resize() {
  dpr = window.devicePixelRatio || 1;
  viewW = window.innerWidth;
  viewH = window.innerHeight;
  view.width = Math.round(viewW * dpr);
  view.height = Math.round(viewH * dpr);
  minScale = fitScale();
  if (scale < minScale) fit();
}

function zoomAt(px, py, target) {
  const next = Math.min(MAX_ZOOM, Math.max(minScale, target));
  if (next === scale) return;
  const wx = (px - tx) / scale;
  const wy = (py - ty) / scale;
  scale = next;
  tx = px - wx * scale;
  ty = py - wy * scale;
  draw();
}

function cellAt(px, py) {
  const x = Math.floor((px - tx) / scale);
  const y = Math.floor((py - ty) / scale);
  if (x < 0 || y < 0 || x >= width || y >= height) return null;
  return { x: x, y: y };
}

function paint(x, y) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  grid[y * width + x] = strokeValue;
}

// Шагов столько же, сколько клеток на длинном плече отрезка, поэтому на быстром движении
// мыши между двумя точками не остаётся клетки, в которую курсор не попал.
function strokeLine(x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  if (steps === 0) {
    paint(x1, y1);
    return;
  }
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    paint(Math.round(x0 + dx * t), Math.round(y0 + dy * t));
  }
}

function draw() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = C_OUTSIDE;
  ctx.fillRect(0, 0, viewW, viewH);

  // Границы клеток округляются до целых пикселей: у соседних клеток граница общая, поэтому
  // между ними не остаётся антиалиасингового шва, который на мелком зуме выглядит сеткой.
  for (let y = 0; y < height; y++) {
    const row = y * width;
    const py = Math.round(ty + y * scale);
    const ph = Math.round(ty + (y + 1) * scale) - py;
    for (let x = 0; x < width; x++) {
      ctx.fillStyle = colorOf(grid[row + x]);
      const px = Math.round(tx + x * scale);
      ctx.fillRect(px, py, Math.round(tx + (x + 1) * scale) - px, ph);
    }
  }

  if (scale >= 10) {
    ctx.strokeStyle = C_GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < width; x++) {
      const px = Math.round(tx + x * scale);
      ctx.moveTo(px, Math.round(ty));
      ctx.lineTo(px, Math.round(ty + height * scale));
    }
    for (let y = 1; y < height; y++) {
      const py = Math.round(ty + y * scale);
      ctx.moveTo(Math.round(tx), py);
      ctx.lineTo(Math.round(tx + width * scale), py);
    }
    ctx.stroke();
  }

  ctx.strokeStyle = C_EDGE;
  ctx.lineWidth = 2;
  ctx.strokeRect(Math.round(tx), Math.round(ty),
    Math.round(tx + width * scale) - Math.round(tx),
    Math.round(ty + height * scale) - Math.round(ty));
}

function pushHistory() {
  history.push(grid.slice());
  if (history.length > HISTORY_LIMIT) history.shift();
}

function undo() {
  if (history.length === 0) return;
  grid = history.pop();
  draw();
}

function mapText() {
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let s = '';
    for (let x = 0; x < width; x++) s += String.fromCharCode(grid[row + x]);
    rows.push(s);
  }
  return JSON.stringify({ version: 1, name: mapName(), width: width, height: height, grid: rows }, null, 2) + '\n';
}

function mapName() {
  const v = nameInput.value.trim();
  return v === '' ? 'map' : v;
}

// Имя файла уходит в заголовок загрузки: путь, кавычки и управляющие символы там лишние.
function fileNameFor(name) {
  const safe = name.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^[-._]+/, '').slice(0, 64);
  return (safe === '' ? 'map' : safe) + '.json';
}

function save() {
  const blob = new Blob([mapText()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileNameFor(mapName());
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function parseMap(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error('это не JSON (' + e.message + ')');
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('в файле нет объекта карты');
  }
  if (data.version !== 1) {
    throw new Error('version ' + JSON.stringify(data.version) + ' — редактор читает только version 1');
  }
  for (const side of ['width', 'height']) {
    const v = data[side];
    if (!Number.isInteger(v) || v < MIN_SIDE || v > MAX_SIDE) {
      throw new Error(side + ': ' + JSON.stringify(v) + ' — нужно целое от ' + MIN_SIDE + ' до ' + MAX_SIDE);
    }
  }
  const w = data.width;
  const h = data.height;
  if (!Array.isArray(data.grid) || data.grid.length !== h) {
    const got = Array.isArray(data.grid) ? data.grid.length : 'не массив';
    throw new Error('grid: строк должно быть ' + h + ', получено ' + got);
  }
  const field = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = data.grid[y];
    if (typeof row !== 'string' || row.length !== w) {
      throw new Error('строка ' + (y + 1) + ': нужно ' + w + ' символов');
    }
    for (let x = 0; x < w; x++) {
      const code = row.charCodeAt(x);
      if (KINDS.indexOf(code) === -1) {
        throw new Error('строка ' + (y + 1) + ', столбец ' + (x + 1) + ': неизвестный символ ' + JSON.stringify(row[x]));
      }
      field[y * w + x] = code;
    }
  }
  return { name: typeof data.name === 'string' ? data.name : '', width: w, height: h, grid: field };
}

// Поле меняется только после того, как файл разобран целиком: при отказе оно не тронуто.
async function openFile(file) {
  const map = parseMap(await file.text());
  width = map.width;
  height = map.height;
  grid = map.grid;
  history = [];
  nameInput.value = map.name;
  draw();
}

view.addEventListener('mousedown', (e) => {
  e.preventDefault();
  if (e.button === 1 || (e.button === 0 && spaceDown)) {
    panning = true;
    panX = e.clientX;
    panY = e.clientY;
    panTX = tx;
    panTY = ty;
    return;
  }
  if (e.button !== 0 && e.button !== 2) return;
  const c = cellAt(e.clientX, e.clientY);
  if (!c) return;
  pushHistory();
  stroking = true;
  strokeValue = e.button === 2 ? FREE : brush;
  lastX = c.x;
  lastY = c.y;
  paint(c.x, c.y);
  draw();
});

view.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('mousemove', (e) => {
  if (panning) {
    tx = panTX + e.clientX - panX;
    ty = panTY + e.clientY - panY;
    draw();
    return;
  }
  if (!stroking) return;
  const c = cellAt(e.clientX, e.clientY);
  if (!c || (c.x === lastX && c.y === lastY)) return;
  strokeLine(lastX, lastY, c.x, c.y);
  lastX = c.x;
  lastY = c.y;
  draw();
});

window.addEventListener('mouseup', () => {
  stroking = false;
  panning = false;
});

window.addEventListener('blur', () => {
  spaceDown = false;
  stroking = false;
  panning = false;
});

view.addEventListener('wheel', (e) => {
  e.preventDefault();
  // Firefox отдаёт дельту колеса в строках, а не в пикселях: без поправки зум в нём втрое слабее.
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewH : 1;
  zoomAt(e.clientX, e.clientY, scale * Math.exp(-e.deltaY * unit * 0.0015));
}, { passive: false });

window.addEventListener('keydown', (e) => {
  const tag = e.target && e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (e.code === 'Space') {
    spaceDown = true;
    e.preventDefault();
    return;
  }
  if (e.ctrlKey && e.key === 'z') {
    e.preventDefault();
    undo();
    return;
  }
  const i = '123'.indexOf(e.key);
  if (i !== -1) setBrush(KINDS[i]);
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') spaceDown = false;
});

window.addEventListener('resize', resize);

saveBtn.addEventListener('click', save);
openBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async () => {
  const file = fileInput.files && fileInput.files[0];
  fileInput.value = '';
  if (!file) return;
  try {
    await openFile(file);
  } catch (e) {
    window.alert('Файл не открыт: ' + e.message);
  }
});

// Значки кнопок задают высоту панели, поэтому подгонка камеры идёт после них; devicePixelRatio
// известен только после resize(), а значки рисуются в его масштабе.
resize();
buildBrushes();
fit();
setBrush(ROAD);
draw();
