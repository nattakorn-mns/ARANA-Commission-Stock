/**
 * ARANA Staff — ช่องเลือกที่มีหลายตัวเลือก (12 ขึ้นไป) พิมพ์ค้นหาได้ (คุณออม 22/10)
 * พิมพ์แค่บางตัวอักษร → ขึ้นรายการที่ตรงให้เลือก ไม่ต้องเลื่อนหา
 * ใช้ <select> เดิมอยู่ข้างหลัง (ค่าและ onchange ทำงานเหมือนเดิม) — ช่องที่มีตัวเลือกน้อยยังเป็นแบบเดิม
 */
const SelectSearch = {
  MIN_OPTIONS: 12,
  MAX_SHOWN: 80,
  _timer: null,
  esc(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },

  enhance(sel) {
    if (sel.dataset.ss || sel.multiple || sel.size > 1 || sel.closest('.sel-search') || sel.dataset.noSearch !== undefined) return;
    if (sel.options.length < this.MIN_OPTIONS) return;
    sel.dataset.ss = '1';
    const wrap = document.createElement('div');
    wrap.className = 'sel-search';
    if (sel.style.width) wrap.style.width = sel.style.width;
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.autocomplete = 'off';
    inp.className = (sel.classList.contains('filter-select') ? 'filter-input' : 'form-input') + ' sel-search-input';
    inp.setAttribute('role', 'combobox');
    inp.setAttribute('aria-expanded', 'false');
    const list = document.createElement('div');
    list.className = 'sel-search-list';
    list.setAttribute('role', 'listbox');
    wrap.append(inp, list);
    sel.classList.add('sel-search-native');
    sel.tabIndex = -1;

    let active = -1;
    const options = () => [...sel.options].filter(o => o.value !== '' && !o.disabled);
    const label = () => { const o = sel.options[sel.selectedIndex]; return o && o.value !== '' ? o.text : ''; };
    const hint = () => { const o = [...sel.options].find(x => x.value === ''); return (o ? o.text.replace(/^[-\s]+|[-\s]+$/g, '') : '') || 'เลือก'; };
    const sync = () => {
      if (document.activeElement !== inp) inp.value = label();
      inp.placeholder = 'พิมพ์ค้นหา · ' + hint();
      inp.disabled = sel.disabled;
    };
    const close = () => { list.classList.remove('open'); inp.setAttribute('aria-expanded', 'false'); active = -1; };
    const render = () => {
      const q = inp.value.trim().toLowerCase();
      const all = options();
      const hits = q && q !== label().toLowerCase() ? all.filter(o => o.text.toLowerCase().includes(q)) : all;
      const shown = hits.slice(0, this.MAX_SHOWN);
      list.innerHTML = shown.map((o, i) => `<div class="sel-search-item${o.selected ? ' selected' : ''}${i === active ? ' active' : ''}" role="option" data-v="${this.esc(o.value)}">${this.esc(o.text)}</div>`).join('')
        + (hits.length > shown.length ? `<div class="sel-search-more">พิมพ์เพิ่มเพื่อให้แคบลง (อีก ${hits.length - shown.length} รายการ)</div>` : '')
        + (hits.length ? '' : '<div class="sel-search-more">ไม่พบ — ลองพิมพ์คำอื่น</div>');
      list.classList.add('open');
      inp.setAttribute('aria-expanded', 'true');
    };
    const choose = value => {
      if (sel.value !== value) {
        sel.value = value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      inp.value = label();
      close();
    };
    inp.addEventListener('focus', () => { active = -1; inp.select(); render(); });
    inp.addEventListener('input', () => { active = -1; render(); });
    inp.addEventListener('blur', () => setTimeout(() => { close(); inp.value = label(); }, 150));
    inp.addEventListener('keydown', e => {
      const items = [...list.querySelectorAll('.sel-search-item')];
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!list.classList.contains('open')) render();
        active = Math.max(0, Math.min(items.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)));
        items.forEach((el, i) => el.classList.toggle('active', i === active));
        items[active]?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const pick = items[active >= 0 ? active : 0];
        if (pick) choose(pick.dataset.v);
      } else if (e.key === 'Escape') { close(); inp.value = label(); inp.blur(); }
    });
    // pointerdown ก่อน blur — กดเลือกบนมือถือได้
    list.addEventListener('pointerdown', e => {
      const item = e.target.closest('.sel-search-item');
      if (!item) return;
      e.preventDefault();
      choose(item.dataset.v);
    });
    sel.addEventListener('change', sync);
    new MutationObserver(sync).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
    sync();
  },

  scan() {
    document.querySelectorAll('select:not([data-ss])').forEach(s => this.enhance(s));
    // ค่าที่โค้ดตั้งให้เอง (ไม่มีเหตุการณ์ change) → อัปเดตข้อความในช่อง
    document.querySelectorAll('.sel-search').forEach(w => {
      const sel = w.querySelector('select'), inp = w.querySelector('.sel-search-input');
      if (sel && inp && document.activeElement !== inp) {
        const o = sel.options[sel.selectedIndex];
        const text = o && o.value !== '' ? o.text : '';
        if (inp.value !== text) inp.value = text;
      }
    });
  },

  watch() {
    if (typeof MutationObserver === 'undefined' || typeof document === 'undefined' || !document.documentElement) return;
    new MutationObserver(() => { clearTimeout(this._timer); this._timer = setTimeout(() => this.scan(), 40); })
      .observe(document.documentElement, { childList: true, subtree: true });
  }
};
SelectSearch.watch();
