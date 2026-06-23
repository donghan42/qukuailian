// 模拟区块链节点 - 纯 Node.js 实现，无需 MySQL/Ganache
// 数据持久化到 chain-data.json
// 业务整体闭环：创建众筹项目 → 用户捐赠资金 → 筹款截止自动结算
// 结算分支1：筹款达标(成功) → 发起人全额提现；结算分支2：筹款未达标(失败) → 捐赠人全额退款
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_FILE = path.join(__dirname, 'chain-data.json');

// ========== 全局内存状态存储 state 数据结构说明 ==========
/**
 * users: 钱包地址映射用户基础信息，限制单钱包唯一注册
 * usernameIndex: 用户名校验索引，保证用户名全局唯一
 * projects: 项目主存储，存放每个众筹项目基础信息、筹款金额、截止时间、状态
 * projectCount: 项目自增ID，保证项目唯一标识
 * projectDonations: 按项目维度存储所有捐赠明细，用于展示项目捐款列表
 * donatedAmount: 用户-项目二维索引，快速查询用户对单个项目总捐赠额（退款核心依赖）
 * donorProjects: 用户维度索引，记录该用户所有捐赠过的项目，实现「我的捐赠」查询
 * creatorProjects: 发起人维度索引，记录该用户创建的全部项目，实现「我的发布」查询
 * userFundRecords: 单用户资金流水，存储捐赠/提现/退款记录
 * allFundRecords: 全局全量资金流水，支持后台所有交易查询
 * balances: 模拟链上钱包ETH余额，控制捐赠、提现、退款的资金流转
 */
let state = {
  users: {},                  // address => { username, email, phone, realName, createdAt, exists }
  usernameIndex: {},          // username => address
  projects: {},               // id => Project
  projectCount: 0,
  projectDonations: {},       // projectId => [Donation]
  donatedAmount: {},          // donorAddress => { projectId: amount }
  donorProjects: {},          // donor => [projectId]
  creatorProjects: {},        // creator => [projectId]
  userFundRecords: {},        // user => [FundRecord]
  allFundRecords: [],         // [FundRecord]
  balances: {}                // address => ETH 余额（模拟链上账户）
};

// 加载已有数据
function loadState() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      state = { ...state, ...data };
    } catch (e) {
      console.warn('⚠️ 链数据加载失败，使用空数据');
    }
  }
}

// 持久化：每次业务操作完成后将内存state写入本地json，模拟区块持久化存储
function saveState() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

// 生成假地址（基于种子字符串，便于演示固定测试账号）
function fakeAddress(seed) {
  const hash = crypto.createHash('sha256').update(seed).digest('hex');
  return '0x' + hash.slice(0, 40);
}

// 生成假交易哈希，模拟每笔链上操作唯一tx标识
function fakeTxHash() {
  return '0x' + crypto.randomBytes(32).toString('hex');
}

// 获取当前毫秒时间戳，用于创建时间、众筹截止时间对比
function now() { return Date.now(); }

// ========== 用户模块：钱包注册、信息修改、查询 ==========
function registerUser({ address, username, email, phone, realName }) {
  if (state.users[address]?.exists) throw new Error('该钱包已注册');
  if (state.usernameIndex[username]) throw new Error('用户名已被使用');
  if (username.length < 3 || username.length > 20) throw new Error('用户名长度 3-20 字符');

  state.users[address] = {
    username, email: email || '', phone: phone || '', realName: realName || '',
    createdAt: now(), exists: true
  };
  state.usernameIndex[username] = address;
  // 新注册用户初始化测试余额100ETH
  if (!state.balances[address]) state.balances[address] = 100;
  saveState();
  return state.users[address];
}

function updateUser({ address, email, phone, realName }) {
  if (!state.users[address]?.exists) throw new Error('请先注册');
  const u = state.users[address];
  u.email = email || u.email;
  u.phone = phone || u.phone;
  u.realName = realName || u.realName;
  saveState();
  return u;
}

