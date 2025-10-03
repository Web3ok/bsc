# 🧪 BSC Testnet DEX Testing Guide

**Date**: 2025-10-03
**Version**: v1.0.0
**Purpose**: Complete guide for testing DEX functionality on BSC Testnet

---

## 📋 Overview

This guide will walk you through testing the complete DEX functionality (Swap + Liquidity + Analytics) on BSC Testnet.

### ✅ Features to Test
- **Swap Interface**: Token swapping (BNB ↔ Tokens, Token ↔ Token)
- **Liquidity Interface**: Add/Remove liquidity
- **Analytics Interface**: Market data display

---

## 🌐 Network Configuration

### BSC Testnet Details
- **Network Name**: BSC Testnet
- **Chain ID**: 97
- **RPC URL**: https://data-seed-prebsc-1-s1.binance.org:8545/
- **Block Explorer**: https://testnet.bscscan.com
- **Symbol**: tBNB

### Supported Contracts

#### PancakeSwap V2 Testnet Contracts
- **Router**: `0xD99D1c33F9fC3444f8101754aBC46c52416550D1`
- **Factory**: `0x6725F303b657a9451d8BA641348b6761A6CC7a17`
- **WBNB**: `0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd`

#### Test Tokens
| Token | Address | Decimals |
|-------|---------|----------|
| BNB | NATIVE | 18 |
| WBNB | `0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd` | 18 |
| USDT | `0x337610d27c682E347C9cD60BD4b3b107C9d34dDd` | 18 |
| BUSD | `0xeD24FC36d5Ee211Ea25A80239Fb8C4Cfd80f12Ee` | 18 |
| USDC | `0x64544969ed7EBf5f083679233325356EbE738930` | 18 |

---

## 🚀 Getting Started

### Step 1: Get Testnet BNB

You need testnet BNB to pay for gas fees and testing.

#### Official BSC Testnet Faucets:
1. **Binance Testnet Faucet** (Recommended)
   - URL: https://testnet.bnbchain.org/faucet-smart
   - Amount: 0.5 tBNB per request
   - Cooldown: 24 hours

2. **Alternative Faucets**:
   - https://testnet.binance.org/faucet-smart
   - Twitter faucet: Tweet your address with #BNBChain

#### How to Get tBNB:
1. Visit https://testnet.bnbchain.org/faucet-smart
2. Connect your wallet (MetaMask recommended)
3. Click "Give me BNB" button
4. Wait ~30 seconds for transaction confirmation
5. Check your wallet balance

### Step 2: Get Test Tokens

You'll need test tokens (USDT, BUSD, USDC) for testing swaps and liquidity.

#### Option A: Swap tBNB for Test Tokens
1. Go to DEX page: http://localhost:10002/dex
2. Connect your wallet
3. Make sure you're on BSC Testnet (Chain ID: 97)
4. Use Swap to exchange tBNB → USDT/BUSD/USDC

#### Option B: Use PancakeSwap Testnet
1. Visit https://pancake.kiemtienonline360.com/ (unofficial testnet UI)
2. Swap tBNB for test tokens
3. Return to our DEX for testing

#### Token Contracts (for manual import to MetaMask):
```
USDT: 0x337610d27c682E347C9cD60BD4b3b107C9d34dDd
BUSD: 0xeD24FC36d5Ee211Ea25A80239Fb8C4Cfd80f12Ee
USDC: 0x64544969ed7EBf5f083679233325356EbE738930
```

---

## 🧪 Testing Checklist

### 1. Swap Interface Testing

#### Test Case 1: BNB → Token Swap
**Steps**:
1. Navigate to http://localhost:10002/dex
2. Connect wallet (MetaMask recommended)
3. Ensure network is "BSC Testnet"
4. Select "Swap" tab
5. From: BNB
6. To: USDT
7. Enter amount: 0.01 BNB
8. Review quote (should show estimated USDT output)
9. Click "Swap"
10. Confirm transaction in wallet
11. Wait for confirmation (~3 seconds)
12. Verify balance updated

**Expected Results**:
- ✅ Quote appears within 2 seconds
- ✅ Transaction succeeds
- ✅ Balance updates correctly
- ✅ Transaction visible on BSCScan

#### Test Case 2: Token → BNB Swap
**Steps**:
1. From: USDT
2. To: BNB
3. Enter amount: 1 USDT
4. Check if approval needed
5. If needed: Click "Approve USDT" → Confirm
6. Wait for approval confirmation
7. Click "Swap"
8. Confirm transaction
9. Verify balance updated

