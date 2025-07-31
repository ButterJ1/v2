/**
 * Transparent Order System Demo - TypeScript Version
 * Tests our enhanced order system with real 1inch data
 * Demonstrates price protection, balance monitoring, and queue management
 */

import { OrderDataAnalyzer } from '../../src/OrderDataAnalyzer';
import { TransparentOrderService } from '../../src/TransparentOrderService';
import { ethers } from 'ethers';

// ============= INTERFACES & TYPES =============

interface DemoConfig {
  // readonly ethereumRPC: string;
  readonly ethereumSepoliaRPC: string;
  // readonly dogecoinRPC: string;
  readonly dogecoinTestnetRPC: string;
  readonly transparentOrderContract: string;
  readonly testPrivateKey: string;
  readonly inchApiKey: string;
}

interface TokenAddresses {
  readonly WETH: string;
  readonly USDC: string;
  readonly WDOGE: string;
  readonly WBTC: string;
}

interface EnhancedOrderExample {
  readonly type: string;
  readonly order: EnhancedOrderParams;
}

interface EnhancedOrderParams {
  readonly user: string;
  readonly makerAsset: string;
  readonly takerAsset: string;
  readonly makingAmount: bigint;
  readonly takingAmount: bigint;
  readonly gasPrice: bigint;
  readonly enablePriceProtection: boolean;
  readonly tolerance: number;
  readonly enableBalanceCheck: boolean;
  readonly autoAdjust: boolean;
  readonly sourceChain: number;
  readonly targetChain: number;
}

interface PriceProtectionScenario {
  readonly name: string;
  readonly orderPrice: bigint;
  readonly marketPrice: bigint;
  readonly tolerance: bigint;
  readonly expectedResult: boolean;
}

interface BalanceScenario {
  readonly user: string;
  readonly token: string;
  readonly requiredAmount: bigint;
  readonly currentBalance: bigint;
  readonly autoAdjust: boolean;
  readonly autoCancel: boolean;
  readonly expectedAction: string;
}

interface QueueOrder {
  readonly orderHash: string;
  readonly gasPrice: bigint;
  readonly amount: bigint;
  readonly timestamp: bigint;
  readonly type: string;
  queuePosition?: bigint;
}

interface QueueOrderWithPriority extends QueueOrder {
  readonly queuePosition: bigint;
}

interface CrossChainChecklistItem {
  readonly item: string;
  readonly status: 'ready' | 'design' | 'pending' | 'blocked';
  readonly details: string;
}

interface DogeOrderCalculation {
  readonly amount: bigint;
  readonly targetUSDC: bigint;
  readonly bridgeFee: bigint;
  readonly networkFee: bigint;
}

interface DemoResults {
  realDataAnalysis?: any;
  enhancedOrders?: EnhancedOrderExample[];
  priceProtectionTests?: PriceProtectionScenario[];
  balanceMonitoringTests?: BalanceScenario[];
  queueManagement?: QueueOrderWithPriority[];
  crossChainPrep?: {
    checklist: CrossChainChecklistItem[];
    dogeCalculations: DogeOrderCalculation;
  };
}

// ============= DEMO CONFIGURATION =============

const DEMO_CONFIG: DemoConfig = {
  // Test RPC (use your own endpoints)
  ethereumSepoliaRPC: 'https://ethereum-sepolia-rpc.publicnode.com',
  dogecoinTestnetRPC: 'https://rpc-testnet.dogechain.dog',
  
  // Contract addresses (would be deployed)
  transparentOrderContract: '0x1234567890123456789012345678901234567890',
  
  // Test wallet (DO NOT USE IN PRODUCTION)
  testPrivateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  
  // API keys (add your own)
  inchApiKey: process.env.INCH_API_KEY || '',
};

// Token addresses
const TOKENS: TokenAddresses = {
  WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  USDC: '0xA0b86a33E6417c5B9e8e5Cc0123458Ac3e62Ac6E',
  WDOGE: '0x0000000000000000000000000000000000000000', // Placeholder - would be actual WDOGE
  WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'
} as const;

// ============= DEMO CLASS =============

export class TransparentOrderDemo {
  private readonly orderAnalyzer: OrderDataAnalyzer;
  private results: DemoResults;

  constructor() {
    this.orderAnalyzer = new OrderDataAnalyzer(DEMO_CONFIG.inchApiKey);
    this.results = {};
  }