function getUser(address) {
  return state.users[address] || null;
}

// ========== 项目模块：创建众筹项目、单项目查询、项目分页筛选 ==========
/**
 * createProject 项目创建实现思路
 * 1. 前置参数合法性校验：必须已注册用户、标题非空、目标筹款金额大于0，拦截无效项目
 * 2. 自增全局projectCount生成唯一项目ID；根据传入众筹时长预计算筹款截止时间戳
 * 3. 初始化项目对象存入state.projects，默认状态0（众筹进行中）、初始筹款0
 * 4. 维护发起人索引creatorProjects，记录该用户创建的全部项目，方便「我的发布」查询
 * 5. 生成模拟部署合约交易哈希，持久化数据后返回项目信息
 */
function createProject({ creator, title, description, category, coverImage, goalAmount, durationSeconds }) {
  if (!state.users[creator]?.exists) throw new Error('请先注册用户');
  if (!title) throw new Error('标题不能为空');
  if (!goalAmount || goalAmount <= 0) throw new Error('目标金额必须大于0');

  const projectId = ++state.projectCount;
  const deadline = now() + durationSeconds * 1000;

  state.projects[projectId] = {
    id: projectId,
    creator,
    title, description: description || '',
    category: category || '其他',
    coverImage: coverImage || '',
    goalAmount: parseFloat(goalAmount),
    currentAmount: 0,
    deadline,
    status: 0, // Funding 0=众筹中 1=筹款成功 2=筹款失败 3=资金已提取
    exists: true,
    createdAt: now()
  };

  if (!state.creatorProjects[creator]) state.creatorProjects[creator] = [];
  state.creatorProjects[creator].push(projectId);

  const txHash = fakeTxHash();
  saveState();
  return { projectId, txHash, project: state.projects[projectId] };
}

function getProject(id) {
  const p = state.projects[id];
  if (!p?.exists) throw new Error('项目不存在');
  return p;
}

function listProjects({ keyword = '', category = '', status = '', sort = 'new', page = 1, pageSize = 12, creator = '', donor = '' } = {}) {
  let list = Object.values(state.projects).filter(p => p.exists);

  if (keyword) {
    const k = keyword.toLowerCase();
    list = list.filter(p => p.title.toLowerCase().includes(k) || (p.description || '').toLowerCase().includes(k));
  }
  if (category) list = list.filter(p => p.category === category);
  if (status !== '' && status !== null && status !== undefined) {
    list = list.filter(p => p.status === parseInt(status));
  }
  if (creator) list = list.filter(p => p.creator === creator);
  if (donor) list = list.filter(p => (state.donatedAmount[donor]?.[p.id] || 0) > 0);

  // 附加发起人信息
  list = list.map(p => ({
    ...p,
    creator_name: state.users[p.creator]?.username || '未知',
    creator_real_name: state.users[p.creator]?.realName || '',
    donor_count: (state.projectDonations[p.id] || []).filter(d => !d.refunded).length
  }));

  // 排序
  if (sort === 'hot') list.sort((a, b) => b.currentAmount - a.currentAmount);
  else if (sort === 'ending') list.sort((a, b) => a.deadline - b.deadline);
  else list.sort((a, b) => b.id - a.id);

  const total = list.length;
  const offset = (page - 1) * pageSize;
  return { list: list.slice(offset, offset + pageSize), total };
}

// ========== 捐赠模块：用户向众筹项目捐赠资金 ==========
/**
 * donate 资金捐赠实现思路
 * 1. 多层安全校验：用户已注册、项目存在、项目处于众筹中、未到截止时间、金额合法、余额充足，杜绝非法转账
 * 2. 模拟链上转账：扣除捐赠人余额，同步累加项目当前筹款金额
 * 3. 多维度冗余索引同步更新：
 *    donatedAmount：记录用户对该项目总捐赠额（退款时读取总额）
 *    donorProjects：记录用户捐赠过的所有项目
 *    projectDonations：存入单条捐赠明细，展示项目捐款列表
 * 4. 生成txType=1捐赠流水，同步存入个人流水与全局流水，支持交易溯源
 * 5. 自动判断筹款是否达标：currentAmount >= goalAmount 则自动将项目状态改为1（筹款成功）
 * 6. 持久化数据，返回交易哈希、捐赠后余额、更新后的项目信息
 */