**Expected Results**:
- ✅ Approval transaction succeeds (if needed)
- ✅ Swap transaction succeeds
- ✅ BNB balance increases
- ✅ USDT balance decreases

#### Test Case 3: Token → Token Swap
**Steps**:
1. From: USDT
2. To: BUSD
3. Enter amount: 1 USDT
4. Verify quote (should be ~1 BUSD due to peg)
5. Approve if needed
6. Execute swap
7. Verify balances

**Expected Results**:
- ✅ Route through WBNB (USDT → WBNB → BUSD)
- ✅ Quote approximately 1:1
- ✅ Slippage protection works
- ✅ Transaction succeeds

#### Test Case 4: Slippage Testing
**Steps**:
1. Set slippage to 0.1%
2. Try swapping 0.01 BNB → USDT
3. If transaction fails, increase slippage to 0.5%
4. Retry

**Expected Results**:
- ✅ Low slippage may fail (expected)
- ✅ Higher slippage succeeds
- ✅ Actual slippage within tolerance

---

### 2. Liquidity Interface Testing

#### Test Case 5: Add Liquidity (BNB + USDT)
**Steps**:
1. Select "Liquidity" tab
2. Select "Add Liquidity"
3. Token A: BNB
4. Token B: USDT
5. Enter amount A: 0.01 BNB
6. Amount B should auto-calculate based on pool ratio
7. If pool doesn't exist, enter manually: ~3 USDT
8. Review transaction details
9. Approve USDT (if needed)
10. Click "Add Liquidity"
11. Confirm transaction
12. Verify LP tokens received

**Expected Results**:
- ✅ Amount B auto-calculates (if pool exists)
- ✅ Approval succeeds
- ✅ Add liquidity transaction succeeds
- ✅ LP tokens appear in wallet
- ✅ "Your LP Tokens" displays balance

#### Test Case 6: Add Liquidity (Token + Token)
**Steps**:
1. Token A: USDT
2. Token B: BUSD
3. Enter amounts: 1 USDT + 1 BUSD
4. Approve both tokens
5. Add liquidity
6. Verify LP tokens

**Expected Results**:
- ✅ Both approvals succeed
- ✅ Liquidity added successfully
- ✅ LP token balance increases

#### Test Case 7: Remove Liquidity
**Steps**:
1. Select "Remove Liquidity" tab
2. Check "Your LP Tokens" balance
3. Enter amount to remove (e.g., 50% of balance)
4. Click "Remove Liquidity"
5. Confirm transaction
6. Verify tokens returned

**Expected Results**:
- ✅ LP balance displays correctly
- ✅ Remove transaction succeeds
- ✅ Both tokens returned to wallet
- ✅ LP token balance decreases

---

### 3. Analytics Interface Testing

#### Test Case 8: Market Data Display
**Steps**:
1. Select "Analytics" tab
2. Review "Total Value Locked"
3. Review "24h Volume"
4. Review "Top Tokens by Volume"
5. Review "Top Trading Pairs"
6. Review "Recent Transactions"

**Expected Results**:
- ✅ Mock data displays correctly
- ✅ All statistics visible
- ✅ Tables render properly
- ✅ No console errors

---

### 4. Network Switching Testing

#### Test Case 9: Switch Between Mainnet and Testnet
**Steps**:
1. Start on BSC Testnet
2. Note current token balances
3. Switch to BSC Mainnet in wallet
4. Observe UI updates
5. Check token list updates to mainnet addresses
6. Switch back to BSC Testnet
7. Verify tokens reset to testnet addresses

**Expected Results**:
- ✅ UI detects network change
- ✅ Token addresses update automatically
- ✅ Balances refresh
- ✅ No errors during switch

---

### 5. Error Handling Testing

#### Test Case 10: Insufficient Balance
**Steps**:
1. Try to swap more BNB than you have
2. Observe error message

**Expected Results**:
- ✅ "Insufficient BNB Balance" button appears
- ✅ Button is disabled
- ✅ No transaction attempted

#### Test Case 11: Unsupported Network
**Steps**:
1. Switch wallet to Ethereum Mainnet
2. Observe UI warning

**Expected Results**:
- ✅ Warning message appears
- ✅ "Please switch to BNB Smart Chain" shown
- ✅ Functions disabled

