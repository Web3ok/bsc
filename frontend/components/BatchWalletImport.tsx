'use client';

import { useState } from 'react';
import {
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  Button, Tabs, Tab, Textarea, Card, CardBody, Progress, Chip,
  Table, TableHeader, TableColumn, TableBody, TableRow, TableCell
} from '@nextui-org/react';
import { Upload, FileText, Key, CheckCircle, XCircle, AlertTriangle, Download } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { apiClient } from '@/lib/api';

interface BatchWalletImportProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

interface WalletPreview {
  index: number;
  address: string;
  label: string;
  group?: string;
  status: 'pending' | 'validating' | 'valid' | 'invalid';
  error?: string;
}

export default function BatchWalletImport({ isOpen, onClose, onSuccess }: BatchWalletImportProps) {
  const [activeTab, setActiveTab] = useState('manual');
  const [manualKeys, setManualKeys] = useState('');
  const [csvContent, setCsvContent] = useState('');
  const [jsonContent, setJsonContent] = useState('');
  const [walletPreviews, setWalletPreviews] = useState<WalletPreview[]>([]);
  const [isValidating, setIsValidating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const downloadExample = (type: 'csv' | 'json') => {
    if (type === 'csv') {
      const csvExample = `privateKey,label,group
0x1111111111111111111111111111111111111111111111111111111111111111,Wallet 1,Group A
0x2222222222222222222222222222222222222222222222222222222222222222,Wallet 2,Group A
0x3333333333333333333333333333333333333333333333333333333333333333,Wallet 3,Group B`;

      const blob = new Blob([csvExample], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'wallets_example.csv';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success('CSV 示例已下载');
    } else {
      const jsonExample = JSON.stringify([
        { privateKey: '0x1111111111111111111111111111111111111111111111111111111111111111', label: 'Wallet 1', group: 'Group A' },
        { privateKey: '0x2222222222222222222222222222222222222222222222222222222222222222', label: 'Wallet 2', group: 'Group A' },
        { privateKey: '0x3333333333333333333333333333333333333333333333333333333333333333', label: 'Wallet 3', group: 'Group B' }
      ], null, 2);

      const blob = new Blob([jsonExample], { type: 'application/json;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'wallets_example.json';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success('JSON 示例已下载');
    }
  };

  const validatePrivateKey = async (key: string): Promise<{ valid: boolean; address?: string; error?: string }> => {
    try {
      // Basic validation
      if (!key.startsWith('0x')) {
        return { valid: false, error: 'Private key must start with 0x' };
      }

      if (key.length !== 66) {
        return { valid: false, error: 'Private key must be 64 hex characters (66 with 0x prefix)' };
      }

      // Use ethers to validate and derive address
      const { ethers } = await import('ethers');
      const wallet = new ethers.Wallet(key);
      return { valid: true, address: wallet.address };
    } catch (error) {
      return { valid: false, error: error instanceof Error ? error.message : 'Invalid private key' };
    }
  };

  const handleValidateManual = async () => {
    setIsValidating(true);
    const lines = manualKeys.split('\n').filter(line => line.trim());

    if (lines.length === 0) {
      toast.error('Please enter at least one private key');
      setIsValidating(false);
      return;
    }

    if (lines.length > 100) {
      toast.error('Maximum 100 wallets per batch');
      setIsValidating(false);
      return;
    }

    const previews: WalletPreview[] = [];

    for (let i = 0; i < lines.length; i++) {
      const key = lines[i].trim();
      const validation = await validatePrivateKey(key);

      previews.push({
        index: i,
        address: validation.address || 'Invalid',
        label: `Imported-${i + 1}`,
        status: validation.valid ? 'valid' : 'invalid',
        error: validation.error,
      });
    }

    setWalletPreviews(previews);
    setIsValidating(false);

    const validCount = previews.filter(p => p.status === 'valid').length;
    if (validCount === 0) {
      toast.error('No valid private keys found');
    } else {
      toast.success(`${validCount} valid private keys found`);
    }
  };

  const handleValidateCSV = async () => {
    setIsValidating(true);

    try {
      const lines = csvContent.split('\n').filter(line => line.trim());

      if (lines.length < 2) {
        toast.error('CSV must have a header row and at least one data row');
        setIsValidating(false);
        return;
      }

      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      const dataRows = lines.slice(1);

      if (dataRows.length > 100) {
        toast.error('Maximum 100 wallets per batch');
        setIsValidating(false);
        return;
      }

      const previews: WalletPreview[] = [];

      for (let i = 0; i < dataRows.length; i++) {
        const values = dataRows[i].split(',').map(v => v.trim());
        const row: Record<string, string> = {};
        headers.forEach((header, index) => {
          row[header] = values[index] || '';
        });

        const privateKey = row.privatekey || row.private_key || row['private key'];
        const label = row.label || row.name || `Imported-${i + 1}`;
        const group = row.group || row.group_name;

        if (!privateKey) {
          previews.push({
            index: i,
            address: 'N/A',
            label,
            group,
            status: 'invalid',
            error: 'No private key found in row',
          });
          continue;
        }

        const validation = await validatePrivateKey(privateKey);
        previews.push({
          index: i,
          address: validation.address || 'Invalid',
          label,
          group,
          status: validation.valid ? 'valid' : 'invalid',
          error: validation.error,
        });
      }

      setWalletPreviews(previews);
      setIsValidating(false);

      const validCount = previews.filter(p => p.status === 'valid').length;
      if (validCount === 0) {
        toast.error('No valid wallets found in CSV');
      } else {
        toast.success(`${validCount} valid wallets found in CSV`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to parse CSV');
      setIsValidating(false);
    }
  };

  const handleValidateJSON = async () => {
    setIsValidating(true);

    try {
      const data = JSON.parse(jsonContent);

      if (!Array.isArray(data)) {
        toast.error('JSON must be an array of wallet objects');
        setIsValidating(false);
        return;
      }

      if (data.length === 0) {
        toast.error('JSON array is empty');
        setIsValidating(false);
        return;
      }

      if (data.length > 100) {
        toast.error('Maximum 100 wallets per batch');
        setIsValidating(false);
        return;
      }

      const previews: WalletPreview[] = [];

      for (let i = 0; i < data.length; i++) {
        const wallet = data[i];
        const privateKey = wallet.privateKey || wallet.private_key;
        const label = wallet.label || wallet.name || `Imported-${i + 1}`;
        const group = wallet.group || wallet.group_name;

        if (!privateKey) {
          previews.push({
            index: i,
            address: 'N/A',
            label,
            group,
            status: 'invalid',
            error: 'No private key found',
          });
          continue;
        }

        const validation = await validatePrivateKey(privateKey);
        previews.push({
          index: i,
          address: validation.address || 'Invalid',
          label,
          group,
          status: validation.valid ? 'valid' : 'invalid',
          error: validation.error,
        });
      }

      setWalletPreviews(previews);
      setIsValidating(false);

      const validCount = previews.filter(p => p.status === 'valid').length;
      if (validCount === 0) {
        toast.error('No valid wallets found in JSON');
      } else {
        toast.success(`${validCount} valid wallets found`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Invalid JSON format');
      setIsValidating(false);
    }
  };

  const handleImport = async () => {
    const validWallets = walletPreviews.filter(p => p.status === 'valid');

    if (validWallets.length === 0) {
      toast.error('No valid wallets to import');
      return;
    }

    const confirmed = window.confirm(
      `Are you sure you want to import ${validWallets.length} wallet(s)?\n\n` +
      'SECURITY WARNING:\n' +
      '• Private keys will be encrypted and stored in the database\n' +
      '• Ensure you are on a secure connection\n' +
      '• Keep your encryption password safe\n\n' +
      'Continue?'
    );

    if (!confirmed) {
      return;
    }

    setIsImporting(true);
    setImportProgress(0);

    try {
      let result;

      if (activeTab === 'manual') {
        const lines = manualKeys.split('\n').filter(line => line.trim());
        const wallets = validWallets.map((preview, i) => ({
          privateKey: lines[preview.index].trim(),
          label: preview.label,
          group: preview.group,
        }));

        result = await apiClient.importWallets(wallets);
      } else if (activeTab === 'csv') {
        result = await apiClient.importWalletsFromCSV(csvContent);
      } else if (activeTab === 'json') {
        const data = JSON.parse(jsonContent);
        const wallets = validWallets.map(preview => {
          const wallet = data[preview.index];
          return {
            privateKey: wallet.privateKey || wallet.private_key,
            label: preview.label,
            group: preview.group,
          };
        });

        result = await apiClient.importWallets(wallets);
      }

      setImportProgress(100);

      if (result?.success) {
        toast.success(`Successfully imported ${result.data.imported} wallet(s)`);

        if (result.data.errors && result.data.errors.length > 0) {
          toast.error(`${result.data.failed} wallet(s) failed to import`);
        }

        // Reset form
        setManualKeys('');
        setCsvContent('');
        setJsonContent('');
        setWalletPreviews([]);

        if (onSuccess) {
          onSuccess();
        }

        // Close modal after a short delay
        setTimeout(() => {
          onClose();
          setIsImporting(false);
          setImportProgress(0);
        }, 1500);
      } else {
        throw new Error(result?.message || 'Import failed');
      }
    } catch (error) {
      console.error('Import failed:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to import wallets');
      setIsImporting(false);
      setImportProgress(0);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>, type: 'csv' | 'json') => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (type === 'csv') {
        setCsvContent(content);
        setActiveTab('csv');
        toast.success(`已加载 CSV 文件: ${file.name}`);
      } else {
        setJsonContent(content);
        setActiveTab('json');
        toast.success(`已加载 JSON 文件: ${file.name}`);
      }
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, type: 'csv' | 'json') => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (!file) return;

    // Validate file type
    const fileExt = file.name.split('.').pop()?.toLowerCase();
    if (type === 'csv' && fileExt !== 'csv') {
      toast.error('请上传 CSV 文件');
      return;
    }
    if (type === 'json' && fileExt !== 'json') {
      toast.error('请上传 JSON 文件');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (type === 'csv') {
        setCsvContent(content);
        setActiveTab('csv');
      } else {
        setJsonContent(content);
        setActiveTab('json');
      }
      toast.success(`文件 ${file.name} 已加载`);
    };
    reader.readAsText(file);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'valid': return 'success';
      case 'invalid': return 'danger';
      case 'validating': return 'warning';
      default: return 'default';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'valid': return <CheckCircle className="h-4 w-4" />;
      case 'invalid': return <XCircle className="h-4 w-4" />;
      case 'validating': return <AlertTriangle className="h-4 w-4" />;
      default: return null;
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="5xl" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader>
          <div className="flex items-center gap-3">
            <Upload className="h-6 w-6 text-primary" />
            <div>
              <h2 className="text-xl font-bold">批量导入钱包</h2>
              <p className="text-sm text-gray-500 font-normal">支持 CSV、JSON 或手动输入私钥</p>
            </div>
          </div>
        </ModalHeader>

        <ModalBody>
          <Tabs selectedKey={activeTab} onSelectionChange={(key) => setActiveTab(key as string)}>
            {/* Manual Input Tab */}
            <Tab key="manual" title={<div className="flex items-center gap-2"><Key className="h-4 w-4" />手动输入</div>}>
              <div className="space-y-4">
                <Textarea
                  label="私钥列表"
                  placeholder="输入私钥，每行一个&#10;0x1234567890abcdef...&#10;0xabcdef1234567890..."
                  value={manualKeys}
                  onValueChange={setManualKeys}
                  minRows={8}
                  maxRows={12}
                  description="每行输入一个私钥，必须以 0x 开头"
                />

                <div className="flex gap-2">
                  <Button
                    color="primary"
                    onPress={handleValidateManual}
                    isLoading={isValidating}
                    isDisabled={!manualKeys.trim()}
                  >
                    验证私钥
                  </Button>
                  <Button
                    variant="flat"
                    onPress={() => {
                      setManualKeys('');
                      setWalletPreviews([]);
                    }}
                  >
                    清空
                  </Button>
                </div>
              </div>
            </Tab>

            {/* CSV Upload Tab */}
            <Tab key="csv" title={<div className="flex items-center gap-2"><FileText className="h-4 w-4" />CSV 文件</div>}>
              <div className="space-y-4">
                <Card>
                  <CardBody>
                    <div className="flex justify-between items-center mb-2">
                      <h4 className="font-semibold">CSV 格式要求：</h4>
                      <Button
                        size="sm"
                        variant="bordered"
                        color="primary"
                        onPress={() => downloadExample('csv')}
                        startContent={<Download className="h-4 w-4" />}
                      >
                        下载示例
                      </Button>
                    </div>
                    <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside">
                      <li>第一行必须是标题行</li>
                      <li>必须包含 <code className="bg-gray-100 px-1 rounded">privateKey</code> 列</li>
                      <li>可选列：<code className="bg-gray-100 px-1 rounded">label</code>, <code className="bg-gray-100 px-1 rounded">group</code>, <code className="bg-gray-100 px-1 rounded">address</code></li>
                    </ul>
                    <div className="mt-3 bg-gray-50 p-3 rounded text-xs font-mono">
                      privateKey,label,group<br/>
                      0x1234...,Wallet 1,Group A<br/>
                      0x5678...,Wallet 2,Group B
                    </div>
                  </CardBody>
                </Card>

                {/* Drag and Drop Area */}
                <div
                  className={`border-2 border-dashed rounded-lg p-8 text-center transition-all ${
                    isDragging
                      ? 'border-primary bg-primary/10 scale-105'
                      : 'border-gray-300 dark:border-gray-600 hover:border-primary/50'
                  }`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, 'csv')}
                >
                  <Upload className={`h-12 w-12 mx-auto mb-4 ${isDragging ? 'text-primary' : 'text-gray-400'}`} />
                  <p className="text-lg font-medium mb-2">
                    {isDragging ? '松开以上传文件' : '拖拽 CSV 文件到这里'}
                  </p>
                  <p className="text-sm text-gray-500 mb-4">或者</p>
                  <input
                    type="file"
                    accept=".csv"
                    onChange={(e) => handleFileUpload(e, 'csv')}
                    className="hidden"
                    id="csv-upload"
                  />
                  <label htmlFor="csv-upload">
                    <Button as="span" color="primary" variant="flat" startContent={<Upload className="h-4 w-4" />}>
                      点击选择 CSV 文件
                    </Button>
                  </label>
                </div>

                {csvContent && (
                  <>
                    <Textarea
                      label="CSV 内容预览"
                      value={csvContent}
                      onValueChange={setCsvContent}
                      minRows={8}
                      maxRows={12}
                      isReadOnly
                    />

                    <Button
                      color="primary"
                      onPress={handleValidateCSV}
                      isLoading={isValidating}
                    >
                      验证 CSV
                    </Button>
                  </>
                )}
              </div>
            </Tab>

            {/* JSON Upload Tab */}
            <Tab key="json" title={<div className="flex items-center gap-2"><FileText className="h-4 w-4" />JSON 文件</div>}>
              <div className="space-y-4">
                <Card>
                  <CardBody>
                    <div className="flex justify-between items-center mb-2">
                      <h4 className="font-semibold">JSON 格式要求：</h4>
                      <Button
                        size="sm"
                        variant="bordered"
                        color="primary"
                        onPress={() => downloadExample('json')}
                        startContent={<Download className="h-4 w-4" />}
                      >
                        下载示例
                      </Button>
                    </div>
                    <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside">
                      <li>必须是钱包对象的数组</li>
                      <li>每个对象必须包含 <code className="bg-gray-100 px-1 rounded">privateKey</code> 字段</li>
                      <li>可选字段：<code className="bg-gray-100 px-1 rounded">label</code>, <code className="bg-gray-100 px-1 rounded">group</code></li>
                    </ul>
                    <div className="mt-3 bg-gray-50 p-3 rounded text-xs font-mono">
                      {'['}
                      <br/>
                      {'  { "privateKey": "0x1234...", "label": "Wallet 1", "group": "Group A" },'}
                      <br/>
                      {'  { "privateKey": "0x5678...", "label": "Wallet 2", "group": "Group B" }'}
                      <br/>
                      {']'}
                    </div>
                  </CardBody>
                </Card>

                {/* Drag and Drop Area */}
                <div
                  className={`border-2 border-dashed rounded-lg p-8 text-center transition-all ${
                    isDragging
                      ? 'border-primary bg-primary/10 scale-105'
                      : 'border-gray-300 dark:border-gray-600 hover:border-primary/50'
                  }`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, 'json')}
                >
                  <Upload className={`h-12 w-12 mx-auto mb-4 ${isDragging ? 'text-primary' : 'text-gray-400'}`} />
                  <p className="text-lg font-medium mb-2">
                    {isDragging ? '松开以上传文件' : '拖拽 JSON 文件到这里'}
                  </p>
                  <p className="text-sm text-gray-500 mb-4">或者</p>
                  <input
                    type="file"
                    accept=".json"
                    onChange={(e) => handleFileUpload(e, 'json')}
                    className="hidden"
                    id="json-upload"
                  />
                  <label htmlFor="json-upload">
                    <Button as="span" color="primary" variant="flat" startContent={<Upload className="h-4 w-4" />}>
                      点击选择 JSON 文件
                    </Button>
                  </label>
                </div>

                {jsonContent && (
                  <>
                    <Textarea
                      label="JSON 内容"
                      value={jsonContent}
                      onValueChange={setJsonContent}
                      minRows={8}
                      maxRows={12}
                    />

                    <Button
                      color="primary"
                      onPress={handleValidateJSON}
                      isLoading={isValidating}
                    >
                      验证 JSON
                    </Button>
                  </>
                )}
              </div>
            </Tab>
          </Tabs>

          {/* Preview Table */}
          {walletPreviews.length > 0 && (
            <div className="mt-6">
              <h3 className="text-lg font-semibold mb-3">
                钱包预览 ({walletPreviews.filter(p => p.status === 'valid').length} 有效 / {walletPreviews.length} 总计)
              </h3>

              <Table aria-label="Wallet preview table">
                <TableHeader>
                  <TableColumn>序号</TableColumn>
                  <TableColumn>地址</TableColumn>
                  <TableColumn>标签</TableColumn>
                  <TableColumn>分组</TableColumn>
                  <TableColumn>状态</TableColumn>
                </TableHeader>
                <TableBody>
                  {walletPreviews.map((wallet) => (
                    <TableRow key={wallet.index}>
                      <TableCell>{wallet.index + 1}</TableCell>
                      <TableCell>
                        <span className="font-mono text-xs">
                          {wallet.address.slice(0, 10)}...{wallet.address.slice(-8)}
                        </span>
                      </TableCell>
                      <TableCell>{wallet.label}</TableCell>
                      <TableCell>{wallet.group || '-'}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Chip
                            size="sm"
                            color={getStatusColor(wallet.status)}
                            startContent={getStatusIcon(wallet.status)}
                          >
                            {wallet.status}
                          </Chip>
                          {wallet.error && (
                            <span className="text-xs text-danger">{wallet.error}</span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Import Progress */}
          {isImporting && (
            <div className="mt-4">
              <Progress
                value={importProgress}
                color="success"
                showValueLabel
                label="导入进度"
              />
            </div>
          )}
        </ModalBody>

        <ModalFooter>
          <Button variant="light" onPress={onClose} isDisabled={isImporting}>
            取消
          </Button>
          <Button
            color="success"
            onPress={handleImport}
            isLoading={isImporting}
            isDisabled={walletPreviews.filter(p => p.status === 'valid').length === 0}
            startContent={!isImporting && <Upload className="h-4 w-4" />}
          >
            导入 {walletPreviews.filter(p => p.status === 'valid').length} 个钱包
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
