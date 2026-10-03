'use strict';

const MIN_SIDE = 8;
const MAX_SIDE = 96;
const MAX_ZOOM = 32;
const MARGIN = 12;
const HISTORY_LIMIT = 50;
const SWATCH = 40;
const MIN_BRUSH_W = 1;
const MAX_BRUSH_W = 16;
// Линейки занимают свои ячейки сетки, и все размеры считаются от сцены: у канваса есть собственный
// размер 300 на 150, и если мерить линейки по нему же, сетка расползается, а поле уезжает.
const RULER_X_H = 24;
const RULER_Y_W = 40;

// Символ клетки и символ в файле — одно и то же поле: клетка хранит код символа.
// Таблицы «тип → символ» не существует, поэтому разойтись с файлом она не может.
const FREE = '.'.charCodeAt(0);
const ROAD = '#'.charCodeAt(0);
const TAKEN = 'X'.charCodeAt(0);
const KINDS = [FREE, ROAD, TAKEN];

const C_OUTSIDE = '#0e1014';
// Сетка рисуется на любом зуме, иначе на стартовом поле клетку не видно вовсе, а «рисовать по
// клеткам» без видимой клетки невозможно. Два уровня: частая и через GRID_EVERY — по ней считают.
const C_GRID = 'rgba(0,0,0,0.26)';
const C_GRID_MAJOR = 'rgba(0,0,0,0.50)';
const C_EDGE = '#5a616e';
const C_HOVER = '#e8b64c';
const C_RULER_BG = '#12151c';
const C_RULER_TICK = '#4a5566';
const C_RULER_TICK_MINOR = '#2a3140';
const C_RULER_TEXT = '#9aa4b2';
const GRID_EVERY = 8;

// Кожа рисуется в offscreen один раз на изменение поля, а на экран выводится одним drawImage.
// Масштаб фиксированный: зум, панорама и перерисовка без изменения поля картинку не трогают.
// Правило 0001 «полная перерисовка дешевле миллисекунды» здесь именно поэтому не действует:
// замерено в 0001 — 0.297 мс на ANGLE и 9.34 мс на D3D11 при 32 px на клетку, а Windows Chrome
// выбирает D3D11.
const SKIN_PX = 12;

// Стиль — объект с числами и именем. Второй сеттинг добавляется вторым набором, а не правкой
// первого; переключателя в интерфейсе нет и не планируется.
const SKINS = {
  desert: {
    name: 'Пустыня',
    px: SKIN_PX,
    // Насколько неровная граница вида клетки, в долях клетки. Больше половины нельзя: петля
    // пересекает себя там, где вид клетки шириной в одну клетку.
    edgeAmp: 0.42,
    // Снос тени вправо-вниз, в долях клетки. Свет на всю карту один: сверху-слева.
    castOffset: 0.6,
    // Гребень идёт вверх-вправо, подветренный склон — вправо-вниз. Направление одно на все
    // барханы, иначе карта рассыпается.
    ridge: [Math.SQRT1_2, -Math.SQRT1_2],
    lee: [Math.SQRT1_2, Math.SQRT1_2],
    sand: {
      base: '#dcc59b',
      toneA: '#e9dbba',
      toneB: '#d3bd96',
      toneC: '#c9b18c',
      ripple: '#c0a479',
      rippleLight: '#e8d7ae',
      crack: '#ab9370',
      pebble: '#a08767',
      cast: 'rgba(126, 96, 58, 0.32)'
    },
    road: {
      base: '#b8ab98',
      rut: '#d2c6b2',
      pebble: '#a1938a',
      curbDark: '#7f7466',
      curbLight: '#c3b7a3',
      cast: 'rgba(78, 76, 74, 0.36)'
    },
    dune: {
      base: '#e2cfa4',
      shadow: '#cdb387',
      deep: '#b89a6e',
      crest: '#f2e6c8'
    }
  }
};
const SKIN = SKINS.desert;

const view = document.getElementById('view');
const ctx = view.getContext('2d');
const bar = document.getElementById('bar');
const brushesBox = document.getElementById('brushes');
const nameInput = document.getElementById('name');
const fileInput = document.getElementById('file');
const saveBtn = document.getElementById('save');
const openBtn = document.getElementById('open');
const presetSel = document.getElementById('preset');
const fieldW = document.getElementById('fieldW');
const fieldH = document.getElementById('fieldH');
const stage = document.getElementById('stage');
const rulerX = document.getElementById('rulerX');
const rulerY = document.getElementById('rulerY');
const rxCtx = rulerX.getContext('2d');
const ryCtx = rulerY.getContext('2d');
const brushWInput = document.getElementById('brushW');
const brushUpBtn = document.getElementById('brushUp');
const brushDownBtn = document.getElementById('brushDown');
const panToolBtn = document.getElementById('panTool');
const zoomInBtn = document.getElementById('zoomIn');
const zoomOutBtn = document.getElementById('zoomOut');
const fitBtn = document.getElementById('fitBtn');
const stSize = document.getElementById('stSize');
const stCell = document.getElementById('stCell');
const stBrush = document.getElementById('stBrush');
const stBrushW = document.getElementById('stBrushW');
const stZoom = document.getElementById('stZoom');
const KIND_TITLE = ['Свободно', 'Дорога', 'Занято'];
const PRESETS = new Set(['96x96', '96x64', '64x96', '64x64', '48x48', '32x32']);

let width = MAX_SIDE;
let height = MAX_SIDE;
let grid = newField(width, height);
let brush = ROAD;

let viewW = 0;
let viewH = 0;
let viewLeft = 0;
let viewTop = 0;
let rxW = 0;
let rxH = 0;
let ryW = 0;
let ryH = 0;
let dpr = 1;
let scale = 1;
let minScale = 1;
let tx = 0;
let ty = 0;

let stroking = false;
let panning = false;
let spaceDown = false;
let strokeValue = FREE;
let hover = null;
let brushW = 1;
// Сдвиг отдельным инструментом, а не только средней кнопкой: у многих мышей средняя кнопка
// не нажимается нормально, а на увеличенном поле сдвинуть карту нужно постоянно.
let tool = 'paint';
let userZoomed = false;
let lastX = 0;
let lastY = 0;
let panX = 0;
let panY = 0;
let panTX = 0;
let panTY = 0;
let history = [];