---

## 📊 Test Results Template

Use this template to record your test results:

```markdown
## Test Session: [Date/Time]
**Tester**: [Your Name]
**Wallet**: [Address]
**Initial tBNB Balance**: [Amount]

### Swap Tests
- [ ] BNB → USDT: PASS / FAIL
  - TX Hash: [hash]
  - Notes: [any issues]
- [ ] USDT → BNB: PASS / FAIL
  - TX Hash: [hash]
- [ ] USDT → BUSD: PASS / FAIL
  - TX Hash: [hash]

### Liquidity Tests
- [ ] Add BNB+USDT: PASS / FAIL
  - TX Hash: [hash]
  - LP Received: [amount]
- [ ] Remove Liquidity: PASS / FAIL
  - TX Hash: [hash]

### UI/UX Tests
- [ ] Network switching: PASS / FAIL
- [ ] Error handling: PASS / FAIL
- [ ] Balance updates: PASS / FAIL

### Bugs Found
1. [Description]
2. [Description]
```

---

## 🐛 Common Issues & Solutions

### Issue 1: "Insufficient BNB for gas"
**Solution**: Get more tBNB from faucet

### Issue 2: "Transaction failed"
**Possible Causes**:
- Slippage too low → Increase to 1-2%
- Network congestion → Wait and retry
- Insufficient allowance → Re-approve token

### Issue 3: "Pair does not exist"
**Solution**:
- Create the pair by adding initial liquidity
- Or use a different token pair that already exists

### Issue 4: Quotes not loading
**Possible Causes**:
- RPC endpoint slow → Wait 10 seconds
- Pool doesn't exist → Try different token pair
- Browser cache → Hard refresh (Cmd+Shift+R)

### Issue 5: Wallet won't connect
**Solution**:
1. Make sure MetaMask is installed
2. Add BSC Testnet to MetaMask manually:
   - Network Name: BSC Testnet
   - RPC URL: https://data-seed-prebsc-1-s1.binance.org:8545/
   - Chain ID: 97
   - Currency Symbol: tBNB
   - Block Explorer: https://testnet.bscscan.com

---

## 📝 Transaction Verification

### How to Verify on BSCScan
1. Copy transaction hash from wallet
2. Visit https://testnet.bscscan.com
3. Paste hash in search bar
4. Verify:
   - Status: Success ✅
   - From: Your address
   - To: Router contract
   - Value: Correct amount
   - Token Transfers: Correct tokens swapped

---

## 🎯 Success Criteria

Your DEX testing is complete when:
- ✅ **All 3 swap types work** (BNB→Token, Token→BNB, Token→Token)
- ✅ **Add liquidity succeeds** for at least 1 pair
- ✅ **Remove liquidity works**
- ✅ **Approvals function correctly**
- ✅ **Network switching works**
- ✅ **Error messages display properly**
- ✅ **All transactions visible on BSCScan**

---

## 🔗 Useful Links

### BSC Testnet Resources
- **Faucet**: https://testnet.bnbchain.org/faucet-smart
- **Explorer**: https://testnet.bscscan.com
- **RPC Status**: https://testnet.bscscan.com/nodetracker
- **Gas Tracker**: https://testnet.bscscan.com/gastracker

### PancakeSwap Resources
- **Docs**: https://docs.pancakeswap.finance
- **Router Contract**: https://testnet.bscscan.com/address/0xD99D1c33F9fC3444f8101754aBC46c52416550D1
- **Factory Contract**: https://testnet.bscscan.com/address/0x6725F303b657a9451d8BA641348b6761A6CC7a17

### MetaMask Setup
- **Add Network**: https://docs.bnbchain.org/docs/wallet/metamask
- **Add Tokens**: Custom token import in MetaMask

---

## 📞 Support

If you encounter issues during testing:
1. Check console for error messages (F12 → Console)
2. Verify transaction on BSCScan
3. Check RPC endpoint status
4. Try different RPC endpoint if needed
5. Clear browser cache and retry

---

## 🎉 Next Steps After Testing

Once testnet testing is complete:
1. Document all bugs found
2. Fix any critical issues
3. Re-test after fixes
4. Prepare for mainnet deployment
5. Conduct final security review

---

**Guide Version**: v1.0.0
**Last Updated**: 2025-10-03
**Status**: ✅ **Ready for Testing**

Happy Testing! 🧪🚀
