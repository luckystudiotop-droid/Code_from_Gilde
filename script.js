const SUPABASE_URL = 'https://ckivnxtnjdnonjavsgon.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNraXZueHRuamRub25qYXZzZ29uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIzNjA4NDIsImV4cCI6MjEwNzkzNjg0Mn0.jrHwOdeFZrOlwfl7FEyn2JStn8DQ3m4GeRHlHbgBBwU';
// Сесія адміна живе тільки до закриття вкладки (sessionStorage)
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { storage: window.sessionStorage, persistSession: true, autoRefreshToken: true }
});

// Налаштування фото та сховища
const PHOTO_BUCKET = 'product-photos';
const PHOTO_MAX_SIDE = 1080;        // px по довгій стороні
const PHOTO_QUALITY = 0.82;         // якість JPEG
const STORAGE_LIMIT_MB = 1024;      // безкоштовний ліміт Supabase (1 ГБ)
const STORAGE_WARN_RATIO = 0.8;     // попередження з 80%

let allProducts = [];
const MAX_SELECTED = 10;                // ліміт карток (= фото) для одного повідомлення
let selectedGroups = new Map();         // ключ "модель|колір" -> { group, sizes }
let currentGroups = new Map();          // картки, що зараз на екрані
const cardButtons = new Map();          // ключ -> кнопка "Додати" (щоб не перемальовувати весь список)

// Підписи розмірів для картки й тексту клієнту
const SIZE_YEARS = { 0: '0-1 р.', 1: '1-2 р.', 2: '3-4 р.', 3: '5-6 р.', 4: '7-8 р.', 5: '9-10 р.', 6: '11-12 р.', 7: '13-14 р.', 8: '15-16 р.' };
const NO_PHOTO_SRC = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#EEEEF2"/>' +
    '<text x="150" y="158" font-family="Nunito, sans-serif" font-size="26" font-weight="700" fill="#9A9AA5" text-anchor="middle">Немає фото</text></svg>');
let filters = { gender: null, categories: new Set(), size: null };

// Читає всі рядки products сторінками по 1000 (ліміт Supabase на один запит)
async function fetchAllProducts(columns) {
    const pageSize = 1000;
    let from = 0;
    let rows = [];
    while (true) {
        const { data, error } = await db.from('products')
            .select(columns)
            .order('category')
            .order('id')
            .range(from, from + pageSize - 1);
        if (error) throw error;
        rows = rows.concat(data);
        if (data.length < pageSize) break;
        from += pageSize;
    }
    return rows;
}

// Фото: одна таблиця "модель + колір -> файл", незалежна від імпорту залишків
function photoKey(baseModel, colorKey) {
    return `${String(baseModel || '').trim()}|${colorKey}`;
}

async function fetchPhotoMap() {
    const { data, error } = await db.from('photos').select('base_model, color_key, path, updated_at').range(0, 9999);
    if (error) throw error;
    return new Map(data.map(ph => [photoKey(ph.base_model, ph.color_key), ph]));
}

function photoPublicUrl(ph) {
    const { data } = db.storage.from(PHOTO_BUCKET).getPublicUrl(ph.path);
    return `${data.publicUrl}?v=${new Date(ph.updated_at).getTime()}`; // нова версія = без старого кешу
}

async function loadProducts() {
    try {
        const [products, photoMap] = await Promise.all([fetchAllProducts('*'), fetchPhotoMap()]);
        products.forEach(p => {
            const ph = photoMap.get(photoKey(p.base_model, normColor(p.color)));
            p.photo_url = ph ? photoPublicUrl(ph) : null; // тільки точний збіг моделі й кольору
        });
        allProducts = products;
        renderProducts();
    } catch (e) {
        console.error('Помилка завантаження товарів', e);
    }
}

function toggleFilter(type, value) {
    if (type === 'gender') {
        filters.gender = filters.gender === value ? null : value;
        document.querySelectorAll('.filter-gender').forEach(btn => btn.classList.toggle('active', btn.dataset.val === filters.gender));
    } else if (type === 'category') {
        filters.categories.has(value) ? filters.categories.delete(value) : filters.categories.add(value);
        document.querySelectorAll('.filter-category').forEach(btn => btn.classList.toggle('active', filters.categories.has(btn.dataset.val)));
    } else if (type === 'size') {
        filters.size = filters.size === value ? null : value;
        document.querySelectorAll('.filter-size').forEach(btn => btn.classList.toggle('active', btn.dataset.val === filters.size));
    }
    renderProducts();
}

