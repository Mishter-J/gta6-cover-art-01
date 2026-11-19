// Vice Cover Studio — multi-panel GTA-style cover art maker.
//
// Everything runs offline in the browser: photos are read from the user's own
// machine (or the two bundled samples), drawn on a canvas with a sunset/neon
// grade and a bold caption, and exported as a PNG. No network, no library.

const SIZES = {
  '1080x1080': [1080, 1080],
  '1080x1350': [1080, 1350],
  '1920x1080': [1920, 1080],
};

const PANEL_COUNT = { trio: 3, duo: 2, solo: 1 };
const SAMPLES = [
  { name: 'boulevard.jpg', url: './samples/boulevard.jpg' },
  { name: 'pier.jpg', url: './samples/pier.jpg' },
];

// The working state. Panel entries survive a layout switch; only the count of
// panels actually drawn follows the layout.
const state = {
  layout: 'trio',
  size: '1920x1080',
  title: 'NEON VICE',
  tagline: 'Palm trees · fast cars · long nights',
  titleSize: 1.0,
  grade: 'sunset',
  panels: [
    { photo: null, zoom: 1, ox: 0, oy: 0 },
    { photo: null, zoom: 1, ox: 0, oy: 0 },
    { photo: null, zoom: 1, ox: 0, oy: 0 },
  ],
};

let photos = []; // [{ name, img, url }]
let activePanel = 0;

const preview = document.getElementById('preview');
const previewCtx = preview.getContext('2d');

window.__viceError = null;
window.addEventListener('error', (event) => {
  window.__viceError = String(event.message || event.error || 'error');
});

// ---------------------------------------------------------------- fonts

let fontsReadyPromise = null;
function ensureFonts() {
  if (!fontsReadyPromise) {
    fontsReadyPromise = (async () => {
      try {
        await document.fonts.load('900 100px "ViceDisplay"');
        await document.fonts.ready;
      } catch (err) {
        // Fall back to the system sans: the caption still draws.
      }
    })();
  }
  return fontsReadyPromise;
}

// ---------------------------------------------------------------- geometry

function frameOf(width) {
  return Math.max(4, Math.round((16 * width) / 1920));
}

function gutterOf(width) {
  return Math.max(3, Math.round((10 * width) / 1920));
}

// Panel rectangles inside the white outer frame, in cover pixels.
function panelRects(width, height, layout) {
  const frame = frameOf(width);
  const gap = gutterOf(width);
  const innerX = frame;
  const innerY = frame;
  const innerW = width - 2 * frame;
  const innerH = height - 2 * frame;
  if (layout === 'solo') {
    return [{ x: innerX, y: innerY, w: innerW, h: innerH }];
  }
  if (layout === 'duo') {
    if (width >= height) {
      const avail = innerW - gap;
      const leftW = 0.58 * avail;
      const rightW = 0.42 * avail;
      return [
        { x: innerX, y: innerY, w: leftW, h: innerH },
        { x: innerX + leftW + gap, y: innerY, w: rightW, h: innerH },
      ];
    }
    const avail = innerH - gap;
    const topH = 0.55 * avail;
    const bottomH = 0.45 * avail;
    return [
      { x: innerX, y: innerY, w: innerW, h: topH },
      { x: innerX, y: innerY + topH + gap, w: innerW, h: bottomH },
    ];
  }
  // trio: three horizontal bands, 46 / 30 / 24 of the inner height.
  const avail = innerH - 2 * gap;
  const topH = 0.46 * avail;
  const midH = 0.3 * avail;
  const botH = 0.24 * avail;
  return [
    { x: innerX, y: innerY, w: innerW, h: topH },
    { x: innerX, y: innerY + topH + gap, w: innerW, h: midH },
    { x: innerX, y: innerY + topH + gap + midH + gap, w: innerW, h: botH },
  ];
}

// ---------------------------------------------------------------- drawing

function drawVignette(ctx, rect, strength) {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const inner = Math.min(rect.w, rect.h) * 0.35;
  const outer = Math.max(rect.w, rect.h) * 0.75;
  const grad = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = grad;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
}

