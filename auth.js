// auth.js — Client-side authentication helper for Fotoku
// Status auth ditentukan server via /api/me (cookie HttpOnly fotoku_session).
(function () {
  let authenticated = false;
  const path = window.location.pathname;
  const isProfilePage = path.endsWith('profile.html');

  // Inject CSS blur styles immediately if not logged in
  function applyBlur() {
    if (authenticated || document.getElementById('auth-blur-styles')) return;
    const style = document.createElement('style');
    style.id = 'auth-blur-styles';
    style.innerHTML = `
      img, .aspect-square img, .photo-grid img, #gallery-root img {
        filter: blur(25px) grayscale(50%) !important;
        pointer-events: none !important;
        user-select: none !important;
        -webkit-user-drag: none !important;
      }
      /* Block any click actions on grids, lightbox links, and other interactive elements */
      .photo-grid > div, #gallery-root div, .lb-btn, .lb-arrow, #btn-sync, #btn-add-chat, .btn-remove {
        pointer-events: none !important;
        cursor: not-allowed !important;
        opacity: 0.6 !important;
      }
      /* Allow clicks only on profile, modal, and bottom/top navigation */
      nav a, header a, #login-modal, #login-modal * {
        pointer-events: auto !important;
        cursor: pointer !important;
        opacity: 1 !important;
      }
    `;
    document.head.appendChild(style);
  }

  function removeBlur() {
    const style = document.getElementById('auth-blur-styles');
    if (style) style.remove();
  }

  // Handle onload behavior
  window.addEventListener('DOMContentLoaded', async () => {
    try {
      const res = await fetch('/api/me');
      authenticated = (await res.json()).authenticated === true;
    } catch { authenticated = false; }
    applyBlur();

    const btnAuth = document.getElementById('btn-auth') || document.querySelector('button.mt-lg');
    if (isProfilePage && btnAuth) {
      btnAuth.id = 'btn-auth';
      if (!authenticated) {
        btnAuth.textContent = 'Sign In';
        btnAuth.classList.remove('border-error/20', 'text-error', 'hover:bg-error-container/10');
        btnAuth.classList.add('border-primary/20', 'text-primary', 'hover:bg-primary/10');
        btnAuth.addEventListener('click', (e) => {
          e.preventDefault();
          showLoginModal();
        });
      } else {
        btnAuth.textContent = 'Sign Out';
        btnAuth.addEventListener('click', async (e) => {
          e.preventDefault();
          if (confirm('Apakah Anda yakin ingin keluar?')) {
            await logout();
          }
        });
      }
    }
  });

  // Inject the Login Modal html on body load if we need to
  function showLoginModal() {
    let modal = document.getElementById('login-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'login-modal';
      modal.className = 'fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-md';
      modal.innerHTML = `
        <div class="bg-surface border border-outline-variant rounded-2xl p-lg max-w-sm w-full shadow-2xl flex flex-col gap-md relative">
          <button id="login-modal-close" class="absolute top-4 right-4 text-on-surface-variant hover:text-on-surface">
            <span class="material-symbols-outlined text-[20px]">close</span>
          </button>
          <div class="text-center">
            <h3 class="font-title-md text-title-md font-bold text-on-surface">Masuk ke Fotoku</h3>
            <p class="font-body-md text-body-md text-on-surface-variant mt-xs">Silakan login untuk mengakses media.</p>
          </div>
          <div class="flex flex-col gap-sm">
            <input id="login-email" type="email" placeholder="Email" class="w-full px-md py-sm bg-surface-container-high rounded-xl font-body-md text-body-md text-on-surface outline-none focus:ring-2 focus:ring-primary/30 border-none"/>
            <input id="login-password" type="password" placeholder="Password" class="w-full px-md py-sm bg-surface-container-high rounded-xl font-body-md text-body-md text-on-surface outline-none focus:ring-2 focus:ring-primary/30 border-none"/>
          </div>
          <p id="login-error" class="hidden font-label-sm text-label-sm text-error px-xs text-center"></p>
          <button id="btn-login-submit" class="w-full py-md bg-primary text-on-primary rounded-xl font-title-md text-title-md active:scale-95 transition-transform duration-150 shadow-md">
            Masuk
          </button>
        </div>
      `;
      document.body.appendChild(modal);

      document.getElementById('login-modal-close').addEventListener('click', () => {
        modal.classList.add('hidden');
      });

      document.getElementById('btn-login-submit').addEventListener('click', submitLogin);

      // Submit on enter
      const inputs = [document.getElementById('login-email'), document.getElementById('login-password')];
      inputs.forEach(input => {
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') submitLogin();
        });
      });
    } else {
      modal.classList.remove('hidden');
    }
    document.getElementById('login-password').focus();
  }

  async function submitLogin() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value.trim();
    const errorEl = document.getElementById('login-error');

    if (!email || !password) {
      errorEl.textContent = 'Email dan password harus diisi.';
      errorEl.classList.remove('hidden');
      return;
    }

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        // Session tersimpan di cookie HttpOnly oleh server — tidak ada token di JS
        window.location.reload();
      } else {
        errorEl.textContent = data.error || 'Login gagal.';
        errorEl.classList.remove('hidden');
      }
    } catch {
      errorEl.textContent = 'Gagal menghubungi server.';
      errorEl.classList.remove('hidden');
    }
  }

  async function logout() {
    try {
      await fetch('/api/logout', { method: 'POST' });
    } catch {}
    window.location.reload();
  }
})();
