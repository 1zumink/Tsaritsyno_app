// ── Storage ──────────────────────────────────────────────────────────────────
const STORE = {
  getPlayer: () => JSON.parse(localStorage.getItem('tsaritsyno_player') || 'null'),
  setPlayer: (p) => localStorage.setItem('tsaritsyno_player', JSON.stringify(p)),
  getCollected: () => JSON.parse(localStorage.getItem('tsaritsyno_collected') || '[]'),
  addCollected: (id) => {
    const c = STORE.getCollected();
    if (!c.includes(id)) { c.push(id); localStorage.setItem('tsaritsyno_collected', JSON.stringify(c)); }
  },
  getXP: () => parseInt(localStorage.getItem('tsaritsyno_xp') || '0', 10),
  addXP: (n) => localStorage.setItem('tsaritsyno_xp', STORE.getXP() + n)
};

// ── Level helpers ─────────────────────────────────────────────────────────────
function getCurrentLevel(xp) {
  let cur = LEVELS[0];
  for (const l of LEVELS) { if (xp >= l.minXP) cur = l; }
  return cur;
}
function getNextLevel(xp) {
  return LEVELS.find(l => l.minXP > xp) || null;
}
function xpPercent(xp) {
  const cur = getCurrentLevel(xp);
  const next = getNextLevel(xp);
  if (!next) return 100;
  const range = next.minXP - cur.minXP;
  const progress = xp - cur.minXP;
  return Math.round((progress / range) * 100);
}

// ── Screen routing ────────────────────────────────────────────────────────────
const screens = {
  map: document.getElementById('screen-map'),
  onboarding: document.getElementById('screen-onboarding'),
  monument: document.getElementById('screen-monument'),
  profile: document.getElementById('screen-profile'),
  scanner: document.getElementById('screen-scanner')
};

let currentScreen = null;
function showScreen(name) {
  Object.entries(screens).forEach(([k, el]) => {
    if (el) el.classList.toggle('hidden', k !== name);
  });
  currentScreen = name;
  const fab = document.getElementById('fab-scan');
  if (fab) fab.style.display = name === 'map' ? 'flex' : 'none';
}

// ── QR Scanner ────────────────────────────────────────────────────────────────
let scannerStream = null;
let scannerRaf = null;
let scannerActive = false;

// Запрашивает доступ к камере превентивно (без открытия экрана сканера).
// Вызывается при пользовательском жесте, чтобы iOS/Android показал диалог.
async function requestCameraPermission() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } }
    });
    stream.getTracks().forEach(t => t.stop());
  } catch {
    // Отказ или отсутствие камеры — обработаем позже при startScanner
  }
}

async function startScanner() {
  // mediaDevices недоступен вне защищённого контекста (HTTP вместо HTTPS)
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    if (!window.isSecureContext) {
      showCameraHttpsTip();
    } else {
      showToast('Камера недоступна в этом браузере');
    }
    return;
  }

  showScreen('scanner');
  scannerActive = true;
  const video = document.getElementById('scanner-video');
  try {
    scannerStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }
    });
    video.srcObject = scannerStream;
    video.play();
    video.addEventListener('loadedmetadata', tickScan, { once: true });
  } catch (err) {
    stopScanner();
    showScreen('map');
    // Разбираем причину отказа
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      showCameraPermissionTip();
    } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      showToast('Камера не найдена на устройстве');
    } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
      showToast('Камера занята другим приложением');
    } else {
      showToast('Не удалось открыть камеру');
    }
  }
}