function resetFilters() {
    filters.gender = null; filters.categories.clear(); filters.size = null; selectedGroups.clear();
    document.querySelectorAll('.big-btn').forEach(btn => btn.classList.remove('active'));
    updateActionBar(); renderProducts();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function sizeLabel(p) {
    return SIZE_YEARS[p.size_index] || p.size_name || '—';
}

function formatPrice(n) {
    return `${Number(n).toLocaleString('uk-UA')} грн`;
}

// Товари в наявності після фільтрів статі й категорії
function getFilteredProducts() {
    let filtered = allProducts.filter(p => (p.stock || 0) > 0);
    if (filters.gender) filtered = filtered.filter(p => p.gender === filters.gender);
    if (filters.categories.size > 0) filtered = filtered.filter(p => filters.categories.has(p.category));
    return filtered;
}

// Одна картка = модель + колір; розміри всередині
function buildGroups() {
    const map = new Map();
    getFilteredProducts().forEach(p => {
        const key = photoKey(p.base_model, normColor(p.color));
        if (!map.has(key)) map.set(key, { key, base: p.base_model, color: p.color, gender: p.gender, photo: p.photo_url, items: [] });
        const g = map.get(key);
        g.items.push(p);
        if (!g.photo && p.photo_url) g.photo = p.photo_url;
    });

    let groups = [...map.values()];
    groups.forEach(g => g.items.sort((a, b) => (a.size_index ?? 99) - (b.size_index ?? 99)));

    if (filters.size !== null) {
        const size = parseInt(filters.size, 10);
        groups = groups.filter(g => g.items.some(p => p.size_index === size));
    }
    // Без фото — в самий кінець (sort стабільний)
    groups.sort((a, b) => (a.photo ? 0 : 1) - (b.photo ? 0 : 1));
    return groups;
}

function cardPriceText(g) {
    let items = g.items;
    if (filters.size !== null) {
        const size = parseInt(filters.size, 10);
        const exact = items.filter(p => p.size_index === size);
        if (exact.length) items = exact;
    }
    const prices = items.map(p => Number(p.price));
    const min = Math.min(...prices), max = Math.max(...prices);
    return min === max ? formatPrice(min) : `${Number(min).toLocaleString('uk-UA')}–${formatPrice(max)}`;
}

function selectButtonState(btn, key) {
    const sel = selectedGroups.get(key);
    btn.classList.toggle('selected', !!sel);
    if (!sel) { btn.textContent = '+ Додати'; return; }
    btn.textContent = '✅ Обрано';
}

function renderProducts() {
    const container = document.getElementById('products-container');
    const catalogTitle = document.getElementById('catalog-title');
    currentGroups = new Map();
    cardButtons.clear();

    if (!filters.gender && filters.categories.size === 0 && filters.size === null) {
        container.innerHTML = '<div class="empty-state">👆 Оберіть фільтри вище, щоб побачити товари</div>';
        catalogTitle.innerText = 'Знайдені товари';
        return;
    }

    const groups = buildGroups();
    catalogTitle.innerText = `Знайдені товари (${groups.length})`;
    if (!groups.length) {
        container.innerHTML = '<div class="empty-state">Товарів за цим запитом немає 😔</div>';
        return;
    }

    const activeSize = filters.size !== null ? parseInt(filters.size, 10) : null;
    const fragment = document.createDocumentFragment();

    groups.forEach(g => {
        currentGroups.set(g.key, g);
        const priceClass = g.gender === 'Дівчинка' ? 'girl-price' : 'boy-price';
        const chips = g.items.map(p => `
            <span class="size-chip ${p.size_index === activeSize ? 'active' : ''} ${p.stock <= 1 ? 'low' : ''}">
                <b>${escapeHtml(sizeLabel(p))}</b><small>${p.stock} шт</small>
            </span>`).join('');

        const card = document.createElement('div');
        card.className = 'product-card';
        card.innerHTML = `
            <img src="${g.photo || NO_PHOTO_SRC}" loading="lazy" decoding="async" class="product-img ${g.photo ? '' : 'no-photo'}"
                 alt="Арт. ${escapeHtml(g.base)} ${escapeHtml(g.color || '')}">
            <div class="product-info">
                <div class="p-meta">Арт. ${escapeHtml(g.base)}</div>
                <div class="p-color">${escapeHtml(g.color || 'Без кольору')}</div>
                <div class="p-price ${priceClass}">${cardPriceText(g)}</div>
                <div class="size-chips">${chips}</div>
                <button type="button" class="select-btn"></button>
            </div>`;
        const btn = card.querySelector('.select-btn');
        btn.dataset.key = g.key;
        selectButtonState(btn, g.key);
        cardButtons.set(g.key, btn);
        fragment.appendChild(card);
    });

    container.innerHTML = '';
    container.appendChild(fragment);
}

// Один обробник на весь список (працює і для миші, і для дотику)
document.getElementById('products-container').addEventListener('click', e => {
    const btn = e.target.closest('.select-btn');
    if (btn && btn.dataset.key) toggleSelect(btn.dataset.key);
});

function addGroup(key) {
    const g = currentGroups.get(key);
    if (!g) return false;
    const size = filters.size !== null ? parseInt(filters.size, 10) : null;
    const sizes = size !== null && g.items.some(p => p.size_index === size)
        ? [size]
        : g.items.map(p => p.size_index);
    selectedGroups.set(key, { group: g, sizes });
    prefetchPhoto(g); // фото готуємо заздалегідь, щоб меню «Поділитися» відкрилось миттєво
    return true;
}

function toggleSelect(key) {
    if (selectedGroups.has(key)) {
        selectedGroups.delete(key);
    } else {
        if (selectedGroups.size >= MAX_SELECTED) { alert(`⚠️ Максимум ${MAX_SELECTED} товарів за раз!`); return; }
        addGroup(key);
    }
    const btn = cardButtons.get(key);
    if (btn) selectButtonState(btn, key);
    updateActionBar();
}

function selectAllFiltered() {
    if (!currentGroups.size) return;
    let skipped = 0;
    for (const key of currentGroups.keys()) {
        if (selectedGroups.has(key)) continue;
        if (selectedGroups.size >= MAX_SELECTED) { skipped++; continue; }
        addGroup(key);
        const btn = cardButtons.get(key);
        if (btn) selectButtonState(btn, key);
    }
    updateActionBar();
    if (skipped) alert(`Обрано перші ${MAX_SELECTED} товарів (ліміт для одного повідомлення в Інстаграм).`);
}

function updateActionBar() {
    const bar = document.getElementById('action-bar');
    document.getElementById('selected-count').innerText = selectedGroups.size;
    const onSeller = document.getElementById('seller-screen').classList.contains('active');
    bar.style.display = selectedGroups.size > 0 && onSeller ? 'flex' : 'none';
}

// Рядок для клієнта: "▪️ Арт. 2332 (Сірий) — розміри: 3-4 р., 5-6 р. — 150 грн"
function customerLine(group, sizes) {
    const items = group.items.filter(p => sizes.includes(p.size_index));
    const title = `▪️ Арт. ${group.base}${group.color ? ` (${group.color})` : ''}`;
    const prices = new Set(items.map(p => Number(p.price)));
    if (prices.size === 1) {
        const word = items.length === 1 ? 'розмір' : 'розміри';
        return `${title} — ${word}: ${items.map(sizeLabel).join(', ')} — ${formatPrice(items[0].price)}`;
    }
    return `${title} — ${items.map(p => `${sizeLabel(p)} — ${formatPrice(p.price)}`).join('; ')}`;
}

// =====================================================================
// ВІДПРАВКА КЛІЄНТУ: телефон — системне меню «Поділитися», комп'ютер — файли
// =====================================================================

const photoFiles = new Map();    // url -> File (або null, якщо не вдалося)
const photoLoading = new Map();  // url -> Promise
let pendingShareFiles = [];
let lastShareText = '';

function prefetchPhoto(group) {
    const url = group.photo;
    if (!url || photoFiles.has(url) || photoLoading.has(url)) return;
    const name = `${slugify(group.base)}_${slugify(group.color || 'foto')}.jpg`;
    const promise = fetch(url)
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob(); })
        .then(blob => photoFiles.set(url, new File([blob], name, { type: blob.type || 'image/jpeg' })))
        .catch(e => { console.error('Фото не завантажилось', url, e); photoFiles.set(url, null); })
        .finally(() => photoLoading.delete(url));
    photoLoading.set(url, promise);
}

