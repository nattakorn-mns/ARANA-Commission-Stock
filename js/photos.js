/**
 * ARANA Staff — รูปเก็บใน Storage (ข้อ 25, SQL ไฟล์ 20 + Edge Function "photos")
 * ก่อนบันทึก: ย่อรูปในเครื่อง (รูปเต็ม ~1280px / รูปเล็ก ~320px) → อัปโหลด → ฐานข้อมูลเก็บแค่ "storage:<path>"
 * ตอนแสดง: <img src="storage:..."> ถูกเปลี่ยนเป็นลิงก์ชั่วคราวให้อัตโนมัติ
 * ถ้ายังไม่ได้ติดตั้ง Edge Function "photos" → เก็บรูปที่ย่อแล้วแบบเดิม (ไม่ทำให้บันทึกไม่ได้)
 */
const Photos = {
  FULL_SIDE: 1280, FULL_Q: 0.72, THUMB_SIDE: 320, THUMB_Q: 0.6,
  _signed: {}, // marker → { url, at }
  _pending: new Set(),
  _timer: null,
  _disabled: false,

  isMarker(v) { return typeof v === 'string' && v.startsWith('storage:'); },
  thumbOf(marker) { return marker.includes('/legacy/') ? marker : marker.replace(/\.jpg$/, '_t.jpg'); },

  compress(dataUrl, maxSide, quality) {
    return new Promise(resolve => {
      if (!/^data:image\//.test(String(dataUrl || ''))) { resolve(dataUrl); return; }
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * scale));
        c.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  },

  async _call(body) {
    const token = DB._sessionToken();
    if (!token) throw new Error('SESSION_REQUIRED');
    const r = await fetch(`${SUPABASE_URL}/functions/v1/photos`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ ...body, session_token: token })
    });
    if (r.status === 404) { const e = new Error('PHOTOS_NOT_INSTALLED'); e.notInstalled = true; throw e; }
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error(j.error || 'อัปโหลดรูปไม่สำเร็จ');
    return j;
  },

  // images: array ของ data URL หรือ { data, name } → คืนรูปแบบเดิม แต่ data เป็น "storage:..." (หรือรูปที่ย่อแล้ว ถ้ายังใช้ Storage ไม่ได้)
  async store(kind, branch, images) {
    const list = Array.isArray(images) ? images : [];
    const raw = list.map(i => (typeof i === 'string' ? i : i && i.data) || '');
    const todo = raw.map((d, n) => /^data:image\//.test(d) ? n : -1).filter(n => n >= 0);
    if (!todo.length) return list;
    const full = await Promise.all(todo.map(n => this.compress(raw[n], this.FULL_SIDE, this.FULL_Q)));
    let paths = null;
    if (!this._disabled) {
      try {
        const thumbs = await Promise.all(todo.map(n => this.compress(raw[n], this.THUMB_SIDE, this.THUMB_Q)));
        paths = (await this._call({ action: 'upload', kind, branch, images: full.map((f, i) => ({ full: f, thumb: thumbs[i] })) })).paths;
      } catch (e) {
        if (e.notInstalled) this._disabled = true;
        else console.warn('Photos.store: เก็บรูปแบบเดิมแทน', e);
      }
    }
    const out = raw.slice();
    todo.forEach((n, i) => { out[n] = paths ? paths[i] : full[i]; });
    return list.map((item, n) => typeof item === 'string' ? out[n] : { ...item, data: out[n] });
  },

  // ลิงก์ชั่วคราวของรูปใน Storage (เก็บไว้ใช้ซ้ำ 50 นาที)
  async urls(markers) {
    const now = Date.now();
    const need = [...new Set(markers.filter(m => this.isMarker(m) && !(this._signed[m] && now - this._signed[m].at < 50 * 60e3)))];
    for (let i = 0; i < need.length; i += 150) {
      try {
        const j = await this._call({ action: 'sign', paths: need.slice(i, i + 150) });
        Object.entries(j.urls || {}).forEach(([m, url]) => { this._signed[m] = { url, at: now }; });
      } catch (e) { console.warn('Photos.urls', e); }
    }
    const res = {};
    markers.forEach(m => { res[m] = this.isMarker(m) ? (this._signed[m] && this._signed[m].url) || null : m; });
    return res;
  },
  async url(marker) { return (await this.urls([marker]))[marker]; },
  async open(marker) {
    const w = window.open('', '_blank');
    const u = await this.url(marker);
    if (w) { if (u) w.location = u; else w.close(); }
  },

  // <img src="storage:..."> หรือ <img data-photo="storage:..."> → ลิงก์จริง (รูปเล็กไม่มี → ใช้รูปเต็ม)
  _scan() {
    document.querySelectorAll('img[src^="storage:"], img[data-photo]:not([data-photo-done])').forEach(img => {
      const s = img.getAttribute('src');
      const m = this.isMarker(s) ? s : img.getAttribute('data-photo');
      if (!this.isMarker(m)) return;
      img.setAttribute('data-photo', m); img.setAttribute('data-photo-done', '1');
      img.removeAttribute('src');
      this._pending.add(img);
    });
    if (!this._pending.size) return;
    const imgs = [...this._pending]; this._pending.clear();
    const want = imgs.map(img => img.dataset.photoThumb === '1' ? this.thumbOf(img.dataset.photo) : img.dataset.photo);
    const fallback = imgs.map(img => img.dataset.photo);
    this.urls([...want, ...fallback]).then(map => imgs.forEach((img, i) => {
      const u = map[want[i]] || map[fallback[i]];
      if (u) {
        if (want[i] !== fallback[i]) img.onerror = () => { img.onerror = null; if (map[fallback[i]]) img.src = map[fallback[i]]; };
        img.src = u;
      } else img.alt = 'โหลดรูปไม่ได้';
    }));
  },
  watch() {
    if (typeof MutationObserver === 'undefined' || typeof document === 'undefined' || !document.documentElement) return;
    new MutationObserver(() => { clearTimeout(this._timer); this._timer = setTimeout(() => this._scan(), 30); })
      .observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  }
};
Photos.watch();