// Сетка по клавише и по умолчанию включена: без неё рисовать по клеткам нельзя, но поверх
// оформленной карты она превращает всё в шахматку, поэтому выключатель обязателен. Линейки
// с номерами остаются всегда — координата нужна независимо от сетки.
let showGrid = true;

const skin = document.createElement('canvas');
const skinCtx = skin.getContext('2d');
// Песок от поля не зависит: пятна, полосы и камешки стоят на мировых координатах. Он рисуется
// один раз в свою карту, и дальше кожа только копирует её. Это и есть главный выигрыш: слой
// песка — около двухсот вызовов канваса, и на перерисовке кожи он стоил 60 мс из 64.
const sandBase = document.createElement('canvas');
const sandCtx = sandBase.getContext('2d');
let sandPainted = false;
let skinDirty = true;
let sandGrads = null;
let pebblePat = null;

// Uint8Array забит нулями, а ноль — не «.», поэтому поле заполняется явно.
function newField(w, h) {
  const field = new Uint8Array(w * h);
  field.fill(FREE);
  return field;
}

// Образец кисти берёт базу того же вида клетки, что и кожа: серый квадрат рядом с оформленной
// картой читается как чужой элемент, а не как инструмент.
function colorOf(code) {
  if (code === ROAD) return SKIN.road.base;
  if (code === TAKEN) return SKIN.dune.base;
  return SKIN.sand.base;
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
  return Math.max(1, Math.min(MAX_ZOOM, (viewW - 2 * MARGIN) / width, (viewH - 2 * MARGIN) / height));
}

function fit() {
  scale = fitScale();
  minScale = scale;
  userZoomed = false;
  tx = (viewW - width * scale) / 2;
  ty = (viewH - height * scale) / 2;
}

function resize() {
  dpr = window.devicePixelRatio || 1;
  // Размер берётся у сцены, а не у окна: сцена уже вычитает из себя панели, и поле поэтому
  // всегда помещается в видимую часть и никогда не лезет под панель.
  const box = stage.getBoundingClientRect();
  const stageW = Math.max(RULER_Y_W + 1, Math.round(stage.clientWidth));
  const stageH = Math.max(RULER_X_H + 1, Math.round(stage.clientHeight));
  rxW = stageW - RULER_Y_W;
  rxH = RULER_X_H;
  ryW = RULER_Y_W;
  ryH = stageH - RULER_X_H;
  viewW = rxW;
  viewH = ryH;
  // Буфер канваса живёт в пикселях устройства, а его размер на странице — в CSS-пикселях. Без
  // второй строки при масштабе 125% канвас 1600 px шириной ложится в сцену 1280: поле уезжает
  // вправо и за нижний край, а попадание курсора считается в других координатах, чем рисунок.
  view.width = Math.round(viewW * dpr);
  view.height = Math.round(viewH * dpr);
  view.style.width = viewW + 'px';
  view.style.height = viewH + 'px';
  rulerX.width = Math.round(rxW * dpr);
  rulerX.height = Math.round(rxH * dpr);
  rulerX.style.width = rxW + 'px';
  rulerX.style.height = rxH + 'px';
  rulerY.width = Math.round(ryW * dpr);
  rulerY.height = Math.round(ryH * dpr);
  rulerY.style.width = ryW + 'px';
  rulerY.style.height = ryH + 'px';
  // События мыши приходят в координатах окна, а tx и ty живут в координатах канваса. После того
  // как канвас переехал из угла окна в сцену между панелями, разница стала равна высоте панели —
  // это и был сдвиг клика на десяток клеток вниз.
  viewLeft = box.left + RULER_Y_W;
  viewTop = box.top + RULER_X_H;
  minScale = fitScale();
  // Поле центрируется по сцене, поэтому её размер нельзя запоминать: если сцена стала ниже, а
  // пользователь не зумил, поле обязано вписаться заново. Прежнее условие «зум меньше минимального»
  // этого не ловило — при уменьшении сцены старая центровка оставалась, и клик уезжал на клетки.
  if (!userZoomed || scale < minScale) fit();
  draw();
}

// Панели меняют свою высоту уже после первой отрисовки — строка состояния наполняется числами,
// подсказка переносится на узком окне. Если мерить сцену один раз, канвас остаётся выше её на ту
// разницу: поле съезжает на клетку, а нижняя панель обрезается. Поэтому сцена наблюдается.
let lastStageW = 0;
let lastStageH = 0;
function syncToStage() {
  const w = Math.round(stage.clientWidth);
  const h = Math.round(stage.clientHeight);
  if (w === lastStageW && h === lastStageH) return;
  lastStageW = w;
  lastStageH = h;
  resize();
}

// Клик и зум приходят в координатах окна, а рисуем мы в координатах канваса.
function toCanvasX(clientX) {
  return clientX - viewLeft;
}

function toCanvasY(clientY) {
  return clientY - viewTop;
}

function zoomAt(px, py, target) {
  const next = Math.min(MAX_ZOOM, Math.max(minScale, target));
  if (next === scale) return;
  const wx = (px - tx) / scale;
  const wy = (py - ty) / scale;
  scale = next;
  if (scale > minScale + 0.001) userZoomed = true;
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
  // Полотно красится квадратом со стороной brushW, а не одной клеткой: восемь клеток дороги
  // иначе приходится выкладывать вручную. Нечётная толщина делится поровну, чётная уходит
  // целиком вправо и вниз — иначе линия полосы уезжает на полклетки от края до края.
  const before = Math.floor((brushW - 1) / 2);
  const after = brushW - 1 - before;
  // Кожа помечается грязной здесь, а не в вызывающем коде: paint() — единственное место, где
  // клетка меняет вид, и забытая пометка дала бы карту, которая не соответствует файлу.
  skinDirty = true;
  for (let dy = -before; dy <= after; dy++) {
    const row = y + dy;
    if (row < 0 || row >= height) continue;
    for (let dx = -before; dx <= after; dx++) {
      const col = x + dx;
      if (col < 0 || col >= width) continue;
      grid[row * width + col] = strokeValue;
    }
  }
}