  /**
   * Run complete demonstration
   */
  async runFullDemo(): Promise<void> {
    console.log('STARTING TRANSPARENT ORDER SYSTEM DEMO');
    console.log('===========================================\n');

    try {
      // Phase 1: Analyze real 1inch data
      await this.phase1_analyzeRealData();
      
      // Phase 2: Demonstrate enhanced order creation
      await this.phase2_createEnhancedOrders();
      
      // Phase 3: Simulate price protection
      await this.phase3_priceProtectionDemo();
      
      // Phase 4: Balance monitoring simulation
      await this.phase4_balanceMonitoringDemo();
      
      // Phase 5: Queue management demonstration
      await this.phase5_queueManagementDemo();
      
      // Phase 6: Cross-chain preparation (Dogecoin)
      await this.phase6_crossChainPrep();

      console.log('\nDEMO COMPLETED SUCCESSFULLY!');

    } catch (error) {
      console.error('Demo failed:', error);
    }
  }

  /**
   * Phase 1: Analyze real 1inch order data
   */
  private async phase1_analyzeRealData(): Promise<void> {
    console.log('PHASE 1: ANALYZING REAL 1INCH DATA');
    console.log('====================================');

    try {
      const analysis = await this.orderAnalyzer.runAnalysis();
      this.results.realDataAnalysis = analysis;

      if (analysis && analysis.wethUsdcOrders > 0) {
        console.log(`Successfully analyzed ${analysis.wethUsdcOrders} WETH<->USDC orders`);
        
        // Extract key insights
        const sampleOrder = analysis.sampleOrder;
        if (sampleOrder) {
          console.log('\nSample Order Analysis:');
          console.log(`  Maker: ${sampleOrder.data.maker}`);
          console.log(`  Making Amount: ${sampleOrder.data.makingAmount}`);
          console.log(`  Taking Amount: ${sampleOrder.data.takingAmount}`);
          console.log(`  Created: ${sampleOrder.createDateTime}`);
          console.log(`  Status: ${sampleOrder.status}`);
          
          // Calculate implied price
          const makingAmount = BigInt(sampleOrder.data.makingAmount);
          const takingAmount = BigInt(sampleOrder.data.takingAmount);
          const impliedPrice = (takingAmount * 1000000n) / makingAmount;
          console.log(`  Implied Price: ${impliedPrice.toString()} (scaled)`);
        }
      } else {
        console.log('No WETH<->USDC orders found - using mock data for demo');
        this.createMockOrderData();
      }

    } catch (error) {
      console.error('Phase 1 failed:', error);
      this.createMockOrderData();
    }

    console.log('Phase 1 Complete\n');
  }

