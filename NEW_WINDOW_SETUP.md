# 新窗口快速启动指南

## 一键启动命令

### 终端窗口 1 - 后端服务
```bash
cd /Users/ph88vito/project/BNB && npm run server:dev
```

### 终端窗口 2 - 前端服务  
```bash
cd /Users/ph88vito/project/BNB/frontend && NEXT_PUBLIC_API_URL=http://localhost:10001 npm run dev -- -p 10002
```

## 访问地址
- 🌐 **前端界面**: http://localhost:10002
- 🔌 **后端API**: http://localhost:10001

## 验证服务状态

### 检查后端API
```bash
curl http://localhost:10001/api/dashboard/overview
```
应该返回: `{"success":true,"data":{"system":...}}`

### 检查前端页面
浏览器访问 http://localhost:10002 应该看到:
- ✅ BSC Trading Bot Dashboard
- ✅ 4个数据卡片 (API Status, Trading Performance, Wallet Balance, Success Rate)  
- ✅ System Status 和 Live Metrics 面板

## 常见问题排查

### 1. 端口被占用
```bash
# 查看端口占用
lsof -i :10001
lsof -i :10002

# 杀死占用进程
kill -9 <PID>
```

### 2. 前端样式不显示
```bash
cd /Users/ph88vito/project/BNB/frontend
rm -rf .next
NEXT_PUBLIC_API_URL=http://localhost:10001 npm run dev -- -p 10002
```

### 3. API连接失败
检查 `.env.local` 文件:
```bash
cat /Users/ph88vito/project/BNB/frontend/.env.local
```
应该包含: `NEXT_PUBLIC_API_URL=http://localhost:10001`

### 4. WebSocket连接问题
如果看到 "WebSocket: Disconnected":
1. 确保后端服务正常运行
2. 刷新前端页面
3. 检查浏览器控制台错误

## 快速重启脚本

创建启动脚本 `start.sh`:
```bash
#!/bin/bash
echo "启动 BSC Market Maker Bot..."

# 启动后端
cd /Users/ph88vito/project/BNB
npm run server:dev &
BACKEND_PID=$!

# 等待后端启动
sleep 3

# 启动前端  
cd frontend
NEXT_PUBLIC_API_URL=http://localhost:10001 npm run dev -- -p 10002 &
FRONTEND_PID=$!

echo "后端 PID: $BACKEND_PID"
echo "前端 PID: $FRONTEND_PID"
echo "前端地址: http://localhost:10002"
echo "后端地址: http://localhost:10001"

# 等待用户输入结束进程
read -p "按 Enter 键停止所有服务..."
kill $BACKEND_PID $FRONTEND_PID
```

使用方法:
```bash
chmod +x start.sh
./start.sh
```

## 项目状态确认清单

- [ ] 后端服务运行在端口 10001
- [ ] 前端服务运行在端口 10002  
- [ ] API 返回正确的 JSON 数据
- [ ] 前端页面正常显示卡片布局
- [ ] WebSocket 连接状态显示为 "Connected"
- [ ] 所有图标和样式正确渲染
- [ ] 浏览器控制台无错误信息

---
📝 **最后更新**: 2025-09-26  
🔧 **维护状态**: 开发环境稳定运行