async function waitForPhotos(groups) {
    groups.forEach(g => {
        if (g.photo && photoFiles.get(g.photo) === null) photoFiles.delete(g.photo); // ще одна спроба
        prefetchPhoto(g);
    });
    await Promise.all(groups.map(g => photoLoading.get(g.photo)).filter(Boolean));
}

const photosReady = groups => groups.every(g => !g.photo || photoFiles.has(g.photo));
const readyFiles = groups => groups.map(g => photoFiles.get(g.photo)).filter(Boolean);
const failedCount = groups => groups.filter(g => g.photo && photoFiles.get(g.photo) === null).length;

// Телефон/планшет з підтримкою передачі файлів
function canShareFiles() {
    if (!navigator.canShare || !window.matchMedia('(pointer: coarse)').matches) return false;
    try { return navigator.canShare({ files: [new File(['x'], 'test.jpg', { type: 'image/jpeg' })] }); }
    catch (e) { return false; }
}

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (e) {
        // запасний спосіб для старих браузерів
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
        document.body.removeChild(ta);
        return ok;
    }
}

function buildCustomerText() {
    let text = 'Вітаємо! Ось що є в наявності за вашим запитом:\n\n';
    for (const { group, sizes } of selectedGroups.values()) text += customerLine(group, sizes) + '\n';
    return text;
}

function setShareBusy(busy) {
    const btn = document.querySelector('.share-btn');
    btn.disabled = busy;
    btn.classList.toggle('busy', busy);
    if (busy) { btn.dataset.label = btn.innerHTML; btn.innerHTML = '⏳ Готуємо фото...'; }
    else if (btn.dataset.label) { btn.innerHTML = btn.dataset.label; }
}

// Instagram на Android приймає в «Повідомлення» лише одне фото через «Поділитися»
const isAndroid = /Android/i.test(navigator.userAgent);

// Зберігає фото окремими файлами (комп'ютер і Android): повертає кількість
async function downloadFiles(groups) {
    await waitForPhotos(groups);
    let saved = 0;
    for (const file of readyFiles(groups)) {
        const url = URL.createObjectURL(file);
        const link = document.createElement('a');
        link.href = url;
        link.download = file.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        saved++;
        await new Promise(r => setTimeout(r, 400)); // щоб браузер не заблокував масове збереження
    }
    return saved;
}

async function shareToInstagram() {
    if (selectedGroups.size === 0) return;
    const groups = [...selectedGroups.values()].map(s => s.group);
    const photoCount = groups.filter(g => g.photo).length;
    lastShareText = buildCustomerText();
    const copied = copyText(lastShareText); // запускаємо одразу, у момент натискання

    // Телефон: меню «Поділитися» (на Android — тільки коли фото одне)
    if (canShareFiles() && !(isAndroid && photoCount > 1)) {
        if (photosReady(groups)) {
            // Фото вже в пам'яті — відкриваємо меню в межах цього ж натискання
            await shareFiles(readyFiles(groups), copied, failedCount(groups));
        } else {
            setShareBusy(true);
            await waitForPhotos(groups);
            setShareBusy(false);
            pendingShareFiles = readyFiles(groups);
            openShareSheet('ready', { copied: await copied, files: pendingShareFiles.length, failed: failedCount(groups) });
        }
        return;
    }

    // Android з кількома фото і комп'ютер: зберігаємо фото файлами
    setShareBusy(true);
    const saved = await downloadFiles(groups);
    setShareBusy(false);
    pendingShareFiles = [];
    openShareSheet(isAndroid ? 'savedAndroid' : 'downloaded', { copied: await copied, files: saved, failed: failedCount(groups) });
}

async function shareFiles(files, copiedPromise, failed = 0) {
    pendingShareFiles = files;
    if (!files.length) {
        openShareSheet('nofiles', { copied: await copiedPromise, files: 0, failed });
        return;
    }
    try {
        await navigator.share({ files });
        openShareSheet('shared', { copied: await copiedPromise, files: files.length, failed });
    } catch (e) {
        if (e.name === 'AbortError') return; // меню закрили — вибір лишається
        if (e.name === 'NotAllowedError') { // браузер вимагає ще одне натискання
            openShareSheet('ready', { copied: await copiedPromise, files: files.length, failed });
            return;
        }
        console.error(e);
        openShareSheet('error', { copied: await copiedPromise, files: files.length, failed, message: e.message });
    }
}

// Кнопка у вікні — нове натискання, тому меню «Поділитися» точно відкриється
function shareFilesAgain() {
    shareFiles(pendingShareFiles, Promise.resolve(true));
}

async function copyShareTextAgain() {
    const ok = await copyText(lastShareText);
    document.getElementById('share-hint').innerText = ok
        ? '📋 Текст скопійовано. У чаті клієнта утримайте поле вводу і натисніть «Вставити».'
        : '❌ Не вдалося скопіювати. Виділіть текст нижче вручну.';
}

