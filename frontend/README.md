# BSC Trading Bot - Frontend

一个现代化的 BSC 交易机器人 Web 界面,基于 Next.js 14 和 NextUI 构建。

## ✨ 功能特性

### 📊 Dashboard (仪表盘)
- 实时系统状态监控
- 交易性能指标 (24h P&L, 成功率)
- 钱包余额总览
- WebSocket 实时更新
- 系统健康检查
- 告警通知

### 💱 Trading (交易页面)
- 单笔交易执行
- 实时价格报价
- 批量交易管理
- 交易历史记录
- 滑点配置
- 多钱包支持

### 📈 Monitoring (监控页面)
- 系统告警管理
- 实时性能指标
- 组件健康检查
- CPU 和内存使用率
- 响应时间统计
- 错误率追踪

### 💼 Wallets (钱包管理)
- 钱包列表和筛选
- 余额查询
- 批量生成
- 导入导出
- 标签管理

## 🚀 快速开始

### 安装依赖

```bash
cd frontend
npm install
```

### 配置环境变量

创建 `.env.local` 文件:

```bash
# API 后端地址
NEXT_PUBLIC_API_URL=http://localhost:10001

# WebSocket 地址 (可选,默认使用 API URL)
NEXT_PUBLIC_WS_URL=ws://localhost:10001
```

### 启动开发服务器

```bash
npm run dev
```

应用将在 http://localhost:10002 启动

### 生产构建

```bash
# 构建
npm run build

# 启动生产服务器
npm start
```

## 🏗️ 项目结构

```
frontend/
├── app/                    # Next.js App Router 页面
│   ├── page.tsx           # Dashboard 首页
│   ├── trading/           # 交易页面
│   │   └── page.tsx
│   ├── monitoring/        # 监控页面
│   │   └── page.tsx
│   ├── wallets/           # 钱包管理 (待实现)
│   ├── settings/          # 设置页面 (待实现)
│   ├── layout.tsx         # 根布局
│   └── providers.tsx      # 全局 Provider
│
├── components/            # React 组件
│   ├── Navigation.tsx     # 导航栏
│   ├── BatchOperations.tsx # 批量操作组件
│   └── ...
│
├── contexts/              # React Context
│   ├── WebSocketContext.tsx  # WebSocket 连接管理
│   └── LanguageContext.tsx   # 多语言支持
│
├── utils/                 # 工具函数
│   └── validation.ts      # 输入验证工具
│
├── public/               # 静态资源
│   └── ...
│
└── package.json          # 项目配置
```

## 🛠️ 技术栈

### 核心框架
- **Next.js 14.2** - React 框架 (App Router)
- **React 18** - UI 库
- **TypeScript** - 类型安全

### UI 组件
- **NextUI** - 现代化组件库
- **Lucide React** - 图标库
- **Framer Motion** - 动画库
- **React Hot Toast** - 消息提示

### 数据可视化
- **Chart.js** - 图表库
- **React Chart.js 2** - React 封装
- **date-fns** - 日期处理

### 区块链集成
- **wagmi** - React Hooks for Ethereum
- **viem** - TypeScript Ethereum 库
- **@web3modal** - 钱包连接

### 状态管理
- **Zustand** - 轻量级状态管理
- **React Context** - 全局状态

## 📱 页面说明

### Dashboard (/)
**功能**:
- 系统状态概览
- 实时性能指标
- 24h 交易统计
- WebSocket 连接状态
- 自动刷新 (15秒)

**关键组件**:
- 系统状态卡片
- 实时度量面板
- 告警模态框

### Trading (/trading)
**功能**:
- 单笔交易
- 批量交易
- 交易历史
- 实时报价

**Tab 标签**:
1. **Single Trade** - 单笔交易
2. **Batch Trading** - 批量配置
3. **Advanced Batch** - 高级批量操作
4. **Trade History** - 交易历史

**输入验证**:
- 代币地址格式验证
- 金额范围验证
- 滑点限制验证
- 钱包地址验证

### Monitoring (/monitoring)
**功能**:
- 活跃告警列表
- 系统性能图表
- 组件健康检查
- 指标追踪

**Tab 标签**:
1. **Alerts** - 告警管理
2. **Metrics** - 性能指标
3. **Health Checks** - 健康检查

## 🎨 主题与样式

### 主题配置

在 `tailwind.config.js` 中配置:

```javascript
const { nextui } = require("@nextui-org/react");

module.exports = {
  darkMode: "class",
  plugins: [nextui()],
  // ...
}
```

### Dark Mode

系统会根据用户的系统偏好自动切换暗色/亮色主题。

## 🌐 国际化

### 支持语言
- 🇨🇳 简体中文
- 🇺🇸 English

### 使用方式

```typescript
import { useLanguage } from '@/contexts/LanguageContext';

function Component() {
  const { t, language, setLanguage } = useLanguage();

  return <div>{t('dashboard.title')}</div>;
}
```

### 添加新翻译

编辑 `contexts/LanguageContext.tsx` 中的 translations 对象。

## 🔌 WebSocket 集成

### 连接管理

