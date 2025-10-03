# BSC Trading Bot API Documentation

## Base URL
```
Development: http://localhost:10001
Production: https://api.yourdomain.com
```

## Authentication
Most endpoints require JWT authentication. Include the token in the Authorization header:
```
Authorization: Bearer <your-jwt-token>
```

---

## API Endpoints

### System APIs

#### Health Check
```http
GET /api/health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-10-02T10:00:00.000Z",
  "uptime": 3600,
  "environment": "production",
  "version": "0.1.0",
  "services": {
    "api": "healthy",
    "database": "healthy",
    "rpc_providers": "healthy",
    "websocket": "healthy"
  }
}
```

---

### Wallet Management APIs

#### List Wallets
```http
GET /api/v1/wallets/list
```

**Query Parameters:**
- `page` (number, optional): Page number (default: 1)
- `limit` (number, optional): Items per page (default: 50)
- `group` (string, optional): Filter by group name

**Response:**
```json
{
  "success": true,
  "data": {
    "wallets": [
      {
        "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
        "label": "Main Wallet",
        "group": "Trading",
        "balance": "1.5 BNB",
        "tier": "standard",
        "createdAt": "2025-10-01T12:00:00.000Z"
      }
    ],
    "total": 100,
    "page": 1,
    "limit": 50,
    "totalPages": 2
  }
}
```

#### Generate Wallets
```http
POST /api/v1/wallets/generate
```

**Request Body:**
```json
{
  "count": 10,
  "config": {
    "label": "Trading Wallet",
    "group": "Main Group",
    "tier": "standard"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "wallets": [
      {
        "address": "0x...",
        "privateKey": "0x...",
        "label": "Trading Wallet-1",
        "group": "Main Group"
      }
    ],
    "count": 10
  }
}
```

#### Import Wallets
```http
POST /api/v1/wallets/import
```

**Request Body:**
```json
{
  "privateKeys": ["0x...", "0x..."],
  "config": {
    "labels": ["Wallet 1", "Wallet 2"],
    "group": "Imported"
  }
}
```

#### Import from CSV
```http
POST /api/v1/wallets/import-csv
```

**Request Body:** (multipart/form-data)
- `file`: CSV file with columns: address, privateKey, label, group

#### Export Wallets
```http
GET /api/v1/wallets/export
```

**Query Parameters:**
- `format` (string): 'csv' or 'json' (default: 'csv')
- `group` (string, optional): Export specific group only

**Response:** CSV or JSON file download

#### Batch Transfer
```http
POST /api/v1/wallets/batch-transfer
```

**Request Body:**
```json
{
  "type": "one-to-many",
  "fromAddresses": ["0x..."],
  "toAddresses": ["0x...", "0x...", "0x..."],
  "amount": "0.1",
  "tokenAddress": "BNB"
}
```

**Types:**
- `one-to-one`: Single sender to single receiver
- `one-to-many`: Single sender to multiple receivers
- `many-to-many`: Multiple senders to multiple receivers (round-robin)

---

### Trading APIs

#### Get Quote
```http
POST /api/trading/quote
```

**Request Body:**
```json
{
  "tokenIn": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
  "tokenOut": "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
  "amountIn": "1000000000000000000",
  "slippage": 0.5
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "amountOut": "450000000000000000",
    "priceImpact": "0.12",
    "route": ["WBNB", "CAKE"],
    "gasEstimate": "150000"
  }
}
```

#### Execute Trade
```http
POST /api/trading/execute
```

**Request Body:**
```json
{
  "walletAddress": "0x...",
  "tokenIn": "0x...",
  "tokenOut": "0x...",
  "amountIn": "1000000000000000000",
  "slippage": 0.5,
  "deadline": 300
}
```

#### Batch Trading
```http
POST /api/trading/batch
```

**Request Body:**
```json
{
  "trades": [
    {
      "walletAddress": "0x...",
      "tokenIn": "0x...",
      "tokenOut": "0x...",
      "amountIn": "1000000000000000000"
    }
  ],
  "config": {
    "strategy": "parallel",
    "maxConcurrent": 5,
    "delayMs": 1000
  }
}
```

---

### Dashboard APIs

