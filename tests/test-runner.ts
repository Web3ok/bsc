#!/usr/bin/env node

/**
 * 测试运行器 - 按顺序运行不同类型的测试
 */

import { spawn } from 'child_process';
import { writeFileSync, existsSync } from 'fs';

interface TestSuite {
  name: string;
  pattern: string;
  description: string;
  timeout?: number;
  required?: boolean;
}

const TEST_SUITES: TestSuite[] = [
  {
    name: 'unit',
    pattern: 'tests/core/**/*.test.ts',
    description: '核心模块单元测试',
    timeout: 30000,
    required: true
  },
  {
    name: 'integration',
    pattern: 'tests/integration/**/*.test.ts',
    description: '集成测试',
    timeout: 60000,
    required: true
  },
  {
    name: 'api',
    pattern: 'tests/api/**/*.test.ts',
    description: 'API端点测试',
    timeout: 30000,
    required: true
  },
  {
    name: 'frontend',
    pattern: 'tests/frontend/**/*.test.tsx',
    description: '前端组件测试',
    timeout: 30000,
    required: false // 前端测试可选，因为需要额外依赖
  },
  {
    name: 'e2e',
    pattern: 'tests/e2e/**/*.test.ts',
    description: '端到端测试',
    timeout: 120000,
    required: false // E2E测试可选，因为需要启动完整服务
  }
];

class TestRunner {
  private results: Map<string, { success: boolean; duration: number; output: string }> = new Map();
  private totalStartTime = Date.now();

  async runSuite(suite: TestSuite): Promise<boolean> {
    console.log(`\n🧪 运行 ${suite.description}...`);
    console.log(`📁 测试文件: ${suite.pattern}`);
    
    const startTime = Date.now();

    return new Promise((resolve) => {
      const args = [
        'vitest',
        'run',
        suite.pattern,
        '--reporter=verbose',
        '--no-coverage' // 跳过覆盖率以加快速度
      ];

      if (suite.timeout) {
        args.push(`--testTimeout=${suite.timeout}`);
      }

      const testProcess = spawn('npx', args, {
        stdio: 'pipe',
        env: {
          ...process.env,
          NODE_ENV: 'test',
          VITEST_SUITE: suite.name
        }
      });

      let output = '';

      testProcess.stdout?.on('data', (data) => {
        const text = data.toString();
        output += text;
        console.log(text);
      });

      testProcess.stderr?.on('data', (data) => {
        const text = data.toString();
        output += text;
        console.error(text);
      });

      testProcess.on('close', (code) => {
        const duration = Date.now() - startTime;
        const success = code === 0;

        this.results.set(suite.name, {
          success,
          duration,
          output
        });

        if (success) {
          console.log(`✅ ${suite.description} 完成 (${duration}ms)`);
        } else {
          console.log(`❌ ${suite.description} 失败 (${duration}ms)`);
        }

        resolve(success);
      });

      process.on('error', (error) => {
        console.error(`❌ 启动测试失败: ${error.message}`);
        this.results.set(suite.name, {
          success: false,
          duration: Date.now() - startTime,
          output: error.message
        });
        resolve(false);
      });
    });
  }

  async runAll(): Promise<void> {
    console.log('🚀 开始运行BSC交易机器人测试套件\n');

    let totalTests = 0;
    let passedSuites = 0;
    let failedSuites = 0;

    for (const suite of TEST_SUITES) {
      try {
        const success = await this.runSuite(suite);
        totalTests++;

        if (success) {
          passedSuites++;
        } else {
          failedSuites++;
          
          if (suite.required) {
            console.log(`\n⚠️ 必需的测试套件 "${suite.name}" 失败，继续运行其他测试...`);
          }
        }
      } catch (error) {
        console.error(`❌ 运行测试套件 "${suite.name}" 时出错:`, error);
        failedSuites++;
        totalTests++;
      }
    }

    this.generateReport(totalTests, passedSuites, failedSuites);
  }