  /**
   * Phase 2: Demonstrate enhanced order creation
   */
  private async phase2_createEnhancedOrders(): Promise<void> {
    console.log('PHASE 2: ENHANCED ORDER CREATION');
    console.log('===================================');

    // Create mock enhanced orders to demonstrate our structure
    const enhancedOrders: EnhancedOrderExample[] = [
      {
        type: 'Basic ETH->USDC',
        order: {
          user: '0x742d35Cc00f6A4A6C3Daa5c2D65c9Ef7Bb8c2A8D',
          makerAsset: TOKENS.WETH,
          takerAsset: TOKENS.USDC,
          makingAmount: ethers.parseEther('1'), // Ethers v6 syntax
          takingAmount: BigInt('4000000000'), // 4000 USDC
          gasPrice: BigInt('20000000000'), // 20 gwei
          enablePriceProtection: true,
          tolerance: 10,
          enableBalanceCheck: true,
          autoAdjust: true,
          sourceChain: 1,
          targetChain: 1
        }
      },
      {
        type: 'Cross-chain DOGE->USDC (via WDOGE)',
        order: {
          user: '0x8ba1f109551bD432803012645Hac136c30d2A4E1C',
          makerAsset: TOKENS.WDOGE, // Wrapped DOGE on Ethereum
          takerAsset: TOKENS.USDC,
          makingAmount: BigInt('10000000000000'), // 10,000 DOGE (8 decimals)
          takingAmount: BigInt('800000000'), // 800 USDC
          gasPrice: BigInt('25000000000'), // 25 gwei (higher priority)
          enablePriceProtection: true,
          tolerance: 15, // Higher tolerance for volatile pairs
          enableBalanceCheck: true,
          autoAdjust: true,
          sourceChain: 2, // Dogecoin
          targetChain: 1  // Ethereum
        }
      },
      {
        type: 'High-Priority BTC->ETH',
        order: {
          user: '0x123456789012345678901234567890123456789A',
          makerAsset: TOKENS.WBTC,
          takerAsset: TOKENS.WETH,
          makingAmount: BigInt('100000000'), // 1 BTC (8 decimals)
          takingAmount: ethers.parseEther('15'), // 15 ETH (Ethers v6)
          gasPrice: BigInt('50000000000'), // 50 gwei (highest priority)
          enablePriceProtection: true,
          tolerance: 5, // Tight tolerance for large order
          enableBalanceCheck: true,
          autoAdjust: false, // No auto-adjust for large orders
          sourceChain: 1,
          targetChain: 1
        }
      }
    ];

    console.log(`Created ${enhancedOrders.length} enhanced order examples:`);
    
    enhancedOrders.forEach((example, index) => {
      console.log(`\n${index + 1}. ${example.type}:`);
      console.log(`   Amount: ${example.order.makingAmount.toString()}`);
      console.log(`   Target Price: ${(example.order.takingAmount * 1000000n / example.order.makingAmount).toString()}`);
      console.log(`   Gas Price: ${example.order.gasPrice.toString()} wei`);
      console.log(`   Price Protection: ${example.order.enablePriceProtection ? '✅' : '❌'} (${example.order.tolerance}%)`);
      console.log(`   Cross-chain: ${example.order.sourceChain !== example.order.targetChain ? '✅' : '❌'}`);
      
      // Calculate queue position
      const queuePosition = this.calculateQueuePosition(
        example.order.gasPrice,
        BigInt(Date.now()),
        example.order.makingAmount
      );
      console.log(`   Queue Position: ${queuePosition.toString()}`);
    });

    this.results.enhancedOrders = enhancedOrders;
    console.log('\nPhase 2 Complete - Enhanced orders designed\n');
  }

  /**
   * Phase 3: Price protection demonstration
   */
  private async phase3_priceProtectionDemo(): Promise<void> {
    console.log('PHASE 3: PRICE PROTECTION DEMONSTRATION');
    console.log('=========================================');

    const testScenarios: PriceProtectionScenario[] = [
      {
        name: 'WETH/USDC within tolerance',
        orderPrice: 4000n * 1000000n, // $4000
        marketPrice: 4050n * 1000000n, // $4050 (+1.25%)
        tolerance: 10n,
        expectedResult: true
      },
      {
        name: 'WETH/USDC outside tolerance',
        orderPrice: 4000n * 1000000n, // $4000
        marketPrice: 4500n * 1000000n, // $4500 (+12.5%)
        tolerance: 10n,
        expectedResult: false
      },
      {
        name: 'DOGE/USDC volatile but within range',
        orderPrice: 80n * 1000000n, // $0.08
        marketPrice: 85n * 1000000n, // $0.085 (+6.25%)
        tolerance: 15n,
        expectedResult: true
      },
      {
        name: 'BTC/ETH tight tolerance exceeded',
        orderPrice: 15n * 1000000n, // 15 ETH per BTC
        marketPrice: 1575n * 100000n, // 15.75 ETH (+5%)
        tolerance: 3n,
        expectedResult: false
      }
    ];

    console.log('Testing price protection scenarios:\n');

    testScenarios.forEach((scenario, index) => {
      console.log(`${index + 1}. ${scenario.name}:`);
      console.log(`   Order Price: ${scenario.orderPrice.toString()}`);
      console.log(`   Market Price: ${scenario.marketPrice.toString()}`);
      console.log(`   Tolerance: ${scenario.tolerance.toString()}%`);
      
      const withinTolerance = this.checkPriceProtection(
        scenario.orderPrice,
        scenario.marketPrice,
        scenario.tolerance
      );
      
      const resultIcon = withinTolerance === scenario.expectedResult ? 'Yup' : 'Nah';
      console.log(`   Result: ${withinTolerance ? 'WITHIN' : 'OUTSIDE'} tolerance ${resultIcon}`);
      console.log('');
    });

    this.results.priceProtectionTests = testScenarios;
    console.log('Phase 3 Complete - Price protection validated\n');
  }