function donate({ donor, projectId, amount, message = '' }) {
  if (!state.users[donor]?.exists) throw new Error('请先注册用户');
  const p = state.projects[projectId];
  if (!p?.exists) throw new Error('项目不存在');
  if (p.status !== 0) throw new Error('项目不在众筹中');
  if (now() >= p.deadline) throw new Error('众筹已结束');
  if (!amount || amount <= 0) throw new Error('捐赠金额必须大于0');
  if ((state.balances[donor] || 0) < amount) throw new Error('账户余额不足');

  // 扣款
  state.balances[donor] -= amount;
  p.currentAmount = (p.currentAmount || 0) + amount;

  // 记录捐赠关联索引
  if (!state.donatedAmount[donor]) state.donatedAmount[donor] = {};
  state.donatedAmount[donor][projectId] = (state.donatedAmount[donor][projectId] || 0) + amount;
  if (!state.donorProjects[donor]) state.donorProjects[donor] = [];
  if (state.donatedAmount[donor][projectId] === amount) {
    state.donorProjects[donor].push(projectId);
  }

  if (!state.projectDonations[projectId]) state.projectDonations[projectId] = [];
  state.projectDonations[projectId].push({
    donor, projectId, amount, timestamp: now(), message, refunded: false
  });

  // 流水 txType=1 捐赠支出
  const r = { projectId, user: donor, txType: 1, amount, timestamp: now() };
  if (!state.userFundRecords[donor]) state.userFundRecords[donor] = [];
  state.userFundRecords[donor].push(r);
  state.allFundRecords.push(r);

  // 达成筹款目标，自动变更项目状态为成功
  if (p.currentAmount >= p.goalAmount) p.status = 1;

  const txHash = fakeTxHash();
  saveState();
  return { txHash, project: p, newBalance: state.balances[donor] };
}

function getProjectDonations(projectId) {
  return (state.projectDonations[projectId] || []).map(d => ({
    ...d,
    username: state.users[d.donor]?.username || '',
    real_name: state.users[d.donor]?.realName || ''
  }));
}

// ========== 筹款成功分支：发起人全额提现 withdrawFunds ==========
/**
 * withdrawFunds 筹款成功提现实现思路
 * 前置业务前提：项目筹款达标 status=1，仅项目创建人可操作
 * 1. 权限校验：项目存在、操作人为项目发起人、项目状态为成功、尚有未提取资金
 * 2. 资金流转：项目全部筹款转入发起人钱包余额，项目currentAmount置0
 * 3. 项目状态更新为3（资金已提取），防止重复提现
 * 4. 生成txType=2提现入账流水，同步个人、全局流水用于账单查询
 * 5. 持久化返回交易哈希与提现后余额
 */
function withdrawFunds({ creator, projectId }) {
  const p = state.projects[projectId];
  if (!p?.exists) throw new Error('项目不存在');
  if (p.creator !== creator) throw new Error('只有项目发起人可以提取');
  if (p.status !== 1) throw new Error('项目未达到目标');
  if (p.currentAmount <= 0) throw new Error('没有可提取的资金');

  const amount = p.currentAmount;
  state.balances[creator] = (state.balances[creator] || 0) + amount;
  p.currentAmount = 0;
  p.status = 3; // Withdrawn 资金已提取

  // 流水 txType=2 发起人提现入账
  const r = { projectId, user: creator, txType: 2, amount, timestamp: now() };
  if (!state.userFundRecords[creator]) state.userFundRecords[creator] = [];
  state.userFundRecords[creator].push(r);
  state.allFundRecords.push(r);

  const txHash = fakeTxHash();
  saveState();
  return { txHash, project: p, newBalance: state.balances[creator] };
}

