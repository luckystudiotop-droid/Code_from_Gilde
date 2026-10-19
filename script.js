const db = window.supabase.createClient('https://ckivnxtnjdnonjavsgon.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNraXZueHRuamRub25qYXZzZ29uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIzNjA4NDIsImV4cCI6MjEwNzkzNjg0Mn0.jrHwOdeFZrOlwfl7FEyn2JStn8DQ3m4GeRHlHbgBBwU');

let allProducts = [];
let selectedProducts = new Set();
let filters = { gender: null, categories: new Set(), size: null };

async function loadProducts() {
    const { data, error } = await db.from('products').select('*').order('category');
    if (!error) {
        allProducts = data;
        renderProducts();
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
    actionBtn.innerText = "⏳ Формуємо..."; actionBtn.disabled = true;

    let textToCopy = "Вітаємо! Ось що є в наявності за вашим запитом:\n\n";
    let filesArray = []; let zip = new JSZip(); let hasImages = false;

    try {
        for (let id of selectedProducts) {
            let p = allProducts.find(x => x.id === id);
            textToCopy += `▪️ Арт. ${p.base_model} (${p.color}), розмір ${p.size_name} — ${p.price} грн\n`;
            if (p.photo_url) {
                try {
                    const response = await fetch(p.photo_url);
                    const blob = await response.blob();
                    const fileName = `${p.sku}.jpg`;
                    filesArray.push(new File([blob], fileName, { type: blob.type }));
                    zip.file(fileName, blob); hasImages = true;
                } catch (e) { console.error("Помилка завантаження фото", e); }
            }
        }
        
        await navigator.clipboard.writeText(textToCopy);
        
        if (navigator.canShare && navigator.canShare({ files: filesArray })) {
            try { await navigator.share({ files: filesArray, title: 'Фото товару' }); } 
            catch(e) { if (e.name !== "AbortError") await downloadZip(zip, hasImages); }
        } else {
            await downloadZip(zip, hasImages);
        }
    } catch (err) { alert("Помилка."); } 
    finally { actionBtn.innerText = originalText; actionBtn.disabled = false; resetFilters(); }
}

async function downloadZip(zip, hasImages) {
    if (!hasImages) return alert("Текст скопійовано! Фото відсутні.");
    const now = new Date(); const dateKey = `${String(now.getDate()).padStart(2,'0')}_${String(now.getMonth()+1).padStart(2,'0')}`;
    let savedDate = localStorage.getItem('archive_date');
    let counter = parseInt(localStorage.getItem('archive_counter') || '0');
    if (savedDate !== dateKey) { savedDate = dateKey; counter = 1; } else { counter++; }
    localStorage.setItem('archive_date', savedDate); localStorage.setItem('archive_counter', counter);
    const zipName = `${dateKey}_${counter}.zip`;
    
    const content = await zip.generateAsync({type: "blob"});
    const link = document.createElement('a'); link.href = URL.createObjectURL(content); link.download = zipName;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
    alert(`✅ Текст із цінами скопійовано!\nАрхів "${zipName}" завантажено.`);
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
async function uploadPhotosToSupabase() {
    const fileInput = document.getElementById('photo-files');
    const statusDiv = document.getElementById('photo-status');
    
    if (!fileInput.files.length) { alert("Оберіть фотографії!"); return; }

    const files = Array.from(fileInput.files);
    statusDiv.innerText = `⏳ Отримання списку товарів...`;
    
    const { data: products, error: fetchErr } = await db.from('products').select('id, base_model, color');
    if (fetchErr) { statusDiv.innerText = "❌ Помилка отримання БД."; return; }

    statusDiv.innerText = `🚀 Завантажуємо ${files.length} фото... Не закривайте вкладку!`;
    
    let successCount = 0;
    let noMatchCount = 0;

    for (let i = 0; i < files.length; i++) {
        let file = files[i];
        let fileName = file.name;
        
        let parts = fileName.split('(');
        if (parts.length < 2) continue;
        
        let baseModel = parts[0].trim();
        let colorPart = parts[1].split(')')[0].toLowerCase().replace('мята', "м'ята").replace('мʼята', "м'ята").trim();
        
        statusDiv.innerText = `⏳ Завантажуємо ${i + 1} з ${files.length}: ${fileName}...`;

        let matchingProducts = products.filter(p => {
            let dbColor = String(p.color || '').toLowerCase().trim();
            // Перевіряємо в обидва боки: або колір з бази містить назву з файлу, або назва з файлу містить колір з бази
            return p.base_model === baseModel && (dbColor.includes(colorPart) || colorPart.includes(dbColor));
        });
        if (matchingProducts.length === 0) { noMatchCount++; continue; }

        let ext = fileName.split('.').pop();
        let safeName = `${baseModel}_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;

        const { error: uploadError } = await db.storage
            .from('product-photos')
            .upload(safeName, file, { cacheControl: '3600', upsert: true });

        if (uploadError) { console.error("Помилка Storage для", fileName, uploadError); continue; }

        const { data: urlData } = db.storage.from('product-photos').getPublicUrl(safeName);
        const publicUrl = urlData.publicUrl;

        for (let prod of matchingProducts) {
            await db.from('products').update({ photo_url: publicUrl }).eq('id', prod.id);
        }
        successCount++;
    }

    statusDiv.innerText = `🎉 Готово! Прив'язано фото: ${successCount} шт. (Не знайдено товарів для ${noMatchCount} фото).`;
    loadProducts();
}

window.onload = () => loadProducts();