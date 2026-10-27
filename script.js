const SUPABASE_URL = 'https://ckivnxtnjdnonjavsgon.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNraXZueHRuamRub25qYXZzZ29uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIzNjA4NDIsImV4cCI6MjEwNzkzNjg0Mn0.jrHwOdeFZrOlwfl7FEyn2JStn8DQ3m4GeRHlHbgBBwU';
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

async function loadProducts() {
    try {
        allProducts = await fetchAllProducts('*');
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

function toggleAdmin() {
    const adminScreen = document.getElementById('admin-screen');
    const sellerScreen = document.getElementById('seller-screen');
    const actionBar = document.getElementById('action-bar');

    // Якщо адмінка закрита і ми хочемо в неї зайти
    if (!adminScreen.classList.contains('active')) {
        const pass = prompt("Введіть пароль для доступу до бази даних:");
        
        // Твій пароль. Можеш змінити "1234" на щось інше.
        if (pass === "2026") {
            sellerScreen.classList.remove('active');
            actionBar.style.display = 'none'; // Ховаємо кошик
            adminScreen.classList.add('active');
            refreshStorageUsage();
        } else if (pass !== null) {
            alert("❌ Невірний пароль!");
        }
    } else {
        // Якщо ми хочемо ВИЙТИ з адмінки назад у вітрину
        adminScreen.classList.remove('active');
        sellerScreen.classList.add('active');
        updateActionBar(); // Повертаємо кошик, якщо там щось є
    }
}

// Функції адмінки
// Функції адмінки
async function processExcel() {
    const fileInput = document.getElementById('excel-file');
    const statusDiv = document.getElementById('upload-status');
    
    if (!fileInput.files.length) { alert("Оберіть файл БілизнаЦіни.xlsx!"); return; }

    statusDiv.innerText = "⏳ Обробка файлу... не закривайте сторінку.";
    statusDiv.style.color = "#FF2A85";
    
    const file = fileInput.files[0];
    const reader = new FileReader();
    
    reader.onload = async function(e) {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, {type: 'array'});
        const firstSheetName = workbook.SheetNames[0];
        
        // Читаємо з 3-го рядка
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], { range: 2 });
        let toUpsert = [];
        let seenSkus = new Set(); // Трекер унікальності артикулів

        rows.forEach(row => {
            if (!row['Назва товару'] || !row['Артикул']) return;

            let original_sku = String(row['Артикул']).trim();
            let base_model = original_sku.split('_')[0];
            let name = row['Назва товару'];
            
            let gender = 'Невідомо';
            if (name.toLowerCase().includes('хлоп')) gender = 'Хлопчик';
            if (name.toLowerCase().includes('дів')) gender = 'Дівчинка';

            let cat = row['Вид товару'] ? String(row['Вид товару']).trim() : 'Інше';
            if (cat.startsWith('Комплект')) cat = 'Комплекти';
            if (name.toLowerCase().includes('піжама')) cat = 'Комплекти'; // Додатково страхуємо піжами

            let size_name = row['Розмір'] || 'Не вказано';
            let size_index = null;
            let sizeStr = String(size_name).trim();
            if (sizeStr[0] && !isNaN(sizeStr[0])) {
                size_index = parseInt(sizeStr[0]);
            } else {
                let parts = original_sku.split('_');
                if (parts.length > 1 && !isNaN(parts[1])) size_index = parseInt(parts[1]);
            }

            // ЗАХИСТ ВІД ПОМИЛОК ТОРГСОФТУ (однакові артикули):
            let sku = original_sku;
            if (seenSkus.has(sku)) {
                let sizeSuffix = size_index !== null ? size_index : sizeStr.replace(/\s+/g, '');
                sku = `${sku}_${sizeSuffix}`;
                if (seenSkus.has(sku)) sku = `${sku}_${Math.floor(Math.random() * 1000)}`;
            }
            seenSkus.add(sku);

            toUpsert.push({
                base_model: base_model,
                sku: sku, // Тепер гарантовано унікальний
                name: name,
                gender: gender,
                category: cat,
                size_name: String(size_name),
                size_index: size_index,
                color: String(row['Колір']).replace('мята', "М'ята").replace('мʼята', "М'ята").trim(),
                price: parseFloat(row['Ціна роздрібна']) || 0,
                stock: parseInt(row['Кількість']) || 0
            });
        });

        statusDiv.innerText = `✅ Знайдено ${toUpsert.length} позицій. Завантажуємо...`;

        for (let i = 0; i < toUpsert.length; i += 100) {
            const chunk = toUpsert.slice(i, i + 100);
            const { error } = await db.from('products').upsert(chunk, { onConflict: 'sku' });
            if (error) {
                console.error(error);
                statusDiv.innerText = `❌ Помилка на ${i}-му рядку!`;
                statusDiv.style.color = "red";
                return;
            }
        }

        statusDiv.innerText = `🎉 База успішно оновлена! Завантажено: ${toUpsert.length} шт.`;
        statusDiv.style.color = "#34C759";
        loadProducts();
    };
    reader.readAsArrayBuffer(file);
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

// Поки що логіка збігу як раніше (includes в обидва боки); точне порівняння — етап 3
function colorsMatch(fileColor, dbColorNorm) {
    if (!dbColorNorm) return false; // раніше порожній колір у базі збігався з будь-яким фото
    return dbColorNorm.includes(fileColor) || fileColor.includes(dbColorNorm);
}

