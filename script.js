/* =========================================================
   Dompetku — logika aplikasi
   Sumber data: Google Sheets (lewat Apps Script Web App) jika
   sudah dihubungkan, atau localStorage jika belum.
   ========================================================= */

const STORAGE_USERS     = 'dompetku_users';
const STORAGE_SESSION   = 'dompetku_session';
const TX_PREFIX         = 'dompetku_tx_';
const STORAGE_SHEET_URL = 'dompetku_sheet_url';

const DAY_NAMES   = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
const MONTH_NAMES = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

let chartMonthOffset = 0; // 0 = bulan ini, negatif = bulan lalu

// Flag global untuk mencegah double click pada pengiriman transaksi & navigasi grafik
let isSubmittingTx = false;
let isNavigatingChart = false;

/* =========================================================
   KONEKSI GOOGLE SHEETS
   ========================================================= */

function getSheetUrl(){
  return (localStorage.getItem(STORAGE_SHEET_URL) || 'https://script.google.com/macros/s/AKfycbyOjaiqlJI0Gox5x68ufJeSOfL-aV_Ttq442IaldSTh4fN187mmQcb0LSv_w2Qud11O1w/exec').trim();
}
function setSheetUrl(url){
  localStorage.setItem(STORAGE_SHEET_URL, (url || 'https://script.google.com/macros/s/AKfycbyOjaiqlJI0Gox5x68ufJeSOfL-aV_Ttq442IaldSTh4fN187mmQcb0LSv_w2Qud11O1w/exec').trim());
}
function isSheetMode(){
  return !!getSheetUrl();
}

async function apiPost(action, payload = {}){
  const res = await fetch(getSheetUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...payload })
  });
  if(!res.ok) throw new Error('Gagal menghubungi Google Sheets (' + res.status + ')');
  const data = await res.json();
  if(data && data.error) throw new Error(data.error);
  return data;
}

/* --------------------- keamanan password --------------------- */

async function hashPassword(password){
  const data = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/* --------------------- util penyimpanan lokal (mode offline) --------------------- */

function loadLocalUsers(){
  try{ return JSON.parse(localStorage.getItem(STORAGE_USERS)) || {}; }
  catch(e){ return {}; }
}
function saveLocalUsers(users){
  localStorage.setItem(STORAGE_USERS, JSON.stringify(users));
}

function loadSession(){
  try{ return JSON.parse(localStorage.getItem(STORAGE_SESSION)); }
  catch(e){ return null; }
}
function saveSession(session){
  localStorage.setItem(STORAGE_SESSION, JSON.stringify(session));
}
function clearSession(){
  localStorage.removeItem(STORAGE_SESSION);
}

function forceLogoutInvalidSession(message){
  clearSession();
  appScreen.classList.add('hidden');
  authScreen.classList.remove('hidden');
  loginForm.classList.remove('hidden');
  registerForm.classList.add('hidden');
  if(message) alert(message);
}

async function loadTx(session){
  if(isSheetMode()){
    try{
      const data = await apiPost('getTx', { username: session.username, sessionToken: session.sessionToken });
      return Array.isArray(data) ? data : [];
    }catch(err){
      console.error(err);
      if(err.message === 'Sesi tidak valid. Silakan masuk kembali.'){
        forceLogoutInvalidSession(err.message);
      } else {
        alert('Gagal memuat transaksi dari Google Sheets.');
      }
      return [];
    }
  }
  try{ return JSON.parse(localStorage.getItem(TX_PREFIX + session.username)) || []; }
  catch(e){ return []; }
}

async function saveTx(session, list){
  if(isSheetMode()){
    try{
      await apiPost('saveTx', { username: session.username, sessionToken: session.sessionToken, tx: list });
    }catch(err){
      console.error(err);
      if(err.message === 'Sesi tidak valid. Silakan masuk kembali.'){
        forceLogoutInvalidSession(err.message);
      } else {
        alert('Gagal menyimpan transaksi ke Google Sheets.');
      }
    }
    return;
  }
  localStorage.setItem(TX_PREFIX + session.username, JSON.stringify(list));
}

/* --------------------- util format --------------------- */

function formatRupiah(n){
  return new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0
  }).format(n).replace(/\s/g, '');
}

