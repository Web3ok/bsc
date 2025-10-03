'use client';

import { useState, useEffect } from 'react';
import { 
  Card, CardBody, CardHeader, Button, Input, Modal, ModalContent, 
  ModalHeader, ModalBody, ModalFooter, useDisclosure, Select, SelectItem,
  Table, TableHeader, TableColumn, TableBody, TableRow, TableCell,
  Chip, Progress, Textarea, Tabs, Tab, Divider
} from '@nextui-org/react';
import { Play, Pause, Square, RotateCcw, Settings, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';
import { toast } from 'react-hot-toast';

interface BatchOperation {
  id: string;
  type: 'buy' | 'sell' | 'transfer';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  walletAddress: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  progress: number;
  result?: any;
  error?: string;
  createdAt: string;
  executedAt?: string;
}

interface BatchStrategy {
  name: string;
  description: string;
  operations: Omit<BatchOperation, 'id' | 'status' | 'progress' | 'createdAt'>[];
  riskLevel: 'low' | 'medium' | 'high';
  estimatedDuration: string;
}

export default function BatchOperations() {
  const [operations, setOperations] = useState<BatchOperation[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [selectedWallets, setSelectedWallets] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [strategy, setStrategy] = useState<BatchStrategy | null>(null);

  // Modal states
  const { isOpen: isCreateOpen, onOpen: onCreateOpen, onClose: onCreateClose } = useDisclosure();
  const { isOpen: isStrategyOpen, onOpen: onStrategyOpen, onClose: onStrategyClose } = useDisclosure();

  // Form states
  const [batchConfig, setBatchConfig] = useState({
    operationType: 'buy',
    tokenIn: '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd', // WBNB
    tokenOut: '0x78867BbEeF44f2326bF8DDd1941a4439382EF2A7', // BUSD
    amountIn: '0.01',
    slippage: '1.0',
    maxConcurrency: 3,
    delayBetweenOps: 1000,
    riskCheck: true
  });

  const [newStrategy, setNewStrategy] = useState({
    name: '',
    description: '',
    operationsConfig: '',
    riskLevel: 'medium'
  });

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:10001';

  useEffect(() => {
    fetchOperations();
  }, []);

  const fetchOperations = async () => {
    try {
      // Mock data for demonstration
      const mockOperations: BatchOperation[] = [
        {
          id: 'op_001',
          type: 'buy',
          status: 'completed',
          walletAddress: '0x1234...5678',
          tokenIn: '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd',
          tokenOut: '0x78867BbEeF44f2326bF8DDd1941a4439382EF2A7',
          amountIn: '0.01',
          progress: 100,
          result: { txHash: '0xabc...def', amountOut: '4.98' },
          createdAt: new Date().toISOString(),
          executedAt: new Date().toISOString()
        },
        {
          id: 'op_002',
          type: 'sell',
          status: 'processing',
          walletAddress: '0x9876...1234',
          tokenIn: '0x78867BbEeF44f2326bF8DDd1941a4439382EF2A7',
          tokenOut: '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd',
          amountIn: '5.0',
          progress: 45,
          createdAt: new Date().toISOString()
        }
      ];
      setOperations(mockOperations);
    } catch (error) {
      console.error('Failed to fetch operations:', error);
      toast.error('Failed to load batch operations');
    }
  };

  const handleCreateBatchOperation = async () => {
    try {
      // Validate inputs
      if (selectedWallets.length === 0) {
        toast.error('Please select at least one wallet');
        return;
      }

      const newOperations: Omit<BatchOperation, 'id' | 'status' | 'progress' | 'createdAt'>[] = 
        selectedWallets.map(walletAddress => ({
          type: batchConfig.operationType as 'buy' | 'sell',
          walletAddress,
          tokenIn: batchConfig.tokenIn,
          tokenOut: batchConfig.tokenOut,
          amountIn: batchConfig.amountIn
        }));

      // Call batch trading API
      const response = await fetch(`${API_URL}/api/v1/batch/operations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operations: newOperations,
          config: {
            maxConcurrency: batchConfig.maxConcurrency,
            delayBetweenOps: batchConfig.delayBetweenOps,
            slippage: parseFloat(batchConfig.slippage),
            riskCheck: batchConfig.riskCheck
          }
        })
      });

      const result = await response.json();
      if (result.success) {
        toast.success(`Created ${newOperations.length} batch operations`);
        fetchOperations();
        onCreateClose();
      } else {
        toast.error(result.error || 'Failed to create batch operations');
      }
    } catch (error) {
      console.error('Failed to create batch operation:', error);
      toast.error('Failed to create batch operations');
    }
  };

  const handleExecuteBatch = async () => {
    try {
      setIsRunning(true);
      const pendingOps = operations.filter(op => op.status === 'pending');
      
      // Simulate batch execution with progress updates
      for (let i = 0; i < pendingOps.length; i++) {
        const op = pendingOps[i];
        
        // Update operation status to processing
        setOperations(prev => prev.map(o => 
          o.id === op.id ? { ...o, status: 'processing', progress: 0 } : o
        ));

        // Simulate progress
        for (let progress = 0; progress <= 100; progress += 20) {
          await new Promise(resolve => setTimeout(resolve, 200));
          setOperations(prev => prev.map(o => 
            o.id === op.id ? { ...o, progress } : o
          ));
          setProgress((i / pendingOps.length) * 100 + (progress / pendingOps.length));
        }

        // Complete operation
        setOperations(prev => prev.map(o => 
          o.id === op.id ? { 
            ...o, 
            status: 'completed', 
            progress: 100,
            executedAt: new Date().toISOString(),
            result: { txHash: '0x' + Math.random().toString(16).substr(2, 8) }
          } : o
        ));
      }

      setProgress(100);
      toast.success('Batch execution completed!');
    } catch (error) {
      console.error('Batch execution failed:', error);
      toast.error('Batch execution failed');
    } finally {
      setIsRunning(false);
      setTimeout(() => setProgress(0), 2000);
    }
  };

  const handleStopBatch = () => {
    setIsRunning(false);
    setOperations(prev => prev.map(op => 
      op.status === 'processing' ? { ...op, status: 'pending', progress: 0 } : op
    ));
    setProgress(0);
    toast('Batch execution stopped');
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'success';
      case 'processing': return 'primary';
      case 'failed': return 'danger';
      case 'pending': return 'default';
      default: return 'default';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'buy': return <TrendingUp className="h-4 w-4 text-green-500" />;
      case 'sell': return <TrendingDown className="h-4 w-4 text-red-500" />;
      default: return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">批量操作</h2>
          <p className="text-muted-foreground">跨多个钱包执行交易</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="bordered" onPress={onStrategyOpen} startContent={<Settings className="h-4 w-4" />}>
            策略管理
          </Button>
          <Button size="sm" color="primary" onPress={onCreateOpen} startContent={<Play className="h-4 w-4" />}>
            创建批量任务
          </Button>
        </div>
      </div>

      {/* Control Panel */}
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">执行控制</h3>
        </CardHeader>
        <CardBody>
          <div className="flex items-center gap-4">
            <Button
              color="success"
              onPress={handleExecuteBatch}
              isDisabled={isRunning || operations.filter(op => op.status === 'pending').length === 0}
              startContent={<Play className="h-4 w-4" />}
            >
              执行批量任务
            </Button>
            <Button
              color="danger"
              onPress={handleStopBatch}
              isDisabled={!isRunning}
              startContent={<Square className="h-4 w-4" />}
            >
              停止
            </Button>
            <Button
              variant="bordered"
              onPress={() => setOperations([])}
              startContent={<RotateCcw className="h-4 w-4" />}
            >
              清空全部
            </Button>
            
            <div className="flex-1">
              <Progress 
                value={progress} 
                color={progress === 100 ? "success" : "primary"}
                showValueLabel={true}
                className="max-w-md"
              />
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Operations Table */}
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">操作队列 ({operations.length})</h3>
        </CardHeader>
        <CardBody>
          <Table aria-label="Batch operations table">
            <TableHeader>
              <TableColumn>类型</TableColumn>
              <TableColumn>钱包</TableColumn>
              <TableColumn>交易对</TableColumn>
              <TableColumn>数量</TableColumn>
              <TableColumn>状态</TableColumn>
              <TableColumn>进度</TableColumn>
              <TableColumn>结果</TableColumn>
            </TableHeader>
            <TableBody>
              {operations.map((op) => (
                <TableRow key={op.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {getTypeIcon(op.type)}
                      <span className="capitalize">{op.type}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-sm">
                      {op.walletAddress.slice(0, 8)}...{op.walletAddress.slice(-6)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm">
                      {op.type === 'buy' ? 'BNB → BUSD' : 'BUSD → BNB'}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono">{op.amountIn}</span>
                  </TableCell>
                  <TableCell>
                    <Chip size="sm" color={getStatusColor(op.status)}>
                      {op.status}
                    </Chip>
                  </TableCell>
                  <TableCell>
                    <Progress value={op.progress} size="sm" color="primary" />
                  </TableCell>
                  <TableCell>
                    {op.result && (
                      <span className="text-xs font-mono text-green-500 dark:text-green-400">
                        {op.result.amountOut || op.result.txHash?.slice(0, 8)}
                      </span>
                    )}
                    {op.error && (
                      <span className="text-xs text-red-500 dark:text-red-400">错误</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardBody>
      </Card>

      {/* Create Batch Modal */}
      <Modal isOpen={isCreateOpen} onClose={onCreateClose} size="2xl">
        <ModalContent>
          <ModalHeader>创建批量操作</ModalHeader>
          <ModalBody>
            <div className="space-y-4">
              <Select
                label="操作类型"
                selectedKeys={[batchConfig.operationType]}
                onSelectionChange={(keys) => setBatchConfig({
                  ...batchConfig,
                  operationType: Array.from(keys)[0] as string
                })}
              >
                <SelectItem key="buy" value="buy" textValue="买入 (BNB → 代币)">买入 (BNB → 代币)</SelectItem>
                <SelectItem key="sell" value="sell" textValue="卖出 (代币 → BNB)">卖出 (代币 → BNB)</SelectItem>
              </Select>

              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="每次操作数量"
                  placeholder="0.01"
                  value={batchConfig.amountIn}
                  onChange={(e) => setBatchConfig({ ...batchConfig, amountIn: e.target.value })}
                />
                <Input
                  label="滑点 %"
                  placeholder="1.0"
                  value={batchConfig.slippage}
                  onChange={(e) => setBatchConfig({ ...batchConfig, slippage: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="最大并发数"
                  type="number"
                  value={batchConfig.maxConcurrency.toString()}
                  onChange={(e) => setBatchConfig({
                    ...batchConfig,
                    maxConcurrency: parseInt(e.target.value) || 1
                  })}
                />
                <Input
                  label="延迟 (毫秒)"
                  type="number"
                  value={batchConfig.delayBetweenOps.toString()}
                  onChange={(e) => setBatchConfig({
                    ...batchConfig,
                    delayBetweenOps: parseInt(e.target.value) || 1000
                  })}
                />
              </div>

              <Textarea
                label="选择钱包"
                placeholder="输入钱包地址（每行一个）"
                rows={4}
                value={selectedWallets.join('\n')}
                onChange={(e) => setSelectedWallets(
                  e.target.value.split('\n').filter(addr => addr.trim())
                )}
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={onCreateClose}>
              取消
            </Button>
            <Button color="primary" onPress={handleCreateBatchOperation}>
              创建批量任务
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Strategy Modal */}
      <Modal isOpen={isStrategyOpen} onClose={onStrategyClose} size="3xl">
        <ModalContent>
          <ModalHeader>批量策略</ModalHeader>
          <ModalBody>
            <Tabs defaultSelectedKey="presets">
              <Tab key="presets" title="预设策略">
                <div className="space-y-4">
                  {/* Preset strategies would go here */}
                  <Card>
                    <CardBody>
                      <h4 className="font-semibold">定投策略</h4>
                      <p className="text-sm text-muted-foreground">
                        逐步买入代币以减少价格影响
                      </p>
                      <div className="mt-2">
                        <Chip size="sm" color="success">低风险</Chip>
                        <span className="ml-2 text-sm text-muted-foreground">~5分钟</span>
                      </div>
                    </CardBody>
                  </Card>
                </div>
              </Tab>
              <Tab key="custom" title="自定义策略">
                <div className="space-y-4">
                  <Input
                    label="策略名称"
                    value={newStrategy.name}
                    onChange={(e) => setNewStrategy({ ...newStrategy, name: e.target.value })}
                  />
                  <Textarea
                    label="描述"
                    value={newStrategy.description}
                    onChange={(e) => setNewStrategy({ ...newStrategy, description: e.target.value })}
                  />
                  <Textarea
                    label="操作配置 (JSON)"
                    placeholder="输入操作配置..."
                    rows={6}
                    value={newStrategy.operationsConfig}
                    onChange={(e) => setNewStrategy({ ...newStrategy, operationsConfig: e.target.value })}
                  />
                </div>
              </Tab>
            </Tabs>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={onStrategyClose}>
              关闭
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}