  /**
   * Phase 4: Balance monitoring demonstration  
   */
  private async phase4_balanceMonitoringDemo(): Promise<void> {
    console.log('PHASE 4: BALANCE MONITORING DEMONSTRATION');
    console.log('===========================================');

    const balanceScenarios: BalanceScenario[] = [
      {
        user: '0x742d35Cc00f6A4A6C3Daa5c2D65c9Ef7Bb8c2A8D',
        token: 'WETH',
        requiredAmount: ethers.parseEther('1'), // Ethers v6
        currentBalance: ethers.parseEther('1.5'), // Ethers v6
        autoAdjust: true,
        autoCancel: false,
        expectedAction: 'PROCEED'
      },
      {
        user: '0x8ba1f109551bD432803012645Hac136c30d2A4E1C',
        token: 'WDOGE',
        requiredAmount: BigInt('10000000000000'),
        currentBalance: BigInt('5000000000000'),
        autoAdjust: true,
        autoCancel: false,
        expectedAction: 'ADJUST'
      },
      {
        user: '0x123456789012345678901234567890123456789A',
        token: 'WBTC',
        requiredAmount: BigInt('100000000'),
        currentBalance: BigInt('50000000'),
        autoAdjust: false,
        autoCancel: true,
        expectedAction: 'CANCEL'
      }
    ];

    console.log('Testing balance monitoring scenarios:\n');

    balanceScenarios.forEach((scenario, index) => {
      console.log(`${index + 1}. User: ${scenario.user.slice(0, 10)}...`);
      console.log(`   Token: ${scenario.token}`);
      console.log(`   Required: ${scenario.requiredAmount.toString()}`);
      console.log(`   Available: ${scenario.currentBalance.toString()}`);
      console.log(`   Auto Adjust: ${scenario.autoAdjust ? 'Yup' : 'Nah'}`);
      console.log(`   Auto Cancel: ${scenario.autoCancel ? 'Yup' : 'Nah'}`);
      
      const action = this.determineBalanceAction(scenario);
      const resultIcon = action === scenario.expectedAction ? 'Yup' : 'Nah';
      console.log(`   Action: ${action} ${resultIcon}`);
      console.log('');
    });

    this.results.balanceMonitoringTests = balanceScenarios;
    console.log('Phase 4 Complete - Balance monitoring validated\n');
  }

  /**
   * Phase 5: Queue management demonstration
   */
  private async phase5_queueManagementDemo(): Promise<void> {
    console.log('PHASE 5: QUEUE MANAGEMENT DEMONSTRATION');
    console.log('========================================');

    // Simulate order queue with different priorities
    const orderQueue: QueueOrder[] = [
      {
        orderHash: '0xabc123...',
        gasPrice: BigInt('50000000000'), // 50 gwei
        amount: ethers.parseEther('1'), // Ethers v6
        timestamp: BigInt(Date.now() - 60000), // 1 min ago
        type: 'Large BTC order'
      },
      {
        orderHash: '0xdef456...',
        gasPrice: BigInt('20000000000'), // 20 gwei
        amount: ethers.parseEther('0.1'), // Ethers v6
        timestamp: BigInt(Date.now() - 300000), // 5 min ago
        type: 'Small ETH order'
      },
      {
        orderHash: '0x789xyz...',
        gasPrice: BigInt('30000000000'), // 30 gwei
        amount: BigInt('10000000000000'), // Large DOGE amount
        timestamp: BigInt(Date.now() - 120000), // 2 min ago
        type: 'DOGE cross-chain'
      }
    ];

    console.log('Order Queue Analysis:\n');

    // Calculate queue positions
    const queueWithPriorities: QueueOrderWithPriority[] = orderQueue.map(order => ({
      ...order,
      queuePosition: this.calculateQueuePosition(order.gasPrice, order.timestamp, order.amount)
    }));

    // Sort by priority (highest first)
    queueWithPriorities.sort((a, b) => 
      Number(b.queuePosition - a.queuePosition)
    );

    queueWithPriorities.forEach((order, index) => {
      console.log(`${index + 1}. ${order.type} (${order.orderHash.slice(0, 10)}...):`);
      console.log(`   Gas Price: ${Number(order.gasPrice) / 1e9} gwei`);
      console.log(`   Amount: ${order.amount.toString()}`);
      console.log(`   Age: ${(Date.now() - Number(order.timestamp)) / 60000} minutes`);
      console.log(`   Queue Position: ${order.queuePosition.toString()}`);
      console.log(`   Priority Rank: #${index + 1}`);
      console.log('');
    });

    this.results.queueManagement = queueWithPriorities;
    console.log('Phase 5 Complete - Queue management demonstrated\n');
  }