function setTool(next) {
  tool = next;
  panToolBtn.setAttribute('aria-pressed', next === 'pan' ? 'true' : 'false');
  view.style.cursor = next === 'pan' ? 'grab' : 'crosshair';
  updateStatus();
}

function setBrushW(w) {
  const next = Math.max(MIN_BRUSH_W, Math.min(MAX_BRUSH_W, Math.round(w) || 1));
  brushW = next;
  brushWInput.value = String(next);
  stBrushW.textContent = String(next);
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

// Хэш координат клетки — единственный источник случайности на карте. Math.random здесь не
// годится: у случайного числа нет координат, поэтому одна и та же карта выглядела бы по-разному
// при каждом кадре и шевелилась бы.
function hash2(x, y, salt) {
  let h = Math.imul(x | 0, 0x27d4eb2f) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 13), 0x297a2d39);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Петли границы региона и список рёбер. Рёбра нужны бордюру: камешек ставится на своё ребро, а
// не вдоль пути, иначе рисунок зависел бы от порядка обхода петель, который меняется от
// правки одной клетки. Рёбра обходятся так, что область всегда справа, поэтому внешний контур и
// дырки выходят противоположной ориентации и заливка ненулевой вычитает дырки сама. Дырка у
// дороги — это песок внутри кольца, и без этого он был бы залит дорогой.
function regionLoops(pred, box) {
  const x0 = box.x0;
  const y0 = box.y0;
  const vw = box.x1 - x0 + 2;
  const head = new Int32Array(vw * (box.y1 - y0 + 2)).fill(-1);
  const to = [];
  const next = [];
  const edges = [];
  const edge = (ax, ay, bx, by) => {
    const v = (ay - y0) * vw + (ax - x0);
    edges.push(ax, ay, bx, by);
    to.push((by - y0) * vw + (bx - x0));
    next.push(head[v]);
    head[v] = to.length - 1;
  };
  for (let y = y0; y <= box.y1; y++) {
    for (let x = x0; x <= box.x1; x++) {
      if (!pred(x, y)) continue;
      if (y === y0 || !pred(x, y - 1)) edge(x, y, x + 1, y);
      if (x === box.x1 || !pred(x + 1, y)) edge(x + 1, y, x + 1, y + 1);
      if (y === box.y1 || !pred(x, y + 1)) edge(x + 1, y + 1, x, y + 1);
      if (x === x0 || !pred(x - 1, y)) edge(x, y + 1, x, y);
    }
  }
  const used = new Uint8Array(to.length);
  const open = (v) => {
    let e = head[v];
    while (e !== -1 && used[e]) e = next[e];
    return e;
  };
  const loops = [];
  for (let v = 0; v < head.length; v++) {
    if (open(v) === -1) continue;
    const loop = [];
    let cur = v;
    for (;;) {
      loop.push((cur % vw) + x0, ((cur / vw) | 0) + y0);
      const e = open(cur);
      if (e === -1) break;
      used[e] = 1;
      cur = to[e];
    }
    loops.push(loop);
  }
  return { loops: loops, edges: edges };
}

// Прямая линия по клеткам — это и есть причина, по которой карта читается как таблица. Каждое
// единичное ребро границы заменяется ломаной: три точки на ребро, каждая сдвинута наружу по
// нормали на долю клетки из хэша. Сдвиг только по нормали и меньше половины клетки — иначе петля
// пересекает себя там, где вид клетки шириной в одну клетку.
function jitterPath(loops, amp) {
  const S = SKIN.px;
  const p = new Path2D();
  for (const loop of loops) {
    const n = loop.length / 2;
    for (let i = 0; i < n; i++) {
      const ax = loop[i * 2];
      const ay = loop[i * 2 + 1];
      const j = i + 1 === n ? 0 : i + 1;
      const bx = loop[j * 2];
      const by = loop[j * 2 + 1];
      const nx = by - ay;
      const ny = ax - bx;
      if (i === 0) p.moveTo(ax * S, ay * S);
      for (let t = 1; t <= 3; t++) {
        const f = t / 4;
        const h = hash2(t, ax * 4 + ay, 7) * 2 - 1;
        const k = h * amp * (0.35 + 0.65 * hash2(ax, ay, 8));
        p.lineTo((ax + (bx - ax) * f + nx * k) * S, (ay + (by - ay) * f + ny * k) * S);
      }
      p.lineTo(bx * S, by * S);
    }
    p.closePath();
  }
  return p;
}

// Волна гребня считается от индекса вдоль линии, а не от координат точки. От координат линии
// получались разными при параллельном сдвиге, и граница света и граница глубины тени
// пересекались ромбом. Волна длиной в две клетки: короче — шум, длиннее — складка.
function waveAt(i, salt) {
  const S = SKIN.px;
  return (hash2(Math.round(i / 2), salt, 23) - 0.5) * 0.44 * S;
}

// Подветренная половина бархана. Это четырёхугольник: две стороны параллельны гребню, две
// уходят по нормали далеко за поле. Первый вариант вёл от края по нормали и обратно — путь
// пересекал сам себя и заливал два клинья вместо полуплоскости. Лишнее срезает clip по контуру.
function leePlane(px, py, R, salt) {
  const d = SKIN.ridge;
  const n = SKIN.lee;
  const step = SKIN.px;
  const k = Math.ceil(R / step);
  const p = new Path2D();
  p.moveTo(px - d[0] * R, py - d[1] * R);
  p.lineTo(px + n[0] * R - d[0] * R, py + n[1] * R - d[1] * R);
  p.lineTo(px + n[0] * R + d[0] * R, py + n[1] * R + d[1] * R);
  p.lineTo(px + d[0] * R, py + d[1] * R);
  for (let i = k; i >= -k; i--) {
    const w = waveAt(i, salt);
    p.lineTo(px + d[0] * i * step + d[1] * w, py + d[1] * i * step - d[0] * w);
  }
  p.closePath();
  return p;
}