// ทุกจุดที่บันทึกรูป ส่งผ่าน Photos.store ก่อน
(function wrapPhotoSaves() {
  if (typeof DB === 'undefined') return;
  const kindOfMove = m => m === 'IN' ? 'in' : m === 'TRANSFER' ? 'transfer' : 'out';
  const wrapPayload = (name, kind, argIndex) => {
    const orig = DB[name];
    if (typeof orig !== 'function') return;
    DB[name] = async function (...args) {
      const p = args[argIndex];
      if (p && Array.isArray(p.images) && p.images.length) {
        args[argIndex] = { ...p, images: await Photos.store(kind, p.branch_name || currentBranch, p.images) };
      }
      return orig.apply(this, args);
    };
  };
  wrapPayload('createOpdBillSupabase', 'opd', 0);
  wrapPayload('appendOpdBillSupabase', 'opd', 1);
  wrapPayload('editOpdBillSupabase', 'opd', 1);
  wrapPayload('submitBillEditSupabase', 'opd', 1);
  wrapPayload('createDepositSupabase', 'deposit', 0);
  const saveStock = DB.saveStockRequestSupabase;
  DB.saveStockRequestSupabase = async function (req) {
    const images = req && Array.isArray(req.images) && req.images.length ? await Photos.store(kindOfMove(req.moveType), req.branch, req.images) : req.images;
    return saveStock.call(this, { ...req, images });
  };
  const receive = DB.receiveTransferSupabase;
  if (receive) DB.receiveTransferSupabase = async function (requestId, lines, images, note) {
    return receive.call(this, requestId, lines, await Photos.store('transfer-receive', currentBranch, images || []), note);
  };
})();
