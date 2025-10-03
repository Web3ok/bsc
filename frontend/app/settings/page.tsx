'use client';

import { useState } from 'react';
import { useTheme } from 'next-themes';
import { useLanguage } from '../../contexts/LanguageContext';
import { Button, Card, CardBody, CardHeader, Input, Select, SelectItem, Switch, Divider } from '@nextui-org/react';
import { Settings, Globe, Moon, Sun, Wallet, Database, Key, Shield } from 'lucide-react';

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { language, setLanguage, t } = useLanguage();
  const [apiKey, setApiKey] = useState('');
  const [autoSave, setAutoSave] = useState(true);
  const [notifications, setNotifications] = useState(true);
  
  const isDarkMode = theme === 'dark';
  const toggleDarkMode = () => setTheme(isDarkMode ? 'light' : 'dark');

  const handleSave = () => {
    try {
      // 保存设置到 localStorage
      const settings = {
        theme,
        language,
        autoSave,
        notifications,
        apiKey: apiKey ? '***hidden***' : '', // 不保存明文API密钥
        lastUpdated: new Date().toISOString()
      };

      localStorage.setItem('bsc_bot_settings', JSON.stringify(settings));
      alert(t('settings.settingsSaved') || '✅ Settings saved successfully!');
    } catch (error) {
      console.error('Failed to save settings:', error);
      alert(t('settings.saveFailed') || '❌ Failed to save settings');
    }
  };

  const handleExport = async () => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:10001';

      // 显示确认对话框
      const confirmed = window.confirm(
        t('settings.exportWarning') ||
        'This will export all wallets data (including private keys). Are you sure?\n\n' +
        '⚠️ Keep the exported file secure!\n' +
        '⚠️ Never share it with anyone!'
      );

      if (!confirmed) {
        return;
      }

      const response = await fetch(`${apiUrl}/api/v1/wallets/export`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      if (result.success) {
        alert(
          `${t('settings.exportSuccess') || '✅ Export successful!'}\n\n` +
          `${t('settings.filePath') || 'File saved to'}: ${result.data.filePath}\n` +
          `${t('settings.walletCount') || 'Wallets'}: ${result.data.count}\n` +
          `${t('settings.format') || 'Format'}: ${result.data.format.toUpperCase()}\n\n` +
          `${t('settings.keepFileSafe') || '⚠️ Keep this file safe!'}`
        );
      } else {
        throw new Error(result.message || 'Export failed');
      }
    } catch (error) {
      console.error('Export failed:', error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      alert(`${t('settings.exportFailed') || '❌ Export Failed'}: ${errorMsg}`);
    }
  };

  const handleClearCache = () => {
    try {
      // 清除本地缓存
      const confirmed = window.confirm(
        t('settings.clearCacheWarning') ||
        'This will clear all cached data. Continue?'
      );

      if (!confirmed) {
        return;
      }

      // 清除 localStorage 中的缓存（保留设置）
      const settings = localStorage.getItem('bsc_bot_settings');
      localStorage.clear();
      if (settings) {
        localStorage.setItem('bsc_bot_settings', settings);
      }

      alert(t('settings.cacheCleared') || '✅ Cache cleared successfully!');
    } catch (error) {
      console.error('Failed to clear cache:', error);
      alert(t('settings.clearCacheFailed') || '❌ Failed to clear cache');
    }
  };

  const handleResetSettings = () => {
    try {
      const confirmed = window.confirm(
        t('settings.resetWarning') ||
        'This will reset all settings to default. Continue?'
      );

      if (!confirmed) {
        return;
      }

      // 重置所有设置
      setTheme('light');
      setLanguage('en');
      setApiKey('');
      setAutoSave(true);
      setNotifications(true);

      localStorage.removeItem('bsc_bot_settings');

      alert(t('settings.settingsReset') || '✅ Settings reset to default!');
    } catch (error) {
      console.error('Failed to reset settings:', error);
      alert(t('settings.resetFailed') || '❌ Failed to reset settings');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 p-4 sm:p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6 sm:mb-8">
          <div className="bg-blue-100 dark:bg-blue-900 p-3 rounded-xl">
            <Settings className="h-6 w-6 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 dark:text-white">{t('settings.title')}</h1>
            <p className="text-base sm:text-lg text-gray-600 dark:text-gray-300">{t('settings.subtitle')}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 lg:gap-8">
          {/* Appearance Settings */}
          <Card className="p-4 sm:p-6 shadow-lg border-2 border-gray-100 hover:shadow-xl transition-all duration-300">
            <CardHeader className="flex items-center gap-3 pb-4">
              <div className="bg-purple-100 p-2 rounded-lg">
                <Sun className="h-5 w-5 text-purple-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-900">{t('settings.appearance')}</h3>
            </CardHeader>
            <CardBody className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium text-gray-700">{t('settings.darkMode')}</h4>
                  <p className="text-sm text-gray-500">{t('settings.darkModeDesc')}</p>
                </div>
                <Switch
                  isSelected={isDarkMode}
                  onValueChange={toggleDarkMode}
                  color="primary"
                />
              </div>
              
              <Divider />
              
              <div>
                <h4 className="font-medium text-gray-700 mb-2">{t('settings.language')}</h4>
                <Select
                  placeholder={t('settings.selectLanguage')}
                  selectedKeys={[language]}
                  onSelectionChange={(keys) => setLanguage(Array.from(keys)[0] as any)}
                  startContent={<Globe className="h-4 w-4" />}
                >
                  <SelectItem key="zh" value="zh" textValue="中文">中文</SelectItem>
                  <SelectItem key="en" value="en" textValue="English">English</SelectItem>
                  <SelectItem key="ja" value="ja" textValue="日本語">日本語</SelectItem>
                  <SelectItem key="ko" value="ko" textValue="한국어">한국어</SelectItem>
                </Select>
              </div>
            </CardBody>
          </Card>

          {/* Security Settings */}
          <Card className="p-4 sm:p-6 shadow-lg border-2 border-gray-100 hover:shadow-xl transition-all duration-300">
            <CardHeader className="flex items-center gap-3 pb-4">
              <div className="bg-red-100 p-2 rounded-lg">
                <Shield className="h-5 w-5 text-red-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-900">{t('settings.security')}</h3>
            </CardHeader>
            <CardBody className="space-y-6">
              <div>
                <h4 className="font-medium text-gray-700 mb-2">{t('settings.apiKey')}</h4>
                <Input
                  type="password"
                  placeholder={t('settings.apiKey')}
                  value={apiKey}
                  onValueChange={setApiKey}
                  startContent={<Key className="h-4 w-4" />}
                />
              </div>
              
              <Divider />
              
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium text-gray-700">{t('settings.autoSave')}</h4>
                  <p className="text-sm text-gray-500">{t('settings.autoSaveDesc')}</p>
                </div>
                <Switch
                  isSelected={autoSave}
                  onValueChange={setAutoSave}
                  color="success"
                />
              </div>
            </CardBody>
          </Card>

          {/* Notification Settings */}
          <Card className="p-4 sm:p-6 shadow-lg border-2 border-gray-100 hover:shadow-xl transition-all duration-300">
            <CardHeader className="flex items-center gap-3 pb-4">
              <div className="bg-green-100 p-2 rounded-lg">
                <Database className="h-5 w-5 text-green-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-900">{t('settings.notifications')}</h3>
            </CardHeader>
            <CardBody className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium text-gray-700">{t('settings.pushNotifications')}</h4>
                  <p className="text-sm text-gray-500">{t('settings.pushNotificationsDesc')}</p>
                </div>
                <Switch
                  isSelected={notifications}
                  onValueChange={setNotifications}
                  color="warning"
                />
              </div>
              
              <Divider />
              
              <div className="space-y-3">
                <h4 className="font-medium text-gray-700">{t('settings.notificationTypes')}</h4>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>{t('settings.tradeComplete')}</span>
                    <Switch size="sm" color="success" aria-label="切换交易完成通知" />
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span>{t('settings.priceAlert')}</span>
                    <Switch size="sm" color="warning" aria-label="切换价格预警通知" />
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span>{t('settings.systemError')}</span>
                    <Switch size="sm" color="danger" aria-label="切换系统错误通知" />
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Data Management */}
          <Card className="p-4 sm:p-6 shadow-lg border-2 border-gray-100 hover:shadow-xl transition-all duration-300">
            <CardHeader className="flex items-center gap-3 pb-4">
              <div className="bg-orange-100 p-2 rounded-lg">
                <Wallet className="h-5 w-5 text-orange-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-900">{t('settings.dataManagement')}</h3>
            </CardHeader>
            <CardBody className="space-y-6">
              <Button
                onPress={handleExport}
                color="primary"
                variant="bordered"
                className="w-full"
              >
                {t('settings.exportData')}
              </Button>
              
              <Button
                onPress={handleClearCache}
                color="warning"
                variant="bordered"
                className="w-full"
              >
                {t('settings.clearCache')}
              </Button>

              <Button
                onPress={handleResetSettings}
                color="danger"
                variant="bordered"
                className="w-full"
              >
                {t('settings.resetSettings')}
              </Button>
            </CardBody>
          </Card>
        </div>

        {/* Save Button */}
        <div className="mt-8 flex justify-center">
          <Button
            onPress={handleSave}
            color="primary"
            size="lg"
            className="px-12 py-3 text-lg font-semibold"
          >
            {t('settings.save')}
          </Button>
        </div>
      </div>
    </div>
  );
}