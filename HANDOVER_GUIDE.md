# BSC Market Maker Bot - 项目交接文档

## 项目概述
BSC Market Maker Bot 是一个基于 Binance Smart Chain 的做市机器人系统，包含后端 API 服务和前端管理界面。

## 项目结构
```
/Users/ph88vito/project/BNB/
├── src/                    # 后端源码
│   ├── server.ts          # 主服务器文件
│   ├── api/               # API 路由
│   └── ...
├── frontend/              # 前端 Next.js 应用
│   ├── app/               # 页面文件
│   ├── components/        # 组件
│   ├── contexts/          # React 上下文
│   └── ...
├── package.json           # 后端依赖
└── scripts/               # 部署脚本
```

## 开发环境启动

### 1. 后端服务 (端口: 10001)
```bash
cd /Users/ph88vito/project/BNB
npm run server:dev
```

### 2. 前端服务 (端口: 10002)
```bash
cd /Users/ph88vito/project/BNB/frontend
NEXT_PUBLIC_API_URL=http://localhost:10001 npm run dev -- -p 10002
```

### 3. 访问地址
- 前端管理界面: http://localhost:10002
- 后端 API: http://localhost:10001

## 已解决的技术问题

### 1. CORS 配置
**问题**: 前端无法访问后端 API
**解决**: 在 `src/server.ts` 第96-104行添加了端口 10002 的 CORS 支持
```typescript
origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:10002', 'http://127.0.0.1:10002']
```

### 2. 环境变量配置
**文件**: `frontend/.env.local`
```
NEXT_PUBLIC_API_URL=http://localhost:10001
```

### 3. WebSocket 连接
**文件**: `frontend/contexts/WebSocketContext.tsx` 第22行
```typescript
const wsUrl = 'ws://localhost:10001/ws';
```

### 4. API 数据结构
后端 API 返回的数据结构 (`src/server.ts` 第332-340行):
```typescript
trading: {
  totalTrades24h: 0,
  pnl24h: '+0.00',
  volume24h: '0.00',
  successRate: '100%',
}
```

### 5. 前端显示问题
**问题**: NextUI Card 组件渲染异常
**解决**: 使用原生 HTML + Tailwind CSS 重写了主页面 (`frontend/app/page.tsx`)

## 核心功能模块

### 1. 仪表板 (Dashboard)
- **文件**: `frontend/app/page.tsx`
- **功能**: 系统状态监控、交易数据展示、实时指标
- **特色**: 响应式卡片布局、悬停动画效果、实时数据更新

### 2. 导航系统
- **文件**: `frontend/components/Navigation.tsx` 
- **页面**: Dashboard, Trading, Wallets, Monitoring, Settings

### 3. WebSocket 实时通信
- **文件**: `frontend/contexts/WebSocketContext.tsx`
- **功能**: 实时数据推送、连接状态管理

## 技术栈

### 后端
- Node.js + TypeScript
- Express.js
- WebSocket
- CORS 支持

### 前端
- Next.js 14.2.33 (App Router)
- React 18
- NextUI v2.6.11
- Tailwind CSS
- Lucide React (图标)
- React Query (数据管理)

### 依赖管理
```bash
# 安装图表依赖 (如需要监控页面)
npm install react-chartjs-2 chart.js chartjs-adapter-date-fns date-fns --legacy-peer-deps
```

## 开发注意事项

### 1. 端口配置
- 后端: 10001
- 前端: 10002
- 确保两个服务同时运行

### 2. 环境变量
- 前端必须使用 `NEXT_PUBLIC_` 前缀
- 重启开发服务器以应用新的环境变量

### 3. 缓存清理
如遇到样式问题:
```bash
cd frontend
rm -rf .next
npm run dev -- -p 10002
```

### 4. API 测试
```bash
# 测试后端 API
curl http://localhost:10001/api/dashboard/overview

# 测试 CORS
curl -H "Origin: http://localhost:10002" http://localhost:10001/api/dashboard/overview
```

## 已知问题及解决方案

### 1. NextUI 组件兼容性
**症状**: Card 组件不显示边框和样式
**解决**: 使用原生 HTML div + Tailwind CSS 替代

### 2. 依赖冲突
**症状**: framer-motion 版本冲突
**解决**: 使用 `--legacy-peer-deps` 安装

### 3. TypeScript 类型错误
**问题**: `uptimeSeconds` 字段类型不匹配
**解决**: 更新接口定义并使用可选链操作符 (`?.`)

## 部署相关

### 生产环境变量
```bash
NODE_ENV=production
NEXT_PUBLIC_API_URL=https://your-api-domain.com
```

### 构建命令
```bash
# 后端
npm run build

# 前端
cd frontend
npm run build
```

## 联系信息
- 项目路径: `/Users/ph88vito/project/BNB`
- 最后更新: 2025-09-26
- 状态: 开发环境正常运行，前端显示问题已修复

## 下一步计划
1. 完善交易功能页面
2. 实现钱包管理功能  
3. 添加监控和报警系统
4. 优化 WebSocket 连接稳定性
5. 增加用户认证和权限管理