// ========== 筹款失败分支：捐赠人全额退款 refund ==========
/**
 * refund 筹款失败退款实现思路
 * 1. 自动结算逻辑：接口触发时校验项目是否超时未结算，自动更新最终状态
 *    众筹中+已过截止时间：筹款达标=status1成功；未达标=status2失败
 * 2. 退款权限校验：项目状态必须为2（失败），且用户存在该项目捐赠记录
 * 3. 资金回滚：全额返还用户捐赠金额至钱包余额，清空用户该项目累计捐赠记录
 * 4. 标记该用户所有捐赠明细refunded=true，前端区分已退款/有效捐赠
 * 5. 生成txType=3退款入账流水，存入个人、全局流水，完成资金闭环
 */
function refund({ donor, projectId }) {
  const p = state.projects[projectId];
  if (!p?.exists) throw new Error('项目不存在');

  // 自动结算到期未更新状态的项目
  if (p.status === 0 && now() >= p.deadline) {
    p.status = p.currentAmount >= p.goalAmount ? 1 : 2;
  }
  if (p.status !== 2) throw new Error('项目未失败，不可退款');

  const amount = state.donatedAmount[donor]?.[projectId] || 0;
  if (amount <= 0) throw new Error('您没有向该项目捐赠');

  state.donatedAmount[donor][projectId] = 0;
  state.balances[donor] = (state.balances[donor] || 0) + amount;

  // 标记该用户所有捐赠记录为已退款
  const dons = state.projectDonations[projectId] || [];
  dons.forEach(d => { if (d.donor === donor) d.refunded = true; });

  // 流水 txType=3 退款入账
  const r = { projectId, user: donor, txType: 3, amount, timestamp: now() };
  if (!state.userFundRecords[donor]) state.userFundRecords[donor] = [];
  state.userFundRecords[donor].push(r);
  state.allFundRecords.push(r);

  const txHash = fakeTxHash();
  saveState();
  return { txHash, newBalance: state.balances[donor] };
}

// ========== 资金流水、余额查询工具函数 ==========
function getUserFundRecords(user, { txType, projectId } = {}) {
  let list = state.userFundRecords[user] || [];
  if (txType !== undefined) list = list.filter(r => r.txType === txType);
  if (projectId) list = list.filter(r => r.projectId === parseInt(projectId));
  return list.map(r => ({ ...r, project_title: state.projects[r.projectId]?.title || '' }));
}

function getAllFundRecords({ txType, offset = 0, limit = 20 } = {}) {
  let list = [...state.allFundRecords].reverse();
  if (txType) list = list.filter(r => r.txType === parseInt(txType));
  return list.slice(offset, offset + limit).map(r => ({
    ...r,
    project_title: state.projects[r.projectId]?.title || '',
    username: state.users[r.user]?.username || ''
  }));
}

function getBalance(address) {
  return state.balances[address] || 0;
}