function applyGrade(ctx, rect, grade) {
  if (grade === 'sunset') {
    const wash = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h);
    wash.addColorStop(0, 'rgba(255,120,40,0.10)');
    wash.addColorStop(1, 'rgba(120,20,90,0.38)');
    ctx.fillStyle = wash;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    const glow = ctx.createRadialGradient(
      rect.x + rect.w, rect.y, 0,
      rect.x + rect.w, rect.y, Math.max(rect.w, rect.h),
    );
    glow.addColorStop(0, 'rgba(255,180,80,0.25)');
    glow.addColorStop(1, 'rgba(255,180,80,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    drawVignette(ctx, rect, 0.35);
  } else if (grade === 'neon') {
    const wash = ctx.createLinearGradient(rect.x, rect.y, rect.x + rect.w, rect.y + rect.h);
    wash.addColorStop(0, 'rgba(255,0,128,0.22)');
    wash.addColorStop(1, 'rgba(0,200,255,0.22)');
    ctx.fillStyle = wash;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    drawVignette(ctx, rect, 0.35);
  } else if (grade === 'noir') {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    drawVignette(ctx, rect, 0.5);
  } else {
    drawVignette(ctx, rect, 0.35);
  }
}

function drawPanel(ctx, rect, panel) {
  const photo = panel.photo === null ? null : photos[panel.photo];
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  if (!photo || !photo.img.complete || photo.img.naturalWidth === 0) {
    const empty = ctx.createLinearGradient(rect.x, rect.y, rect.x + rect.w, rect.y + rect.h);
    empty.addColorStop(0, '#2a1845');
    empty.addColorStop(1, '#160b28');
    ctx.fillStyle = empty;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.fillStyle = 'rgba(245,238,252,0.55)';
    ctx.font = `700 ${Math.max(16, Math.round(rect.h * 0.06))}px "Liberation Sans", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ADD A PHOTO', rect.x + rect.w / 2, rect.y + rect.h / 2);
  } else {
    const img = photo.img;
    const base = Math.max(rect.w / img.naturalWidth, rect.h / img.naturalHeight) * panel.zoom;
    const dw = img.naturalWidth * base;
    const dh = img.naturalHeight * base;
    const dx = rect.x + (rect.w - dw) / 2 + panel.ox * rect.w;
    const dy = rect.y + (rect.h - dh) / 2 + panel.oy * rect.h;
    ctx.drawImage(img, dx, dy, dw, dh);
    applyGrade(ctx, rect, state.grade);
  }
  ctx.restore();
}

function drawCaption(ctx, width, height) {
  const frame = frameOf(width);
  const titleSize = Math.round(0.11 * height * state.titleSize);
  const tagSize = Math.max(13, Math.round(0.028 * height));
  const left = frame + 0.035 * width;
  const tagBaseline = height - frame - 0.018 * height;
  const titleBaseline = tagBaseline - tagSize * 2.0;

  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  if (state.title.trim()) {
    ctx.save();
    ctx.translate(left, titleBaseline);
    ctx.rotate((-2 * Math.PI) / 180);
    ctx.font = `900 ${titleSize}px ViceDisplay, "Liberation Sans", sans-serif`;
    try {
      // The tagline below sets letterSpacing on this shared preview context;
      // the title must draw with its own spacing, not the tagline's.
      ctx.letterSpacing = '0px';
    } catch (err) {
      // Older canvas implementations ignore letterSpacing.
    }
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, titleSize / 12);
    ctx.strokeStyle = 'rgba(20,5,30,0.9)';
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = titleSize / 8;
    ctx.shadowOffsetY = titleSize / 20;
    const fill = ctx.createLinearGradient(0, -titleSize, 0, 0);
    fill.addColorStop(0, '#ffffff');
    fill.addColorStop(1, '#ffd76a');
    ctx.strokeText(state.title, 0, 0);
    ctx.fillStyle = fill;
    ctx.fillText(state.title, 0, 0);
    ctx.restore();
  }

  if (state.tagline.trim()) {
    ctx.font = `700 ${tagSize}px "Liberation Sans", sans-serif`;
    try {
      ctx.letterSpacing = `${Math.max(1, Math.round(height * 0.004))}px`;
    } catch (err) {
      // Older canvas implementations ignore letterSpacing.
    }
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = tagSize / 3;
    ctx.shadowOffsetY = tagSize / 8;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(state.tagline.toUpperCase(), left, tagBaseline);
  }
  ctx.restore();
}

// Draw the whole cover at any size. Pure function of state + photos:
// the same state always renders the same pixels.
function drawCover(ctx, width, height) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  const rects = panelRects(width, height, state.layout);
  const count = PANEL_COUNT[state.layout];
  for (let i = 0; i < count; i += 1) {
    drawPanel(ctx, rects[i], state.panels[i]);
  }
  drawCaption(ctx, width, height);
}

// ---------------------------------------------------------------- export

async function exportCover(sizeName) {
  const dims = SIZES[sizeName] || SIZES[state.size];
  await ensureFonts();
  const canvas = document.createElement('canvas');
  canvas.width = dims[0];
  canvas.height = dims[1];
  drawCover(canvas.getContext('2d'), dims[0], dims[1]);
  return canvas.toDataURL('image/png');
}

window.__vice = { exportCover };

// ---------------------------------------------------------------- preview

function renderPreview() {
  const dims = SIZES[state.size];
  if (preview.width !== dims[0] || preview.height !== dims[1]) {
    preview.width = dims[0];
    preview.height = dims[1];
  }
  drawCover(previewCtx, dims[0], dims[1]);
}

// ---------------------------------------------------------------- photos

function imageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${url}`));
    img.src = url;
  });
}

