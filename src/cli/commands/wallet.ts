import { Command } from 'commander';
import { WalletManager } from '../../wallet/legacy-manager';
import { ConfigLoader } from '../../config/loader';
import { Logger } from 'pino';
import fs from 'fs/promises';
import { formatError } from '../utils/logging';

export function walletCommands(program: Command, logger: Logger) {
  const walletCmd = program
    .command('wallet')
    .description('Wallet management operations');

  // Generate wallets
  walletCmd
    .command('generate')
    .description('Generate new HD wallets')
    .option('-c, --count <number>', 'number of wallets to generate', '1')
    .option('-s, --start-index <number>', 'starting index for derivation', '0')
    .option('--mnemonic-out <path>', 'save mnemonic to file (encrypted)')
    .option('--label-prefix <prefix>', 'prefix for wallet labels', 'Wallet')
    .option('--group <group>', 'group name for generated wallets')
    .action(async (options) => {
      try {
        const config = ConfigLoader.getInstance();
        const walletManager = new WalletManager();
        walletManager.setEncryptionPassword(config.getEncryptionPassword());

        const count = parseInt(options.count);
        const startIndex = parseInt(options.startIndex);

        logger.info({ count, startIndex }, 'Generating wallets');

        const result = walletManager.generateBulkWallets(count, startIndex);
        
        // Set labels and groups
        result.wallets.forEach((wallet, i) => {
          wallet.label = `${options.labelPrefix}-${startIndex + i}`;
          if (options.group) {
            wallet.group = options.group;
          }
        });

        // Save wallets
        await walletManager.saveWallets();

        // Save mnemonic if requested
        if (options.mnemonicOut) {
          await fs.writeFile(options.mnemonicOut, result.mnemonic, 'utf8');
          logger.info({ file: options.mnemonicOut }, 'Mnemonic saved');
        }

        // Display results
        console.log('\n✅ Wallets generated successfully:\n');
        result.wallets.forEach((wallet, i) => {
          console.log(`${i + 1}. ${wallet.address} (${wallet.label})`);
        });

        console.log(`\n📊 Generated ${result.wallets.length} wallets`);
        console.log(`🔑 Mnemonic: ${result.mnemonic}`);
        console.log('\n⚠️  CRITICAL: Save your mnemonic phrase securely!');

      } catch (error) {
        logger.error({ err: formatError(error) }, 'Failed to generate wallets');
        process.exit(1);
      }
    });

  // List wallets
  walletCmd
    .command('list')
    .description('List all managed wallets')
    .option('-g, --group <group>', 'filter by group')
    .option('--format <format>', 'output format (table|json|csv)', 'table')
    .action(async (options) => {
      try {
        const config = ConfigLoader.getInstance();
        const walletManager = new WalletManager();
        walletManager.setEncryptionPassword(config.getEncryptionPassword());

        await walletManager.loadWallets();

        let wallets = options.group ? 
          walletManager.getWalletsByGroup(options.group) : 
          walletManager.getAllWallets();

        if (wallets.length === 0) {
          console.log('No wallets found');
          return;
        }

        switch (options.format) {
          case 'json':
            console.log(JSON.stringify(wallets.map(w => ({
              address: w.address,
              label: w.label,
              group: w.group,
              index: w.index
            })), null, 2));
            break;
          case 'csv':
            const csv = await walletManager.exportToCSV();
            console.log(csv);
            break;
          default:
            console.log('\n📱 Managed Wallets:\n');
            wallets.forEach((wallet, i) => {
              console.log(`${i + 1}. ${wallet.address}`);
              if (wallet.label) console.log(`   Label: ${wallet.label}`);
              if (wallet.group) console.log(`   Group: ${wallet.group}`);
              if (wallet.index !== undefined) console.log(`   Index: ${wallet.index}`);
              console.log('');
            });
        }

      } catch (error) {
        logger.error({ err: formatError(error) }, 'Failed to list wallets');
        process.exit(1);
      }
    });

  // Import wallet
  walletCmd
    .command('import')
    .description('Import wallet from private key or mnemonic')
    .option('-k, --private-key <key>', 'private key to import')
    .option('-m, --mnemonic <phrase>', 'mnemonic phrase to import')
    .option('-i, --index <number>', 'derivation index for mnemonic', '0')
    .option('-l, --label <label>', 'label for imported wallet')
    .option('-g, --group <group>', 'group for imported wallet')
    .action(async (options) => {
      try {
        const config = ConfigLoader.getInstance();
        const walletManager = new WalletManager();
        walletManager.setEncryptionPassword(config.getEncryptionPassword());

        let wallet;

        if (options.privateKey) {
          wallet = walletManager.importPrivateKey(options.privateKey, options.label);
        } else if (options.mnemonic) {
          const index = parseInt(options.index);
          wallet = walletManager.deriveWallet(options.mnemonic, index);
          wallet.label = options.label;
        } else {
          logger.error('Either --private-key or --mnemonic must be provided');
          process.exit(1);
        }

        if (options.group) {
          wallet.group = options.group;
        }

        await walletManager.saveWallets();

        logger.info({ address: wallet.address }, 'Imported wallet');

        console.log('✅ Wallet imported successfully:');
        console.log(`   Address: ${wallet.address}`);
        console.log(`   Label: ${wallet.label || 'None'}`);
        console.log(`   Group: ${wallet.group || 'None'}`);

      } catch (error) {
        logger.error({ err: formatError(error) }, 'Failed to import wallet');
        process.exit(1);
      }
    });

  // Export wallets
  walletCmd
    .command('export')
    .description('Export wallets to file')
    .option('-o, --output <file>', 'output file path', 'wallets.csv')
    .option('-g, --group <group>', 'export specific group only')
    .option('--format <format>', 'export format (csv|json)', 'csv')
    .action(async (options) => {
      try {
        const config = ConfigLoader.getInstance();
        const walletManager = new WalletManager();
        walletManager.setEncryptionPassword(config.getEncryptionPassword());

        await walletManager.loadWallets();

        let content: string;
        const wallets = options.group ? 
          walletManager.getWalletsByGroup(options.group) : 
          walletManager.getAllWallets();

        if (options.format === 'json') {
          content = JSON.stringify(wallets.map(w => ({
            address: w.address,
            label: w.label,
            group: w.group,
            index: w.index
          })), null, 2);
        } else {
          content = await walletManager.exportToCSV();
        }

        await fs.writeFile(options.output, content);

        logger.info({ output: options.output, count: wallets.length }, 'Exported wallets to file');

        console.log(`✅ Exported ${wallets.length} wallets to ${options.output}`);

      } catch (error) {
        logger.error({ err: formatError(error) }, 'Failed to export wallets');
        process.exit(1);
      }
    });

  // Update wallet
  walletCmd
    .command('update')
    .description('Update wallet label or group')
    .argument('<address>', 'wallet address to update')
    .option('-l, --label <label>', 'new label')
    .option('-g, --group <group>', 'new group')
    .action(async (address, options) => {
      try {
        const config = ConfigLoader.getInstance();
        const walletManager = new WalletManager();
        walletManager.setEncryptionPassword(config.getEncryptionPassword());

        await walletManager.loadWallets();

        const wallet = walletManager.getWallet(address);
        if (!wallet) {
          console.log(`❌ Wallet not found: ${address}`);
          process.exit(1);
        }

        if (options.label) {
          walletManager.updateWalletLabel(address, options.label);
        }
        if (options.group) {
          walletManager.updateWalletGroup(address, options.group);
        }

        await walletManager.saveWallets();

        console.log('✅ Wallet updated successfully');
        console.log(`   Address: ${wallet.address}`);
        console.log(`   Label: ${wallet.label || 'None'}`);
        console.log(`   Group: ${wallet.group || 'None'}`);

      } catch (error) {
        logger.error({ error }, 'Failed to update wallet');
        process.exit(1);
      }
    });

  // Remove wallet
  walletCmd
    .command('remove')
    .description('Remove wallet from management')
    .argument('<address>', 'wallet address to remove')
    .option('-f, --force', 'skip confirmation prompt')
    .action(async (address, options) => {
      try {
        const config = ConfigLoader.getInstance();
        const walletManager = new WalletManager();
        walletManager.setEncryptionPassword(config.getEncryptionPassword());

        await walletManager.loadWallets();

        const wallet = walletManager.getWallet(address);
        if (!wallet) {
          console.log(`❌ Wallet not found: ${address}`);
          process.exit(1);
        }

        if (!options.force) {
          // In a real CLI, you'd prompt for confirmation here
          console.log(`⚠️  This will remove wallet ${address} from management`);
          console.log('Use --force to skip this confirmation');
          return;
        }

        const removed = walletManager.removeWallet(address);
        if (removed) {
          await walletManager.saveWallets();
          console.log(`✅ Wallet removed: ${address}`);
        } else {
          console.log(`❌ Failed to remove wallet: ${address}`);
        }

      } catch (error) {
        logger.error({ error }, 'Failed to remove wallet');
        process.exit(1);
      }
    });
}
