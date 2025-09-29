# BSC Trading Bot - Integration Tests 集成测试指南

本目录包含BSC交易机器人的完整测试套件，涵盖单元测试、集成测试、API测试、前端测试和端到端测试。

## 🚨 重要提示 - 集成测试前置条件

**集成测试需要先启动API服务并配置JWT_SECRET才能运行**

## 🎯 测试概览

### 测试结构
```
tests/
├── core/              # 核心模块单元测试
├── integration/       # 集成测试
├── api/              # API端点测试
├── frontend/         # 前端组件测试
├── e2e/              # 端到端测试
├── helpers/          # 测试工具函数
├── setup.ts          # 全局测试配置
├── test-runner.ts    # 自定义测试运行器
└── README.md         # 本文档
```

### 测试类型

#### 1. 核心模块单元测试 (`tests/core/`)
- **wallet-manager.test.ts**: 钱包管理器测试
- **dex-trading.test.ts**: DEX交易逻辑测试
- **risk-manager.test.ts**: 风险管理系统测试
- **batch-execution.test.ts**: 批量执行引擎测试

#### 2. 集成测试 (`tests/integration/`)
- **trading-engine.test.ts**: 交易引擎集成测试
- **system-integration.test.ts**: 系统集成测试

#### 3. API端点测试 (`tests/api/`)
- **trading-api.test.ts**: 交易API端点测试
- **wallet-api.test.ts**: 钱包管理API测试

#### 4. 前端组件测试 (`tests/frontend/`)
- **navigation.test.tsx**: 导航组件测试
- **dashboard.test.tsx**: 仪表盘组件测试

#### 5. 端到端测试 (`tests/e2e/`)
- **complete-workflow.test.ts**: 完整工作流程测试

## 🚀 运行测试

### 前置步骤（重要！）

#### 1. 启动API服务器
```bash
# 必须先启动API服务器，集成测试依赖于运行中的服务
JWT_SECRET=dev-secret-key-for-testing-only-256bits-long PORT=10001 npm run server:dev

# 或者在另一个终端运行
export JWT_SECRET=dev-secret-key-for-testing-only-256bits-long
export PORT=10001
npm run server:dev
```

#### 2. 运行数据库迁移
```bash
# 确保数据库表结构是最新的
npx knex migrate:latest
```

### 快速开始
```bash
# 设置测试环境变量
export JWT_SECRET=dev-secret-key-for-testing-only-256bits-long

# 运行所有测试
npm test

# 运行特定类型的测试
npm run test:unit        # 单元测试（不需要API服务）
npm run test:integration # 集成测试（需要API服务运行在10001端口）
npm run test:api         # API测试（需要API服务）
npm run test:frontend    # 前端测试
npm run test:e2e         # 端到端测试（需要API服务）

# 运行完整集成测试
JWT_SECRET=dev-secret-key-for-testing-only-256bits-long npm run test:integration:watch -- --run tests/integration/full-integration.test.ts

# 观察模式运行测试
npm run test:watch

# 运行测试并生成覆盖率报告
npm run test:coverage
```

### 测试运行器
我们提供了自定义的测试运行器，它会按顺序运行不同类型的测试并生成详细报告：

```bash
# 使用自定义测试运行器
npx tsx tests/test-runner.ts

# 运行特定测试套件
npx tsx tests/test-runner.ts unit
npx tsx tests/test-runner.ts api

# 查看可用选项
npx tsx tests/test-runner.ts --help
```

## ⚙️ 配置说明

### 环境变量
测试使用以下环境变量：

```bash
NODE_ENV=test                           # 测试环境
ENCRYPTION_PASSWORD=test-password-123   # 测试加密密码
ALLOW_DEV_ENCRYPTION_FALLBACK=true     # 允许开发环境加密回退
SKIP_BLOCKCHAIN_TESTS=true             # 跳过区块链测试
SKIP_SERVER_TESTS=false                # 是否跳过服务器测试
SKIP_E2E_TESTS=false                   # 是否跳过端到端测试
```

### 测试配置文件
- **vitest.config.ts**: Vitest测试框架配置
- **tests/setup.ts**: 全局测试设置和工具函数

## 📋 测试覆盖范围

### 核心功能测试
- ✅ 钱包创建、导入、加密/解密
- ✅ DEX交易报价、执行、Gas估算
- ✅ 风险管理：限额、白名单、黑名单
- ✅ 批量操作：并发、顺序、错开执行
- ✅ 错误处理和重试机制

### API端点测试
- ✅ 钱包管理API (CRUD操作)
- ✅ 交易API (报价、执行、历史)
- ✅ 监控API (健康检查、指标)
- ✅ 错误处理和参数验证

