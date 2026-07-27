// lightbox.js — reusable photo viewer
(function () {
  let photos = [];   // array of {url, thumb_url, date, caption}
  let current = 0;

  const lb = document.createElement('div');
  lb.id = 'lb';
  lb.innerHTML = `
    <style>
      #lb { display:none; position:fixed; inset:0; z-index:1000; background:#000; flex-direction:column; height:100dvh; overflow:hidden; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; color:#fff; touch-action:none; }
      #lb.open { display:flex; }
      #lb-header { display:flex; justify-content:space-between; align-items:center; padding:16px 20px; background:rgba(0,0,0,0.5); position:absolute; top:0; left:0; right:0; z-index:2; backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); touch-action:manipulation; }
      #lb-header-left { display:flex; align-items:center; gap:20px; }
      #lb-back { background:none; border:none; color:#fff; cursor:pointer; touch-action:manipulation; }
      #lb-datetime .lb-date { font-size:17px; font-weight:500; }
      #lb-main { flex:1; display:flex; align-items:center; justify-content:center; position:relative; }
      #lb-img { max-width:100%; max-height:100%; object-fit:contain; user-select:none; touch-action:pinch-zoom; transition:transform .1s; }
      #lb-spinner { position:absolute; display:none; }
      #lb-spinner.show { display:block; }
      .lb-arrow { position:absolute; top:50%; transform:translateY(-50%); background:rgba(0,0,0,.4); border:none; color:#fff; cursor:pointer; padding:12px 8px; border-radius:4px; z-index:3; transition:background .2s; touch-action:manipulation; }
      .lb-arrow:hover { background:rgba(0,0,0,.7); }
      #lb-prev { left:8px; }
      #lb-next { right:8px; }
      #lb-footer { display:flex; justify-content:space-around; align-items:center; padding:20px 24px 32px; background:rgba(0,0,0,0.5); position:absolute; bottom:0; left:0; right:0; z-index:2; backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); touch-action:manipulation; }
      .lb-btn { background:none; border:none; color:#fff; cursor:pointer; padding:8px; display:flex; align-items:center; justify-content:center; opacity:.9; transition:opacity .2s; touch-action:manipulation; }
      .lb-btn:hover { opacity:1; }
      .lb-btn svg { width:24px; height:24px; stroke:#fff; stroke-width:1.5; fill:none; stroke-linecap:round; stroke-linejoin:round; }
    </style>
    <div id="lb-header">
      <div id="lb-header-left">
        <button id="lb-back">
          <svg viewBox="0 0 24 24" width="24" height="24" stroke="white" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline>
          </svg>
        </button>
        <div id="lb-datetime">
          <div class="lb-date" id="lb-date">—</div>
        </div>
      </div>
      <div>
        <button class="lb-btn" id="lb-info-btn" title="Info">
          <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        </button>
      </div>
    </div>

    <div id="lb-main">
      <button class="lb-arrow" id="lb-prev">
        <svg viewBox="0 0 24 24" width="20" height="20" stroke="white" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>
      <img id="lb-img" src="" alt=""/>
      <div id="lb-spinner">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83">
            <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur=".8s" repeatCount="indefinite"/>
          </path>
        </svg>
      </div>
      <button class="lb-arrow" id="lb-next">
        <svg viewBox="0 0 24 24" width="20" height="20" stroke="white" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </button>
    </div>

    <div id="lb-footer">
      <button class="lb-btn" id="lb-share" title="Bagikan">
        <svg viewBox="0 0 24 24"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
      </button>
      <button class="lb-btn" id="lb-fav" title="Favorit">
        <svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
      </button>
      <button class="lb-btn" id="lb-download" title="Unduh">
        <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      </button>
      <button class="lb-btn" id="lb-more" title="Lainnya">
        <svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>
      </button>
    </div>
  `;
  document.body.appendChild(lb);

  let scale = 1, lastScale = 1, posX = 0, posY = 0;
  const img = document.getElementById('lb-img');

  function resetZoom() {
    scale = 1; posX = 0; posY = 0;
    img.style.transform = '';
    img.style.transformOrigin = 'center';
    setUI(true);
  }

  function setUI(visible) {
    const v = visible ? '' : 'none';
    document.getElementById('lb-header').style.display = visible ? 'flex' : 'none';
    document.getElementById('lb-footer').style.display = visible ? 'flex' : 'none';
    document.getElementById('lb-prev').style.display = visible ? '' : 'none';
    document.getElementById('lb-next').style.display = visible ? '' : 'none';
  }

  function updateFavBtn(loved) {
    const path = document.querySelector('#lb-fav svg path');
    if (!path) return;
    path.style.fill = loved ? 'white' : 'none';
    path.style.stroke = 'white';
  }

  function formatDate(ts) {
    if (!ts) return '—';
    const d = new Date(ts * 1000);
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function show(idx) {
    current = Math.max(0, Math.min(idx, photos.length - 1));
    resetZoom();
    const p = photos[current];
    const img = document.getElementById('lb-img');
    const spinner = document.getElementById('lb-spinner');

    img.style.opacity = '0';
    spinner.classList.add('show');
    img.src = '';
    img.onload = () => { img.style.opacity = '1'; spinner.classList.remove('show'); };
    img.onerror = () => { spinner.classList.remove('show'); };
    img.src = p.url;

    document.getElementById('lb-date').textContent = formatDate(p.date);
    updateFavBtn(p.loved || false);

    // Sembunyikan panah jika di ujung
    document.getElementById('lb-prev').style.visibility = current > 0 ? 'visible' : 'hidden';
    document.getElementById('lb-next').style.visibility = current < photos.length - 1 ? 'visible' : 'hidden';
  }

  function open(idx, photoList) {
    photos = photoList;
    lb.classList.add('open');
    document.body.style.overflow = 'hidden';
    // Aktifkan pinch zoom saat lightbox terbuka
    document.querySelector('meta[name=viewport]').setAttribute('content',
      'width=device-width, initial-scale=1.0, viewport-fit=cover');
    show(idx);
  }

  function close() {
    lb.classList.remove('open');
    document.body.style.overflow = '';
    // Nonaktifkan pinch zoom kembali
    document.querySelector('meta[name=viewport]').setAttribute('content',
      'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover');
    document.getElementById('lb-img').src = '';
  }

  // Event handlers
  document.getElementById('lb-back').addEventListener('click', close);
  document.getElementById('lb-prev').addEventListener('click', () => show(current - 1));
  document.getElementById('lb-next').addEventListener('click', () => show(current + 1));

  // Tombol love
  const favBtn = document.getElementById('lb-fav');

  favBtn.addEventListener('click', async () => {
    const p = photos[current];
    if (!p.channel_id || !p.message_id) return;
    try {
      const res = await fetch(`/api/love/${encodeURIComponent(p.channel_id)}/${p.message_id}`, { method: 'POST' });
      const data = await res.json();
      p.loved = data.loved;
      updateFavBtn(data.loved);
      favBtn.classList.add('scale-125');
      setTimeout(() => favBtn.classList.remove('scale-125'), 200);
    } catch {}
  });

  // Download foto asli
  document.getElementById('lb-download').addEventListener('click', () => {
    const p = photos[current];
    const a = document.createElement('a');
    a.href = p.url;
    a.download = `foto_${p.message_id || current}.jpg`;
    a.click();
  });

  // Cegah pinch zoom pada area selain gambar
  lb.addEventListener('touchmove', e => {
    if (e.touches.length >= 2 && e.target !== img) e.preventDefault();
  }, { passive: false });
  img.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      e.stopPropagation();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      img._pinchStart = Math.sqrt(dx * dx + dy * dy);
      img._scaleStart = scale;

      // Titik tengah antara dua jari sebagai origin zoom
      const rect = img.getBoundingClientRect();