// ========== 初始化演示数据 ==========
function initDemoData() {
  if (state.projectCount > 0) return; // 已初始化

  console.log('🌱 初始化演示数据...');

  // 创建一些默认用户和地址
  const demoUsers = [
    { addr: fakeAddress('alice'), name: 'alice', real: '张小爱', email: 'alice@example.com' },
    { addr: fakeAddress('bob'), name: 'bob', real: '李大博', email: 'bob@example.com' },
    { addr: fakeAddress('charlie'), name: 'charlie', real: '王中查理', email: 'charlie@example.com' }
  ];

  demoUsers.forEach(u => {
    state.users[u.addr] = {
      username: u.name, email: u.email, phone: '', realName: u.real,
      createdAt: now(), exists: true
    };
    state.usernameIndex[u.name] = u.addr;
    state.balances[u.addr] = 100;
  });

  // 创建演示项目
  const demoProjects = [
    {
      creator: demoUsers[0].addr,
      title: '智能手表 Pro 革命性新品',
      description: '一款革命性的智能手表，集健康监测、运动追踪、移动支付于一体，续航长达30天。我们已经完成了原型设计，现在需要您的支持进入量产阶段。',
      category: '科技产品', coverImage: '',
      goalAmount: 10, durationSeconds: 30 * 24 * 3600
    },
    {
      creator: demoUsers[1].addr,
      title: '原创独立电影《追光者》',
      description: '一部关于梦想与坚持的原创独立电影，讲述小镇青年追逐电影梦想的感人故事。导演团队来自北京电影学院，剧本已打磨三年。',
      category: '影视艺术', coverImage: '',
      goalAmount: 5, durationSeconds: 60 * 24 * 3600
    },
    {
      creator: demoUsers[2].addr,
      title: '环保再生纸笔记本',
      description: '使用100%再生纸制作的精美笔记本，每售出一本我们将种植一棵树。设计精美，手感细腻，是送礼和自用的绝佳选择。',
      category: '环保公益', coverImage: '',
      goalAmount: 2, durationSeconds: 20 * 24 * 3600
    }
  ];

  demoProjects.forEach(p => {
    state.projectCount++;
    const pid = state.projectCount;
    state.projects[pid] = {
      id: pid, creator: p.creator,
      title: p.title, description: p.description, category: p.category, coverImage: p.coverImage,
      goalAmount: p.goalAmount, currentAmount: 0, deadline: now() + p.durationSeconds * 1000,
      status: 0, exists: true, createdAt: now()
    };
    if (!state.creatorProjects[p.creator]) state.creatorProjects[p.creator] = [];
    state.creatorProjects[p.creator].push(pid);
  });

  // 模拟一些捐赠
  const demoDonations = [
    { donor: demoUsers[1].addr, projectId: 1, amount: 2, message: '加油！' },
    { donor: demoUsers[2].addr, projectId: 1, amount: 1.5, message: '期待产品！' },
    { donor: demoUsers[0].addr, projectId: 2, amount: 0.8, message: '支持国产独立电影' },
    { donor: demoUsers[0].addr, projectId: 3, amount: 0.5, message: '环保从我做起' },
    { donor: demoUsers[1].addr, projectId: 3, amount: 0.3, message: '' }
  ];

  demoDonations.forEach(d => {
    state.balances[d.donor] -= d.amount;
    state.projects[d.projectId].currentAmount += d.amount;
    if (!state.donatedAmount[d.donor]) state.donatedAmount[d.donor] = {};
    state.donatedAmount[d.donor][d.projectId] = (state.donatedAmount[d.donor][d.projectId] || 0) + d.amount;
    if (!state.donorProjects[d.donor]) state.donorProjects[d.donor] = [];
    if (state.donatedAmount[d.donor][d.projectId] === d.amount) {
      state.donorProjects[d.donor].push(d.projectId);
    }
    if (!state.projectDonations[d.projectId]) state.projectDonations[d.projectId] = [];
    state.projectDonations[d.projectId].push({
      donor: d.donor, projectId: d.projectId, amount: d.amount,
      timestamp: now(), message: d.message, refunded: false
    });
    if (!state.userFundRecords[d.donor]) state.userFundRecords[d.donor] = [];
    const r = { projectId: d.projectId, user: d.donor, txType: 1, amount: d.amount, timestamp: now() };
    state.userFundRecords[d.donor].push(r);
    state.allFundRecords.push(r);
  });

  saveState();
  console.log('✅ 演示数据初始化完成');
}

// 程序启动自动加载本地链数据；无数据/空数据时初始化演示案例
loadState();
if (!fs.existsSync(DATA_FILE) || state.projectCount === 0) {
  initDemoData();
}

module.exports = {
  state, loadState, saveState,
  fakeAddress, fakeTxHash, now,
  registerUser, updateUser, getUser,
  createProject, getProject, listProjects,
  donate, getProjectDonations,
  withdrawFunds, refund,
  getUserFundRecords, getAllFundRecords,
  getBalance
};