async function addPhoto(name, url) {
  const img = await imageFromUrl(url);
  const index = photos.length;
  photos.push({ name, img, url });
  // Fill the first empty panel with the new photo.
  for (const panel of state.panels) {
    if (panel.photo === null) {
      panel.photo = index;
      break;
    }
  }
  refreshPhotoList();
  refreshPhotoSelect();
  renderPreview();
  return index;
}

async function loadSample(sample) {
  const response = await fetch(sample.url);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  return addPhoto(sample.name, url);
}

async function loadBothSamples() {
  // Sequential on purpose: panel 0 gets the boulevard, panel 1 the pier.
  await loadSample(SAMPLES[0]);
  await loadSample(SAMPLES[1]);
  state.panels[0].photo = 0;
  state.panels[1].photo = 1;
  state.panels[2].photo = 0;
  refreshPhotoSelect();
  renderPreview();
}

function removePhoto(index) {
  photos.splice(index, 1);
  for (const panel of state.panels) {
    if (panel.photo === index) panel.photo = null;
    else if (panel.photo !== null && panel.photo > index) panel.photo -= 1;
  }
  refreshPhotoList();
  refreshPhotoSelect();
  renderPreview();
}

function refreshPhotoList() {
  const list = document.getElementById('photoList');
  list.innerHTML = '';
  photos.forEach((photo, index) => {
    const item = document.createElement('li');
    const thumb = document.createElement('img');
    thumb.src = photo.url;
    thumb.alt = photo.name;
    const label = document.createElement('span');
    label.className = 'name';
    label.textContent = photo.name;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => removePhoto(index));
    item.append(thumb, label, remove);
    list.append(item);
  });
}

// ---------------------------------------------------------------- controls

function refreshPanelSelect() {
  const select = document.getElementById('panelSelect');
  select.innerHTML = '';
  const count = PANEL_COUNT[state.layout];
  for (let i = 0; i < count; i += 1) {
    const option = document.createElement('option');
    option.value = String(i);
    option.textContent = `Panel ${i + 1}`;
    select.append(option);
  }
  if (activePanel >= count) activePanel = 0;
  select.value = String(activePanel);
}

function refreshPhotoSelect() {
  const select = document.getElementById('photoSelect');
  select.innerHTML = '';
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = '— empty —';
  select.append(empty);
  photos.forEach((photo, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = photo.name;
    select.append(option);
  });
  const panel = state.panels[activePanel];
  select.value = panel.photo === null ? '' : String(panel.photo);
  document.getElementById('zoomInput').value = String(panel.zoom);
}

function syncActiveButtons() {
  document.querySelectorAll('#layoutRow button').forEach((button) => {
    button.classList.toggle('active', button.dataset.layout === state.layout);
  });
  document.querySelectorAll('#sizeRow button').forEach((button) => {
    button.classList.toggle('active', button.dataset.size === state.size);
  });
  document.querySelectorAll('#gradeRow button').forEach((button) => {
    button.classList.toggle('active', button.dataset.grade === state.grade);
  });
}

