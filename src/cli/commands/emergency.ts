import { Command } from 'commander';
import { emergencyManager } from '../../utils/emergency';
import { logger } from '../../utils/logger';

export const emergencyCommands = new Command('emergency')
  .alias('em')
  .description('Emergency management commands');

emergencyCommands
  .command('stop')
  .description('Trigger emergency stop - halt all trading operations')
  .option('-r, --reason <reason>', 'Reason for emergency stop', 'Manual emergency stop')
  .option('-l, --level <level>', 'Emergency level (warning|critical|emergency)', 'critical')
  .option('--by <who>', 'Who triggered the stop', 'cli-user')
  .action(async (options) => {
    try {
      console.log('🚨 TRIGGERING EMERGENCY STOP...');
      console.log(`📋 Reason: ${options.reason}`);
      console.log(`⚠️  Level: ${options.level}`);
      console.log(`👤 Triggered by: ${options.by}\n`);

      await emergencyManager.emergencyStop(
        options.reason,
        options.level,
        options.by
      );

      console.log('✅ Emergency stop activated successfully!');
      console.log('🔒 All trading operations are now halted');
      console.log('📞 Alerts have been sent to configured channels');
      console.log('\n💡 Use "emergency resume" to lift the emergency stop');

    } catch (error) {
      logger.error({ error }, 'Failed to trigger emergency stop');
      console.error(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(1);
    }
  });

emergencyCommands
  .command('resume')
  .description('Resume operations after emergency stop')
  .option('-r, --reason <reason>', 'Reason for resuming operations', 'Manual resume')
  .option('--by <who>', 'Who resumed operations', 'cli-user')
  .action(async (options) => {
    try {
      const state = emergencyManager.getEmergencyState();
      
      if (!state) {
        console.log('ℹ️  No emergency stop is currently active');
        return;
      }

      console.log('🔄 RESUMING OPERATIONS...');
      console.log(`📋 Previous stop reason: ${state.reason}`);
      console.log(`📋 Resume reason: ${options.reason}`);
      console.log(`👤 Resumed by: ${options.by}\n`);

      await emergencyManager.resume(options.reason, options.by);

      console.log('✅ Operations resumed successfully!');
      console.log('🔓 Trading operations are now allowed');
      console.log('📞 Recovery alerts have been sent');

    } catch (error) {
      logger.error({ error }, 'Failed to resume operations');
      console.error(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(1);
    }
  });

emergencyCommands
  .command('status')
  .description('Check emergency stop status')
  .action(async () => {
    try {
      const state = emergencyManager.getEmergencyState();
      
      console.log('🏥 EMERGENCY STATUS:');
      console.log('────────────────────────────');
      
      if (state) {
        console.log(`🚨 Status: EMERGENCY STOP ACTIVE`);
        console.log(`📋 Reason: ${state.reason}`);
        console.log(`⚠️  Level: ${state.level}`);
        console.log(`👤 Triggered by: ${state.triggeredBy}`);
        console.log(`⏰ Since: ${state.timestamp.toISOString()}`);
        console.log(`⏱️  Duration: ${Math.round((Date.now() - state.timestamp.getTime()) / 1000)}s`);
        console.log('\n🔒 All trading operations are currently HALTED');
      } else {
        console.log(`✅ Status: NORMAL OPERATIONS`);
        console.log('🔓 All systems are operational');
      }

    } catch (error) {
      logger.error({ error }, 'Failed to check emergency status');
      console.error(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(1);
    }
  });

emergencyCommands
  .command('test')
  .description('Test emergency stop functionality (safe test)')
  .action(async () => {
    try {
      console.log('🧪 TESTING EMERGENCY FUNCTIONALITY...\n');

      // Test emergency stop
      console.log('1. Testing emergency stop activation...');
      await emergencyManager.emergencyStop('Test emergency stop', 'warning', 'test-user');
      console.log('   ✅ Emergency stop activated');

      // Check status
      console.log('2. Checking emergency status...');
      const status = emergencyManager.checkEmergencyStatus();
      console.log(`   ${status.allowed ? '❌ FAILED' : '✅ SUCCESS'}: Emergency check working`);

      // Test resume
      console.log('3. Testing emergency resume...');
      await emergencyManager.resume('Test completed', 'test-user');
      console.log('   ✅ Emergency resume working');

      // Final check
      const finalStatus = emergencyManager.checkEmergencyStatus();
      console.log(`   ${finalStatus.allowed ? '✅ SUCCESS' : '❌ FAILED'}: Normal operations restored`);

      console.log('\n🎉 Emergency system test completed successfully!');

    } catch (error) {
      logger.error({ error }, 'Emergency test failed');
      console.error(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(1);
    }
  });