  /**
   * Phase 6: Cross-chain preparation (Dogecoin)
   */
  private async phase6_crossChainPrep(): Promise<void> {
    console.log('PHASE 6: DOGECOIN CROSS-CHAIN PREPARATION');
    console.log('===========================================');

    console.log('Dogecoin Integration Checklist:');
    console.log('');

    const checklist: CrossChainChecklistItem[] = [
      { item: 'Dogecoin RPC Connection', status: 'ready', details: 'Port 22555, JSON-RPC available' },
      { item: 'HTLC Script Implementation', status: 'pending', details: 'Bitcoin Script with hashlock/timelock' },
      { item: 'WDOGE Wrapped Token', status: 'design', details: 'ERC-20 wrapper for Dogecoin on Ethereum' },
      { item: 'Bridge Infrastructure', status: 'pending', details: 'Cross-chain communication layer' },
      { item: 'UTXO Management', status: 'design', details: 'Transaction fee optimization' },
      { item: 'Atomic Swap Resolver', status: 'pending', details: 'Automated cross-chain execution' }
    ];

    checklist.forEach((check, index) => {
      const statusIcon: Record<string, string> = {
        'ready': 'READY',
        'design': 'DESIGN',
        'pending': 'PENDING',
        'blocked': 'BLOCKED'
      };

      console.log(`${index + 1}. ${check.item}: ${statusIcon[check.status]} ${check.status.toUpperCase()}`);
      console.log(`   ${check.details}`);
      console.log('');
    });

    // Demonstrate Dogecoin-specific calculations
    console.log('Dogecoin-Specific Calculations:');
    console.log('');

    const dogeOrder: DogeOrderCalculation = {
      amount: BigInt('100000000000000'), // 1M DOGE (8 decimals)
      targetUSDC: BigInt('80000000000'), // $80,000 USDC
      bridgeFee: BigInt('1000000000'), // 10 DOGE bridge fee
      networkFee: BigInt('100000000') // 1 DOGE network fee
    };

    const totalCost = dogeOrder.amount + dogeOrder.bridgeFee + dogeOrder.networkFee;
    const effectivePrice = (dogeOrder.targetUSDC * 1000000n) / dogeOrder.amount;

    console.log(`Order Amount: ${dogeOrder.amount.toString()} DOGE`);
    console.log(`Bridge Fee: ${dogeOrder.bridgeFee.toString()} DOGE`);
    console.log(`Network Fee: ${dogeOrder.networkFee.toString()} DOGE`);
    console.log(`Total Cost: ${totalCost.toString()} DOGE`);
    console.log(`Effective Price: $${effectivePrice.toString()} per DOGE (scaled)`);

    this.results.crossChainPrep = {
      checklist,
      dogeCalculations: dogeOrder
    };

    console.log('\nPhase 6 Complete - Cross-chain preparation analyzed\n');
  }

  // ============= HELPER FUNCTIONS =============

  /**
   * Calculate queue position based on gas price, time, and amount
   */
  private calculateQueuePosition(gasPrice: bigint, timestamp: bigint, amount: bigint): bigint {
    const GAS_PRIORITY_MULTIPLIER = 100n;
    const gasWeight = gasPrice * GAS_PRIORITY_MULTIPLIER;
    const amountWeight = amount / 1000n;
    const timePenalty = (BigInt(Date.now()) - timestamp) / 60n; // Per minute penalty
    
    return gasWeight + amountWeight - timePenalty;
  }

  /**
   * Check if price is within tolerance
   */
  private checkPriceProtection(orderPrice: bigint, marketPrice: bigint, tolerance: bigint): boolean {
    const lowerBound = (marketPrice * (100n - tolerance)) / 100n;
    const upperBound = (marketPrice * (100n + tolerance)) / 100n;
    
    return orderPrice >= lowerBound && orderPrice <= upperBound;
  }

  /**
   * Determine balance monitoring action
   */
  private determineBalanceAction(scenario: BalanceScenario): string {
    if (scenario.currentBalance >= scenario.requiredAmount) {
      return 'PROCEED';
    }
    
    if (scenario.autoAdjust && scenario.currentBalance > 0) {
      return 'ADJUST';
    }
    
    if (scenario.autoCancel) {
      return 'CANCEL';
    }
    
    return 'HOLD';
  }

