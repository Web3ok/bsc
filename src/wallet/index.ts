import { generateMnemonic, validateMnemonic, mnemonicToSeed } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { HDKey } from '@scure/bip32';
import { ethers } from 'ethers';
import * as fs from 'fs/promises';
import * as path from 'path';
import { CryptoUtils } from '../utils/crypto';
import pino from 'pino';
import { ConfigLoader } from '../config/loader';
const HD_WALLET_PATH = "m/44'/60'/0'/0";
const logger = pino({ name: 'WalletManager' });
const logWallet = (address: string) => logger.child({ wallet: address });

export interface WalletInfo {
  address: string;
  privateKey: string;
  derivationIndex?: number;
  label?: string;
  alias?: string;
  group?: string;
  tier?: 'hot' | 'warm' | 'cold' | 'vault';
  encrypted?: boolean;
  balance?: string;
  lastUsed?: Date;
  createdAt: Date;
}

export interface WalletStorage {
  mnemonic?: string;
  wallets: WalletInfo[];
  metadata: {
    version: string;
    createdAt: Date;
    updatedAt: Date;
  };
}

export class WalletManager {
  private static instance: WalletManager;
  private walletStorage: WalletStorage;
  private encryptionPassword: string;
  private storagePath: string;

  constructor(encryptionPassword?: string) {
    const config = ConfigLoader.getInstance();
    this.encryptionPassword = encryptionPassword || config.getEncryptionPassword();
    this.storagePath = './data/wallets';
    this.walletStorage = {
      wallets: [],
      metadata: {
        version: '1.0.0',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    };
  }

  static getInstance(encryptionPassword?: string): WalletManager {
    if (!WalletManager.instance) {
      WalletManager.instance = new WalletManager(encryptionPassword);
    }
    return WalletManager.instance;
  }

  async generateMnemonic(): Promise<string> {
    const mnemonic = generateMnemonic(wordlist);
    logger.info('Generated new mnemonic phrase');
    return mnemonic;
  }

  async generateWallets(count: number, mnemonic?: string, startIndex = 0, group?: string): Promise<WalletInfo[]> {
    const phrase = mnemonic || await this.generateMnemonic();
    
    if (!validateMnemonic(phrase, wordlist)) {
      throw new Error('Invalid mnemonic phrase');
    }

    const seed = await mnemonicToSeed(phrase);
    const hdkey = HDKey.fromMasterSeed(seed);
    const wallets: WalletInfo[] = [];

    for (let i = 0; i < count; i++) {
      const index = startIndex + i;
      const derivedKey = hdkey.derive(`${HD_WALLET_PATH}/${index}`);
      
      if (!derivedKey.privateKey) {
        throw new Error(`Failed to derive private key for index ${index}`);
      }

      const privateKey = `0x${Buffer.from(derivedKey.privateKey).toString('hex')}`;
      const wallet = new ethers.Wallet(privateKey);

      const walletInfo: WalletInfo = {
        address: wallet.address,
        privateKey,
        derivationIndex: index,
        group,
        createdAt: new Date(),
      };

      wallets.push(walletInfo);
      logWallet(wallet.address).info(`Generated wallet ${i + 1}/${count}`);
    }

    this.walletStorage.mnemonic = phrase;
    this.walletStorage.wallets.push(...wallets);
    this.walletStorage.metadata.updatedAt = new Date();

    logger.info(`Generated ${count} wallets from index ${startIndex}`);
    return wallets;
  }

  async importWallet(privateKey: string, label?: string, group?: string): Promise<WalletInfo> {
    const formattedPrivateKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    const wallet = new ethers.Wallet(formattedPrivateKey);

    const existingWallet = this.walletStorage.wallets.find(w => w.address === wallet.address);
    if (existingWallet) {
      throw new Error(`Wallet ${wallet.address} already exists`);
    }

    const walletInfo: WalletInfo = {
      address: wallet.address,
      privateKey: formattedPrivateKey,
      label,
      group,
      createdAt: new Date(),
    };

    this.walletStorage.wallets.push(walletInfo);
    this.walletStorage.metadata.updatedAt = new Date();

    logWallet(wallet.address).info('Imported wallet');
    return walletInfo;
  }

  async saveToFile(filename?: string): Promise<string> {
    await fs.mkdir(this.storagePath, { recursive: true });
    
    const fileName = filename || `wallets_${new Date().toISOString().split('T')[0]}.json`;
    const filePath = path.join(this.storagePath, fileName);
    
    const data = JSON.stringify(this.walletStorage, null, 2);
    const encryptedData = CryptoUtils.encrypt(data, this.encryptionPassword);
    
    await fs.writeFile(filePath, encryptedData, 'utf8');
    
    logger.info(`Wallet storage saved to ${filePath}`);
    return filePath;
  }

  async loadFromFile(filePath: string): Promise<void> {
    try {
      const encryptedData = await fs.readFile(filePath, 'utf8');
      const data = CryptoUtils.decrypt(encryptedData, this.encryptionPassword);
      const parsed = JSON.parse(data);
      // Normalize date fields after JSON.parse
      const wallets: WalletInfo[] = (parsed.wallets || []).map((w: any) => ({
        ...w,
        createdAt: new Date(w.createdAt),
      }));
      this.walletStorage = {
        mnemonic: parsed.mnemonic,
        wallets,
        metadata: {
          version: parsed.metadata?.version ?? '1.0.0',
          createdAt: parsed.metadata?.createdAt ? new Date(parsed.metadata.createdAt) : new Date(),
          updatedAt: parsed.metadata?.updatedAt ? new Date(parsed.metadata.updatedAt) : new Date(),
        },
      };
      
      logger.info(`Loaded ${this.walletStorage.wallets.length} wallets from ${filePath}`);
    } catch (error) {
      throw new Error(`Failed to load wallet storage: ${error}`);
    }
  }

  async exportToCSV(options?: { 
    includePrivateKeys?: boolean; 
    requireConfirmation?: boolean;
    secureEnvironment?: boolean;
  }): Promise<string> {
    await fs.mkdir(this.storagePath, { recursive: true });
    
    const fileName = `wallets_export_${new Date().toISOString().split('T')[0]}.csv`;
    const filePath = path.join(this.storagePath, fileName);
    
    const includePrivateKeys = options?.includePrivateKeys || false;
    const requireConfirmation = options?.requireConfirmation !== false; // default true
    const secureEnvironment = options?.secureEnvironment || false;

    if (includePrivateKeys) {
      logger.error('🚨 SECURITY VIOLATION ATTEMPT: Private key export is disabled');
      throw new Error('SECURITY ERROR: Private key export is permanently disabled. This operation is not allowed.');
    }

    const header = 'Address,Derivation Index,Label,Group,Created At\n';
    const rows = this.walletStorage.wallets.map(wallet => 
      `${wallet.address},${wallet.derivationIndex || ''},${wallet.label || ''},${wallet.group || ''},${wallet.createdAt.toISOString()}`
    ).join('\n');
    
    logger.info(`Exported ${this.walletStorage.wallets.length} wallets (addresses only) to CSV: ${filePath}`);
    
    const csvContent = header + rows;
    await fs.writeFile(filePath, csvContent, 'utf8');
    
    return filePath;
  }

  getWallets(group?: string): WalletInfo[] {
    if (group) {
      return this.walletStorage.wallets.filter(w => w.group === group);
    }
    return this.walletStorage.wallets;
  }

  getWallet(address: string): WalletInfo | undefined {
    return this.walletStorage.wallets.find(w => w.address.toLowerCase() === address.toLowerCase());
  }

  getMnemonic(): string | undefined {
    return this.walletStorage.mnemonic;
  }

  getWalletCount(): number {
    return this.walletStorage.wallets.length;
  }

  getGroups(): string[] {
    const groups = new Set(this.walletStorage.wallets.map(w => w.group).filter(Boolean));
    return Array.from(groups) as string[];
  }

  // Additional methods needed by BatchWalletManager
  async addWallet(walletInfo: WalletInfo): Promise<void> {
    // Check if wallet already exists
    const existingWallet = this.walletStorage.wallets.find(
      w => w.address.toLowerCase() === walletInfo.address.toLowerCase()
    );

    if (existingWallet) {
      throw new Error(`Wallet with address ${walletInfo.address} already exists`);
    }

    // Add the wallet to storage
    this.walletStorage.wallets.push(walletInfo);
    this.walletStorage.metadata.updatedAt = new Date();

    logger.info({ address: walletInfo.address }, 'Added wallet to storage');
  }

  async updateWallet(address: string, updates: Partial<WalletInfo>): Promise<void> {
    const walletIndex = this.walletStorage.wallets.findIndex(
      w => w.address.toLowerCase() === address.toLowerCase()
    );

    if (walletIndex === -1) {
      throw new Error(`Wallet with address ${address} not found`);
    }

    // Update the wallet
    this.walletStorage.wallets[walletIndex] = {
      ...this.walletStorage.wallets[walletIndex],
      ...updates,
      address, // Ensure address doesn't change
    };

    this.walletStorage.metadata.updatedAt = new Date();
    logger.info({ address, updates }, 'Updated wallet information');
  }

  async removeWallet(address: string): Promise<boolean> {
    const initialLength = this.walletStorage.wallets.length;
    this.walletStorage.wallets = this.walletStorage.wallets.filter(
      w => w.address.toLowerCase() !== address.toLowerCase()
    );

    const removed = this.walletStorage.wallets.length < initialLength;
    if (removed) {
      this.walletStorage.metadata.updatedAt = new Date();
      logger.info({ address }, 'Removed wallet from storage');
    }

    return removed;
  }

  async getWalletsByTier(tier: 'hot' | 'warm' | 'cold' | 'vault'): Promise<WalletInfo[]> {
    return this.walletStorage.wallets.filter(w => w.tier === tier);
  }

  async importFromPrivateKeys(privateKeys: string[], config?: {
    group?: string;
    tier?: 'hot' | 'warm' | 'cold' | 'vault';
    labels?: string[];
  }): Promise<{
    success: boolean;
    imported: number;
    errors: Array<{ index: number; error: string }>;
  }> {
    const results: WalletInfo[] = [];
    const errors: Array<{ index: number; error: string }> = [];

    for (let i = 0; i < privateKeys.length; i++) {
      try {
        const privateKey = privateKeys[i];
        
        // Validate private key format
        if (!privateKey.startsWith('0x')) {
          throw new Error('Private key must start with 0x');
        }

        const wallet = new ethers.Wallet(privateKey);
        
        const walletInfo: WalletInfo = {
          address: wallet.address,
          privateKey: privateKey,
          derivationIndex: -1, // Imported wallet, no derivation
          label: config?.labels?.[i] || `Imported-${i + 1}`,
          group: config?.group,
          tier: config?.tier || 'hot',
          encrypted: false,
          balance: '0',
          lastUsed: new Date(),
          createdAt: new Date(),
        };

        await this.addWallet(walletInfo);
        results.push(walletInfo);

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push({ index: i, error: errorMessage });
      }
    }

    return {
      success: errors.length === 0,
      imported: results.length,
      errors,
    };
  }

  // Wallet tagging system
  private walletTags: Map<string, Set<string>> = new Map();

  async addWalletTag(address: string, tag: string): Promise<void> {
    const addressLower = address.toLowerCase();
    if (!this.walletTags.has(addressLower)) {
      this.walletTags.set(addressLower, new Set());
    }
    this.walletTags.get(addressLower)!.add(tag);
    logger.debug({ address, tag }, 'Added tag to wallet');
  }

  async removeWalletTag(address: string, tag: string): Promise<void> {
    const addressLower = address.toLowerCase();
    const tags = this.walletTags.get(addressLower);
    if (tags) {
      tags.delete(tag);
      if (tags.size === 0) {
        this.walletTags.delete(addressLower);
      }
    }
  }

  getWalletTags(address: string): string[] {
    const addressLower = address.toLowerCase();
    const tags = this.walletTags.get(addressLower);
    return tags ? Array.from(tags) : [];
  }

  getWalletsByTag(tag: string): WalletInfo[] {
    const addresses = [];
    for (const [address, tags] of this.walletTags.entries()) {
      if (tags.has(tag)) {
        addresses.push(address);
      }
    }

    return addresses.map(addr => this.getWallet(addr))
                   .filter(Boolean) as WalletInfo[];
  }

  getAllWallets(): WalletInfo[] {
    return this.walletStorage.wallets;
  }

  async getTokenBalance(address: string, tokenAddress: string): Promise<string> {
    try {
      // Import here to avoid circular dependencies
      const { rpcManager } = await import('../blockchain/rpc');
      const { ethers } = await import('ethers');
      
      const provider = rpcManager.getProvider();
      const ERC20_ABI = ['function balanceOf(address owner) view returns (uint256)', 'function decimals() view returns (uint8)'];
      
      const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
      const [balance, decimals] = await Promise.all([
        contract.balanceOf(address),
        contract.decimals()
      ]);
      
      return ethers.formatUnits(balance, decimals);
    } catch (error) {
      logger.debug({ error, address, tokenAddress }, 'Failed to get token balance, returning 0');
      return '0';
    }
  }

  async getPrivateKey(address: string): Promise<string | null> {
    const wallet = this.getWallet(address);
    if (!wallet) {
      return null;
    }
    
    try {
      // If the private key is already in the wallet, return it
      if (wallet.privateKey) {
        return wallet.privateKey;
      }
      
      // If encrypted, decrypt it (simplified implementation)
      // In production, this would need proper decryption
      return null;
    } catch (error) {
      logger.error({ error, address }, 'Failed to get private key');
      return null;
    }
  }
}
