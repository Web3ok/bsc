"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const supertest_1 = __importDefault(require("supertest"));
const express_1 = __importDefault(require("express"));
(0, vitest_1.describe)('钱包管理API端点测试', () => {
    let app;
    const mockWallets = new Map();
    (0, vitest_1.beforeAll)(() => {
        app = (0, express_1.default)();
        app.use(express_1.default.json());
        // 模拟钱包存储
        let walletIdCounter = 1;
        // GET /api/wallets - 获取所有钱包
        app.get('/api/wallets', (req, res) => {
            const { group } = req.query;
            let wallets = Array.from(mockWallets.values());
            if (group) {
                wallets = wallets.filter(w => w.group === group);
            }
            res.json({
                success: true,
                data: wallets
            });
        });
        // POST /api/wallets/create - 创建新钱包
        app.post('/api/wallets/create', (req, res) => {
            const { label, group, generateNew = true, privateKey } = req.body;
            if (!label) {
                return res.status(400).json({
                    success: false,
                    error: 'Label is required'
                });
            }
            let address;
            if (generateNew) {
                // 生成模拟地址
                address = `0x${walletIdCounter.toString().padStart(40, '0')}`;
            }
            else {
                if (!privateKey) {
                    return res.status(400).json({
                        success: false,
                        error: 'Private key is required when not generating new wallet'
                    });
                }
                // 从私钥生成地址（模拟）
                address = `0x${privateKey.slice(-40)}`;
            }
            const wallet = {
                address,
                label,
                group: group || null,
                balance: '0.0',
                nonce: 0,
                status: 'active',
                transactions24h: 0,
                lastActivity: new Date().toISOString(),
                tokenBalances: [],
                createdAt: new Date().toISOString(),
                encryptedPrivateKey: 'encrypted_' + privateKey || 'encrypted_generated_key'
            };
            mockWallets.set(address, wallet);
            walletIdCounter++;
            res.json({
                success: true,
                data: wallet
            });
        });
        // POST /api/wallets/import - 导入钱包
        app.post('/api/wallets/import', (req, res) => {
            const { type, content, password } = req.body;
            if (!type || !content) {
                return res.status(400).json({
                    success: false,
                    error: 'Type and content are required'
                });
            }
            let imported = 0;
            const importedWallets = [];
            try {
                if (type === 'json') {
                    const data = JSON.parse(content);
                    if (Array.isArray(data.wallets)) {
                        for (const walletData of data.wallets) {
                            const address = `0x${imported.toString().padStart(40, '0')}`;
                            const wallet = {
                                address,
                                label: walletData.label || `Imported Wallet ${imported + 1}`,
                                group: walletData.group || 'imported',
                                balance: '0.0',
                                nonce: 0,
                                status: 'active',
                                transactions24h: 0,
                                lastActivity: new Date().toISOString(),
                                tokenBalances: [],
                                encryptedPrivateKey: 'encrypted_imported_key'
                            };
                            mockWallets.set(address, wallet);
                            importedWallets.push(wallet);
                            imported++;
                        }
                    }
                }
                else if (type === 'csv') {
                    const lines = content.split('\n').filter(line => line.trim());
                    for (let i = 1; i < lines.length; i++) { // 跳过标题行
                        const [address, label, group] = lines[i].split(',');
                        if (address && address.startsWith('0x')) {
                            const wallet = {
                                address: address.trim(),
                                label: label?.trim() || `Imported Wallet ${i}`,
                                group: group?.trim() || 'imported',
                                balance: '0.0',
                                nonce: 0,
                                status: 'active',
                                transactions24h: 0,
                                lastActivity: new Date().toISOString(),
                                tokenBalances: [],
                                encryptedPrivateKey: 'encrypted_imported_key'
                            };
                            mockWallets.set(address, wallet);
                            importedWallets.push(wallet);
                            imported++;
                        }
                    }
                }
                res.json({
                    success: true,
                    data: {
                        imported,
                        wallets: importedWallets
                    }
                });
            }
            catch (error) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid import data format'
                });
            }
        });
        // POST /api/wallets/export - 导出钱包
        app.post('/api/wallets/export', (req, res) => {
            const { addresses, format = 'json' } = req.body;
            let walletsToExport = Array.from(mockWallets.values());
            if (addresses && addresses.length > 0) {
                walletsToExport = walletsToExport.filter(w => addresses.includes(w.address));
            }
            if (walletsToExport.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'No wallets found to export'
                });
            }
            const exportData = {
                exportedAt: new Date().toISOString(),
                format,
                count: walletsToExport.length,
                wallets: walletsToExport.map(w => ({
                    address: w.address,
                    label: w.label,
                    group: w.group,
                    balance: w.balance,
                    status: w.status
                }))
            };
            res.json({
                success: true,
                data: exportData
            });
        });
        // GET /api/wallets/:address - 获取特定钱包
        app.get('/api/wallets/:address', (req, res) => {
            const { address } = req.params;
            const wallet = mockWallets.get(address);
            if (!wallet) {
                return res.status(404).json({
                    success: false,
                    error: 'Wallet not found'
                });
            }
            res.json({
                success: true,
                data: wallet
            });
        });
        // PUT /api/wallets/:address - 更新钱包
        app.put('/api/wallets/:address', (req, res) => {
            const { address } = req.params;
            const { label, group } = req.body;
            const wallet = mockWallets.get(address);
            if (!wallet) {
                return res.status(404).json({
                    success: false,
                    error: 'Wallet not found'
                });
            }
            if (label)
                wallet.label = label;
            if (group !== undefined)
                wallet.group = group;
            mockWallets.set(address, wallet);
            res.json({
                success: true,
                data: wallet
            });
        });
        // DELETE /api/wallets/:address - 删除钱包
        app.delete('/api/wallets/:address', (req, res) => {
            const { address } = req.params;
            if (!mockWallets.has(address)) {
                return res.status(404).json({
                    success: false,
                    error: 'Wallet not found'
                });
            }
            mockWallets.delete(address);
            res.json({
                success: true,
                message: 'Wallet deleted successfully'
            });
        });
        // GET /api/wallets/groups - 获取钱包组
        app.get('/api/wallets/groups', (req, res) => {
            const wallets = Array.from(mockWallets.values());
            const groups = new Map();
            wallets.forEach(wallet => {
                const groupName = wallet.group || 'default';
                if (!groups.has(groupName)) {
                    groups.set(groupName, {
                        name: groupName,
                        description: `Group ${groupName}`,
                        wallets: [],
                        totalBalance: '0.0',
                        status: 'active'
                    });
                }
                groups.get(groupName).wallets.push(wallet.address);
            });
            // 计算组的总余额
            groups.forEach(group => {
                const groupWallets = wallets.filter(w => (w.group || 'default') === group.name);
                const totalBalance = groupWallets.reduce((sum, w) => sum + parseFloat(w.balance), 0);
                group.totalBalance = totalBalance.toString();
            });
            res.json({
                success: true,
                data: Array.from(groups.values())
            });
        });
        // POST /api/wallets/groups - 创建钱包组
        app.post('/api/wallets/groups', (req, res) => {
            const { name, description, strategy } = req.body;
            if (!name) {
                return res.status(400).json({
                    success: false,
                    error: 'Group name is required'
                });
            }
            const group = {
                name,
                description: description || `Group ${name}`,
                strategy: strategy || 'sequential',
                wallets: [],
                totalBalance: '0.0',
                status: 'active',
                createdAt: new Date().toISOString()
            };
            res.json({
                success: true,
                data: group
            });
        });
        // POST /api/wallets/:address/balance - 更新钱包余额
        app.post('/api/wallets/:address/balance', (req, res) => {
            const { address } = req.params;
            const wallet = mockWallets.get(address);
            if (!wallet) {
                return res.status(404).json({
                    success: false,
                    error: 'Wallet not found'
                });
            }
            // 模拟余额更新
            const newBalance = (Math.random() * 10).toFixed(4);
            wallet.balance = newBalance;
            wallet.lastActivity = new Date().toISOString();
            mockWallets.set(address, wallet);
            res.json({
                success: true,
                data: {
                    address,
                    balance: newBalance,
                    lastUpdated: wallet.lastActivity
                }
            });
        });
    });
    (0, vitest_1.describe)('GET /api/wallets', () => {
        (0, vitest_1.test)('应该返回所有钱包', async () => {
            // 先创建一些测试钱包
            await (0, supertest_1.default)(app)
                .post('/api/wallets/create')
                .send({ label: 'Test Wallet 1' });
            await (0, supertest_1.default)(app)
                .post('/api/wallets/create')
                .send({ label: 'Test Wallet 2', group: 'test-group' });
            const response = await (0, supertest_1.default)(app)
                .get('/api/wallets')
                .expect(200);
            (0, vitest_1.expect)(response.body.success).toBe(true);
            (0, vitest_1.expect)(Array.isArray(response.body.data)).toBe(true);
            (0, vitest_1.expect)(response.body.data.length).toBeGreaterThanOrEqual(2);
        });
        (0, vitest_1.test)('应该支持按组筛选钱包', async () => {
            const response = await (0, supertest_1.default)(app)
                .get('/api/wallets?group=test-group')
                .expect(200);
            (0, vitest_1.expect)(response.body.success).toBe(true);
            (0, vitest_1.expect)(response.body.data.every((w) => w.group === 'test-group')).toBe(true);
        });
    });
    (0, vitest_1.describe)('POST /api/wallets/create', () => {
        (0, vitest_1.test)('应该创建新钱包', async () => {
            const walletData = {
                label: 'New Test Wallet',
                group: 'test-group'
            };
            const response = await (0, supertest_1.default)(app)
                .post('/api/wallets/create')
                .send(walletData)
                .expect(200);
            (0, vitest_1.expect)(response.body.success).toBe(true);
            (0, vitest_1.expect)(response.body.data.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
            (0, vitest_1.expect)(response.body.data.label).toBe(walletData.label);
            (0, vitest_1.expect)(response.body.data.group).toBe(walletData.group);
            (0, vitest_1.expect)(response.body.data.status).toBe('active');
        });
        (0, vitest_1.test)('应该拒绝没有标签的请求', async () => {
            const response = await (0, supertest_1.default)(app)
                .post('/api/wallets/create')
                .send({ group: 'test' })
                .expect(400);
            (0, vitest_1.expect)(response.body.success).toBe(false);
            (0, vitest_1.expect)(response.body.error).toContain('Label is required');
        });
        (0, vitest_1.test)('应该支持导入现有私钥', async () => {
            const walletData = {
                label: 'Imported Wallet',
                generateNew: false,
                privateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
            };
            const response = await (0, supertest_1.default)(app)
                .post('/api/wallets/create')
                .send(walletData)
                .expect(200);
            (0, vitest_1.expect)(response.body.success).toBe(true);
            (0, vitest_1.expect)(response.body.data.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
            (0, vitest_1.expect)(response.body.data.label).toBe(walletData.label);
        });
        (0, vitest_1.test)('应该要求私钥当不生成新钱包时', async () => {
            const walletData = {
                label: 'Import Test',
                generateNew: false
                // 缺少 privateKey
            };
            const response = await (0, supertest_1.default)(app)
                .post('/api/wallets/create')
                .send(walletData)
                .expect(400);
            (0, vitest_1.expect)(response.body.success).toBe(false);
            (0, vitest_1.expect)(response.body.error).toContain('Private key is required');
        });
    });
    (0, vitest_1.describe)('POST /api/wallets/import', () => {
        (0, vitest_1.test)('应该导入JSON格式的钱包', async () => {
            const importData = {
                type: 'json',
                content: JSON.stringify({
                    wallets: [
                        { label: 'Imported Wallet 1', group: 'imported' },
                        { label: 'Imported Wallet 2', group: 'imported' }
                    ]
                })
            };
            const response = await (0, supertest_1.default)(app)
                .post('/api/wallets/import')
                .send(importData)
                .expect(200);
            (0, vitest_1.expect)(response.body.success).toBe(true);
            (0, vitest_1.expect)(response.body.data.imported).toBe(2);
            (0, vitest_1.expect)(response.body.data.wallets).toHaveLength(2);
        });
        (0, vitest_1.test)('应该导入CSV格式的钱包', async () => {
            const csvContent = `address,label,group
0x1111111111111111111111111111111111111111,CSV Wallet 1,csv-group
0x2222222222222222222222222222222222222222,CSV Wallet 2,csv-group`;
            const importData = {
                type: 'csv',
                content: csvContent
            };
            const response = await (0, supertest_1.default)(app)
                .post('/api/wallets/import')
                .send(importData)
                .expect(200);
            (0, vitest_1.expect)(response.body.success).toBe(true);
            (0, vitest_1.expect)(response.body.data.imported).toBe(2);
        });
        (0, vitest_1.test)('应该拒绝无效的导入数据', async () => {
            const importData = {
                type: 'json',
                content: 'invalid json'
            };
            const response = await (0, supertest_1.default)(app)
                .post('/api/wallets/import')
                .send(importData)
                .expect(400);
            (0, vitest_1.expect)(response.body.success).toBe(false);
            (0, vitest_1.expect)(response.body.error).toContain('Invalid import data format');
        });
        (0, vitest_1.test)('应该验证必需参数', async () => {
            const response = await (0, supertest_1.default)(app)
                .post('/api/wallets/import')
                .send({ type: 'json' })
                .expect(400);
            (0, vitest_1.expect)(response.body.success).toBe(false);
            (0, vitest_1.expect)(response.body.error).toContain('Type and content are required');
        });
    });
    (0, vitest_1.describe)('POST /api/wallets/export', () => {
        (0, vitest_1.test)('应该导出所有钱包', async () => {
            const response = await (0, supertest_1.default)(app)
                .post('/api/wallets/export')
                .send({})
                .expect(200);
            (0, vitest_1.expect)(response.body.success).toBe(true);
            (0, vitest_1.expect)(response.body.data.wallets).toBeDefined();
            (0, vitest_1.expect)(response.body.data.count).toBeGreaterThan(0);
            (0, vitest_1.expect)(response.body.data.exportedAt).toBeDefined();
        });
        (0, vitest_1.test)('应该导出指定的钱包', async () => {
            // 先创建一个钱包
            const createResponse = await (0, supertest_1.default)(app)
                .post('/api/wallets/create')
                .send({ label: 'Export Test Wallet' });
            const walletAddress = createResponse.body.data.address;
            const response = await (0, supertest_1.default)(app)
                .post('/api/wallets/export')
                .send({ addresses: [walletAddress] })
                .expect(200);
            (0, vitest_1.expect)(response.body.success).toBe(true);
            (0, vitest_1.expect)(response.body.data.count).toBe(1);
            (0, vitest_1.expect)(response.body.data.wallets[0].address).toBe(walletAddress);
        });
        (0, vitest_1.test)('应该处理不存在的钱包地址', async () => {
            const response = await (0, supertest_1.default)(app)
                .post('/api/wallets/export')
                .send({ addresses: ['0x0000000000000000000000000000000000000000'] })
                .expect(404);
            (0, vitest_1.expect)(response.body.success).toBe(false);
            (0, vitest_1.expect)(response.body.error).toContain('No wallets found to export');
        });
    });
    (0, vitest_1.describe)('GET /api/wallets/:address', () => {
        (0, vitest_1.test)('应该返回指定的钱包', async () => {
            // 先创建一个钱包
            const createResponse = await (0, supertest_1.default)(app)
                .post('/api/wallets/create')
                .send({ label: 'Get Test Wallet' });
            const walletAddress = createResponse.body.data.address;
            const response = await (0, supertest_1.default)(app)
                .get(`/api/wallets/${walletAddress}`)
                .expect(200);
            (0, vitest_1.expect)(response.body.success).toBe(true);
            (0, vitest_1.expect)(response.body.data.address).toBe(walletAddress);
            (0, vitest_1.expect)(response.body.data.label).toBe('Get Test Wallet');
        });
        (0, vitest_1.test)('应该处理不存在的钱包', async () => {
            const response = await (0, supertest_1.default)(app)
                .get('/api/wallets/0x0000000000000000000000000000000000000000')
                .expect(404);
            (0, vitest_1.expect)(response.body.success).toBe(false);
            (0, vitest_1.expect)(response.body.error).toContain('Wallet not found');
        });
    });
    (0, vitest_1.describe)('PUT /api/wallets/:address', () => {
        (0, vitest_1.test)('应该更新钱包信息', async () => {
            // 先创建一个钱包
            const createResponse = await (0, supertest_1.default)(app)
                .post('/api/wallets/create')
                .send({ label: 'Update Test Wallet' });
            const walletAddress = createResponse.body.data.address;
            const updateData = {
                label: 'Updated Wallet Label',
                group: 'updated-group'
            };
            const response = await (0, supertest_1.default)(app)
                .put(`/api/wallets/${walletAddress}`)
                .send(updateData)
                .expect(200);
            (0, vitest_1.expect)(response.body.success).toBe(true);
            (0, vitest_1.expect)(response.body.data.label).toBe(updateData.label);
            (0, vitest_1.expect)(response.body.data.group).toBe(updateData.group);
        });
        (0, vitest_1.test)('应该处理不存在的钱包', async () => {
            const response = await (0, supertest_1.default)(app)
                .put('/api/wallets/0x0000000000000000000000000000000000000000')
                .send({ label: 'New Label' })
                .expect(404);
            (0, vitest_1.expect)(response.body.success).toBe(false);
            (0, vitest_1.expect)(response.body.error).toContain('Wallet not found');
        });
    });
    (0, vitest_1.describe)('DELETE /api/wallets/:address', () => {
        (0, vitest_1.test)('应该删除钱包', async () => {
            // 先创建一个钱包
            const createResponse = await (0, supertest_1.default)(app)
                .post('/api/wallets/create')
                .send({ label: 'Delete Test Wallet' });
            const walletAddress = createResponse.body.data.address;
            const response = await (0, supertest_1.default)(app)
                .delete(`/api/wallets/${walletAddress}`)
                .expect(200);
            (0, vitest_1.expect)(response.body.success).toBe(true);
            (0, vitest_1.expect)(response.body.message).toContain('deleted successfully');
            // 验证钱包已被删除
            await (0, supertest_1.default)(app)
                .get(`/api/wallets/${walletAddress}`)
                .expect(404);
        });
        (0, vitest_1.test)('应该处理不存在的钱包', async () => {
            const response = await (0, supertest_1.default)(app)
                .delete('/api/wallets/0x0000000000000000000000000000000000000000')
                .expect(404);
            (0, vitest_1.expect)(response.body.success).toBe(false);
            (0, vitest_1.expect)(response.body.error).toContain('Wallet not found');
        });
    });
    (0, vitest_1.describe)('GET /api/wallets/groups', () => {
        (0, vitest_1.test)('应该返回钱包组列表', async () => {
            const response = await (0, supertest_1.default)(app)
                .get('/api/wallets/groups')
                .expect(200);
            (0, vitest_1.expect)(response.body.success).toBe(true);
            (0, vitest_1.expect)(Array.isArray(response.body.data)).toBe(true);
            if (response.body.data.length > 0) {
                const group = response.body.data[0];
                (0, vitest_1.expect)(group.name).toBeDefined();
                (0, vitest_1.expect)(group.wallets).toBeDefined();
                (0, vitest_1.expect)(Array.isArray(group.wallets)).toBe(true);
                (0, vitest_1.expect)(group.totalBalance).toBeDefined();
                (0, vitest_1.expect)(group.status).toBeDefined();
            }
        });
    });
    (0, vitest_1.describe)('POST /api/wallets/groups', () => {
        (0, vitest_1.test)('应该创建新的钱包组', async () => {
            const groupData = {
                name: 'new-test-group',
                description: 'New test group',
                strategy: 'parallel'
            };
            const response = await (0, supertest_1.default)(app)
                .post('/api/wallets/groups')
                .send(groupData)
                .expect(200);
            (0, vitest_1.expect)(response.body.success).toBe(true);
            (0, vitest_1.expect)(response.body.data.name).toBe(groupData.name);
            (0, vitest_1.expect)(response.body.data.description).toBe(groupData.description);
            (0, vitest_1.expect)(response.body.data.strategy).toBe(groupData.strategy);
        });
        (0, vitest_1.test)('应该拒绝没有名称的组', async () => {
            const response = await (0, supertest_1.default)(app)
                .post('/api/wallets/groups')
                .send({ description: 'Group without name' })
                .expect(400);
            (0, vitest_1.expect)(response.body.success).toBe(false);
            (0, vitest_1.expect)(response.body.error).toContain('Group name is required');
        });
    });
    (0, vitest_1.describe)('POST /api/wallets/:address/balance', () => {
        (0, vitest_1.test)('应该更新钱包余额', async () => {
            // 先创建一个钱包
            const createResponse = await (0, supertest_1.default)(app)
                .post('/api/wallets/create')
                .send({ label: 'Balance Test Wallet' });
            const walletAddress = createResponse.body.data.address;
            const response = await (0, supertest_1.default)(app)
                .post(`/api/wallets/${walletAddress}/balance`)
                .expect(200);
            (0, vitest_1.expect)(response.body.success).toBe(true);
            (0, vitest_1.expect)(response.body.data.address).toBe(walletAddress);
            (0, vitest_1.expect)(response.body.data.balance).toBeDefined();
            (0, vitest_1.expect)(response.body.data.lastUpdated).toBeDefined();
            (0, vitest_1.expect)(parseFloat(response.body.data.balance)).toBeGreaterThanOrEqual(0);
        });
        (0, vitest_1.test)('应该处理不存在的钱包', async () => {
            const response = await (0, supertest_1.default)(app)
                .post('/api/wallets/0x0000000000000000000000000000000000000000/balance')
                .expect(404);
            (0, vitest_1.expect)(response.body.success).toBe(false);
            (0, vitest_1.expect)(response.body.error).toContain('Wallet not found');
        });
    });
});
//# sourceMappingURL=wallet-api.test.js.map