function ridgeLine(c, px, py, R, salt) {
  const d = SKIN.ridge;
  const step = SKIN.px;
  const k = Math.ceil(R / step);
  c.beginPath();
  for (let i = -k; i <= k; i++) {
    const w = waveAt(i, salt);
    const x = px + d[0] * i * step + d[1] * w;
    const y = py + d[1] * i * step - d[0] * w;
    if (i === -k) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.stroke();
}

// Связные области одного вида клетки: у каждой свой контур и своя диагональ света и тени.
function componentsOf(kind) {
  const labels = new Int32Array(width * height).fill(-1);
  const groups = [];
  const stack = [];
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] !== kind || labels[i] !== -1) continue;
    const id = groups.length;
    const g = { cells: [], x0: width, y0: height, x1: -1, y1: -1 };
    groups.push(g);
    labels[i] = id;
    stack.length = 0;
    stack.push(i);
    while (stack.length) {
      const c = stack.pop();
      g.cells.push(c);
      const cx = c % width;
      const cy = (c / width) | 0;
      if (cx < g.x0) g.x0 = cx;
      if (cx > g.x1) g.x1 = cx;
      if (cy < g.y0) g.y0 = cy;
      if (cy > g.y1) g.y1 = cy;
      if (cx > 0 && grid[c - 1] === kind && labels[c - 1] === -1) { labels[c - 1] = id; stack.push(c - 1); }
      if (cx < width - 1 && grid[c + 1] === kind && labels[c + 1] === -1) { labels[c + 1] = id; stack.push(c + 1); }
      if (cy > 0 && grid[c - width] === kind && labels[c - width] === -1) { labels[c - width] = id; stack.push(c - width); }
      if (cy < height - 1 && grid[c + width] === kind && labels[c + width] === -1) { labels[c + width] = id; stack.push(c + width); }
    }
  }
  return groups;
}

function maskOf(cells) {
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < cells.length; i++) mask[cells[i]] = 1;
  return mask;
}

function pathOfMask(mask, box) {
  return jitterPath(regionLoops((x, y) => mask[y * width + x] === 1, box).loops, SKIN.edgeAmp);
}

// Бордюр из крупных камней по краям полотна. Камень ставится на каждое единичное ребро границы и
// собирается в один путь: два вызова заливки на всю кромку вместо тысячи отдельных. Размер,
// наклон и сдвиг вдоль ребра берутся из хэша — одинаковые квадраты читаются как пунктир, а не
// как камни. Светлая половина сдвинута вверх-влево, по солнцу.
function curbPath(edges, inset, scale) {
  const S = SKIN.px;
  const p = new Path2D();
  for (let i = 0; i < edges.length; i += 4) {
    const ax = edges[i];
    const ay = edges[i + 1];
    const bx = edges[i + 2];
    const by = edges[i + 3];
    const h0 = hash2(ax, ay, 61);
    const h1 = hash2(ax, ay, 62);
    const h2 = hash2(ax, ay, 63);
    const r = (0.2 + h0 * 0.3) * S * scale;
    const along = (h1 - 0.5) * 0.36;
    const ang = (h2 - 0.5) * 1.3;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const dx = (bx - ax) * ca - (by - ay) * sa;
    const dy = (bx - ax) * sa + (by - ay) * ca;
    const mx = ((ax + bx) / 2 + (bx - ax) * along - (by - ay) * inset) * S;
    const my = ((ay + by) / 2 + (by - ay) * along + (ax - bx) * inset) * S;
    const tx = dx * r;
    const ty = dy * r;
    const nx = -dy * r * 0.82;
    const ny = dx * r * 0.82;
    p.moveTo(mx + tx + nx, my + ty + ny);
    p.lineTo(mx - tx + nx, my - ty + ny);
    p.lineTo(mx - tx - nx, my - ty - ny);
    p.lineTo(mx + tx - nx, my + ty - ny);
    p.closePath();
  }
  return p;
}

function sandGradsFor(c) {
  if (sandGrads === null) {
    const tones = [SKIN.sand.toneA, SKIN.sand.toneB, SKIN.sand.toneC];
    sandGrads = tones.map((tone) => {
      const g = c.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, tone);
      g.addColorStop(1, 'rgba(0, 0, 0, 0)');
      return g;
    });
  }
  return sandGrads;
}