  private generateReport(total: number, passed: number, failed: number): void {
    const totalDuration = Date.now() - this.totalStartTime;
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 测试结果汇总');
    console.log('='.repeat(60));
    
    console.log(`总测试套件: ${total}`);
    console.log(`✅ 通过: ${passed}`);
    console.log(`❌ 失败: ${failed}`);
    console.log(`⏱️ 总耗时: ${(totalDuration / 1000).toFixed(2)}s`);
    
    const successRate = total > 0 ? ((passed / total) * 100).toFixed(1) : '0';
    console.log(`📈 成功率: ${successRate}%`);

    console.log('\n📋 详细结果:');
    for (const [suiteName, result] of this.results) {
      const status = result.success ? '✅' : '❌';
      const duration = (result.duration / 1000).toFixed(2);
      console.log(`  ${status} ${suiteName}: ${duration}s`);
    }

    // 生成测试报告文件
    this.writeReportFile(total, passed, failed, totalDuration);

    console.log('\n🎯 测试建议:');
    if (failed === 0) {
      console.log('🎉 所有测试都通过了！系统准备就绪。');
    } else {
      console.log('🔧 有些测试失败了，请检查以下内容：');
      for (const [suiteName, result] of this.results) {
        if (!result.success) {
          console.log(`  - 检查 ${suiteName} 测试的依赖和配置`);
        }
      }
    }

    console.log('\n📁 详细日志已保存到: ./tests/test-report.json');
    process.exit(failed > 0 ? 1 : 0);
  }

  private writeReportFile(total: number, passed: number, failed: number, duration: number): void {
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        total,
        passed,
        failed,
        successRate: total > 0 ? ((passed / total) * 100) : 0,
        duration
      },
      suites: Array.from(this.results.entries()).map(([name, result]) => ({
        name,
        success: result.success,
        duration: result.duration,
        output: result.output
      }))
    };

    try {
      writeFileSync('./tests/test-report.json', JSON.stringify(report, null, 2));
    } catch (error) {
      console.warn('⚠️ 无法写入测试报告文件:', error);
    }
  }

  async runSpecific(suiteName: string): Promise<void> {
    const suite = TEST_SUITES.find(s => s.name === suiteName);
    
    if (!suite) {
      console.error(`❌ 未找到测试套件: ${suiteName}`);
      console.log('可用的测试套件:');
      TEST_SUITES.forEach(s => console.log(`  - ${s.name}: ${s.description}`));
      process.exit(1);
    }

    console.log(`🎯 运行指定测试套件: ${suite.description}\n`);
    const success = await this.runSuite(suite);
    
    if (success) {
      console.log('\n✅ 测试完成');
      process.exit(0);
    } else {
      console.log('\n❌ 测试失败');
      process.exit(1);
    }
  }
}

// 主程序
async function main() {
  const args = process.argv.slice(2);
  const runner = new TestRunner();

  if (args.length === 0) {
    await runner.runAll();
  } else if (args[0] === '--help' || args[0] === '-h') {
    console.log('BSC交易机器人测试运行器\n');
    console.log('用法:');
    console.log('  npm run test           # 运行所有测试');
    console.log('  npm run test:unit      # 运行单元测试');
    console.log('  npm run test:api       # 运行API测试');
    console.log('  npm run test:e2e       # 运行端到端测试');
    console.log('\n可用的测试套件:');
    TEST_SUITES.forEach(suite => {
      console.log(`  ${suite.name}: ${suite.description}`);
    });
  } else if (args[0] === '--list') {
    console.log('可用的测试套件:');
    TEST_SUITES.forEach(suite => {
      const required = suite.required ? '(必需)' : '(可选)';
      console.log(`  - ${suite.name}: ${suite.description} ${required}`);
    });
  } else {
    const suiteName = args[0];
    await runner.runSpecific(suiteName);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ 测试运行器出错:', error);
    process.exit(1);
  });
}

export { TestRunner };