function showCameraHttpsTip() {
  const existing = document.getElementById('camera-tip-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'camera-tip-overlay';
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 200;
    background: rgba(0,0,0,.72);
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    padding: 32px 28px; gap: 20px;
  `;

  const httpsUrl = window.location.href.replace(/^http:/, 'https:');

  overlay.innerHTML = `
    <div style="font-size:64px; line-height:1;">🔒</div>
    <div style="font-family:var(--font-heading); font-size:26px; color:#fff; text-align:center; line-height:1.2;">Нужен HTTPS</div>
    <div style="font-size:16px; color:rgba(255,255,255,.75); text-align:center; line-height:1.6;">
      Камера работает только через защищённое соединение.<br>
      Открой сайт по ссылке ниже:
    </div>
    <a href="${httpsUrl}" style="
      background: rgba(255,255,255,.15); color: #fff;
      border: 1.5px solid rgba(255,255,255,.3);
      border-radius: 14px; padding: 12px 20px;
      font-size: 13px; word-break: break-all;
      text-align: center; text-decoration: none;
      line-height: 1.5; max-width: 100%;
    ">${httpsUrl}</a>
    <button id="camera-tip-close" style="
      background:#fff; color:#000;
      border:none; border-radius:999px;
      padding:15px 36px; font-size:17px; font-weight:700;
      cursor:pointer; font-family:var(--font-body);
    ">Понятно</button>
  `;

  document.body.appendChild(overlay);
  document.getElementById('camera-tip-close').addEventListener('click', () => overlay.remove());
}

function showCameraPermissionTip() {
  const existing = document.getElementById('camera-tip-overlay');
  if (existing) { existing.remove(); }

  const overlay = document.createElement('div');
  overlay.id = 'camera-tip-overlay';
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 200;
    background: rgba(0,0,0,.72);
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    padding: 32px 28px; gap: 20px;
  `;

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const tipText = isIOS
    ? 'Перейди в Настройки → Safari → Камера и выбери «Разрешить».'
    : 'Нажми на значок 🔒 в адресной строке браузера и разреши доступ к камере.';

  overlay.innerHTML = `
    <div style="font-size:64px; line-height:1;">📷</div>
    <div style="font-family:var(--font-heading); font-size:26px; color:#fff; text-align:center; line-height:1.2;">Нет доступа<br>к камере</div>
    <div style="font-size:16px; color:rgba(255,255,255,.75); text-align:center; line-height:1.6;">${tipText}</div>
    <button id="camera-tip-close" style="
      margin-top:8px; background:#fff; color:#000;
      border:none; border-radius:999px;
      padding:15px 36px; font-size:17px; font-weight:700;
      cursor:pointer; font-family:var(--font-body);
    ">Понятно</button>
  `;

  document.body.appendChild(overlay);
  document.getElementById('camera-tip-close').addEventListener('click', () => overlay.remove());
}

function stopScanner() {
  scannerActive = false;
  if (scannerRaf) { cancelAnimationFrame(scannerRaf); scannerRaf = null; }
  if (scannerStream) { scannerStream.getTracks().forEach(t => t.stop()); scannerStream = null; }
  const video = document.getElementById('scanner-video');
  video.srcObject = null;
}

function tickScan() {
  if (!scannerActive) return;
  const video = document.getElementById('scanner-video');
  const canvas = document.getElementById('scanner-canvas');
  if (video.readyState < video.HAVE_ENOUGH_DATA) {
    scannerRaf = requestAnimationFrame(tickScan);
    return;
  }
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
  if (code) {
    let id = null;
    try {
      const url = new URL(code.data);
      id = url.searchParams.get('monument') || url.searchParams.get('id');
    } catch {
      id = code.data.trim();
    }
    const match = id && MONUMENTS.find(m => m.id === id);
    if (match) {
      stopScanner();
      openMonumentPage(match.id, true);
      return;
    }
  }
  scannerRaf = requestAnimationFrame(tickScan);
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// ── Confetti ──────────────────────────────────────────────────────────────────
const CONFETTI_COLORS = ['#FF0F74','#00A651','#8CC6FC','#E59A62','#E95C53','#7DBDB6'];
function launchConfetti() {
  for (let i = 0; i < 36; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-piece';
    el.style.cssText = `
      left: ${10 + Math.random() * 80}%;
      top: ${Math.random() * 40}%;
      background: ${CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]};
      width: ${6 + Math.random() * 10}px;
      height: ${6 + Math.random() * 10}px;
      border-radius: ${Math.random() > .5 ? '50%' : '2px'};
      animation-duration: ${.8 + Math.random() * .8}s;
      animation-delay: ${Math.random() * .3}s;
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }
}

// ── Level-up overlay ──────────────────────────────────────────────────────────
function showLevelUp(level) {
  const ov = document.getElementById('levelup-overlay');
  document.getElementById('lu-emoji').textContent = level.badge;
  document.getElementById('lu-title').textContent = 'Новый уровень!';
  document.getElementById('lu-sub').textContent = level.name;
  ov.classList.add('show');
  launchConfetti();
  setTimeout(() => ov.classList.remove('show'), 3200);
}

// ── HUD ───────────────────────────────────────────────────────────────────────
function renderHUD() {
  const player = STORE.getPlayer();
  const xp = STORE.getXP();
  const level = getCurrentLevel(xp);
  const next = getNextLevel(xp);
  const pct = xpPercent(xp);

  document.getElementById('hud-name').textContent = player?.name || '';
  document.getElementById('hud-badge').textContent = level.name;
  document.getElementById('hud-level-emoji').textContent = level.badge;
  document.getElementById('hud-xp-bar').style.width = pct + '%';
  document.getElementById('hud-xp-text').textContent = next
    ? `${xp} / ${next.minXP} XP`
    : `${xp} XP — Макс!`;
}

// ── Isometric Map ─────────────────────────────────────────────────────────────
const ISO_GAP = 110;

function isoPosition(col, row) {
  const x = (col - row) * (ISO_GAP / 2);
  const y = (col + row) * (ISO_GAP / 4);
  return { x, y };
}

let mapDragging = false;
let mapDragStart = { x: 0, y: 0 };
let mapOffset = { x: 0, y: 0 };
let mapOffsetStart = { x: 0, y: 0 };

function renderMap() {
  const collected = STORE.getCollected();
  const scene = document.getElementById('iso-scene');
  scene.innerHTML = '';

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const positions = MONUMENTS.map(m => {
    const p = isoPosition(m.iso.col, m.iso.row);
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
    return p;
  });

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  MONUMENTS.forEach((m, i) => {
    const { x, y } = positions[i];
    const isCollected = collected.includes(m.id);

    const tile = document.createElement('div');
    tile.className = 'iso-tile' + (isCollected ? ' collected' : ' locked');
    tile.dataset.id = m.id;
    tile.style.left = (x - centerX - 32) + 'px';
    tile.style.top = (y - centerY - 32) + 'px';

    const base = document.createElement('div');
    base.className = 'tile-base';
    base.style.background = isCollected ? m.color : '#3a3a3a';

    const emoji = document.createElement('div');
    emoji.className = 'tile-emoji';
    emoji.textContent = m.emoji;

    base.appendChild(emoji);
    tile.appendChild(base);
    tile.addEventListener('click', (e) => {
      if (!mapDragging) openBottomSheet(m.id);
    });
    scene.appendChild(tile);
  });
}

// ── Bottom Sheet ──────────────────────────────────────────────────────────────
let bsCurrentId = null;

function openBottomSheet(id) {
  const m = MONUMENTS.find(x => x.id === id);
  if (!m) return;
  bsCurrentId = id;
  const collected = STORE.getCollected();
  const isCollected = collected.includes(id);

  document.getElementById('bs-icon').textContent = m.emoji;
  document.getElementById('bs-icon').style.background = m.color + '33';
  document.getElementById('bs-title').textContent = m.name;
  document.getElementById('bs-xp').textContent = isCollected ? '✓ Уже в коллекции' : `+${m.xp} XP за добавление`;

  const actionsEl = document.getElementById('bs-actions');
  actionsEl.innerHTML = '';

  const openBtn = document.createElement('button');
  openBtn.className = 'btn-open';
  openBtn.textContent = '📖 Подробнее';
  openBtn.addEventListener('click', () => {
    closeBottomSheet();
    openMonumentPage(id);
  });
  actionsEl.appendChild(openBtn);

  if (isCollected) {
    const badge = document.createElement('div');
    badge.className = 'bs-collected-badge';
    badge.innerHTML = '✓ Собрано';
    actionsEl.appendChild(badge);
  }

  document.getElementById('bottom-sheet').classList.add('open');
  document.getElementById('bs-backdrop').classList.add('open');
  const fab = document.getElementById('fab-scan');
  if (fab) fab.style.display = 'none';
}

function closeBottomSheet() {
  document.getElementById('bottom-sheet').classList.remove('open');
  document.getElementById('bs-backdrop').classList.remove('open');
  const fab = document.getElementById('fab-scan');
  if (fab) fab.style.display = 'flex';
  bsCurrentId = null;
}

// ── Monument Detail Page ───────────────────────────────────────────────────────
function openMonumentPage(id, fromQR = false) {
  const m = MONUMENTS.find(x => x.id === id);
  if (!m) return;
  const collected = STORE.getCollected();
  const isCollected = collected.includes(id);

  document.getElementById('mon-hero').style.background =
    `linear-gradient(160deg, ${m.color}cc, ${m.color}66)`;
  document.getElementById('mon-hero-emoji').textContent = m.emoji;
  document.getElementById('mon-hero-name').textContent = m.name;
  document.getElementById('mon-description').textContent = m.description;
  document.getElementById('mon-fact-text').textContent = m.fact;

  const collectWrap = document.getElementById('mon-collect-wrap');
  const collectBtn = document.getElementById('btn-collect');
  collectBtn.dataset.id = id;

  if (!fromQR) {
    collectWrap.style.display = 'none';
  } else if (isCollected) {
    collectWrap.style.display = '';
    collectBtn.textContent = '✓ Уже в коллекции';
    collectBtn.classList.add('collected');
    collectBtn.disabled = true;
  } else {
    collectWrap.style.display = '';
    collectBtn.innerHTML = `⭐ Добавить на карту (+${m.xp} XP)`;
    collectBtn.classList.remove('collected');
    collectBtn.disabled = false;
  }

  showScreen('monument');
  screens.monument.scrollTop = 0;
}

// ── Collect monument ──────────────────────────────────────────────────────────
function collectMonument(id) {
  const m = MONUMENTS.find(x => x.id === id);
  if (!m) return;
  const collected = STORE.getCollected();
  if (collected.includes(id)) return;

  const prevXP = STORE.getXP();
  const prevLevel = getCurrentLevel(prevXP);

  STORE.addCollected(id);
  STORE.addXP(m.xp);

  const newXP = STORE.getXP();
  const newLevel = getCurrentLevel(newXP);

  launchConfetti();
  showToast(`+${m.xp} XP — ${m.name} добавлен!`);

  if (newLevel.level > prevLevel.level) {
    setTimeout(() => showLevelUp(newLevel), 600);
  }

  // Update button
  const collectBtn = document.getElementById('btn-collect');
  collectBtn.textContent = '✓ Уже в коллекции';
  collectBtn.classList.add('collected');
  collectBtn.disabled = true;

  setTimeout(() => {
    renderMap();
    renderHUD();
  }, 300);
}

// ── Profile ───────────────────────────────────────────────────────────────────
function renderProfile() {
  const player = STORE.getPlayer();
  const xp = STORE.getXP();
  const collected = STORE.getCollected();
  const level = getCurrentLevel(xp);
  const next = getNextLevel(xp);
  const pct = xpPercent(xp);

  document.getElementById('profile-name').textContent = player?.name || '';
  document.getElementById('profile-level-name').textContent = level.badge + ' ' + level.name;

  const xpNums = document.getElementById('profile-xp-nums');
  xpNums.innerHTML = `<span>${xp} XP</span><span>${next ? next.minXP + ' XP' : 'Максимум!'}</span>`;
  document.getElementById('profile-xp-bar').style.width = pct + '%';

  document.getElementById('stat-collected').textContent = collected.length;
  document.getElementById('stat-total').textContent = MONUMENTS.length;
  document.getElementById('stat-xp').textContent = xp;
  document.getElementById('stat-level').textContent = level.level;

  const grid = document.getElementById('collection-grid');
  grid.innerHTML = '';
  MONUMENTS.forEach(m => {
    const isC = collected.includes(m.id);
    const item = document.createElement('div');
    item.className = 'coll-item' + (isC ? '' : ' locked');
    item.innerHTML = `
      <div class="coll-item-emoji">${m.emoji}</div>
      <div class="coll-item-name">${m.name}</div>
    `;
    if (isC) {
      item.addEventListener('click', () => openMonumentPage(m.id));
    }
    grid.appendChild(item);
  });
}

// ── Drag / Pan map ────────────────────────────────────────────────────────────
function initMapDrag() {
  const container = document.getElementById('map-container');
  const world = document.getElementById('iso-world');
  let startX, startY, startOX, startOY, moved = false;

  function applyTransform() {
    world.style.transform = `translate(${mapOffset.x}px, ${mapOffset.y}px) translate(-50%, -50%)`;
  }

  applyTransform();

  container.addEventListener('pointerdown', e => {
    mapDragging = false;
    moved = false;
    startX = e.clientX;
    startY = e.clientY;
    startOX = mapOffset.x;
    startOY = mapOffset.y;
    container.setPointerCapture(e.pointerId);
  });

  container.addEventListener('pointermove', e => {
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
      moved = true;
      mapDragging = true;
    }
    if (!moved) return;
    mapOffset.x = startOX + dx;
    mapOffset.y = startOY + dy;
    applyTransform();
  });

  container.addEventListener('pointerup', () => {
    setTimeout(() => { mapDragging = false; }, 50);
  });
}

// ── Check for QR param ────────────────────────────────────────────────────────
function checkQRParam() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('monument') || params.get('id');
  if (id && MONUMENTS.find(m => m.id === id)) {
    return id;
  }
  return null;
}

// ── Init ──────────────────────────────────────────────────────────────────────
function init() {
  const qrId = checkQRParam();
  const player = STORE.getPlayer();

  if (!player) {
    showScreen('onboarding');
  } else if (qrId) {
    renderHUD();
    renderMap();
    openMonumentPage(qrId, true);
  } else {
    showScreen('map');
    renderHUD();
    renderMap();
    initMapDrag();
    // Для вернувшихся пользователей предзапрос делается при первом тапе FAB
  }

  // Onboarding submit
  document.getElementById('btn-start').addEventListener('click', () => {
    const name = document.getElementById('input-name').value.trim();
    if (!name) {
      document.getElementById('input-name').focus();
      return;
    }
    STORE.setPlayer({ name, createdAt: Date.now() });
    showScreen('map');
    renderHUD();
    renderMap();
    initMapDrag();
    // Запрашиваем разрешение камеры сразу — пока есть пользовательский жест
    requestCameraPermission();
    if (qrId) setTimeout(() => openMonumentPage(qrId, true), 400);
  });

  document.getElementById('input-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-start').click();
  });

  // Bottom sheet backdrop
  document.getElementById('bs-backdrop').addEventListener('click', closeBottomSheet);

  // Collect button
  document.getElementById('btn-collect').addEventListener('click', () => {
    const id = document.getElementById('btn-collect').dataset.id;
    collectMonument(id);
  });

  // Back from monument
  document.getElementById('btn-back-monument').addEventListener('click', () => {
    showScreen('map');
    renderHUD();
    renderMap();
  });

  // Back from profile
  document.getElementById('btn-back-profile').addEventListener('click', () => {
    showScreen('map');
    renderHUD();
    renderMap();
  });

  // Level-up tap to dismiss
  document.getElementById('levelup-overlay').addEventListener('click', () => {
    document.getElementById('levelup-overlay').classList.remove('show');
  });

  // HUD → profile
  document.getElementById('hud-profile-btn').addEventListener('click', () => {
    renderProfile();
    showScreen('profile');
  });

  // FAB → scanner
  // Для вернувшихся пользователей requestCameraPermission вызовется внутри
  // startScanner через getUserMedia — это и есть сам запрос разрешения.
  document.getElementById('fab-scan').addEventListener('click', startScanner);

  // Back from scanner
  document.getElementById('btn-back-scanner').addEventListener('click', () => {
    stopScanner();
    showScreen('map');
  });
}

document.addEventListener('DOMContentLoaded', init);