function paintSand(c, W, H) {
  const S = SKIN.px;
  const D = SKIN.sand;
  c.fillStyle = D.base;
  c.fillRect(0, 0, W, H);

  // Пятна трёх тонов: ровная заливка читается как фон, а не как песок. Градиент строится один
  // раз на тон и растягивается преобразованием — новый на каждое пятно дороже в разы. Пятно
  // должно быть пятном, а не тёмным облаком: их больше, они мельче и вдвое светлее базы, иначе
  // песок выглядит испачканным.
  const grads = sandGradsFor(c);
  for (let i = 0; i < 34; i++) {
    const cx = hash2(i, 1, 11) * (W + 24 * S) - 12 * S;
    const cy = hash2(i, 2, 12) * (H + 24 * S) - 12 * S;
    const rx = (2.6 + hash2(i, 3, 13) * 4.2) * S;
    c.save();
    c.translate(cx, cy);
    c.rotate((hash2(i, 5, 15) - 0.5) * 0.7);
    c.scale(rx, rx * (0.16 + hash2(i, 4, 14) * 0.26));
    c.globalAlpha = i % 4 === 3 ? 0.13 : 0.17;
    c.fillStyle = grads[i % 3];
    c.fillRect(-1, -1, 2, 2);
    c.restore();
  }
  c.globalAlpha = 1;

  // Ветровые полосы: одно направление на всю карту, низкий контраст, тот же наклон, что у
  // гребня. На мелком зуме именно они, а не пятна, дают направление и масштаб. Полосы идут через
  // всё поле, поэтому их число — это и есть цена слоя: чаще клетки не надо.
  c.lineWidth = Math.max(1, S * 0.09);
  for (let k = -2; k * 2.2 * S < H + W; k++) {
    const y0 = k * 2.2 * S;
    c.beginPath();
    for (let s = -1; s * 1.6 <= W / S + 1.6; s++) {
      const x = s * 1.6 * S;
      const y = y0 - x * 0.3 + (hash2(s, k, 17) - 0.5) * 0.55 * S;
      if (s === -1) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.strokeStyle = (k & 1) === 0 ? SKIN.sand.rippleLight : SKIN.sand.ripple;
    c.globalAlpha = (k & 1) === 0 ? 0.13 : 0.1;
    c.stroke();
  }
  c.globalAlpha = 1;

  // Трещины и редкие камешки — текстура, а не рисунок: их почти не видно, но без них песок
  // выглядит листом бумаги.
  c.strokeStyle = SKIN.sand.crack;
  c.globalAlpha = 0.22;
  c.lineWidth = Math.max(1, S * 0.09);
  for (let i = 0; i < 26; i++) {
    let x = hash2(i, 21, 31) * W;
    let y = hash2(i, 22, 32) * H;
    c.beginPath();
    c.moveTo(x, y);
    for (let s = 0; s < 4; s++) {
      x += (hash2(i, s, 33) - 0.5) * 2.6 * S;
      y += (hash2(i, s, 34) - 0.5) * 2.6 * S;
      c.lineTo(x, y);
    }
    c.stroke();
  }
  c.fillStyle = SKIN.sand.pebble;
  c.globalAlpha = 0.26;
  for (let i = 0; i < 150; i++) {
    const x = hash2(i, 51, 41) * W;
    const y = hash2(i, 52, 42) * H;
    const r = 0.5 + hash2(i, 53, 43) * 0.9;
    c.beginPath();
    c.ellipse(x, y, r, r * 0.72, 0, 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;
}

function paintDunes(c) {
  const S = SKIN.px;
  const D = SKIN.dune;
  const groups = componentsOf(TAKEN);
  if (groups.length === 0) return;
  const masks = groups.map((g) => maskOf(g.cells));
  // Тень бархана ложится на песок справа-вниз и рисуется до тела: тело её накрывает.
  const cast = new Path2D();
  const shift = new DOMMatrix().translate(SKIN.castOffset * S, SKIN.castOffset * S);
  for (let i = 0; i < groups.length; i++) cast.addPath(pathOfMask(masks[i], groups[i]), shift);
  c.fillStyle = SKIN.sand.cast;
  c.fill(cast);

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const path = pathOfMask(masks[i], g);
    // Линии гребня идут на ширину блока, а не на ширину поля. На ширине поля это квадрат
    // 4608 на 4608 пикселей и тринадцать штрихов длиной 4608 на каждый блок: растеризация
    // уходила в десятки миллисекунд, и карта не рисовалась.
    const reach = (Math.max(g.x1 - g.x0, g.y1 - g.y0) + 6) * S;
    c.fillStyle = D.base;
    c.fill(path);
    c.save();
    c.clip(path);
    // Наветренный пологий склон — это база, подветренный крутой заливается тенью. Граница между
    // ними одна на весь блок, и блоков много, но направление у всех одно. Сдвиг берётся от
    // меньшей стороны блока: от большей граница уезжала за его пределы и блок становился
    // весь освещённым или весь в тени.
    const short = Math.min(g.x1 - g.x0, g.y1 - g.y0);
    const t = (hash2(g.x0, g.y0, 21) - 0.5) * (short + 2) * S * 0.3;
    const px = ((g.x0 + g.x1) / 2) * S + SKIN.lee[0] * t;
    const py = ((g.y0 + g.y1) / 2) * S + SKIN.lee[1] * t;
    // Соль одна на весь блок: иначе параллельные линии блока получают разную волну.
    const salt = g.x0 * 131 + g.y0;
    c.fillStyle = D.shadow;
    c.fill(leePlane(px, py, reach, salt));
    // Склон не плоский: чем дальше от гребня, тем темнее. Вторая такая же заливка давала второй
    // жёсткий край, а он с первым пересекался ромбом; градиент поперёк склона мягче и дешевле.
    // Первый стоп прозрачный обязателен: градиент по краям держит цвет стопа, и без этого весь
    // наветренный склон заливался глубиной тени.
    const grad = c.createLinearGradient(px, py, px + SKIN.lee[0] * 4 * S, py + SKIN.lee[1] * 4 * S);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    grad.addColorStop(0.15, D.deep);
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    c.fillStyle = grad;
    c.fillRect(g.x0 * S - 2 * S, g.y0 * S - 2 * S, (g.x1 - g.x0 + 5) * S, (g.y1 - g.y0 + 5) * S);
    c.strokeStyle = D.crest;
    c.lineWidth = Math.max(1, S * 0.08);
    ridgeLine(c, px, py, reach, salt);
    // Вторичные гребни того же направления по обе стороны от главного: без них наветренный
    // склон остаётся ровной заливкой, а блок читается как картон.
    if (g.x1 - g.x0 >= 3 && g.y1 - g.y0 >= 3) {
      c.strokeStyle = D.shadow;
      c.lineWidth = Math.max(1.5, S * 0.45);
      c.globalAlpha = 0.24;
      for (let k = -3; k <= 3; k++) {
        if (k === 0) continue;
        ridgeLine(c, px + SKIN.lee[0] * k * 1.8 * S, py + SKIN.lee[1] * k * 1.8 * S, reach, salt);
      }
      c.strokeStyle = D.crest;
      c.lineWidth = Math.max(1, S * 0.07);
      c.globalAlpha = 0.3;
      for (let k = -3; k <= 3; k++) {
        if (k === 0) continue;
        ridgeLine(c, px + SKIN.lee[0] * (k * 1.8 - 0.3) * S, py + SKIN.lee[1] * (k * 1.8 - 0.3) * S, reach, salt);
      }
      c.globalAlpha = 1;
    }
    c.restore();
  }
}

// Плитка камешков рисуется примитивами один раз и повторяется заливкой. Обход границы дороги с
// камешком на каждый сантиметр кромки дороже на порядок, а выглядит так же.
function pebblePattern(c) {
  if (pebblePat === null) {
    const t = document.createElement('canvas');
    const T = 6 * SKIN.px;
    t.width = T;
    t.height = T;
    const tc = t.getContext('2d');
    // Два тона: одноцветные камешки читаются как грязь, а два тона — как гравий.
    for (let i = 0; i < 110; i++) {
      const x = hash2(i, 41, 1) * T;
      const y = hash2(i, 42, 2) * T;
      const r = 0.5 + hash2(i, 43, 3) * 1.1;
      tc.fillStyle = (i & 1) === 0 ? SKIN.road.pebble : SKIN.road.curbLight;
      // Камешек у края плитки дорисовывается с другой стороны, иначе шов видно.
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          if (ox !== 0 && x + ox * T > -r && x + ox * T < T + r) continue;
          if (oy !== 0 && y + oy * T > -r && y + oy * T < T + r) continue;
          tc.beginPath();
          tc.ellipse(x + ox * T, y + oy * T, r, r * 0.78, 0, 0, Math.PI * 2);
          tc.fill();
        }
      }
    }
    pebblePat = c.createPattern(t, 'repeat');
  }
  return pebblePat;
}