### 前端组件测试
- ✅ 导航组件功能和样式
- ✅ 仪表盘数据展示和交互
- ✅ 用户输入验证和错误处理
- ✅ WebSocket连接状态显示

### 系统集成测试
- ✅ 完整的钱包管理工作流程
- ✅ 端到端交易执行流程
- ✅ 监控和健康检查系统
- ✅ 并发请求处理
- ✅ 数据一致性验证

## 🔧 常见问题

### 1. 测试运行慢
如果测试运行较慢，可以：
```bash
# 并行运行测试
npm run test:unit -- --reporter=dot

# 跳过耗时的集成测试
SKIP_SERVER_TESTS=true npm test

# 跳过端到端测试
SKIP_E2E_TESTS=true npm test
```

### 2. 前端测试失败
前端测试需要额外的依赖，如果失败：
```bash
# 安装前端测试依赖
cd frontend && npm install

# 检查React Testing Library版本
npm list @testing-library/react
```

### 3. E2E测试超时
端到端测试需要启动完整的服务器，可能会超时：
```bash
# 增加超时时间
npm run test:e2e -- --testTimeout=120000

# 或者跳过E2E测试
SKIP_E2E_TESTS=true npm test
```

### 4. 数据库相关测试失败
确保测试使用内存数据库：
```bash
# 检查环境变量
export DATABASE_URL=:memory:
npm test
```

## 📊 测试报告

测试完成后会生成以下文件：
- `tests/test-report.json`: 详细的测试结果JSON报告
- `tests/test-results.json`: Vitest标准格式结果
- `tests/test-results.xml`: JUnit格式的结果（用于CI/CD）
- `coverage/`: 代码覆盖率报告（HTML格式）

## 🎨 编写新测试

### 单元测试示例
```typescript
import { describe, expect, test, beforeEach, vi } from 'vitest';
import { WalletManager } from '../../src/wallet';

describe('新功能测试', () => {
  let walletManager: WalletManager;

  beforeEach(() => {
    walletManager = new WalletManager();
  });

  test('应该能够执行新功能', () => {
    // 测试逻辑
    expect(true).toBe(true);
  });
});
```

### API测试示例
```typescript
import { describe, expect, test } from 'vitest';
import request from 'supertest';
import app from '../../src/app';

describe('新API端点', () => {
  test('应该返回正确的响应', async () => {
    const response = await request(app)
      .get('/api/new-endpoint')
      .expect(200);

    expect(response.body.success).toBe(true);
  });
});
```

### 测试最佳实践
1. **使用描述性的测试名称**: 明确说明测试的目的
2. **遵循AAA模式**: Arrange（准备）、Act（执行）、Assert（断言）
3. **使用Mock避免外部依赖**: 特别是区块链和网络调用
4. **测试边界情况**: 包括错误情况和极端值
5. **保持测试独立**: 每个测试都应该能够独立运行

## 🚀 CI/CD集成

测试可以轻松集成到CI/CD管道中：

```yaml
# GitHub Actions示例
jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v2
    
    - name: Setup Node.js
      uses: actions/setup-node@v2
      with:
        node-version: '18'
        
    - name: Install dependencies
      run: npm ci
      
    - name: Setup test environment
      run: |
        echo "JWT_SECRET=dev-secret-key-for-testing-only-256bits-long" >> $GITHUB_ENV
        echo "DATABASE_URL=./data/test.db" >> $GITHUB_ENV
        echo "PORT=10001" >> $GITHUB_ENV
        
    - name: Run database migrations
      run: npx knex migrate:latest
      
    - name: Start API server
      run: |
        npm run server:dev &
        sleep 5  # 等待服务器启动
        
    - name: Verify server is running
      run: curl -f http://localhost:10001/api/health || exit 1
        
    - name: Run tests
      run: npm run test:integration
    
    - name: Generate coverage report
      run: npm run test:coverage
        
    - name: Upload coverage
      uses: codecov/codecov-action@v1
      with:
        file: ./coverage/lcov.info
```

### Docker环境测试

```dockerfile
# Dockerfile.test
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ENV JWT_SECRET=dev-secret-key-for-testing-only-256bits-long
ENV PORT=10001
ENV DATABASE_URL=./data/test.db

RUN npx knex migrate:latest

CMD ["sh", "-c", "npm run server:dev & sleep 5 && npm run test:integration"]
```

## 📞 获取帮助

如果在运行测试时遇到问题：

1. 查看测试输出中的错误信息
2. 检查 `tests/test-report.json` 中的详细日志
3. 确保所有依赖都已正确安装
4. 验证环境变量配置是否正确

---

**注意**: 本测试套件设计为在测试环境中运行，不会影响生产数据或执行真实的区块链交易。