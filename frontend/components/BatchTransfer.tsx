'use client';

import { useState, useEffect } from 'react';
import {
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  Button, Input, Select, SelectItem, Textarea, Card, CardBody,
  Progress, Chip, Table, TableHeader, TableColumn, TableBody,
  TableRow, TableCell, Tabs, Tab, Switch
} from '@nextui-org/react';
import { Send, Wallet, ArrowRight, CheckCircle, XCircle, Clock, Zap } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { apiClient } from '@/lib/api';

interface BatchTransferProps {
  isOpen: boolean;
  onClose: () => void;
  wallets?: Array<{ address: string; label: string; balance: string }>;
}

interface TransferRecipient {
  address: string;
  amount?: string;
  status: 'pending' | 'processing' | 'success' | 'failed';
  txHash?: string;
  error?: string;
}

type TransferType = 'one-to-one' | 'one-to-many' | 'many-to-many';

export default function BatchTransfer({ isOpen, onClose, wallets = [] }: BatchTransferProps) {
  const [transferType, setTransferType] = useState<TransferType>('one-to-many');
  const [assetType, setAssetType] = useState<'BNB' | 'TOKEN'>('BNB');
  const [tokenAddress, setTokenAddress] = useState('');

  // Sender configuration
  const [fromAddresses, setFromAddresses] = useState<string[]>([]);
  const [manualFromAddresses, setManualFromAddresses] = useState('');

  // Recipient configuration
  const [recipientInput, setRecipientInput] = useState('');
  const [recipients, setRecipients] = useState<TransferRecipient[]>([]);

  // Amount configuration
  const [fixedAmount, setFixedAmount] = useState('');
  const [useFixedAmount, setUseFixedAmount] = useState(true);

  // Transfer state
  const [isTransferring, setIsTransferring] = useState(false);
  const [transferProgress, setTransferProgress] = useState(0);
  const [estimatedGas, setEstimatedGas] = useState('0');
  const [senderBalances, setSenderBalances] = useState<Record<string, string>>({});
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  useEffect(() => {
    // Reset state when modal opens
    if (isOpen) {
      setRecipients([]);
      setTransferProgress(0);
    }
  }, [isOpen]);

  const parseRecipients = () => {
    try {
      const lines = recipientInput.split('\n').filter(line => line.trim());

      if (lines.length === 0) {
        toast.error('请输入至少一个接收地址');
        return;
      }

      const newRecipients: TransferRecipient[] = [];

      for (const line of lines) {
        const parts = line.trim().split(',').map(p => p.trim());
        const address = parts[0];

        // Validate address format
        if (!address.match(/^0x[a-fA-F0-9]{40}$/)) {
          toast.error(`无效的地址格式: ${address}`);
          return;
        }

        const amount = parts[1] || fixedAmount;

        if (!useFixedAmount && !amount) {
          toast.error(`地址 ${address} 缺少转账金额`);
          return;
        }

        newRecipients.push({
          address,
          amount: amount,
          status: 'pending',
        });
      }

      setRecipients(newRecipients);
      toast.success(`已添加 ${newRecipients.length} 个接收地址`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '解析接收地址失败');
    }
  };

  const parseFromAddresses = () => {
    const addresses = manualFromAddresses
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.match(/^0x[a-fA-F0-9]{40}$/));

    setFromAddresses(addresses);
  };

  const checkBalances = async () => {
    const balances: Record<string, string> = {};

    for (const address of fromAddresses) {
      try {
        const result = await apiClient.getWalletBalance(address);
        balances[address] = result.data?.BNB || '0';
      } catch (error) {
        balances[address] = '0';
      }
    }

    setSenderBalances(balances);
    return balances;
  };

  const smartDistribute = async () => {
    if (fromAddresses.length === 0) {
      toast.error('请先选择发送钱包');
      return;
    }

    if (recipients.length === 0) {
      toast.error('请先添加接收地址');
      return;
    }

    const balances = await checkBalances();
    const totalBalance = Object.values(balances).reduce((sum, b) => sum + parseFloat(b), 0);

    // Reserve 5% for gas
    const availableBalance = totalBalance * 0.95;
    const amountPerRecipient = (availableBalance / recipients.length).toFixed(6);

    setFixedAmount(amountPerRecipient);
    toast.success(`已设置每笔 ${amountPerRecipient} BNB (总余额: ${totalBalance.toFixed(4)} BNB, 预留 5% Gas 费)`);
  };

  const estimateGas = async () => {
    try {
      // Simple gas estimation: base gas * number of transfers
      const baseGas = assetType === 'BNB' ? 21000 : 65000; // Token transfers cost more
      const totalGas = baseGas * recipients.length;
      const gasPrice = 5; // 5 Gwei (typical for BSC)

      const estimatedCost = (totalGas * gasPrice) / 1e9; // Convert to BNB
      setEstimatedGas(estimatedCost.toFixed(6));
    } catch (error) {
      console.error('Gas estimation failed:', error);
      setEstimatedGas('Unknown');
    }
  };

  useEffect(() => {
    if (recipients.length > 0) {
      estimateGas();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipients, assetType]);

  const handleTransfer = async () => {
    // Validation
    if (fromAddresses.length === 0) {
      toast.error('请选择或输入发送钱包地址');
      return;
    }

    if (recipients.length === 0) {
      toast.error('请添加接收地址');
      return;
    }

    if (useFixedAmount && (!fixedAmount || parseFloat(fixedAmount) <= 0)) {
      toast.error('请输入有效的转账金额');
      return;
    }

    if (assetType === 'TOKEN' && !tokenAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
      toast.error('请输入有效的代币合约地址');
      return;
    }

    // Show confirmation dialog
    await checkBalances();
    setShowConfirmDialog(true);
  };

  const executeTransfer = async () => {
    const totalAmount = useFixedAmount
      ? (parseFloat(fixedAmount) * recipients.length).toFixed(6)
      : recipients.reduce((sum, r) => sum + parseFloat(r.amount || '0'), 0).toFixed(6);

    setShowConfirmDialog(false);

    setIsTransferring(true);
    setTransferProgress(0);

    try {
      const toAddresses = recipients.map(r => r.address);
      const amount = useFixedAmount ? fixedAmount : recipients[0].amount || '0';

      const result = await apiClient.batchTransfer({
        type: transferType,
        fromAddresses,
        toAddresses,
        amount,
        tokenAddress: assetType === 'TOKEN' ? tokenAddress : undefined,
      });

      if (result.success && result.data) {
        const { successful, failed, results } = result.data;

        // Update recipient statuses
        const updatedRecipients = recipients.map((recipient, index) => {
          const transferResult = results[index];
          if (!transferResult) {
            return { ...recipient, status: 'failed' as const, error: 'No result' };
          }

          if (transferResult.success) {
            return {
              ...recipient,
              status: 'success' as const,
              txHash: transferResult.txHash,
            };
          } else {
            return {
              ...recipient,
              status: 'failed' as const,
              error: transferResult.error || 'Transfer failed',
            };
          }
        });

        setRecipients(updatedRecipients);
        setTransferProgress(100);

        if (failed === 0) {
          toast.success(`成功转账 ${successful} 笔交易！`);
        } else {
          toast.error(`${successful} 笔成功，${failed} 笔失败`);
        }
      } else {
        throw new Error(result.message || 'Batch transfer failed');
      }
    } catch (error) {
      console.error('Batch transfer failed:', error);
      toast.error(error instanceof Error ? error.message : '批量转账失败');

      // Mark all as failed
      setRecipients(recipients.map(r => ({
        ...r,
        status: 'failed',
        error: 'Batch transfer error',
      })));
    } finally {
      setIsTransferring(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success': return 'success';
      case 'failed': return 'danger';
      case 'processing': return 'warning';
      default: return 'default';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success': return <CheckCircle className="h-4 w-4" />;
      case 'failed': return <XCircle className="h-4 w-4" />;
      case 'processing': return <Clock className="h-4 w-4 animate-spin" />;
      default: return null;
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="5xl" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader>
          <div className="flex items-center gap-3">
            <Send className="h-6 w-6 text-primary" />
            <div>
              <h2 className="text-xl font-bold">批量转账</h2>
              <p className="text-sm text-gray-500 font-normal">向多个地址发送 BNB 或代币</p>
            </div>
          </div>
        </ModalHeader>

        <ModalBody>
          <div className="space-y-6">
            {/* Transfer Type Selection */}
            <Card>
              <CardBody>
                <h3 className="font-semibold mb-3">转账类型</h3>
                <Select
                  label="选择转账模式"
                  selectedKeys={[transferType]}
                  onSelectionChange={(keys) => setTransferType(Array.from(keys)[0] as TransferType)}
                >
                  <SelectItem key="one-to-one" textValue="一对一转账">
                    <div>
                      <p className="font-semibold">一对一转账</p>
                      <p className="text-xs text-gray-500">单个钱包向单个地址转账</p>
                    </div>
                  </SelectItem>
                  <SelectItem key="one-to-many" textValue="一对多转账">
                    <div>
                      <p className="font-semibold">一对多转账</p>
                      <p className="text-xs text-gray-500">单个钱包向多个地址转账</p>
                    </div>
                  </SelectItem>
                  <SelectItem key="many-to-many" textValue="多对多转账">
                    <div>
                      <p className="font-semibold">多对多转账</p>
                      <p className="text-xs text-gray-500">多个钱包轮流向多个地址转账</p>
                    </div>
                  </SelectItem>
                </Select>
              </CardBody>
            </Card>

            {/* Asset Type */}
            <Card>
              <CardBody>
                <h3 className="font-semibold mb-3">资产类型</h3>
                <Tabs selectedKey={assetType} onSelectionChange={(key) => setAssetType(key as 'BNB' | 'TOKEN')}>
                  <Tab key="BNB" title="BNB">
                    <div className="py-4">
                      <p className="text-sm text-gray-600">转账 BNB (BSC 原生代币)</p>
                    </div>
                  </Tab>
                  <Tab key="TOKEN" title="ERC20 代币">
                    <div className="py-4 space-y-3">
                      <Input
                        label="代币合约地址"
                        placeholder="0x..."
                        value={tokenAddress}
                        onValueChange={setTokenAddress}
                        description="输入 BEP-20 代币合约地址"
                      />
                    </div>
                  </Tab>
                </Tabs>
              </CardBody>
            </Card>

            {/* From Addresses */}
            <Card>
              <CardBody>
                <h3 className="font-semibold mb-3">发送钱包</h3>
                <Textarea
                  label="发送地址列表"
                  placeholder="输入钱包地址，每行一个&#10;0x1234567890abcdef...&#10;0xabcdef1234567890..."
                  value={manualFromAddresses}
                  onValueChange={setManualFromAddresses}
                  onBlur={parseFromAddresses}
                  minRows={3}
                  description={`已选择 ${fromAddresses.length} 个发送钱包`}
                />
              </CardBody>
            </Card>

            {/* Recipients */}
            <Card>
              <CardBody>
                <h3 className="font-semibold mb-3">接收地址</h3>
                <Textarea
                  label="接收地址列表"
                  placeholder={
                    useFixedAmount
                      ? "每行一个地址：\n0x1234567890abcdef...\n0xabcdef1234567890..."
                      : "地址,金额格式：\n0x1234...,0.1\n0x5678...,0.2"
                  }
                  value={recipientInput}
                  onValueChange={setRecipientInput}
                  minRows={5}
                  description={useFixedAmount ? "每行一个地址" : "格式：地址,金额 (逗号分隔)"}
                />

                <div className="mt-3 flex gap-2">
                  <Button color="primary" onPress={parseRecipients}>
                    解析地址
                  </Button>
                  <Button
                    variant="flat"
                    onPress={() => {
                      setRecipientInput('');
                      setRecipients([]);
                    }}
                  >
                    清空
                  </Button>
                </div>
              </CardBody>
            </Card>

            {/* Amount Configuration */}
            <Card>
              <CardBody>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">金额配置</h3>
                    <Switch
                      isSelected={useFixedAmount}
                      onValueChange={setUseFixedAmount}
                      size="sm"
                    >
                      使用固定金额
                    </Switch>
                  </div>

                  {useFixedAmount && (
                    <div className="space-y-2">
                      <Input
                        label="每笔转账金额"
                        placeholder="0.01"
                        value={fixedAmount}
                        onValueChange={setFixedAmount}
                        type="number"
                        step="0.000001"
                        endContent={
                          <span className="text-sm text-gray-500">{assetType}</span>
                        }
                      />
                      {fromAddresses.length > 0 && recipients.length > 0 && assetType === 'BNB' && (
                        <Button
                          size="sm"
                          variant="flat"
                          color="success"
                          className="w-full"
                          startContent={<Zap className="h-4 w-4" />}
                          onPress={smartDistribute}
                        >
                          智能分配余额 (自动查询钱包余额并平均分配)
                        </Button>
                      )}
                    </div>
                  )}

                  {recipients.length > 0 && (
                    <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-lg">
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-gray-500">接收地址数:</span>
                          <span className="ml-2 font-semibold">{recipients.length}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">预计 Gas:</span>
                          <span className="ml-2 font-semibold">{estimatedGas} BNB</span>
                        </div>
                        {useFixedAmount && (
                          <div>
                            <span className="text-gray-500">单笔金额:</span>
                            <span className="ml-2 font-semibold">{fixedAmount} {assetType}</span>
                          </div>
                        )}
                        <div>
                          <span className="text-gray-500">总金额:</span>
                          <span className="ml-2 font-semibold">
                            {useFixedAmount
                              ? (parseFloat(fixedAmount || '0') * recipients.length).toFixed(6)
                              : recipients.reduce((sum, r) => sum + parseFloat(r.amount || '0'), 0).toFixed(6)
                            } {assetType}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </CardBody>
            </Card>

            {/* Recipients Preview */}
            {recipients.length > 0 && (
              <Card>
                <CardBody>
                  <h3 className="font-semibold mb-3">接收地址预览</h3>
                  <Table aria-label="Recipients table">
                    <TableHeader>
                      <TableColumn>序号</TableColumn>
                      <TableColumn>地址</TableColumn>
                      <TableColumn>金额</TableColumn>
                      <TableColumn>状态</TableColumn>
                      <TableColumn>交易哈希</TableColumn>
                    </TableHeader>
                    <TableBody>
                      {recipients.map((recipient, index) => (
                        <TableRow key={index}>
                          <TableCell>{index + 1}</TableCell>
                          <TableCell>
                            <span className="font-mono text-xs">
                              {recipient.address.slice(0, 10)}...{recipient.address.slice(-8)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="font-mono">
                              {recipient.amount || fixedAmount} {assetType}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Chip
                              size="sm"
                              color={getStatusColor(recipient.status)}
                              startContent={getStatusIcon(recipient.status)}
                            >
                              {recipient.status}
                            </Chip>
                          </TableCell>
                          <TableCell>
                            {recipient.txHash ? (
                              <a
                                href={`https://bscscan.com/tx/${recipient.txHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary text-xs font-mono hover:underline"
                              >
                                {recipient.txHash.slice(0, 10)}...
                              </a>
                            ) : recipient.error ? (
                              <span className="text-xs text-danger">{recipient.error}</span>
                            ) : (
                              '-'
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardBody>
              </Card>
            )}

            {/* Transfer Progress */}
            {isTransferring && (
              <Card>
                <CardBody>
                  <Progress
                    value={transferProgress}
                    color="success"
                    showValueLabel
                    label="转账进度"
                  />
                </CardBody>
              </Card>
            )}
          </div>
        </ModalBody>

        <ModalFooter>
          <Button variant="light" onPress={onClose} isDisabled={isTransferring}>
            取消
          </Button>
          <Button
            color="success"
            onPress={handleTransfer}
            isLoading={isTransferring}
            isDisabled={fromAddresses.length === 0 || recipients.length === 0}
            startContent={!isTransferring && <Send className="h-4 w-4" />}
          >
            执行批量转账
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