// Две светлые колеи вдоль полотна. Считаются по полосам, а не по каждой строке: иначе у
// четырёхклетковой дороги получается восемь линий вместо двух.
function paintRuts(c) {
  const S = SKIN.px;
  const t = Math.max(1, S * 0.14);
  c.fillStyle = SKIN.road.rut;
  c.globalAlpha = 0.5;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (grid[row + x] !== ROAD) continue;
      let e = x;
      while (e < width && grid[row + e] === ROAD) e++;
      const len = e - x;
      if (len >= 3 && !(y > 0 && grid[row - width + x] === ROAD)) {
        let a = y;
        let b = y;
        while (a > 0 && grid[(a - 1) * width + x] === ROAD) a--;
        while (b < height - 1 && grid[(b + 1) * width + x] === ROAD) b++;
        const h = (b - a + 1) * S;
        c.fillRect((x + 1) * S, a * S + h * 0.28, (len - 2) * S, t);
        c.fillRect((x + 1) * S, a * S + h * 0.66, (len - 2) * S, t);
      }
      x = e - 1;
    }
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      if (grid[y * width + x] !== ROAD) continue;
      let e = y;
      while (e < height && grid[e * width + x] === ROAD) e++;
      const len = e - y;
      if (len >= 3 && !(x > 0 && grid[y * width + x - 1] === ROAD)) {
        let a = x;
        let b = x;
        while (a > 0 && grid[y * width + a - 1] === ROAD) a--;
        while (b < width - 1 && grid[y * width + b + 1] === ROAD) b++;
        const w = (b - a + 1) * S;
        c.fillRect(a * S + w * 0.28, (y + 1) * S, t, (len - 2) * S);
        c.fillRect(a * S + w * 0.66, (y + 1) * S, t, (len - 2) * S);
      }
      y = e - 1;
    }
  }
  c.globalAlpha = 1;
}

function paintRoad(c) {
  const S = SKIN.px;
  const R = SKIN.road;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] !== ROAD) continue;
    const cx = i % width;
    const cy = (i / width) | 0;
    if (cx < x0) x0 = cx;
    if (cx > x1) x1 = cx;
    if (cy < y0) y0 = cy;
    if (cy > y1) y1 = cy;
  }
  if (x1 < 0) return;
  const region = regionLoops((x, y) => grid[y * width + x] === ROAD, { x0: x0, y0: y0, x1: x1, y1: y1 });
  const path = jitterPath(region.loops, SKIN.edgeAmp);
  // Насыпная дорога приподнята, а приподнятость на плоскости держится только тенью: сдвинутая
  // вправо-вниз копия полотна оставляет тень по всей наружной кромке.
  const cast = new Path2D();
  cast.addPath(path, new DOMMatrix().translate(SKIN.castOffset * S, SKIN.castOffset * S));
  c.fillStyle = R.cast;
  c.fill(cast);
  c.fillStyle = R.base;
  c.fill(path);
  // Заливка по самому пути уже ограничена дорогой, поэтому clip для неё лишний: клип по
  // пути из сотен петель дорог и рисуется целиком в буфер маски. Он нужен только колеям.
  c.fillStyle = pebblePattern(c);
  c.globalAlpha = 0.62;
  c.fill(path);
  c.globalAlpha = 1;
  c.save();
  c.clip(path);
  paintRuts(c);
  c.restore();
  // Бордюр из крупных камней по краям: тёмный камень и светлая его половина. Пунктир по пути не
  // годится: его начало зависит от порядка обхода петель, и правка одной клетки сдвигала бы
  // весь бордюр вдоль кольца.
  c.fillStyle = R.curbDark;
  c.fill(curbPath(region.edges, 0, 1));
  c.fillStyle = R.curbLight;
  c.fill(curbPath(region.edges, -0.42, 0.78));
}

function rebuildSkin() {
  const S = SKIN.px;
  const W = width * S;
  const H = height * S;
  if (skin.width !== W || skin.height !== H) {
    skin.width = W;
    skin.height = H;
    sandBase.width = W;
    sandBase.height = H;
    sandPainted = false;
    pebblePat = null;
    sandGrads = null;
  }
  if (!sandPainted) {
    sandCtx.setTransform(1, 0, 0, 1, 0, 0);
    sandCtx.clearRect(0, 0, W, H);
    paintSand(sandCtx, W, H);
    sandPainted = true;
  }
  const c = skinCtx;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-over';
  c.setLineDash([]);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.clearRect(0, 0, W, H);
  c.drawImage(sandBase, 0, 0);
  paintDunes(c);
  paintRoad(c);
  skinDirty = false;
}