function formatHariTanggal(isoString){
  const d = new Date(isoString);
  const hari = DAY_NAMES[d.getDay()];
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${hari},${dd}-${mm}-${yyyy}`;
}

function formatTanggalSingkat(isoString){
  const d = new Date(isoString);
  const bulanSingkat = MONTH_NAMES[d.getMonth()].slice(0, 3);
  return `${String(d.getDate()).padStart(2,'0')} ${bulanSingkat} ${d.getFullYear()}`;
}

/* =========================================================
   AUTH
   ========================================================= */

const authScreen    = document.getElementById('authScreen');
const appScreen     = document.getElementById('appScreen');

const loginForm     = document.getElementById('loginForm');
const registerForm  = document.getElementById('registerForm');
const showRegister  = document.getElementById('showRegister');
const showLogin     = document.getElementById('showLogin');
const loginError    = document.getElementById('loginError');
const registerError = document.getElementById('registerError');

showRegister.addEventListener('click', () => {
  loginError.textContent = '';
  loginForm.classList.add('hidden');
  registerForm.classList.remove('hidden');
});
showLogin.addEventListener('click', () => {
  registerError.textContent = '';
  registerForm.classList.add('hidden');
  loginForm.classList.remove('hidden');
});

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const submitBtn = registerForm.querySelector('button[type="submit"]');
  if(submitBtn && submitBtn.disabled) return; // Mencegah proses ganda jika sedang diklik
  if(submitBtn) submitBtn.disabled = true;

  registerError.textContent = '';

  const name = document.getElementById('registerName').value.trim();
  const username = document.getElementById('registerUsername').value.trim().toLowerCase();
  const password = document.getElementById('registerPassword').value;

  if(!name || !username || !password){
    registerError.textContent = 'Semua kolom wajib diisi.';
    if(submitBtn) submitBtn.disabled = false;
    return;
  }
  if(password.length < 4){
    registerError.textContent = 'Kata sandi minimal 4 karakter.';
    if(submitBtn) submitBtn.disabled = false;
    return;
  }

  const passwordHash = await hashPassword(password);

  try{
    if(isSheetMode()){
      const result = await apiPost('register', { username, name, passwordHash });
      saveSession({
        username,
        name,
        firstLogin: result.firstLogin,
        lastLoginDisplay: result.lastLogin,
        sessionToken: result.sessionToken
      });
    } else {
      const users = loadLocalUsers();
      if(users[username]){
        registerError.textContent = 'Nama pengguna sudah dipakai. Coba nama lain.';
        if(submitBtn) submitBtn.disabled = false;
        return;
      }
      const nowIso = new Date().toISOString();
      users[username] = { name, password: passwordHash, firstLogin: nowIso, lastLogin: nowIso };
      saveLocalUsers(users);
      saveSession({ username, name, firstLogin: nowIso, lastLoginDisplay: nowIso });
    }
  }catch(err){
    console.error(err);
    registerError.textContent = err.message || 'Gagal mendaftar. Coba lagi.';
    if(submitBtn) submitBtn.disabled = false;
    return;
  }

  registerForm.reset();
  if(submitBtn) submitBtn.disabled = false;
  await enterApp();
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const submitBtn = loginForm.querySelector('button[type="submit"]');
  if(submitBtn && submitBtn.disabled) return; // Mencegah proses ganda jika sedang diklik
  if(submitBtn) submitBtn.disabled = true;

  loginError.textContent = '';

  const username = document.getElementById('loginUsername').value.trim().toLowerCase();
  const password = document.getElementById('loginPassword').value;

  const passwordHash = await hashPassword(password);

  try{
    if(isSheetMode()){
      const result = await apiPost('login', { username, passwordHash });
      saveSession({
        username,
        name: result.name,
        firstLogin: result.firstLogin,
        lastLoginDisplay: result.lastLoginDisplay,
        sessionToken: result.sessionToken
      });
    } else {
      const users = loadLocalUsers();
      const user = users[username];
      if(!user || user.password !== passwordHash){
        loginError.textContent = 'Nama pengguna atau kata sandi salah.';
        if(submitBtn) submitBtn.disabled = false;
        return;
      }
      const previousLastLogin = user.lastLogin || user.firstLogin;
      const nowIso = new Date().toISOString();
      user.lastLogin = nowIso;
      saveLocalUsers(users);
      saveSession({ username, name: user.name, firstLogin: user.firstLogin, lastLoginDisplay: previousLastLogin });
    }
  }catch(err){
    console.error(err);
    loginError.textContent = err.message || 'Nama pengguna atau kata sandi salah.';
    if(submitBtn) submitBtn.disabled = false;
    return;
  }

  loginForm.reset();
  if(submitBtn) submitBtn.disabled = false;
  await enterApp();
});

document.getElementById('logoutBtn').addEventListener('click', () => {
  clearSession();
  profileDropdown.classList.add('hidden');
  appScreen.classList.add('hidden');
  authScreen.classList.remove('hidden');
  loginForm.classList.remove('hidden');
  registerForm.classList.add('hidden');
});

/* =========================================================
   PROFIL (dropdown)
   ========================================================= */

const profileBtn      = document.getElementById('profileBtn');
const profileDropdown = document.getElementById('profileDropdown');
const profileInitial  = document.getElementById('profileInitial');

profileBtn.addEventListener('click', () => {
  const isHidden = profileDropdown.classList.contains('hidden');
  profileDropdown.classList.toggle('hidden');
  profileBtn.setAttribute('aria-expanded', String(isHidden));
});

document.addEventListener('click', (e) => {
  if(!profileDropdown.classList.contains('hidden') &&
     !profileDropdown.contains(e.target) &&
     !profileBtn.contains(e.target)){
    profileDropdown.classList.add('hidden');
    profileBtn.setAttribute('aria-expanded', 'false');
  }
});

function renderProfile(){
  const session = loadSession();
  if(!session) return;

  profileInitial.textContent = (session.name || '?').trim().charAt(0).toUpperCase() || '?';
  document.getElementById('ddName').textContent = session.name || '—';
  document.getElementById('ddFirstLogin').textContent = formatHariTanggal(session.firstLogin);
  document.getElementById('ddLastLogin').textContent = formatHariTanggal(session.lastLoginDisplay || session.firstLogin);
}

/* =========================================================
   SALDO
   ========================================================= */

async function renderBalance(){
  const session = loadSession();
  const tx = await loadTx(session);
  const total = tx.reduce((sum, t) => sum + (t.type === 'income' ? t.amount : -t.amount), 0);
  document.getElementById('balanceAmount').textContent = formatRupiah(total);
}

/* =========================================================
   GRAFIK BULANAN (dengan navigasi)
   ========================================================= */

function getOffsetDate(offset){
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return d;
}

function txInMonth(tx, targetDate){
  return tx.filter(t => {
    const d = new Date(t.date);
    return d.getFullYear() === targetDate.getFullYear() && d.getMonth() === targetDate.getMonth();
  });
}

async function renderChart(){
  const session = loadSession();
  const tx = await loadTx(session);
  const targetDate = getOffsetDate(chartMonthOffset);

  const monthTx = txInMonth(tx, targetDate);
  const income = monthTx.filter(t => t.type === 'income').reduce((s,t) => s + t.amount, 0);
  const expense = monthTx.filter(t => t.type === 'expense').reduce((s,t) => s + t.amount, 0);

  const label = chartMonthOffset === 0
    ? `${MONTH_NAMES[targetDate.getMonth()]} ${targetDate.getFullYear()} (bulan ini)`
    : `${MONTH_NAMES[targetDate.getMonth()]} ${targetDate.getFullYear()}`;
  document.getElementById('monthLabel').textContent = label;

  const max = Math.max(income, expense, 1);
  document.getElementById('incomeBar').style.height = `${Math.max((income / max) * 100, 2)}%`;
  document.getElementById('expenseBar').style.height = `${Math.max((expense / max) * 100, 2)}%`;
  document.getElementById('incomeBarValue').textContent = formatRupiah(income);
  document.getElementById('expenseBarValue').textContent = formatRupiah(expense);

  document.getElementById('nextMonth').disabled = chartMonthOffset >= 0;
  document.getElementById('prevMonth').disabled = chartMonthOffset <= -60;
}

document.getElementById('prevMonth').addEventListener('click', async () => {
  if(isNavigatingChart) return;
  isNavigatingChart = true;
  chartMonthOffset -= 1;
  await renderChart();
  isNavigatingChart = false;
});

document.getElementById('nextMonth').addEventListener('click', async () => {
  if(isNavigatingChart) return;
  if(chartMonthOffset < 0){
    isNavigatingChart = true;
    chartMonthOffset += 1;
    await renderChart();
    isNavigatingChart = false;
  }
});

/* =========================================================
   RINGKASAN BULAN INI + DAFTAR TRANSAKSI
   ========================================================= */

async function renderSummaryAndList(){
  const session = loadSession();
  const tx = await loadTx(session);
  const now = new Date();

  const monthTx = txInMonth(tx, now)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const income = monthTx.filter(t => t.type === 'income').reduce((s,t) => s + t.amount, 0);
  const expense = monthTx.filter(t => t.type === 'expense').reduce((s,t) => s + t.amount, 0);

  document.getElementById('incomeTotal').textContent = formatRupiah(income);
  document.getElementById('expenseTotal').textContent = formatRupiah(expense);

  const list = document.getElementById('txList');
  const empty = document.getElementById('txEmpty');
  list.innerHTML = '';

  if(monthTx.length === 0){
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
    monthTx.forEach(t => {
      const li = document.createElement('li');
      li.className = `tx-item ${t.type === 'income' ? 'is-income' : 'is-expense'}`;
      li.innerHTML = `
        <span class="tx-icon">${t.type === 'income' ? '+' : '−'}</span>
        <span class="tx-info">
          <span class="tx-desc">${escapeHtml(t.desc)}</span>
          <span class="tx-date">${formatTanggalSingkat(t.date)}</span>
        </span>
        <span class="tx-amount">${t.type === 'income' ? '+' : '-'}${formatRupiah(t.amount)}</span>
      `;
      list.appendChild(li);
    });
  }
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* =========================================================
   TAMBAH TRANSAKSI
   ========================================================= */

document.getElementById('expenseForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  await addTransaction('expense',
    document.getElementById('expenseAmount'),
    document.getElementById('expenseDesc'),
    btn);
});

document.getElementById('incomeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  await addTransaction('income',
    document.getElementById('incomeAmount'),
    document.getElementById('incomeDesc'),
    btn);
});

async function addTransaction(type, amountInput, descInput, submitBtn){
  if(isSubmittingTx) return; // Mencegah masukan ganda saat transaksi diproses

  const amount = parseInt(amountInput.value, 10);
  const desc = descInput.value.trim();
  if(!amount || amount <= 0 || !desc) return;

  isSubmittingTx = true;
  if(submitBtn) submitBtn.disabled = true;

  try {
    const session = loadSession();
    const tx = await loadTx(session);

    tx.push({
      id: Date.now() + Math.random().toString(16).slice(2),
      type,
      amount,
      desc,
      date: new Date().toISOString()
    });
    await saveTx(session, tx);

    amountInput.value = '';
    descInput.value = '';

    await renderBalance();
    await renderChart();
    await renderSummaryAndList();
  } finally {
    isSubmittingTx = false;
    if(submitBtn) submitBtn.disabled = false;
  }
}

/* =========================================================
   PENGATURAN — HUBUNGKAN KE GOOGLE SHEETS
   ========================================================= */

const settingsBtn      = document.getElementById('settingsBtn');
const settingsModal    = document.getElementById('settingsModal');
const sheetUrlInput    = document.getElementById('sheetUrlInput');
const settingsStatus   = document.getElementById('settingsStatus');
const saveSheetUrlBtn  = document.getElementById('saveSheetUrl');
const closeSettingsBtn = document.getElementById('closeSettings');

if(settingsBtn && settingsModal && sheetUrlInput && settingsStatus && saveSheetUrlBtn && closeSettingsBtn){

  function updateSettingsStatus(){
    settingsStatus.textContent = isSheetMode()
      ? 'Status: tersambung ke Google Sheets.'
      : 'Status: memakai penyimpanan lokal (localStorage) di perangkat ini.';
    settingsStatus.className = 'settings-status';
  }

  settingsBtn.addEventListener('click', () => {
    sheetUrlInput.value = getSheetUrl();
    updateSettingsStatus();
    settingsModal.classList.remove('hidden');
  });

  closeSettingsBtn.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
  });

  settingsModal.addEventListener('click', (e) => {
    if(e.target === settingsModal) settingsModal.classList.add('hidden');
  });

  saveSheetUrlBtn.addEventListener('click', () => {
    if(saveSheetUrlBtn.disabled) return;
    saveSheetUrlBtn.disabled = true;

    const url = sheetUrlInput.value.trim();

    if(url && !url.startsWith('https://script.google.com/')){
      settingsStatus.textContent = 'URL ini sepertinya bukan URL Web App Google Apps Script yang valid.';
      settingsStatus.className = 'settings-status error';
      saveSheetUrlBtn.disabled = false;
      return;
    }

    setSheetUrl(url);
    clearSession();
    settingsStatus.textContent = url
      ? 'Tersimpan. Silakan masuk kembali untuk terhubung ke Google Sheets ini.'
      : 'Kembali memakai penyimpanan lokal. Silakan masuk kembali.';
    settingsStatus.className = 'settings-status';

    settingsModal.classList.add('hidden');
    appScreen.classList.add('hidden');
    authScreen.classList.remove('hidden');
    loginForm.classList.remove('hidden');
    registerForm.classList.add('hidden');
    saveSheetUrlBtn.disabled = false;
  });
}

/* =========================================================
   MASUK KE APLIKASI / INISIALISASI
   ========================================================= */

async function enterApp(){
  chartMonthOffset = 0;
  authScreen.classList.add('hidden');
  appScreen.classList.remove('hidden');
  renderProfile();
  await renderBalance();
  await renderChart();
  await renderSummaryAndList();
}

(function init(){
  const session = loadSession();
  if(session && session.username){
    if(!isSheetMode()){
      const users = loadLocalUsers();
      if(!users[session.username]){
        clearSession();
        authScreen.classList.remove('hidden');
        appScreen.classList.add('hidden');
        return;
      }
    }
    enterApp();
  } else {
    authScreen.classList.remove('hidden');
    appScreen.classList.add('hidden');
  }
})();