#### Get Overview
```http
GET /api/dashboard/overview
```

**Response:**
```json
{
  "success": true,
  "data": {
    "system": {
      "status": "healthy",
      "uptimeSeconds": 86400,
      "version": "0.1.0",
      "environment": "production"
    },
    "wallets": {
      "total": 100,
      "totalBalance": "1500.5 BNB"
    },
    "trading": {
      "totalTrades24h": 250,
      "pnl24h": "+125.50",
      "volume24h": "50000.00",
      "successRate": "94.5%"
    }
  }
}
```

#### Get System Status
```http
GET /api/dashboard/status
```

**Response:**
```json
{
  "success": true,
  "data": {
    "overall": "healthy",
    "components": {
      "api_server": {
        "status": "healthy",
        "responseTime": 45
      },
      "database": {
        "status": "healthy",
        "connected": true
      },
      "rpc_provider": {
        "status": "healthy",
        "latency": 120
      },
      "websocket": {
        "status": "healthy",
        "connections": 5
      }
    },
    "uptimeSeconds": 86400
  }
}
```

---

### Monitoring APIs

#### Get Alerts
```http
GET /api/alerts
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "alert-123",
      "type": "warning",
      "title": "High RPC Latency",
      "message": "RPC latency exceeds 2000ms",
      "severity": "medium",
      "timestamp": "2025-10-02T10:00:00.000Z"
    }
  ]
}
```

#### Get Monitoring Logs
```http
GET /api/monitoring/logs
```

**Query Parameters:**
- `page` (number): Page number
- `limit` (number): Items per page
- `level` (string): Filter by level (info, warn, error)
- `search` (string): Search in messages

---

## WebSocket API

### Connection
```javascript
const ws = new WebSocket('ws://localhost:10002/ws');

ws.onopen = () => {
  // Subscribe to channels
  ws.send(JSON.stringify({
    type: 'subscribe',
    data: { channels: ['metrics', 'trades', 'system'] }
  }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Received:', data);
};
```

### Available Channels
- `metrics`: Real-time system metrics
- `trades`: Trade updates
- `system`: System status updates
- `alerts`: Alert notifications

---

## Error Responses

All error responses follow this format:
```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": {}
}
```

### Common Error Codes
- `INVALID_REQUEST`: Invalid request parameters
- `UNAUTHORIZED`: Authentication required
- `FORBIDDEN`: Insufficient permissions
- `NOT_FOUND`: Resource not found
- `RATE_LIMIT_EXCEEDED`: Too many requests
- `INTERNAL_ERROR`: Server error

---

## Rate Limiting

- Default: 100 requests per minute per IP
- Trading endpoints: 50 requests per minute
- Auth endpoints: 20 requests per minute

Rate limit headers are included in responses:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1696248000
```

---

## Best Practices

1. **Use pagination** for list endpoints
2. **Implement retry logic** with exponential backoff
3. **Cache responses** when appropriate
4. **Use WebSocket** for real-time updates instead of polling
5. **Handle errors gracefully** and log for debugging
6. **Secure your JWT tokens** - never expose in client-side code
7. **Validate inputs** before sending requests
8. **Monitor rate limits** to avoid being throttled

---

## SDK Examples

### JavaScript/Node.js
```javascript
const axios = require('axios');

const api = axios.create({
  baseURL: 'http://localhost:10001',
  headers: {
    'Authorization': `Bearer ${process.env.JWT_TOKEN}`
  }
});

// Get wallets
const wallets = await api.get('/api/v1/wallets/list');

// Execute trade
const trade = await api.post('/api/trading/execute', {
  walletAddress: '0x...',
  tokenIn: '0x...',
  tokenOut: '0x...',
  amountIn: '1000000000000000000'
});
```

### Python
```python
import requests

headers = {
    'Authorization': f'Bearer {os.environ["JWT_TOKEN"]}'
}

# Get system health
response = requests.get(
    'http://localhost:10001/api/health',
    headers=headers
)

print(response.json())
```

---

## Support

For API support, please:
- Check the [GitHub Issues](https://github.com/yourorg/bsc-bot/issues)
- Read the [Documentation](https://docs.yourdomain.com)
- Contact: support@yourdomain.com
