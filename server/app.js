// 轻量级 HTTP 服务 - 无数据库依赖
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const chain = require('./mock-chain');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// MIME 类型
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// 工具
function sendJSON(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function asyncHandler(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      console.error('API错误:', err);
      sendJSON(res, { code: 500, message: err.message || '服务器错误' }, 500);
    }
  };
}

// 路由处理
const routes = {
  // 健康检查
  'GET /api/health': (req, res) => {
    sendJSON(res, {
      code: 0, message: 'ok',
      data: {
        service: 'blockchain-crowdfunding',
        status: 'running',
        mode: 'mock-chain',
        chain: {
          projects: chain.state.projectCount,
          users: Object.keys(chain.state.users).length,
          donations: chain.state.allFundRecords.length
        },
        time: new Date().toISOString()
      }
    });
  },

  // ========== 用户 ==========
  'POST /api/users/register': asyncHandler(async (req, res) => {
    const body = await readBody(req);
    const { address, username, email, phone, realName } = body;
    if (!address) return sendJSON(res, { code: 400, message: '缺少钱包地址' });
    const user = chain.registerUser({ address, username, email, phone, realName });
    sendJSON(res, { code: 0, message: '注册成功', data: user });
  }),

  'GET /api/users/profile': asyncHandler(async (req, res) => {
    const address = url.parse(req.url, true).query.address;
    if (!address) return sendJSON(res, { code: 400, message: '缺少地址' });
    const user = chain.getUser(address);
    if (!user) return sendJSON(res, { code: 404, message: '用户不存在' });
    sendJSON(res, { code: 0, message: 'ok', data: { ...user, address, balance: chain.getBalance(address) } });
  }),

  'PUT /api/users/profile': asyncHandler(async (req, res) => {
    const body = await readBody(req);
    const { address, email, phone, realName } = body;
    if (!address) return sendJSON(res, { code: 400, message: '缺少地址' });
    const user = chain.updateUser({ address, email, phone, realName });
    sendJSON(res, { code: 0, message: '更新成功', data: user });
  }),

  'GET /api/users/balance': asyncHandler(async (req, res) => {
    const address = url.parse(req.url, true).query.address;
    if (!address) return sendJSON(res, { code: 400, message: '缺少地址' });
    sendJSON(res, { code: 0, message: 'ok', data: { address, balance: chain.getBalance(address) } });
  }),

  // ========== 项目 ==========
  'GET /api/projects/list': asyncHandler(async (req, res) => {
    const q = url.parse(req.url, true).query;
    const data = chain.listProjects({
      keyword: q.keyword || '',
      category: q.category || '',
      status: q.status,
      sort: q.sort || 'new',
      page: parseInt(q.page) || 1,
      pageSize: parseInt(q.pageSize) || 12,
      creator: q.creator || '',
      donor: q.donor || ''
    });
    sendJSON(res, { code: 0, message: 'ok', data });
  }),

  'GET /api/projects/detail': asyncHandler(async (req, res) => {
    const id = parseInt(url.parse(req.url, true).query.id);
    const project = chain.getProject(id);
    const donations = chain.getProjectDonations(id);
    const creator = chain.getUser(project.creator);
    sendJSON(res, {
      code: 0, message: 'ok',
      data: {
        project: {
          ...project,
          creator_name: creator?.username || '',
          creator_real_name: creator?.realName || '',
          creator_wallet: project.creator
        },
        stats: {
          donor_count: donations.filter(d => !d.refunded).length,
          total_amount: donations.filter(d => !d.refunded).reduce((s, d) => s + d.amount, 0)
        },
        recentDonations: donations.slice(-10).reverse()
      }
    });
  }),

  'POST /api/projects/create': asyncHandler(async (req, res) => {
    const body = await readBody(req);
    const { creator, title, description, category, coverImage, goalAmount, durationSeconds } = body;
    if (!creator) return sendJSON(res, { code: 400, message: '缺少创建者地址' });
    const result = chain.createProject({ creator, title, description, category, coverImage, goalAmount, durationSeconds });
    sendJSON(res, { code: 0, message: '项目创建成功', data: { id: result.projectId, tx_hash: result.txHash, project: result.project } });
  }),

  'GET /api/projects/my': asyncHandler(async (req, res) => {
    const address = url.parse(req.url, true).query.address;
    if (!address) return sendJSON(res, { code: 400, message: '缺少地址' });
    const ids = chain.state.creatorProjects[address] || [];
    const projects = ids.map(id => chain.state.projects[id]).filter(Boolean);
    sendJSON(res, { code: 0, message: 'ok', data: projects });
  }),

  'GET /api/projects/by-creator': asyncHandler(async (req, res) => {
    const address = url.parse(req.url, true).query.address;
    const data = chain.listProjects({ creator: address, pageSize: 100 });
    sendJSON(res, { code: 0, message: 'ok', data });
  }),

  'GET /api/projects/by-donor': asyncHandler(async (req, res) => {
    const address = url.parse(req.url, true).query.address;
    const data = chain.listProjects({ donor: address, pageSize: 100 });
    sendJSON(res, { code: 0, message: 'ok', data });
  }),

  // ========== 捐赠 ==========
  'POST /api/donations/create': asyncHandler(async (req, res) => {
    const body = await readBody(req);
    const { donor, projectId, amount, message } = body;
    if (!donor) return sendJSON(res, { code: 400, message: '缺少捐赠者地址' });
    const result = chain.donate({ donor, projectId: parseInt(projectId), amount: parseFloat(amount), message });
    sendJSON(res, { code: 0, message: '捐赠成功', data: { tx_hash: result.txHash, project: result.project, new_balance: result.newBalance } });
  }),

  'GET /api/donations/my': asyncHandler(async (req, res) => {
    const address = url.parse(req.url, true).query.address;
    const ids = chain.state.donorProjects[address] || [];
    const data = [];
    ids.forEach(pid => {
      const dons = (chain.state.projectDonations[pid] || []).filter(d => d.donor === address);
      dons.forEach(d => {
        data.push({
          ...d,
          project_title: chain.state.projects[pid]?.title || '',
          project_status: chain.state.projects[pid]?.status,
          tx_hash: '0x' + require('crypto').createHash('sha256').update(JSON.stringify(d)).digest('hex')
        });
      });
    });
    data.sort((a, b) => b.timestamp - a.timestamp);
    sendJSON(res, { code: 0, message: 'ok', data });
  }),

  'GET /api/donations/project': asyncHandler(async (req, res) => {
    const id = parseInt(url.parse(req.url, true).query.id);
    const data = chain.getProjectDonations(id);
    sendJSON(res, { code: 0, message: 'ok', data });
  }),

  'POST /api/donations/refund': asyncHandler(async (req, res) => {
    const body = await readBody(req);
    const { donor, projectId } = body;
    if (!donor) return sendJSON(res, { code: 400, message: '缺少捐赠者地址' });
    const result = chain.refund({ donor, projectId: parseInt(projectId) });
    sendJSON(res, { code: 0, message: '退款成功', data: { tx_hash: result.txHash, new_balance: result.newBalance } });
  }),

  // ========== 资金 ==========
  'POST /api/funds/withdraw': asyncHandler(async (req, res) => {
    const body = await readBody(req);
    const { creator, projectId } = body;
    if (!creator) return sendJSON(res, { code: 400, message: '缺少创建者地址' });
    const result = chain.withdrawFunds({ creator, projectId: parseInt(projectId) });
    sendJSON(res, { code: 0, message: '提取成功', data: { tx_hash: result.txHash, project: result.project, new_balance: result.newBalance } });
  }),

  'GET /api/funds/transactions': asyncHandler(async (req, res) => {
    const q = url.parse(req.url, true).query;
    const data = chain.getUserFundRecords(q.address, { txType: q.txType, projectId: q.projectId });
    sendJSON(res, { code: 0, message: 'ok', data });
  }),

  'GET /api/funds/all-transactions': asyncHandler(async (req, res) => {
    const q = url.parse(req.url, true).query;
    const data = chain.getAllFundRecords({ txType: q.txType, offset: parseInt(q.offset) || 0, limit: parseInt(q.limit) || 50 });
    sendJSON(res, { code: 0, message: 'ok', data });
  }),

  // ========== 演示辅助 ==========
  'GET /api/demo/reset': (req, res) => {
    // 删除持久化文件并重置内存状态
    if (fs.existsSync(path.join(__dirname, 'chain-data.json'))) {
      fs.unlinkSync(path.join(__dirname, 'chain-data.json'));
    }
    // 重置内存状态
    state.projectCount = 0;
    state.users = {};
    state.usernameIndex = {};
    state.projects = {};
    state.projectDonations = {};
    state.donatedAmount = {};
    state.donorProjects = {};
    state.creatorProjects = {};
    state.userFundRecords = {};
    state.allFundRecords = [];
    state.balances = {};
    saveState();
    // 通过 fork 子进程重新加载（确保干净状态）
    sendJSON(res, { code: 0, message: '链数据已重置，请刷新页面' });
  },

  // 测试加速：把指定项目 deadline 设为已过期（默认 1 秒前）
  // 用法: /api/demo/fast-forward?id=1  或  /api/demo/fast-forward?id=1&offset=-1
  'GET /api/demo/fast-forward': (req, res) => {
    const q = url.parse(req.url, true).query;
    const id = parseInt(q.id);
    if (!id || !chain.state.projects[id]?.exists) {
      return sendJSON(res, { code: 400, message: '项目不存在' });
    }
    const offsetSec = parseInt(q.offset || '-1'); // 默认设为 1 秒前（已过期）
    chain.state.projects[id].deadline = Date.now() + offsetSec * 1000;
    chain.saveState();
    sendJSON(res, {
      code: 0, message: `项目 #${id} 的 deadline 已调整为 ${new Date(chain.state.projects[id].deadline).toISOString()}`,
      data: { projectId: id, deadline: chain.state.projects[id].deadline }
    });
  },

  // 测试加速：主动结算所有 status=0 且已过 deadline 的项目
  'GET /api/demo/settle': (req, res) => {
    let settled = 0;
    Object.values(chain.state.projects).forEach(p => {
      if (p.exists && p.status === 0 && Date.now() >= p.deadline) {
        p.status = (p.currentAmount || 0) >= p.goalAmount ? 1 : 2;
        settled++;
      }
    });
    chain.saveState();
    sendJSON(res, { code: 0, message: `已结算 ${settled} 个项目`, data: { settled } });
  },

  // 测试加速：把指定项目直接标记为已成功（用于测提现流程）
  'GET /api/demo/force-success': (req, res) => {
    const q = url.parse(req.url, true).query;
    const id = parseInt(q.id);
    if (!id || !chain.state.projects[id]?.exists) {
      return sendJSON(res, { code: 400, message: '项目不存在' });
    }
    const p = chain.state.projects[id];
    p.status = 1;
    if ((p.currentAmount || 0) < p.goalAmount) p.currentAmount = p.goalAmount;
    chain.saveState();
    sendJSON(res, { code: 0, message: `项目 #${id} 已标记为众筹成功（可直接测提现）`, data: { project: p } });
  },

  // 测试加速：把指定项目直接标记为已失败（用于测退款流程）
  'GET /api/demo/force-fail': (req, res) => {
    const q = url.parse(req.url, true).query;
    const id = parseInt(q.id);
    if (!id || !chain.state.projects[id]?.exists) {
      return sendJSON(res, { code: 400, message: '项目不存在' });
    }
    const p = chain.state.projects[id];
    p.status = 2;
    p.currentAmount = Math.min(p.currentAmount || 0, p.goalAmount * 0.5);
    chain.saveState();
    sendJSON(res, { code: 0, message: `项目 #${id} 已标记为众筹失败（可直接测退款）`, data: { project: p } });
  },

  'GET /api/demo/faucet': asyncHandler(async (req, res) => {
    const address = url.parse(req.url, true).query.address;
    if (!address) return sendJSON(res, { code: 400, message: '缺少地址' });
    chain.state.balances[address] = (chain.state.balances[address] || 0) + 10;
    chain.saveState();
    sendJSON(res, { code: 0, message: '已领取 10 ETH 测试余额', data: { balance: chain.getBalance(address) } });
  }),

  'GET /api/demo/users': (req, res) => {
    // 返回演示账号的固定地址，方便测试
    sendJSON(res, {
      code: 0, message: 'ok',
      data: {
        users: Object.entries(chain.state.users).map(([addr, u]) => ({
          address: addr, username: u.username, realName: u.realName, balance: chain.state.balances[addr] || 0
        }))
      }
    });
  }
};

// HTTP 服务器
const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const key = `${req.method} ${pathname}`;

  // API 路由
  if (routes[key]) {
    return routes[key](req, res);
  }

  // 静态文件
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(PUBLIC_DIR, filePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('========================================');
  console.log('  区块链众筹系统（纯链上模式）');
  console.log('========================================');
  console.log(`🚀 服务地址: http://localhost:${PORT}`);
  console.log(`📊 健康检查: http://localhost:${PORT}/api/health`);
  console.log(`🌐 前端访问: http://localhost:${PORT}`);
  console.log('💾 链数据持久化文件: server/chain-data.json');
  console.log('🔄 重置链数据: http://localhost:' + PORT + '/api/demo/reset');
  console.log('========================================');
  console.log(`📦 当前链上: ${chain.state.projectCount} 个项目，${Object.keys(chain.state.users).length} 个用户，${chain.state.allFundRecords.length} 条交易`);
  console.log('========================================');
});