function pathFromUrl(url) {
    if (!url) return null;
    const marker = `/object/public/${PHOTO_BUCKET}/`;
    const i = url.indexOf(marker);
    if (i < 0) return null;
    return decodeURIComponent(url.slice(i + marker.length).split('?')[0]);
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
            text += `\n⚠️ Зайнято понад ${Math.round(STORAGE_WARN_RATIO * 100)}% ліміту. Видаліть зайві файли (блок 3).`;
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

    const report = { uploaded: [], fuzzy: [], skipped: [], noMatch: [], duplicates: [], unused: [], failed: [] };

    try {
        const products = await fetchAllProducts('id, base_model, color, photo_url');
        const productById = new Map(products.map(p => [p.id, p]));

        // 1. План: розбираємо назви, один файл на модель + колір
        const byPath = new Map();
        for (const file of files) {
            const parsed = parsePhotoName(file.name);
            if (parsed.error) { report.skipped.push(`${file.name} — ${parsed.error}`); continue; }
            const path = `${slugify(parsed.baseModel)}__${slugify(parsed.color)}.jpg`;
            if (byPath.has(path)) report.duplicates.push(`${byPath.get(path).file.name} замінено на ${file.name}`);
            byPath.set(path, { file, ...parsed, path, productIds: [], fuzzyColors: new Set(), matchedAny: false });
        }
        const candidates = [...byPath.values()];

        // 2. Кожному товару — один файл: точний збіг кольору, інакше найдовша (найточніша) назва
        for (const p of products) {
            const dbColor = normColor(p.color);
            const matches = candidates.filter(c => c.baseModel === String(p.base_model).trim() && colorsMatch(c.color, dbColor));
            if (!matches.length) continue;
            matches.forEach(c => { c.matchedAny = true; });
            const best = matches.find(c => c.color === dbColor)
                || matches.reduce((a, b) => (b.color.length > a.color.length ? b : a));
            best.productIds.push(p.id);
            if (best.color !== dbColor) best.fuzzyColors.add(String(p.color).trim());
        }

        candidates.forEach(c => {
            if (!c.matchedAny) report.noMatch.push(c.file.name);
            else if (!c.productIds.length) report.unused.push(`${c.file.name} — для цих товарів є точніший файл`);
            c.fuzzyColors.forEach(col => report.fuzzy.push(`${c.file.name} → колір у базі «${col}»`));
        });

        // 3. Стискаємо, завантажуємо під постійним іменем, прив'язуємо
        const toUpload = candidates.filter(c => c.productIds.length);
        const oldPaths = new Set();
        const newPaths = new Set();
        let linkedProducts = 0;
        let uploadedBytes = 0;

        for (let i = 0; i < toUpload.length; i++) {
            const c = toUpload[i];
            statusDiv.innerText = `⏳ ${i + 1} з ${toUpload.length}: ${c.file.name}`;
            try {
                const blob = await compressImage(c.file);
                const { error: upErr } = await db.storage.from(PHOTO_BUCKET)
                    .upload(c.path, blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: true });
                if (upErr) throw upErr;

                const { data: urlData } = db.storage.from(PHOTO_BUCKET).getPublicUrl(c.path);
                const url = `${urlData.publicUrl}?v=${Date.now()}`; // нова версія = браузер не покаже старе фото з кешу

                const { error: updErr } = await db.from('products').update({ photo_url: url }).in('id', c.productIds);
                if (updErr) throw updErr;

                newPaths.add(c.path);
                c.productIds.forEach(id => {
                    const old = pathFromUrl(productById.get(id).photo_url);
                    if (old) oldPaths.add(old);
                });
                linkedProducts += c.productIds.length;
                uploadedBytes += blob.size;
                report.uploaded.push(`${c.file.name} → ${c.path} (${formatSize(blob.size)}, товарів: ${c.productIds.length})`);
            } catch (e) {
                console.error('Помилка для', c.file.name, e);
                report.failed.push(`${c.file.name} — ${e.message || e}`);
            }
        }

        // 4. Видаляємо старі файли, на які більше ніхто не посилається
        newPaths.forEach(p => oldPaths.delete(p));
        let removed = 0;
        if (oldPaths.size) {
            statusDiv.innerText = '🧹 Видаляємо старі версії фото...';
            const fresh = await fetchAllProducts('photo_url');
            const referenced = new Set(fresh.map(r => pathFromUrl(r.photo_url)).filter(Boolean));
            removed = await removeStorageFiles([...oldPaths].filter(p => !referenced.has(p)));
        }

        statusDiv.style.color = '#34C759';
        statusDiv.innerText = `🎉 Готово! Завантажено фото: ${report.uploaded.length} (${formatSize(uploadedBytes)}), прив'язано товарів: ${linkedProducts}, видалено старих файлів: ${removed}.`;
    } catch (e) {
        console.error(e);
        statusDiv.style.color = '#FF3B30';
        statusDiv.innerText = `❌ Помилка: ${e.message || e}`;
    } finally {
        renderReport(reportDiv, [
            { title: '❌ Помилки завантаження', items: report.failed, cls: 'bad', open: true },
            { title: '⏭ Пропущено (назва файлу)', items: report.skipped, cls: 'warn', open: true },
            { title: '❓ Не знайдено товару', items: report.noMatch, cls: 'warn', open: true },
            { title: '👀 Неточний збіг кольору (перевірте)', items: report.fuzzy, cls: 'warn', open: true },
            { title: '🔁 Дублі в пачці (взято останній)', items: report.duplicates, cls: 'warn' },
            { title: '💤 Не використано', items: report.unused },
            { title: '✅ Завантажено', items: report.uploaded }
        ]);
        btn.disabled = false;
        refreshStorageUsage();
        loadProducts();
    }
}

// --- Зайві файли (ні на що не посилаються) ---
let orphanPaths = [];

async function findReferencedPaths() {
    const rows = await fetchAllProducts('photo_url');
    if (!rows.length) throw new Error('список товарів порожній, перевірку зупинено');
    return new Set(rows.map(r => pathFromUrl(r.photo_url)).filter(Boolean));
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