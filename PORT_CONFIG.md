# 🔌 端口配置说明

## 📋 端口分配

为了避免端口冲突，本项目使用了不同的端口：

### 后端服务器
- **端口**: `10001`
- **服务**: BSC Market Maker Bot API Server
- **启动命令**: 
  ```bash
  npm run server:dev     # 开发模式
  npm run server:minimal # 最小化服务器
  npm run server:core    # 核心服务器
  ```

### 前端界面
- **端口**: `10002`  
- **服务**: Next.js Web Interface
- **启动命令**:
  ```bash
  cd frontend && npm run dev   # 开发模式
  cd frontend && npm run start # 生产模式
  ```

### API访问地址
- **后端API**: `http://localhost:10001`
- **前端界面**: `http://localhost:10002`
- **API测试页面**: `http://localhost:10002/api-test.html`

## 🛠️ 环境变量配置

可以通过环境变量自定义端口：

```bash
# 后端端口
PORT=10001

# 前端API连接地址
NEXT_PUBLIC_API_URL=http://localhost:10001
```

## 🚀 快速启动

### 1. 启动后端服务器
```bash
npm run server:dev
# 服务器将运行在 http://localhost:10001
```

### 2. 启动前端界面
```bash
cd frontend && npm run dev
# 前端将运行在 http://localhost:10002
```

### 3. 验证连接
访问 `http://localhost:10002/api-test.html` 测试前后端连接状态

## ⚠️ 端口冲突解决

如果仍有端口冲突，可以修改以下文件：

### 后端端口 (10001)
- `src/server.ts:50` - 默认端口配置
- `package.json` - 启动脚本中的 PORT 环境变量

### 前端端口 (10002)  
- `frontend/package.json` - dev 和 start 脚本的 -p 参数

### API连接地址
- `frontend/app/wallets/page.tsx:68`
- `frontend/app/trading/page.tsx:155,174,208,253`
- `frontend/components/BatchOperations.tsx:66`
- `frontend/public/api-test.html:43`

## 🔍 端口检查命令

```bash
# 检查端口占用
lsof -i :10001  # 检查后端端口
lsof -i :10002  # 检查前端端口

# 杀死占用进程（如果需要）
kill -9 $(lsof -t -i:10001)
kill -9 $(lsof -t -i:10002)
```

## 📝 项目默认端口历史

- **原配置**: 后端 3010, 前端 3000
- **中间配置**: 后端 8080, 前端 8081  
- **最终配置**: 后端 10001, 前端 10002
- **修改原因**: 避免与其他项目的端口冲突

这样可以确保多个项目同时运行而不会有端口冲突问题！