WebSocket 会自动连接到后端,并处理重连逻辑:

```typescript
const { connected, lastMessage, sendMessage } = useWebSocket();

// 发送消息
sendMessage({
  type: 'subscribe',
  data: { channels: ['trades', 'metrics'] }
});

// 接收消息
useEffect(() => {
  if (lastMessage) {
    console.log('Received:', lastMessage);
  }
}, [lastMessage]);
```

### 支持的事件

- `prices` - 价格更新
- `metrics` - 系统指标
- `trades` - 交易事件
- `system` - 系统状态

## 🧪 前端验证

### 验证工具库

`utils/validation.ts` 提供了完整的验证函数:

```typescript
import {
  isValidEthereumAddress,
  isValidTokenAddress,
  isValidAmount,
  validateTradeRequest
} from '@/utils/validation';

// 验证地址
if (isValidEthereumAddress(address)) {
  // 有效地址
}

// 验证交易请求
const validation = validateTradeRequest(trade);
if (!validation.isValid) {
  console.error(validation.errors);
}
```

### 验证规则

- **地址格式**: `/^0x[a-fA-F0-9]{40}$/`
- **代币地址**: 'BNB' 或有效以太坊地址
- **金额**: 正数,支持小数
- **滑点**: 0-50%

## 📊 性能优化

### 已实现的优化

1. **HTTP 状态码检查** - 及早发现错误
2. **错误消息优化** - 详细的用户反馈
3. **输入验证** - 客户端即时验证
4. **优雅降级** - API 失败不影响使用
5. **Toast 配置** - 合理的显示时长

### 最佳实践

```typescript
// ✅ 好的做法: 详细的错误处理
try {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const result = await response.json();
  if (result.success) {
    toast.success('Success! ✅', { duration: 4000 });
  } else {
    toast.error(`Failed: ${result.message}`, { duration: 5000 });
  }
} catch (error) {
  const errorMsg = error instanceof Error ? error.message : 'Unknown error';
  toast.error(`Network Error: ${errorMsg}`);
}
```

## 🐛 调试

### 开发工具

```bash
# 查看详细日志
npm run dev

# 类型检查
npm run typecheck

# Linting
npm run lint
```

### Chrome DevTools

1. **Network 标签** - 查看 API 请求
2. **WebSocket 标签** - 监控 WebSocket 连接
3. **Console** - 查看应用日志
4. **React DevTools** - 检查组件状态

### 常见问题

#### Q1: WebSocket 无法连接?
检查后端是否启动: `curl http://localhost:10001/api/dashboard/overview`

#### Q2: API 请求失败?
确保 `.env.local` 中的 `NEXT_PUBLIC_API_URL` 正确。

#### Q3: 页面空白?
查看浏览器控制台的错误信息。

#### Q4: Toast 消息不显示?
确保在 `app/layout.tsx` 中添加了 `<Toaster />` 组件。

## 📝 开发指南

### 添加新页面

1. 在 `app/` 目录创建新文件夹
2. 添加 `page.tsx` 文件
3. 导出 React 组件

示例:

```typescript
// app/example/page.tsx
export default function ExamplePage() {
  return <div>New Page</div>;
}
```

### 添加新组件

1. 在 `components/` 创建组件文件
2. 使用 TypeScript 定义 Props
3. 导出组件

示例:

```typescript
// components/MyComponent.tsx
interface MyComponentProps {
  title: string;
  onAction: () => void;
}

export default function MyComponent({ title, onAction }: MyComponentProps) {
  return (
    <div>
      <h1>{title}</h1>
      <button onClick={onAction}>Click</button>
    </div>
  );
}
```

### API 调用模板

```typescript
const handleApiCall = async () => {
  setLoading(true);
  try {
    const response = await fetch(`${apiUrl}/endpoint`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();

    if (result.success) {
      toast.success('Operation successful! ✅');
      // Handle success
    } else {
      const errorMessage = result.message || result.error || 'Operation failed';
      toast.error(`Failed: ${errorMessage}`);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    toast.error(`Network Error: ${errorMsg}`);
  } finally {
    setLoading(false);
  }
};
```

## 🚀 部署

### Vercel 部署 (推荐)

```bash
# 安装 Vercel CLI
npm i -g vercel

# 部署
vercel
```

### 自托管

```bash
# 构建
npm run build

# 启动
npm start
```

### Docker 部署

```bash
# 构建镜像
docker build -t bsc-bot-frontend .

# 运行
docker run -p 10002:10002 bsc-bot-frontend
```

## 📚 相关链接

- [Next.js 文档](https://nextjs.org/docs)
- [NextUI 文档](https://nextui.org)
- [React 文档](https://react.dev)
- [TypeScript 文档](https://www.typescriptlang.org/docs/)

## 🤝 贡献

欢迎提交 Pull Request!请确保:

1. 代码通过 TypeScript 检查
2. 遵循现有的代码风格
3. 添加必要的注释
4. 测试功能正常

## 📄 许可证

MIT License - 与主项目一致

---

**Made with ❤️ using Next.js**

*Last Updated: 2025-10-01*
