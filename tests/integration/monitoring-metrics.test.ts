import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';

/**
 * 监控端点 - 系统指标集成测试
 * 
 * 测试目标：
 * 1. /api/dashboard/status返回正确的系统指标格式
 * 2. 数据字段命名正确（cpu_usage, memory_usage等）
 * 3. RPC健康检查命名一致（rpc_providers）
 * 4. 前端可以正确消费数据
 */

describe('Monitoring Endpoints - System Metrics', () => {
  const BASE_URL = process.env.API_BASE_URL || 'http://localhost:10001';
  
  describe('GET /api/dashboard/status', () => {
    it('应该返回正确的数据结构', async () => {
      const response = await request(BASE_URL)
        .get('/api/dashboard/status')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      expect(response.body.data).toHaveProperty('overall');
      expect(response.body.data).toHaveProperty('updatedAt');
      expect(response.body.data).toHaveProperty('uptimeSeconds');
    });

    it('应该包含系统metrics字段', async () => {
      const response = await request(BASE_URL)
        .get('/api/dashboard/status')
        .expect(200);

      const { data } = response.body;

      // 验证字段存在
      expect(data).toHaveProperty('cpu_usage');
      expect(data).toHaveProperty('memory_usage');
      expect(data).toHaveProperty('active_connections');
      expect(data).toHaveProperty('requests_per_second');
      expect(data).toHaveProperty('response_time_avg');
      expect(data).toHaveProperty('error_rate');
    });

    it('系统metrics应该是数字类型', async () => {
      const response = await request(BASE_URL)
        .get('/api/dashboard/status')
        .expect(200);

      const { data } = response.body;

      expect(typeof data.cpu_usage).toBe('number');
      expect(typeof data.memory_usage).toBe('number');
      expect(typeof data.active_connections).toBe('number');
      expect(typeof data.requests_per_second).toBe('number');
      expect(typeof data.response_time_avg).toBe('number');
      expect(typeof data.error_rate).toBe('number');
    });

    it('应该包含components对象', async () => {
      const response = await request(BASE_URL)
        .get('/api/dashboard/status')
        .expect(200);

      const { data } = response.body;

      expect(data).toHaveProperty('components');
      expect(typeof data.components).toBe('object');
    });

    it('RPC健康检查应该存在且命名正确', async () => {
      const response = await request(BASE_URL)
        .get('/api/dashboard/status')
        .expect(200);

      const { data } = response.body;

      // 验证rpc字段存在（而不是rpc_provider）
      expect(data.components).toHaveProperty('rpc');
      
      const rpcHealth = data.components.rpc;
      expect(rpcHealth).toHaveProperty('status');
      expect(rpcHealth).toHaveProperty('latency');
      
      // latency应该是数字或null
      expect(['number', 'object']).toContain(typeof rpcHealth.latency);
    });

    it('前端可以正确映射数据到SystemMetrics', async () => {
      const response = await request(BASE_URL)
        .get('/api/dashboard/status')
        .expect(200);

      const { data } = response.body;

      // 模拟前端数据映射
      const systemMetrics = {
        timestamp: Date.now(),
        cpu_usage: data.cpu_usage || 0,
        memory_usage: data.memory_usage || 0,
        active_connections: data.active_connections || 0,
        requests_per_second: data.requests_per_second || 0,
        response_time_avg: data.response_time_avg || 0,
        error_rate: data.error_rate || 0
      };

      // 验证映射成功且无undefined
      expect(systemMetrics.cpu_usage).not.toBeUndefined();
      expect(systemMetrics.memory_usage).not.toBeUndefined();
      expect(systemMetrics.active_connections).not.toBeUndefined();
      expect(systemMetrics.requests_per_second).not.toBeUndefined();
      expect(systemMetrics.response_time_avg).not.toBeUndefined();
      expect(systemMetrics.error_rate).not.toBeUndefined();
    });
  });

  describe('GET /api/monitoring/alerts', () => {
    it('应该返回alerts数组（不是data对象）', async () => {
      const response = await request(BASE_URL)
        .get('/api/monitoring/alerts')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('alerts');
      expect(Array.isArray(response.body.alerts)).toBe(true);
      
      // 不应该有data字段
      expect(response.body.data).toBeUndefined();
    });

    it('应该包含timestamp', async () => {
      const response = await request(BASE_URL)
        .get('/api/monitoring/alerts')
        .expect(200);

      expect(response.body).toHaveProperty('timestamp');
      expect(typeof response.body.timestamp).toBe('number');
    });
  });
});

/**
 * 数据字段命名一致性检查
 */
describe('Field Naming Consistency', () => {
  it('使用下划线命名而非驼峰命名', async () => {
    const BASE_URL = process.env.API_BASE_URL || 'http://localhost:10001';
    const response = await request(BASE_URL)
      .get('/api/dashboard/status')
      .expect(200);

    const { data } = response.body;

    // 正确：cpu_usage, memory_usage
    expect(data).toHaveProperty('cpu_usage');
    expect(data).toHaveProperty('memory_usage');

    // 错误：不应该是cpuUsage, memoryUsage
    expect(data.cpuUsage).toBeUndefined();
    expect(data.memoryUsage).toBeUndefined();
  });
});