function openShareSheet(state, info) {
    const titles = {
        shared: `✅ Фото передано: ${info.files}`,
        ready: `📷 Фото готові: ${info.files}`,
        downloaded: `📥 Збережено фото: ${info.files}`,
        savedAndroid: `📥 Фото збережено в галерею: ${info.files}`,
        nofiles: '📋 У вибраних товарів немає фото',
        error: '❌ Не вдалося відкрити меню «Поділитися»'
    };
    const hints = {
        shared: 'Текст із цінами скопійовано — у чаті клієнта утримайте поле вводу і натисніть «Вставити».',
        ready: 'Натисніть «Поділитися фото» → Instagram → чат клієнта. Текст із цінами вже скопійовано.',
        downloaded: 'Текст скопійовано. Відкрийте Instagram, вставте текст і додайте збережені фото.',
        savedAndroid: `1. Відкрийте чат клієнта в Instagram.\n2. Натисніть іконку галереї та відмітьте ${info.files} останніх фото → надішліть.\n3. Утримайте поле вводу → «Вставити» (текст із цінами вже скопійовано).`,
        nofiles: 'Текст скопійовано — вставте його в чат клієнта.',
        error: `Спробуйте ще раз. ${info.message || ''}`
    };
    let hint = hints[state];
    if (!info.copied) hint += '\n⚠️ Текст не скопіювався автоматично — натисніть «Скопіювати текст».';
    if (info.failed) hint += `\n⚠️ Не вдалося завантажити фото: ${info.failed}.`;

    document.getElementById('share-title').innerText = titles[state];
    document.getElementById('share-hint').innerText = hint;
    document.getElementById('share-preview').innerText = lastShareText;

    const againBtn = document.getElementById('share-again-btn');
    const showAgain = (state === 'ready' || state === 'error' || state === 'shared') && pendingShareFiles.length > 0;
    againBtn.style.display = showAgain ? 'block' : 'none';
    againBtn.innerText = state === 'shared' ? '📤 Поділитися ще раз' : '📤 Поділитися фото';
    againBtn.classList.toggle('primary', state !== 'shared');

    document.getElementById('share-sheet').hidden = false;
}

function closeShareSheet() {
    document.getElementById('share-sheet').hidden = true;
}

// Відправлено — очищаємо екран для наступного клієнта
function finishShare() {
    closeShareSheet();
    photoFiles.clear();
    pendingShareFiles = [];
    resetFilters();
}

// =====================================================================
// ВХІД В АДМІНКУ (Supabase Auth)
// =====================================================================

function showScreen(id) {
    ['seller-screen', 'login-screen', 'admin-screen'].forEach(s =>
        document.getElementById(s).classList.toggle('active', s === id));
    if (id === 'seller-screen') updateActionBar();
    else document.getElementById('action-bar').style.display = 'none';
}

// Кнопка ⚙️: з вітрини — в адмінку (або на вхід), з адмінки/входу — назад у вітрину
async function toggleAdmin() {
    if (!document.getElementById('seller-screen').classList.contains('active')) {
        showScreen('seller-screen');
        return;
    }
    const { data: { session } } = await db.auth.getSession();
    if (session) {
        openAdmin(session);
    } else {
        document.getElementById('login-status').innerText = '';
        showScreen('login-screen');
        document.getElementById('login-email').focus();
    }
}

function openAdmin(session) {
    document.getElementById('admin-user').innerText = `👤 ${session.user.email}`;
    showScreen('admin-screen');
    refreshStorageUsage();
    refreshMissingPhotos();
}

async function doLogin(event) {
    event.preventDefault();
    const btn = document.getElementById('login-btn');
    const statusDiv = document.getElementById('login-status');
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    btn.disabled = true;
    statusDiv.innerText = '⏳ Вхід...';
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    btn.disabled = false;

    if (error) {
        statusDiv.innerText = /invalid/i.test(error.message)
            ? '❌ Невірний email або пароль.'
            : `❌ Помилка входу: ${error.message}`;
        return;
    }
    statusDiv.innerText = '';
    document.getElementById('login-password').value = '';
    openAdmin(data.session);
}

async function doLogout() {
    await db.auth.signOut();
    showScreen('seller-screen');
}

// Якщо сесія закінчилась, поки відкрита адмінка, — повертаємо на вхід
db.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_OUT' && document.getElementById('admin-screen').classList.contains('active')) {
        showScreen('login-screen');
    }
});

// =====================================================================
// ІМПОРТ ЕКСПОРТУ ТОРГСОФТУ: перевірка -> застосування однією транзакцією
// =====================================================================

const EXCLUDED_CATEGORIES = ['Піжама'];   // ці товари не імпортуються взагалі
const IMPORT_MIN_RATIO = 0.8;             // файл має містити ≥80% товарів, що зараз у наявності
const SIZE_LABELS = {
    0: '0 (0-1 рік)', 1: '1 (1-2 роки)', 2: '2 (3-4 роки)', 3: '3 (5-6 років)', 4: '4 (7-8 років)',
    5: '5 (9-10 років)', 6: '6 (11-12 років)', 7: '7 (13-14 років)', 8: '8 (15-16 років)'
};

let pendingImport = null; // { rows, canApply }

function cleanText(v) {
    if (v === undefined || v === null) return '';
    return String(v).replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
}