function draw() {
  if (skinDirty) rebuildSkin();
  // Фон заливается на весь буфер, а не на размер вёрстки: при дробном devicePixelRatio буфер
  // шире на доли пикселя, и незакрашенная полоска в нём хранила то, что было в кадре раньше.
  // Из-за этого снимок после перерисовки отличался от первого на доли процента пикселей.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = C_OUTSIDE;
  ctx.fillRect(0, 0, view.width, view.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Кожа выводится одним drawImage с трансформом камеры. Сглаживание включено обязательно: при
  // вписывании 96 × 96 это 12 пикселей на клетку против 7, и без усреднения текстура рябит.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'low';
  ctx.drawImage(skin, tx, ty, width * scale, height * scale);

  const x0 = Math.round(tx);
  const y0 = Math.round(ty);
  const x1 = Math.round(tx + width * scale);
  const y1 = Math.round(ty + height * scale);

  if (showGrid) {
    // Сетка всегда, а не от 10 пикселей на клетку: на стартовом зуме клетка 7 пикселей, и без
    // линий поле выглядит пустым квадратом, в котором не видно, куда попадёт клик.
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < width; x++) {
      if (x % GRID_EVERY === 0) continue;
      const px = Math.round(tx + x * scale) + 0.5;
      ctx.moveTo(px, y0);
      ctx.lineTo(px, y1);
    }
    for (let y = 1; y < height; y++) {
      if (y % GRID_EVERY === 0) continue;
      const py = Math.round(ty + y * scale) + 0.5;
      ctx.moveTo(x0, py);
      ctx.lineTo(x1, py);
    }
    ctx.strokeStyle = C_GRID;
    ctx.stroke();

    ctx.beginPath();
    for (let x = GRID_EVERY; x < width; x += GRID_EVERY) {
      const px = Math.round(tx + x * scale) + 0.5;
      ctx.moveTo(px, y0);
      ctx.lineTo(px, y1);
    }
    for (let y = GRID_EVERY; y < height; y += GRID_EVERY) {
      const py = Math.round(ty + y * scale) + 0.5;
      ctx.moveTo(x0, py);
      ctx.lineTo(x1, py);
    }
    ctx.strokeStyle = C_GRID_MAJOR;
    ctx.stroke();
  }

  // Рамка показывает не клетку под курсором, а тот квадрат, который будет закрашен: при кисти 8
  // одна клетка вводит в заблуждение и рисуешь вслепую.
  if (hover && tool === 'paint' && !spaceDown) {
    const before = Math.floor((brushW - 1) / 2);
    const after = brushW - 1 - before;
    const hx = Math.round(tx + (hover.x - before) * scale);
    const hy = Math.round(ty + (hover.y - before) * scale);
    const hw = Math.max(2, Math.round(tx + (hover.x + after + 1) * scale) - hx);
    const hh = Math.max(2, Math.round(ty + (hover.y + after + 1) * scale) - hy);
    ctx.strokeStyle = C_HOVER;
    ctx.lineWidth = 2;
    ctx.strokeRect(hx + 1, hy + 1, hw - 2, hh - 2);
    ctx.lineWidth = 1;
  }

  drawRulers();

  ctx.strokeStyle = C_EDGE;
  ctx.lineWidth = 2;
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
}

// Подписи линеек идут с шагом, который на текущем зуме даёт примерно 60 пикселей между числами:
// на мелком зуме частая сетка сливается в кашу, а на крупном подпись через клетку не влезает.
function rulerStep() {
  for (const s of [1, 2, 5, 10, 20, 50]) {
    if (s * scale >= 60) return s;
  }
  return 100;
}

function drawRulers() {
  const step = rulerStep();
  const font = '11px system-ui, "Segoe UI", sans-serif';
  const left = Math.round(tx);
  const top = Math.round(ty);

  rxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  rxCtx.fillStyle = C_RULER_BG;
  rxCtx.fillRect(0, 0, rxW, rxH);
  rxCtx.font = font;
  rxCtx.textBaseline = 'middle';
  rxCtx.textAlign = 'center';
  for (let c = 0; c <= width; c++) {
    const px = Math.round(c * scale);
    const sx = Math.round(tx + px);
    if (sx < -30 || sx > rxW + 30) continue;
    const major = c % step === 0;
    rxCtx.strokeStyle = major ? C_RULER_TICK : C_RULER_TICK_MINOR;
    rxCtx.lineWidth = 1;
    rxCtx.beginPath();
    rxCtx.moveTo(sx + 0.5, rxH - (major ? 11 : 5));
    rxCtx.lineTo(sx + 0.5, rxH);
    rxCtx.stroke();
    if (major) {
      rxCtx.fillStyle = C_RULER_TEXT;
      rxCtx.fillText(String(c), Math.min(Math.max(sx, 12), rxW - 12), rxH / 2 - 1);
    }
  }

  ryCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ryCtx.fillStyle = C_RULER_BG;
  ryCtx.fillRect(0, 0, ryW, ryH);
  ryCtx.font = font;
  ryCtx.textBaseline = 'middle';
  ryCtx.textAlign = 'right';
  for (let r = 0; r <= height; r++) {
    const py = Math.round(r * scale);
    const sy = Math.round(ty + py);
    if (sy < -30 || sy > ryH + 30) continue;
    const major = r % step === 0;
    ryCtx.strokeStyle = major ? C_RULER_TICK : C_RULER_TICK_MINOR;
    ryCtx.lineWidth = 1;
    ryCtx.beginPath();
    ryCtx.moveTo(ryW - (major ? 11 : 5), sy + 0.5);
    ryCtx.lineTo(ryW, sy + 0.5);
    ryCtx.stroke();
    if (major) {
      ryCtx.fillStyle = C_RULER_TEXT;
      ryCtx.fillText(String(r), ryW - 15, Math.min(Math.max(sy, 8), ryH - 8));
    }
  }
}

function pushHistory() {
  history.push(grid.slice());
  if (history.length > HISTORY_LIMIT) history.shift();
}

// Смена размера не выбрасывает нарисованное: содержимое общего угла переносится, новое до свободно.
// Молчаливая потеря карты здесь стоила бы дороже, чем «неожиданно» пустые новые клетки.
function resizeField(w, h) {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < MIN_SIDE || h < MIN_SIDE ||
      w > MAX_SIDE || h > MAX_SIDE) return false;
  if (w === width && h === height) return true;
  pushHistory();
  const next = newField(w, h);
  const copyW = Math.min(w, width);
  const copyH = Math.min(h, height);
  for (let y = 0; y < copyH; y++) {
    const from = y * width;
    const to = y * w;
    for (let x = 0; x < copyW; x++) next[to + x] = grid[from + x];
  }
  width = w;
  height = h;
  grid = next;
  hover = null;
  skinDirty = true;
  syncSizeInputs();
  fit();
  draw();
  return true;
}

function syncSizeInputs() {
  fieldW.value = String(width);
  fieldH.value = String(height);
  stSize.textContent = width + ' × ' + height;
}

function readSizeInputs() {
  const w = parseInt(fieldW.value, 10);
  const h = parseInt(fieldH.value, 10);
  if (!resizeField(w, h)) {
    fieldW.value = String(width);
    fieldH.value = String(height);
  }
}

