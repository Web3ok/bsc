import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { HDKey } from '@scure/bip32';
import { ethers } from 'ethers';
import { CryptoUtils } from '../utils/crypto';
import { WalletInfo } from '../utils/types';
import fs from 'fs/promises';
import path from 'path';

export class WalletManager {
  private readonly basePath: string = "m/44'/60'/0'/0";
  private wallets: Map<string, WalletInfo> = new Map();
  private encryptionPassword?: string;

  constructor(private walletsDir: string = process.env.WALLET_STORAGE_PATH || './data/wallets') {
    this.ensureWalletsDir();
  }

  private async ensureWalletsDir() {
    try {
      await fs.mkdir(this.walletsDir, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }
  }

  setEncryptionPassword(password: string) {
    this.encryptionPassword = password;
  }

  generateMnemonic(): string {
    return generateMnemonic(wordlist);
  }

  validateMnemonic(mnemonic: string): boolean {
    return validateMnemonic(mnemonic, wordlist);
  }

  deriveWallet(mnemonic: string, index: number = 0): WalletInfo {
    if (!this.validateMnemonic(mnemonic)) {
      throw new Error('Invalid mnemonic phrase');
    }

    const seed = mnemonicToSeedSync(mnemonic);
    const hdkey = HDKey.fromMasterSeed(seed);
    const derivationPath = `${this.basePath}/${index}`;
    const derived = hdkey.derive(derivationPath);

    if (!derived.privateKey) {
      throw new Error('Failed to derive private key');
    }

    const privateKey = `0x${Buffer.from(derived.privateKey).toString('hex')}`;
    const wallet = new ethers.Wallet(privateKey);

    return {
      address: wallet.address,
      privateKey,
      mnemonic,
      derivationPath,
      index
    };
  }

  generateBulkWallets(count: number, startIndex: number = 0): {
    wallets: WalletInfo[];
    mnemonic: string;
  } {
    const mnemonic = this.generateMnemonic();
    const wallets: WalletInfo[] = [];

    for (let i = 0; i < count; i++) {
      const wallet = this.deriveWallet(mnemonic, startIndex + i);
      wallet.label = `Wallet-${startIndex + i}`;
      wallets.push(wallet);
      this.wallets.set(wallet.address.toLowerCase(), wallet);
    }

    return { wallets, mnemonic };
  }

  importPrivateKey(privateKey: string, label?: string): WalletInfo {
    // Ensure private key starts with 0x
    const formattedPrivateKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    
    try {
      // Derive address from private key using ethers
      const wallet = new ethers.Wallet(formattedPrivateKey);

      const walletInfo: WalletInfo = {
        address: wallet.address,
        privateKey: formattedPrivateKey,
        label
      };

      this.wallets.set(wallet.address.toLowerCase(), walletInfo);
      return walletInfo;
    } catch (error) {
      throw new Error(`Invalid private key: ${error}`);
    }
  }

  async saveWallets(filename: string = 'wallets.json'): Promise<void> {
    if (!this.encryptionPassword) {
      throw new Error('Encryption password not set');
    }

    const walletsArray = Array.from(this.wallets.values());
    const data = JSON.stringify(walletsArray, null, 2);
    const encrypted = CryptoUtils.encrypt(data, this.encryptionPassword);

    const filePath = path.join(this.walletsDir, filename);
    await fs.writeFile(filePath, encrypted);
  }

  async loadWallets(filename: string = 'wallets.json'): Promise<void> {
    if (!this.encryptionPassword) {
      throw new Error('Encryption password not set');
    }

    const filePath = path.join(this.walletsDir, filename);
    
    try {
      const encrypted = await fs.readFile(filePath, 'utf8');
      const decrypted = CryptoUtils.decrypt(encrypted, this.encryptionPassword);
      const walletsArray: WalletInfo[] = JSON.parse(decrypted);

      this.wallets.clear();
      walletsArray.forEach(wallet => {
        this.wallets.set(wallet.address.toLowerCase(), wallet);
      });
    } catch (error) {
      throw new Error(`Failed to load wallets: ${error}`);
    }
  }

  async exportToCSV(): Promise<string> {
    const headers = ['Address', 'Label', 'Group', 'Index'];
    const rows = Array.from(this.wallets.values()).map(wallet => [
      wallet.address,
      wallet.label || '',
      wallet.group || '',
      wallet.index?.toString() || ''
    ]);

    const csv = [headers, ...rows]
      .map(row => row.map(field => `"${field}"`).join(','))
      .join('\n');

    return csv;
  }

  getWallet(address: string): WalletInfo | undefined {
    return this.wallets.get(address.toLowerCase());
  }

  getAllWallets(): WalletInfo[] {
    return Array.from(this.wallets.values());
  }

  getWalletsByGroup(group: string): WalletInfo[] {
    return Array.from(this.wallets.values()).filter(w => w.group === group);
  }

  updateWalletLabel(address: string, label: string) {
    const wallet = this.wallets.get(address.toLowerCase());
    if (wallet) {
      wallet.label = label;
    }
  }

  updateWalletGroup(address: string, group: string) {
    const wallet = this.wallets.get(address.toLowerCase());
    if (wallet) {
      wallet.group = group;
    }
  }

  removeWallet(address: string): boolean {
    return this.wallets.delete(address.toLowerCase());
  }

  getWalletCount(): number {
    return this.wallets.size;
  }
}
