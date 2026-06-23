// 全局工具函数
const API_BASE = '/api';

// 通用 fetch 封装
async function request(url, options = {}) {
  try {
    const res = await fetch(API_BASE + url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const data = await res.json();
    if (data.code === 500) {
      console.error('API错误:', data.message);
    }
    return data;
  } catch (err) {
    console.error('请求失败:', err);
    return { code: -1, message: '网络错误：' + err.message };
  }
}

const api = {
  // 用户
  register: (data) => request('/users/register', { method: 'POST', body: data }),
  getProfile: (address) => request('/users/profile?address=' + address),
  updateProfile: (data) => request('/users/profile', { method: 'PUT', body: data }),
  getBalance: (address) => request('/users/balance?address=' + address),

  // 项目
  listProjects: (params) => {
    const qs = new URLSearchParams(params || {}).toString();
    return request('/projects/list' + (qs ? '?' + qs : ''));
  },
  getProjectDetail: (id) => request('/projects/detail?id=' + id),
  createProject: (data) => request('/projects/create', { method: 'POST', body: data }),
  myProjects: (address) => request('/projects/my?address=' + address),
  projectsByCreator: (address) => request('/projects/by-creator?address=' + address),
  projectsByDonor: (address) => request('/projects/by-donor?address=' + address),

  // 捐赠
  createDonation: (data) => request('/donations/create', { method: 'POST', body: data }),
  myDonations: (address) => request('/donations/my?address=' + address),
  getProjectDonations: (id) => request('/donations/project?id=' + id),
  refund: (data) => request('/donations/refund', { method: 'POST', body: data }),

  // 资金
  withdrawFunds: (data) => request('/funds/withdraw', { method: 'POST', body: data }),
  getFundTransactions: (params) => {
    const qs = new URLSearchParams(params || {}).toString();
    return request('/funds/transactions' + (qs ? '?' + qs : ''));
  },

  // 演示
  demoReset: () => request('/demo/reset'),
  demoFaucet: (address) => request('/demo/faucet?address=' + address),
  demoUsers: () => request('/demo/users')
};

// Toast 提示
function showToast(message, type = 'info', duration = 2500) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position:fixed;top:24px;right:24px;z-index:9999;display:flex;flex-direction:column;gap:8px;';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  const colors = { success: '#10b981', danger: '#ef4444', warning: '#f59e0b', info: '#6366f1' };
  toast.style.cssText = `
    background: white;
    padding: 12px 20px;
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.15);
    border-left: 4px solid ${colors[type]};
    color: #1f2937;
    font-size: 14px;
    min-width: 240px;
    animation: slideIn 0.3s;
    max-width: 360px;
  `;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, duration);

  if (!document.getElementById('toast-style')) {
    const s = document.createElement('style');
    s.id = 'toast-style';
    s.textContent = `
      @keyframes slideIn { from { transform: translateX(120%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
      @keyframes slideOut { from { opacity: 1; } to { opacity: 0; transform: translateX(120%); } }
    `;
    document.head.appendChild(s);
  }
}

// 用户身份（基于本地模拟钱包）
const Auth = {
  getUser() {
    const u = localStorage.getItem('user');
    return u ? JSON.parse(u) : null;
  },
  setUser(u) {
    localStorage.setItem('user', JSON.stringify(u));
  },
  getAddress() {
    return localStorage.getItem('wallet_address');
  },
  setAddress(addr) {
    localStorage.setItem('wallet_address', addr);
  },
  isLoggedIn() { return !!this.getUser(); },
  logout() {
    localStorage.removeItem('user');
    localStorage.removeItem('wallet_address');
  }
};

// 格式化
function formatAddress(addr, head = 6, tail = 4) {
  if (!addr) return '';
  if (addr.length <= head + tail) return addr;
  return addr.slice(0, head) + '...' + addr.slice(-tail);
}
function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts);
  const pad = (n) => n < 10 ? '0' + n : n;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function formatETH(amount) {
  return parseFloat(amount || 0).toFixed(4) + ' ETH';
}