function wireControls() {
  document.getElementById('fileInput').addEventListener('change', async (event) => {
    const files = Array.from(event.target.files || []);
    for (const file of files) {
      const url = URL.createObjectURL(file);
      try {
        await addPhoto(file.name, url);
      } catch (err) {
        URL.revokeObjectURL(url);
      }
    }
    event.target.value = '';
  });

  document.getElementById('sampleBoulevard').addEventListener('click', () => {
    loadSample(SAMPLES[0]).catch(() => {});
  });
  document.getElementById('samplePier').addEventListener('click', () => {
    loadSample(SAMPLES[1]).catch(() => {});
  });

  document.querySelectorAll('#layoutRow button').forEach((button) => {
    button.addEventListener('click', () => {
      state.layout = button.dataset.layout;
      refreshPanelSelect();
      refreshPhotoSelect();
      syncActiveButtons();
      renderPreview();
    });
  });

  document.querySelectorAll('#sizeRow button').forEach((button) => {
    button.addEventListener('click', () => {
      state.size = button.dataset.size;
      syncActiveButtons();
      renderPreview();
    });
  });

  document.querySelectorAll('#gradeRow button').forEach((button) => {
    button.addEventListener('click', () => {
      state.grade = button.dataset.grade;
      syncActiveButtons();
      renderPreview();
    });
  });

  document.getElementById('titleInput').addEventListener('input', (event) => {
    state.title = event.target.value;
    renderPreview();
  });
  document.getElementById('taglineInput').addEventListener('input', (event) => {
    state.tagline = event.target.value;
    renderPreview();
  });
  document.getElementById('titleSizeInput').addEventListener('input', (event) => {
    state.titleSize = Number(event.target.value);
    renderPreview();
  });

  document.getElementById('panelSelect').addEventListener('change', (event) => {
    activePanel = Number(event.target.value);
    refreshPhotoSelect();
  });
  document.getElementById('photoSelect').addEventListener('change', (event) => {
    state.panels[activePanel].photo = event.target.value === '' ? null : Number(event.target.value);
    renderPreview();
  });
  document.getElementById('zoomInput').addEventListener('input', (event) => {
    state.panels[activePanel].zoom = Number(event.target.value);
    renderPreview();
  });
  document.getElementById('centerBtn').addEventListener('click', () => {
    state.panels[activePanel].ox = 0;
    state.panels[activePanel].oy = 0;
    renderPreview();
  });

  document.getElementById('exportBtn').addEventListener('click', async () => {
    const dataUrl = await exportCover(state.size);
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `vice-cover-${state.size}.png`;
    link.click();
  });
}

// ---------------------------------------------------------------- drag to pan

function wireDragPan() {
  let drag = null;
  preview.addEventListener('pointerdown', (event) => {
    const rect = preview.getBoundingClientRect();
    const scaleX = preview.width / rect.width;
    const scaleY = preview.height / rect.height;
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top) * scaleY;
    const rects = panelRects(preview.width, preview.height, state.layout);
    const count = PANEL_COUNT[state.layout];
    for (let i = 0; i < count; i += 1) {
      const r = rects[i];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        drag = { panel: i, lastX: event.clientX, lastY: event.clientY, scaleX, scaleY };
        activePanel = i;
        document.getElementById('panelSelect').value = String(i);
        refreshPhotoSelect();
        preview.setPointerCapture(event.pointerId);
        preview.classList.add('dragging');
        break;
      }
    }
  });
  preview.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const rects = panelRects(preview.width, preview.height, state.layout);
    const r = rects[drag.panel];
    const panel = state.panels[drag.panel];
    panel.ox += ((event.clientX - drag.lastX) * drag.scaleX) / r.w;
    panel.oy += ((event.clientY - drag.lastY) * drag.scaleY) / r.h;
    panel.ox = Math.max(-0.75, Math.min(0.75, panel.ox));
    panel.oy = Math.max(-0.75, Math.min(0.75, panel.oy));
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    renderPreview();
  });
  const endDrag = () => {
    drag = null;
    preview.classList.remove('dragging');
  };
  preview.addEventListener('pointerup', endDrag);
  preview.addEventListener('pointercancel', endDrag);
}

// ---------------------------------------------------------------- boot

wireControls();
wireDragPan();
refreshPanelSelect();
refreshPhotoSelect();
syncActiveButtons();
ensureFonts().then(renderPreview);
renderPreview();

if (new URLSearchParams(window.location.search).get('demo') === '1') {
  loadBothSamples().catch(() => {});
}