function updateStatus() {
  stCell.textContent = hover ? hover.x + ', ' + hover.y : '—';
  stBrush.textContent = tool === 'pan' ? 'Сдвиг' : KIND_TITLE[KINDS.indexOf(brush)];
  stBrushW.textContent = tool === 'pan' ? '—' : String(brushW);
  stZoom.textContent = (scale / minScale).toFixed(2) + '×';
}

function undo() {
  if (history.length === 0) return;
  grid = history.pop();
  skinDirty = true;
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
  hover = null;
  skinDirty = true;
  nameInput.value = map.name;
  presetSel.value = (width === height && PRESETS.has(width + 'x' + height)) ? width + 'x' + height : 'custom';
  syncSizeInputs();
  fit();
  updateStatus();
  draw();
}

view.addEventListener('mousedown', (e) => {
  e.preventDefault();
  // Правая кнопка двигает карту: так ведут себя все нормальные редакторы, а стирать полосой
  // нужной толщины удобнее кистью «Свободно» — она уже рисует ровно то же самое.
  if (e.button === 1 || e.button === 2 || (e.button === 0 && (spaceDown || tool === 'pan'))) {
    panning = true;
    panX = e.clientX;
    panY = e.clientY;
    panTX = tx;
    panTY = ty;
    view.style.cursor = 'grabbing';
    return;
  }
  if (e.button !== 0) return;
  const c = cellAt(toCanvasX(e.clientX), toCanvasY(e.clientY));
  if (!c) return;
  pushHistory();
  stroking = true;
  strokeValue = brush;
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
  const c = cellAt(toCanvasX(e.clientX), toCanvasY(e.clientY));
  const moved = !c !== !hover || (c && hover && (c.x !== hover.x || c.y !== hover.y));
  if (moved) {
    hover = c;
    updateStatus();
  }
  if (!stroking) {
    if (moved) draw();
    return;
  }
  if (!c || (c.x === lastX && c.y === lastY)) return;
  strokeLine(lastX, lastY, c.x, c.y);
  lastX = c.x;
  lastY = c.y;
  draw();
});

window.addEventListener('mouseup', () => {
  stroking = false;
  panning = false;
  view.style.cursor = tool === 'pan' ? 'grab' : 'crosshair';
});

window.addEventListener('blur', () => {
  spaceDown = false;
  stroking = false;
  panning = false;
});

// Курсор уходит с поля — рамка исчезает, иначе она остаётся висеть на последней клетке.
view.addEventListener('mouseleave', () => {
  if (hover === null) return;
  hover = null;
  updateStatus();
  draw();
});

view.addEventListener('wheel', (e) => {
  e.preventDefault();
  // Firefox отдаёт дельту колеса в строках, а не в пикселях: без поправки зум в нём втрое слабее.
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewH : 1;
  zoomAt(toCanvasX(e.clientX), toCanvasY(e.clientY), scale * Math.exp(-e.deltaY * unit * 0.0015));
  updateStatus();
}, { passive: false });

window.addEventListener('keydown', (e) => {
  const tag = e.target && e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (e.code === 'Space') {
    spaceDown = true;
    view.style.cursor = 'grabbing';
    e.preventDefault();
    return;
  }
  if (e.ctrlKey && e.key === 'z') {
    e.preventDefault();
    undo();
    return;
  }
  const i = '123'.indexOf(e.key);
  if (i !== -1) {
    setBrush(KINDS[i]);
    setTool('paint');
    return;
  }
  if (e.key === '4') {
    setTool(tool === 'pan' ? 'paint' : 'pan');
    return;
  }
  // Сетка обязана выключаться: поверх оформленной карты она превращает всё в шахматку.
  // Линейки с номерами остаются в любом состоянии — координата нужна всегда.
  if (e.key === '5') {
    showGrid = !showGrid;
    draw();
    return;
  }
  if (e.key === '0') {
    fit();
    draw();
    updateStatus();
    return;
  }
  // Ширина кисти на скобках: она меняется часто, а мышью до поля не дотянуться.
  if (e.key === '[') setBrushW(brushW - 1);
  if (e.key === ']') setBrushW(brushW + 1);
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    spaceDown = false;
    if (!panning) view.style.cursor = tool === 'pan' ? 'grab' : 'crosshair';
  }
});

window.addEventListener('resize', resize);

if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(syncToStage).observe(stage);
}

saveBtn.addEventListener('click', save);
openBtn.addEventListener('click', () => fileInput.click());

// Размер поля: набор готовых и два числа для своего. Прямое число выигрывает у выбранного
// пресета, поэтому пресет переходит в «свой» сам, а не молча затирает введённое.
presetSel.addEventListener('change', () => {
  const v = presetSel.value;
  if (v === 'custom') {
    fieldW.focus();
    fieldW.select();
    return;
  }
  const [w, h] = v.split('x').map(Number);
  if (resizeField(w, h)) syncSizeInputs();
});

fieldW.addEventListener('change', () => {
  presetSel.value = 'custom';
  readSizeInputs();
});
fieldH.addEventListener('change', () => {
  presetSel.value = 'custom';
  readSizeInputs();
});

zoomInBtn.addEventListener('click', () => {
  zoomAt(viewW / 2, viewH / 2, scale * 1.4);
  updateStatus();
});
zoomOutBtn.addEventListener('click', () => {
  zoomAt(viewW / 2, viewH / 2, scale / 1.4);
  updateStatus();
});
fitBtn.addEventListener('click', () => {
  fit();
  draw();
  updateStatus();
});

brushWInput.addEventListener('change', () => setBrushW(parseInt(brushWInput.value, 10)));
brushUpBtn.addEventListener('click', () => setBrushW(brushW + 1));
brushDownBtn.addEventListener('click', () => setBrushW(brushW - 1));
panToolBtn.addEventListener('click', () => setTool(tool === 'pan' ? 'paint' : 'pan'));

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
skinDirty = true;
resize();
buildBrushes();
fit();
setBrush(ROAD);
setBrushW(1);
setTool('paint');
syncSizeInputs();
updateStatus();
draw();
syncToStage();