// Чистка кольору з експорту (порожній -> null, "мята" -> "М'ята")
function cleanColor(v) {
    let s = cleanText(v).replace(/[ʼ’‘`´]/g, "'");
    if (!s || s.toLowerCase() === 'undefined') return null;
    s = s.replace(/м'?ята/gi, m => (m[0] === 'М' ? "М'ята" : "м'ята"));
    return s;
}

function readExcelRows(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => {
            try {
                const workbook = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
                const sheet = workbook.Sheets[workbook.SheetNames[0]];
                resolve(XLSX.utils.sheet_to_json(sheet, { range: 2 })); // заголовки в 3-му рядку
            } catch (err) { reject(err); }
        };
        reader.onerror = () => reject(new Error('не вдалося прочитати файл'));
        reader.readAsArrayBuffer(file);
    });
}

// Рядки експорту -> записи для бази + список зауважень
function parseExportRows(rawRows) {
    const rows = [];
    const notes = { excluded: [], fixedSize: [], badSku: [], noColor: [], unknownGender: [], badPrice: [], invalid: [], dupKeys: [] };
    const seenKeys = new Map();

    rawRows.forEach((r, i) => {
        const excelRow = i + 4; // номер рядка в Excel
        const name = cleanText(r['Назва товару']);
        const sku = cleanText(r['Артикул']);
        if (!name || !sku) return; // підсумкові рядки ("Виконавець" тощо)

        const kind = cleanText(r['Вид товару']);
        if (EXCLUDED_CATEGORIES.includes(kind) || /піжам/i.test(name)) {
            notes.excluded.push(`${sku} — ${name}`);
            return;
        }

        const rawSize = cleanText(r['Розмір']);
        const sizeMatch = rawSize.match(/^(\d+)/);
        if (!sizeMatch) { notes.invalid.push(`Рядок ${excelRow}: ${sku} — немає числа розміру («${rawSize}»)`); return; }
        const sizeIndex = parseInt(sizeMatch[1], 10);

        let sizeName = rawSize;
        if (SIZE_LABELS[sizeIndex] !== undefined) {
            sizeName = SIZE_LABELS[sizeIndex];
            if (rawSize !== sizeName) notes.fixedSize.push(`${sku}: «${rawSize}» → «${sizeName}»`);
        }

        if (/^[^_]+_\s*_/.test(sku)) notes.badSku.push(`${sku} (розмір ${sizeName})`);

        const lower = name.toLowerCase();
        let gender = 'Невідомо';
        if (lower.includes('хлоп')) gender = 'Хлопчик';
        if (lower.includes('дів')) gender = 'Дівчинка';
        if (gender === 'Невідомо') notes.unknownGender.push(`${sku} — ${name}`);

        let category = kind || 'Інше';
        if (category.startsWith('Комплект')) category = 'Комплекти';

        const color = cleanColor(r['Колір']);
        if (!color) notes.noColor.push(`${sku} — ${name}`);

        const price = parseFloat(String(r['Ціна роздрібна']).replace(',', '.'));
        const stock = parseInt(r['Кількість'], 10);
        if (!(price > 0)) notes.badPrice.push(`${sku} — ціна «${r['Ціна роздрібна']}»`);

        const importKey = `${sku}|${sizeIndex}`;
        if (seenKeys.has(importKey)) {
            notes.dupKeys.push(`${importKey}: рядки ${seenKeys.get(importKey)} і ${excelRow}`);
            return;
        }
        seenKeys.set(importKey, excelRow);

        rows.push({
            import_key: importKey,
            base_model: sku.split('_')[0].trim(),
            sku,
            name,
            gender,
            category,
            size_name: sizeName,
            size_index: sizeIndex,
            color,
            price: price > 0 ? price : 0,
            stock: Number.isFinite(stock) ? stock : 0
        });
    });
    return { rows, notes };
}

function describeProduct(p) {
    return `${p.base_model} ${p.color || 'без кольору'}, розмір ${p.size_index}`;
}

async function previewImport() {
    const fileInput = document.getElementById('excel-file');
    const statusDiv = document.getElementById('upload-status');
    const reportDiv = document.getElementById('import-report');
    const applyBtn = document.getElementById('import-apply-btn');
    const checkBtn = document.getElementById('import-check-btn');

    pendingImport = null;
    applyBtn.style.display = 'none';
    reportDiv.innerHTML = '';
    if (!fileInput.files.length) { alert('Оберіть файл експорту з ТоргСофту!'); return; }

    checkBtn.disabled = true;
    statusDiv.style.color = '#2C2C35';
    statusDiv.innerText = '⏳ Читаємо файл і порівнюємо з базою...';

    try {
        const [rawRows, dbRows] = await Promise.all([
            readExcelRows(fileInput.files[0]),
            fetchAllProducts('import_key, base_model, sku, name, gender, category, size_name, size_index, color, price, stock')
        ]);
        const { rows, notes } = parseExportRows(rawRows);
        if (!rows.length) throw new Error('у файлі не знайдено жодного товару. Це точно експорт залишків?');

        const dbByKey = new Map(dbRows.map(p => [p.import_key, p]));
        const fileKeys = new Set(rows.map(r => r.import_key));
        const added = [], changed = [], otherChanged = [];
        let unchanged = 0;

        rows.forEach(r => {
            const old = dbByKey.get(r.import_key);
            if (!old) { added.push(`${describeProduct(r)} — ${r.price} грн, ${r.stock} шт`); return; }
            const diffs = [];
            if (Number(old.price) !== r.price) diffs.push(`ціна ${old.price} → ${r.price}`);
            if ((old.stock || 0) !== r.stock) diffs.push(`залишок ${old.stock || 0} → ${r.stock}`);
            if (diffs.length) { changed.push(`${describeProduct(r)}: ${diffs.join(', ')}`); return; }
            const fields = ['base_model', 'sku', 'name', 'gender', 'category', 'size_name', 'size_index', 'color'];
            if (fields.some(f => (old[f] ?? null) !== (r[f] ?? null))) otherChanged.push(describeProduct(r));
            else unchanged++;
        });

        const zeroed = dbRows
            .filter(p => (p.stock || 0) > 0 && !fileKeys.has(p.import_key))
            .map(p => `${describeProduct(p)} — було ${p.stock} шт`);

        const inStock = dbRows.filter(p => (p.stock || 0) > 0).length;
        const tooSmall = inStock > 0 && rows.length < inStock * IMPORT_MIN_RATIO;
        const hasDup = notes.dupKeys.length > 0;

        let summary = `📄 У файлі товарів: ${rows.length} (у базі зараз в наявності: ${inStock})\n` +
            `🆕 Нових: ${added.length}\n✏️ Змінились ціна/залишок: ${changed.length}\n` +
            `🔧 Інші уточнення (назва, розмір, колір): ${otherChanged.length}\n` +
            `0️⃣ Немає у файлі, обнуляться: ${zeroed.length}\n✔️ Без змін: ${unchanged}`;

        if (tooSmall) {
            summary += `\n\n⛔ У файлі менше ${Math.round(IMPORT_MIN_RATIO * 100)}% товарів, що зараз у наявності. Схоже, файл неповний — застосування заблоковано.`;
        } else if (hasDup) {
            summary += `\n\n⛔ У файлі є однакові артикули з однаковим розміром — застосування заблоковано, див. список нижче.`;
        }
        statusDiv.style.color = (tooSmall || hasDup) ? '#FF3B30' : '#2C2C35';
        statusDiv.innerText = summary;

        renderReport(reportDiv, [
            { title: '⛔ Однакові ключі у файлі', items: notes.dupKeys, cls: 'bad', open: true },
            { title: '⛔ Рядки без розміру (пропущено)', items: notes.invalid, cls: 'bad', open: true },
            { title: '0️⃣ Обнуляться (немає у файлі)', items: zeroed, cls: 'warn' },
            { title: '🆕 Нові', items: added },
            { title: '✏️ Змінились ціна/залишок', items: changed },
            { title: '🔧 Інші уточнення', items: otherChanged },
            { title: '⚠️ Артикул без індексу розміру', items: notes.badSku, cls: 'warn' },
            { title: '⚠️ Без кольору', items: notes.noColor, cls: 'warn' },
            { title: '⚠️ Не визначено стать', items: notes.unknownGender, cls: 'warn' },
            { title: '⚠️ Ціна 0 або не число', items: notes.badPrice, cls: 'warn' },
            { title: '✍️ Виправлено підпис розміру', items: notes.fixedSize },
            { title: '🚫 Пропущено (піжами)', items: notes.excluded }
        ]);

        if (!tooSmall && !hasDup) {
            pendingImport = { rows };
            applyBtn.style.display = 'block';
        }
    } catch (e) {
        console.error(e);
        statusDiv.style.color = '#FF3B30';
        statusDiv.innerText = `❌ Помилка: ${e.message || e}`;
    } finally {
        checkBtn.disabled = false;
    }
}

async function applyImport() {
    if (!pendingImport) return;
    const statusDiv = document.getElementById('upload-status');
    const applyBtn = document.getElementById('import-apply-btn');
    const checkBtn = document.getElementById('import-check-btn');

    applyBtn.disabled = true;
    checkBtn.disabled = true;
    statusDiv.style.color = '#2C2C35';
    statusDiv.innerText = '⏳ Записуємо в базу однією операцією...';

    try {
        const { data, error } = await db.rpc('import_products', { p_rows: pendingImport.rows });
        if (error) throw error;
        statusDiv.style.color = '#34C759';
        statusDiv.innerText = `🎉 Базу оновлено! У файлі: ${data.in_file}, нових: ${data.inserted}, ` +
            `оновлено: ${data.updated}, обнулено: ${data.zeroed}.`;
        document.getElementById('import-report').innerHTML = '';
        applyBtn.style.display = 'none';
        pendingImport = null;
        loadProducts();
    } catch (e) {
        console.error(e);
        statusDiv.style.color = '#FF3B30';
        statusDiv.innerText = `❌ База не змінилась. Помилка: ${e.message || e}`;
    } finally {
        applyBtn.disabled = false;
        checkBtn.disabled = false;
    }
}

function resetImportPreview() {
    pendingImport = null;
    document.getElementById('import-apply-btn').style.display = 'none';
    document.getElementById('import-report').innerHTML = '';
    document.getElementById('upload-status').innerText = '';
}

// =====================================================================
// ФОТО: стиснення, постійні імена файлів, звіт, розмір сховища, зайві файли
// =====================================================================

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatSize(bytes) {
    return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} МБ` : `${Math.round(bytes / 1024)} КБ`;
}

// Латинські літери, схожі на кириллицю (напр. "cиній" з латинською c)
const LATIN_LOOKALIKES = { a: 'а', c: 'с', e: 'е', i: 'і', o: 'о', p: 'р', x: 'х', y: 'у', k: 'к' };

// Мінімальна нормалізація кольору (повний словник кольорів — етап 3)
function normColor(value) {
    let s = String(value || '').replace(/\u00A0/g, ' ').toLowerCase();
    s = s.replace(/[ʼ’‘`´]/g, "'");
    if (/[а-яіїєґ]/.test(s)) s = s.replace(/[aceiopxyk]/g, ch => LATIN_LOOKALIKES[ch]);
    s = s.replace(/мята/g, "м'ята").replace(/прінт/g, 'принт');
    s = s.replace(/[^a-zа-яіїєґё0-9'\s-]/g, ' ');
    s = s.replace(/-/g, ' '); // "світло сірий" = "світло-сірий"
    return s.replace(/\s+/g, ' ').trim();
}

// Транслітерація для імені файлу (Supabase не приймає кирилицю в іменах)
const TRANSLIT = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'h', 'ґ': 'g', 'д': 'd', 'е': 'e', 'є': 'ie', 'ж': 'zh', 'з': 'z',
    'и': 'y', 'і': 'i', 'ї': 'i', 'й': 'i', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p',
    'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch',
    'ь': '', 'ю': 'iu', 'я': 'ia', 'ы': 'y', 'э': 'e', 'ъ': '', 'ё': 'io', "'": ''
};

function slugify(s) {
    const t = Array.from(String(s).toLowerCase()).map(ch => (ch in TRANSLIT ? TRANSLIT[ch] : ch)).join('');
    return t.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
}

// "2332(сірий).png" -> { baseModel: '2332', color: 'сірий' } або { error }
function parsePhotoName(fileName) {
    const dot = fileName.lastIndexOf('.');
    const ext = dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : '';
    if (ext === 'heic' || ext === 'heif') return { error: 'формат HEIC, сконвертуйте в JPG' };
    const open = fileName.indexOf('(');
    if (open < 0) return { error: 'немає "(колір)" у назві' };
    const close = fileName.indexOf(')', open);
    if (close < 0) return { error: 'немає закриваючої дужки ")"' };
    const baseModel = fileName.slice(0, open).trim();
    if (!baseModel) return { error: 'немає артикулу перед дужкою' };
    const rawColor = fileName.slice(open + 1, close);
    if (rawColor.includes(',')) return { error: 'кілька кольорів в одному фото' };
    const color = normColor(rawColor);
    if (!color) return { error: 'порожній колір у дужках' };
    return { baseModel, color };
}

async function decodeImage(file) {
    if ('createImageBitmap' in window) {
        try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* пробуємо через <img> */ }
    }
    return await new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('браузер не може прочитати це зображення')); };
        img.src = url;
    });
}

// Зменшує до PHOTO_MAX_SIDE і зберігає як JPEG; прозорий фон заливається білим
async function compressImage(file) {
    const img = await decodeImage(file);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(w, h));
    const cw = Math.round(w * scale);
    const ch = Math.round(h * scale);

    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, cw, ch);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, cw, ch);
    if (img.close) img.close();

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', PHOTO_QUALITY));
    if (!blob) throw new Error('не вдалося стиснути зображення');
    return blob;
}

async function listAllStorageFiles() {
    const files = [];
    const limit = 1000;
    let offset = 0;
    while (true) {
        const { data, error } = await db.storage.from(PHOTO_BUCKET)
            .list('', { limit, offset, sortBy: { column: 'name', order: 'asc' } });
        if (error) throw error;
        data.forEach(f => {
            if (f.id && !f.name.startsWith('.')) files.push({ name: f.name, size: (f.metadata && f.metadata.size) || 0 });
        });
        if (data.length < limit) break;
        offset += limit;
    }
    return files;
}

async function removeStorageFiles(paths) {
    let removed = 0;
    for (let i = 0; i < paths.length; i += 100) {
        const { data, error } = await db.storage.from(PHOTO_BUCKET).remove(paths.slice(i, i + 100));
        if (error) throw error;
        removed += (data || []).length;
    }
    return removed;
}

async function refreshStorageUsage() {
    const el = document.getElementById('storage-usage');
    el.className = 'storage-usage';
    el.innerText = '⏳ Рахуємо розмір сховища...';
    try {
        const files = await listAllStorageFiles();
        const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
        const totalMb = totalBytes / 1048576;
        const ratio = totalMb / STORAGE_LIMIT_MB;
        let text = `📦 Сховище фото: ${totalMb.toFixed(1)} МБ з ${STORAGE_LIMIT_MB} МБ (${Math.round(ratio * 100)}%) • файлів: ${files.length}`;
        if (ratio >= STORAGE_WARN_RATIO) {
            el.classList.add('warn');
            text += `\n⚠️ Зайнято понад ${Math.round(STORAGE_WARN_RATIO * 100)}% ліміту. Видаліть зайві файли (блок 4).`;
        }
        el.innerText = text;
    } catch (e) {
        console.error(e);
        el.classList.add('warn');
        el.innerText = '❌ Не вдалося отримати розмір сховища.';
    }
}

function renderReport(container, sections) {
    container.innerHTML = sections
        .filter(s => s.items.length)
        .map(s => `
            <details class="report-block ${s.cls || ''}" ${s.open ? 'open' : ''}>
                <summary>${s.title}: ${s.items.length}</summary>
                <ul>${s.items.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
            </details>`)
        .join('');
}

async function fetchPhotoPaths() {
    const { data, error } = await db.from('photos').select('path').range(0, 9999);
    if (error) throw error;
    return new Set(data.map(r => r.path));
}

async function uploadPhotosToSupabase() {
    const fileInput = document.getElementById('photo-files');
    const statusDiv = document.getElementById('photo-status');
    const reportDiv = document.getElementById('photo-report');
    const btn = document.getElementById('photo-upload-btn');

    if (!fileInput.files.length) { alert("Оберіть фотографії!"); return; }
    const files = Array.from(fileInput.files);

    btn.disabled = true;
    reportDiv.innerHTML = '';
    statusDiv.style.color = '#00C2FF';
    statusDiv.innerText = '⏳ Отримання списку товарів...';

    const report = { uploaded: [], skipped: [], noMatch: [], duplicates: [], failed: [] };

    try {
        const [products, photoMap] = await Promise.all([fetchAllProducts('base_model, color'), fetchPhotoMap()]);
        const productKeys = new Set(products.map(p => photoKey(p.base_model, normColor(p.color))));

        // 1. План: тільки ТОЧНИЙ збіг "модель + колір"; один файл на ключ
        const byKey = new Map();
        for (const file of files) {
            const parsed = parsePhotoName(file.name);
            if (parsed.error) { report.skipped.push(`${file.name} — ${parsed.error}`); continue; }
            const key = photoKey(parsed.baseModel, parsed.color);
            if (!productKeys.has(key)) { report.noMatch.push(file.name); continue; }
            if (byKey.has(key)) report.duplicates.push(`${byKey.get(key).file.name} замінено на ${file.name}`);
            byKey.set(key, { file, ...parsed, key, path: `${slugify(parsed.baseModel)}__${slugify(parsed.color)}.jpg` });
        }
        const toUpload = [...byKey.values()];

        // 2. Стискаємо, завантажуємо, записуємо в таблицю photos
        const oldPaths = new Set();
        let uploadedBytes = 0;
        for (let i = 0; i < toUpload.length; i++) {
            const c = toUpload[i];
            statusDiv.innerText = `⏳ ${i + 1} з ${toUpload.length}: ${c.file.name}`;
            try {
                const blob = await compressImage(c.file);
                const { error: upErr } = await db.storage.from(PHOTO_BUCKET)
                    .upload(c.path, blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: true });
                if (upErr) throw upErr;

                const { error: dbErr } = await db.from('photos').upsert(
                    { base_model: c.baseModel, color_key: c.color, path: c.path, updated_at: new Date().toISOString() },
                    { onConflict: 'base_model,color_key' });
                if (dbErr) throw dbErr;

                const prev = photoMap.get(c.key);
                if (prev && prev.path !== c.path) oldPaths.add(prev.path);
                uploadedBytes += blob.size;
                report.uploaded.push(`${c.file.name} → ${c.path} (${formatSize(blob.size)})`);
            } catch (e) {
                console.error('Помилка для', c.file.name, e);
                report.failed.push(`${c.file.name} — ${e.message || e}`);
            }
        }

        // 3. Старі файли цих ключів, на які більше ніщо не посилається
        let removed = 0;
        if (oldPaths.size) {
            const referenced = await fetchPhotoPaths();
            removed = await removeStorageFiles([...oldPaths].filter(p => !referenced.has(p)));
        }

        statusDiv.style.color = '#34C759';
        statusDiv.innerText = `🎉 Готово! Завантажено фото: ${report.uploaded.length} (${formatSize(uploadedBytes)}), видалено старих файлів: ${removed}.`;
    } catch (e) {
        console.error(e);
        statusDiv.style.color = '#FF3B30';
        statusDiv.innerText = `❌ Помилка: ${e.message || e}`;
    } finally {
        renderReport(reportDiv, [
            { title: '❌ Помилки завантаження', items: report.failed, cls: 'bad', open: true },
            { title: '⏭ Пропущено (назва файлу)', items: report.skipped, cls: 'warn', open: true },
            { title: '❓ Немає товару з такою моделлю й кольором', items: report.noMatch, cls: 'warn', open: true },
            { title: '🔁 Дублі в пачці (взято останній)', items: report.duplicates, cls: 'warn' },
            { title: '✅ Завантажено', items: report.uploaded }
        ]);
        btn.disabled = false;
        refreshStorageUsage();
        refreshMissingPhotos();
    }
}

// --- Товари в наявності без фото ---
async function refreshMissingPhotos() {
    const statusDiv = document.getElementById('missing-status');
    const reportDiv = document.getElementById('missing-report');
    statusDiv.style.color = '#2C2C35';
    statusDiv.innerText = '⏳ Рахуємо...';
    reportDiv.innerHTML = '';

    await loadProducts();
    const groups = new Map();
    allProducts.filter(p => (p.stock || 0) > 0 && !p.photo_url).forEach(p => {
        const key = photoKey(p.base_model, normColor(p.color));
        if (!groups.has(key)) groups.set(key, { base: p.base_model, color: p.color, stock: 0, sizes: new Set() });
        const g = groups.get(key);
        g.stock += p.stock;
        if (p.size_index !== null) g.sizes.add(p.size_index);
    });

    const list = [...groups.values()]
        .sort((a, b) => b.stock - a.stock)
        .map(g => `${g.base}(${g.color || 'без кольору'}) — ${g.stock} шт, розміри ${[...g.sizes].sort((x, y) => x - y).join(', ')}`);

    if (!list.length) {
        statusDiv.style.color = '#34C759';
        statusDiv.innerText = '✅ У всіх товарів у наявності є фото.';
        return;
    }
    statusDiv.innerText = `Моделей і кольорів без фото: ${list.length}. Назва файлу для кожного вже готова — як у списку.`;
    renderReport(reportDiv, [{ title: '📷 Без фото (спочатку ті, яких найбільше)', items: list, cls: 'warn', open: true }]);
}

// --- Зайві файли (ні на що не посилаються) ---
let orphanPaths = [];

async function findReferencedPaths() {
    const paths = await fetchPhotoPaths();
    if (!paths.size) throw new Error('таблиця фото порожня — спочатку завантажте фото, перевірку зупинено');
    return paths;
}

async function findOrphans() {
    const statusDiv = document.getElementById('orphan-status');
    const reportDiv = document.getElementById('orphan-report');
    const deleteBtn = document.getElementById('orphan-delete-btn');
    const findBtn = document.getElementById('orphan-find-btn');

    findBtn.disabled = true;
    deleteBtn.style.display = 'none';
    reportDiv.innerHTML = '';
    statusDiv.style.color = '#2C2C35';
    statusDiv.innerText = '⏳ Перевіряємо сховище...';

    try {
        const [files, referenced] = await Promise.all([listAllStorageFiles(), findReferencedPaths()]);
        const orphans = files.filter(f => !referenced.has(f.name));
        orphanPaths = orphans.map(f => f.name);

        if (!orphans.length) {
            statusDiv.style.color = '#34C759';
            statusDiv.innerText = `✅ Зайвих файлів немає (усього файлів: ${files.length}).`;
            return;
        }
        const bytes = orphans.reduce((s, f) => s + f.size, 0);
        statusDiv.innerText = `Знайдено зайвих файлів: ${orphans.length} (${formatSize(bytes)}).`;
        renderReport(reportDiv, [{ title: '🗂 Зайві файли', items: orphans.map(f => `${f.name} (${formatSize(f.size)})`) }]);
        deleteBtn.style.display = 'block';
    } catch (e) {
        console.error(e);
        statusDiv.style.color = '#FF3B30';
        statusDiv.innerText = `❌ Помилка: ${e.message || e}`;
    } finally {
        findBtn.disabled = false;
    }
}

async function deleteOrphans() {
    if (!orphanPaths.length) return;
    if (!confirm(`Видалити ${orphanPaths.length} зайвих файлів? Відновити їх буде неможливо.`)) return;

    const statusDiv = document.getElementById('orphan-status');
    const deleteBtn = document.getElementById('orphan-delete-btn');
    deleteBtn.disabled = true;
    statusDiv.innerText = '🧹 Видаляємо...';

    try {
        // Повторна перевірка: раптом за цей час якийсь файл знову прив'язали
        const referenced = await findReferencedPaths();
        const safe = orphanPaths.filter(p => !referenced.has(p));
        const removed = await removeStorageFiles(safe);
        statusDiv.style.color = '#34C759';
        statusDiv.innerText = `✅ Видалено файлів: ${removed}.`;
        document.getElementById('orphan-report').innerHTML = '';
        deleteBtn.style.display = 'none';
        orphanPaths = [];
    } catch (e) {
        console.error(e);
        statusDiv.style.color = '#FF3B30';
        statusDiv.innerText = `❌ Помилка: ${e.message || e}`;
    } finally {
        deleteBtn.disabled = false;
        refreshStorageUsage();
    }
}

window.onload = () => loadProducts();