const STATUS_MAP = {
  0: { text: '众筹中', class: 'badge-info' },
  1: { text: '众筹成功', class: 'badge-success' },
  2: { text: '众筹失败', class: 'badge-danger' },
  3: { text: '已提取', class: 'badge-warning' }
};
function statusBadge(status) {
  const s = STATUS_MAP[status] || { text: '未知', class: 'badge-gray' };
  return `<span class="badge ${s.class}">${s.text}</span>`;
}
const TX_TYPE_MAP = { 1: '捐赠', 2: '提取', 3: '退款' };

// 加载导航栏
function renderNavbar(active) {
  const user = Auth.getUser();
  const nav = document.getElementById('navbar');
  if (!nav) return;
  nav.innerHTML = `
    <div class="nav-container">
      <a href="/" class="logo">
        <div class="logo-icon">₿</div>
        <span>众筹宝</span>
      </a>
      <ul class="nav-menu">
        <li><a href="/" class="${active === 'home' ? 'active' : ''}">首页</a></li>
        <li><a href="/projects.html" class="${active === 'projects' ? 'active' : ''}">浏览项目</a></li>
        <li><a href="/create-project.html" class="${active === 'create' ? 'active' : ''}">发起项目</a></li>
        ${user ? `<li><a href="/profile.html" class="${active === 'profile' ? 'active' : ''}">个人中心</a></li>` : ''}
      </ul>
      <div class="nav-right">
        <button id="wallet-btn" class="wallet-btn">
          <span id="wallet-text">🔗 连接钱包</span>
        </button>
        ${user
          ? `<span class="text-sm text-bold">${user.username}</span>
             <button class="btn btn-secondary btn-sm" onclick="doLogout()">退出</button>`
          : `<a href="/login.html" class="btn btn-primary btn-sm">登录 / 注册</a>`
        }
      </div>
    </div>
  `;
  document.getElementById('wallet-btn')?.addEventListener('click', () => {
    if (Auth.isLoggedIn()) {
      // 显示钱包信息
      const u = Auth.getUser();
      const a = Auth.getAddress();
      const html = `
        <div class="modal" onclick="event.stopPropagation()">
          <div class="modal-header">
            <div class="modal-title">🔗 钱包信息</div>
            <button class="modal-close" onclick="closeModal()">×</button>
          </div>
          <div class="form-group">
            <label class="form-label">钱包地址</label>
            <div class="form-control" style="word-break:break-all;font-family:monospace;font-size:12px">${a}</div>
          </div>
          <div class="form-group">
            <label class="form-label">用户名</label>
            <div class="form-control">${u.username}</div>
          </div>
          <div class="form-group">
            <label class="form-label">模拟余额</label>
            <div id="modal-balance" class="form-control text-bold text-primary">加载中...</div>
          </div>
          <button class="btn btn-primary btn-block" onclick="faucet()">🚰 领取 10 ETH 测试币</button>
          <button class="btn btn-secondary btn-block mt-1" onclick="copyAddress('${a}')">📋 复制地址</button>
        </div>
      `;
      showModal(html);
      api.getBalance(a).then(r => {
        if (r.code === 0) document.getElementById('modal-balance').textContent = r.data.balance.toFixed(4) + ' ETH';
      });
    } else {
      location.href = '/login.html';
    }
  });
  if (Auth.isLoggedIn()) {
    document.getElementById('wallet-text').textContent = '💼 ' + Auth.getUser().username;
  }
}

function doLogout() {
  Auth.logout();
  showToast('已退出', 'success');
  setTimeout(() => location.href = '/', 500);
}

function showModal(html) {
  const m = document.createElement('div');
  m.className = 'modal-overlay active';
  m.onclick = (e) => { if (e.target === m) m.remove(); };
  m.innerHTML = html;
  document.body.appendChild(m);
  window._currentModal = m;
}
function closeModal() {
  if (window._currentModal) {
    window._currentModal.remove();
    window._currentModal = null;
  }
}
function copyAddress(addr) {
  navigator.clipboard.writeText(addr).then(() => showToast('地址已复制', 'success'));
}
async function faucet() {
  const a = Auth.getAddress();
  const r = await api.demoFaucet(a);
  if (r.code === 0) {
    showToast('已领取 10 ETH！', 'success');
    document.getElementById('modal-balance').textContent = r.data.balance.toFixed(4) + ' ETH';
  } else {
    showToast(r.message, 'danger');
  }
}
