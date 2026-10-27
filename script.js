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
let selectedProducts = new Set();
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
    filters.gender = null; filters.categories.clear(); filters.size = null; selectedProducts.clear();
    document.querySelectorAll('.big-btn').forEach(btn => btn.classList.remove('active'));
    updateActionBar(); renderProducts();
}

function getFilteredProducts() {
    let filtered = allProducts.filter(p => p.stock > 0);
    if (filters.gender) filtered = filtered.filter(p => p.gender === filters.gender);
    if (filters.categories.size > 0) filtered = filtered.filter(p => filters.categories.has(p.category));
    if (filters.size) filtered = filtered.filter(p => p.size_index === parseInt(filters.size));
    // Товари без фото — в самий кінець (sort стабільний, порядок решти не змінюється)
    filtered.sort((a, b) => (a.photo_url ? 0 : 1) - (b.photo_url ? 0 : 1));
    return filtered;
}

function selectAllFiltered() {
    const filtered = getFilteredProducts();
    if (filtered.length === 0) return;
    
    const limit = 10;
    const toAdd = filtered.slice(0, limit);
    toAdd.forEach(p => selectedProducts.add(p.id));
    
    updateActionBar();
    renderProducts();
    
    if (filtered.length > limit) {
        alert("Обрано перші 10 товарів (це ліміт для одного повідомлення в Інстаграм).");
    }
}

function renderProducts() {
    const container = document.getElementById('products-container');
    const catalogTitle = document.getElementById('catalog-title');

    if (!filters.gender && filters.categories.size === 0 && !filters.size) {
        container.innerHTML = '<div class="empty-state">👆 Оберіть фільтри вище, щоб побачити товари</div>';
        catalogTitle.innerText = 'Знайдені товари';
        return;
    }

    const filtered = getFilteredProducts();
    catalogTitle.innerText = `Знайдені товари (${filtered.length} шт.)`;

    if (filtered.length === 0) {
        container.innerHTML = '<div class="empty-state">Товарів за цим запитом немає 😔</div>';
        return;
    }

    container.innerHTML = '';
    filtered.forEach(p => {
        const priceClass = p.gender === 'Дівчинка' ? 'girl-price' : 'boy-price';
        const stockClass = p.stock > 2 ? 'stock-ok' : 'stock-low';
        const isSelected = selectedProducts.has(p.id);
        const photoSrc = p.photo_url || 'https://via.placeholder.com/300x300?text=Немає+фото';

        const card = document.createElement('div');
        card.className = 'product-card';
        card.innerHTML = `
            <img src="${photoSrc}" loading="lazy" class="product-img" alt="${p.name}">
            <div class="product-info">
                <div class="p-meta">Арт. ${p.base_model} • ${p.color || ''}</div>
                <div class="p-size">Розмір: ${p.size_name}</div>
                <div class="p-price ${priceClass}">${p.price} грн</div>
                <div class="product-stock ${stockClass}">В наявності: ${p.stock} шт</div>
                <button class="select-btn ${isSelected ? 'selected' : ''}" onclick="toggleSelect('${p.id}')">
                    ${isSelected ? '✅ ОБРАНО' : '+ Додати'}
                </button>
            </div>
        `;
        container.appendChild(card);
    });
}

function toggleSelect(id) {
    if (selectedProducts.has(id)) {
        selectedProducts.delete(id);
    } else {
        if (selectedProducts.size >= 10) { alert("⚠️ Максимум 10 фото за раз!"); return; }
        selectedProducts.add(id);
    }
    updateActionBar(); renderProducts();
}

function updateActionBar() {
    const bar = document.getElementById('action-bar');
    document.getElementById('selected-count').innerText = selectedProducts.size;
    bar.style.display = selectedProducts.size > 0 ? 'flex' : 'none';
}

async function shareToInstagram() {
    if (selectedProducts.size === 0) return;
    const actionBtn = document.querySelector('.share-btn');
    const originalText = actionBtn.innerText;
    actionBtn.innerText = "⏳ Завантажуємо..."; 
    actionBtn.disabled = true;

    let textToCopy = "Вітаємо! Ось що є в наявності за вашим запитом:\n\n";
    let downloadedCount = 0;

    try {
        for (let id of selectedProducts) {
            let p = allProducts.find(x => x.id === id);
            textToCopy += `▪️ Арт. ${p.base_model} (${p.color}), розмір ${p.size_name} — ${p.price} грн\n`;
            
            if (p.photo_url) {
                try {
                    // Витягуємо фото з сервера і перетворюємо на файл для завантаження
                    const response = await fetch(p.photo_url);
                    const blob = await response.blob();
                    const blobUrl = URL.createObjectURL(blob);
                    
                    // Створюємо невидиме посилання для авто-збереження в галерею
                    const link = document.createElement('a');
                    link.href = blobUrl;
                    link.download = `${p.base_model}_${p.color}.jpg`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(blobUrl);
                    
                    downloadedCount++;
                    // Невелика пауза, щоб браузер не заблокував масове завантаження
                    await new Promise(resolve => setTimeout(resolve, 300));
                } catch (e) {
                    console.error("Помилка завантаження фото", e);
                }
            }
        }
        
        // Копіюємо текст у буфер обміну
        await navigator.clipboard.writeText(textToCopy);
        
        alert(`✅ Текст із цінами скопійовано!\n📥 Збережено в галерею фото: ${downloadedCount} шт.\n\nПерейдіть в Instagram, вставте текст і додайте фото.`);
        
    } catch (err) { 
        alert("Виникла помилка при копіюванні тексту."); 
    } finally { 
        actionBtn.innerText = originalText; 
        actionBtn.disabled = false; 
        resetFilters(); 
    }
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