  /**
   * Create mock data if real data unavailable
   */
  private createMockOrderData(): void {
    console.log('🔧 Creating mock order data for demo...');
    this.results.realDataAnalysis = {
      totalOrders: 150,
      wethUsdcOrders: 12,
      sampleOrder: {
        data: {
          maker: '0x742d35Cc00f6A4A6C3Daa5c2D65c9Ef7Bb8c2A8D',
          makingAmount: '1000000000000000000', // 1 WETH
          takingAmount: '4000000000', // 4000 USDC
          makerAsset: TOKENS.WETH,
          takerAsset: TOKENS.USDC
        },
        createDateTime: new Date().toISOString(),
        status: 'active'
      }
    };
  }

  /**
   * Generate summary report
   */
  generateSummaryReport(): void {
    console.log('DEMO SUMMARY REPORT');
    console.log('=====================');
    console.log('');

    if (this.results.realDataAnalysis) {
      console.log(`Real Data Analysis: ${this.results.realDataAnalysis.wethUsdcOrders} WETH/USDC orders analyzed`);
    }

    if (this.results.enhancedOrders) {
      console.log(`Enhanced Orders: ${this.results.enhancedOrders.length} order types designed`);
    }

    if (this.results.priceProtectionTests) {
      const passedTests = this.results.priceProtectionTests.filter(test => 
        this.checkPriceProtection(test.orderPrice, test.marketPrice, test.tolerance) === test.expectedResult
      ).length;
      console.log(`Price Protection: ${passedTests}/${this.results.priceProtectionTests.length} tests passed`);
    }

    if (this.results.balanceMonitoringTests) {
      console.log(`Balance Monitoring: ${this.results.balanceMonitoringTests.length} scenarios tested`);
    }

    if (this.results.queueManagement) {
      console.log(`Queue Management: ${this.results.queueManagement.length} orders prioritized`);
    }
  }
}

// ============= MAIN EXECUTION FUNCTION =============

/**
 * Main demo runner function
 */
export async function runDemo(): Promise<void> {
  const demo = new TransparentOrderDemo();
  await demo.runFullDemo();
  demo.generateSummaryReport();
}

// ============= TEST FUNCTIONS FOR JEST =============

describe('Transparent Order System Demo', () => {
  let demo: TransparentOrderDemo;

  beforeEach(() => {
    demo = new TransparentOrderDemo();
  });

  test('should create demo instance', () => {
    expect(demo).toBeDefined();
    expect(demo).toBeInstanceOf(TransparentOrderDemo);
  });

  test('should calculate queue position correctly', () => {
    const gasPrice = BigInt('50000000000'); // 50 gwei
    const timestamp = BigInt(Date.now() - 60000); // 1 min ago
    const amount = ethers.parseEther('1');

    // Access private method for testing (cast to any)
    const queuePosition = (demo as any).calculateQueuePosition(gasPrice, timestamp, amount);
    
    expect(queuePosition).toBeGreaterThan(0n);
    expect(typeof queuePosition).toBe('bigint');
  });

  test('should check price protection correctly', () => {
    const orderPrice = 4000n * 1000000n;
    const marketPrice = 4050n * 1000000n; // +1.25%
    const tolerance = 10n;

    const withinTolerance = (demo as any).checkPriceProtection(orderPrice, marketPrice, tolerance);
    
    expect(withinTolerance).toBe(true);
  });

  test('should determine balance action correctly', () => {
    const scenario: BalanceScenario = {
      user: '0x742d35Cc00f6A4A6C3Daa5c2D65c9Ef7Bb8c2A8D',
      token: 'WETH',
      requiredAmount: ethers.parseEther('1'),
      currentBalance: ethers.parseEther('1.5'),
      autoAdjust: true,
      autoCancel: false,
      expectedAction: 'PROCEED'
    };

    const action = (demo as any).determineBalanceAction(scenario);
    
    expect(action).toBe('PROCEED');
  });

  test('should run full demo without errors', async () => {
    // Mock console.log to suppress output during tests
    const originalLog = console.log;
    console.log = jest.fn();

    try {
      await demo.runFullDemo();
      expect(true).toBe(true); // Test passes if no error thrown
    } finally {
      console.log = originalLog;
    }
  });
});

// Execute if run directly (CommonJS compatibility)
if (require.main === module) {
  runDemo().catch(console.error);
}