/**
 * 1inch Order Data Analyzer - TypeScript Version
 * Fetches and analyzes real WETH<->USDC limit orders from 1inch API
 * Phase 1A: Understanding current order structure for transparent order system
 */

import axios, { AxiosResponse, AxiosHeaders } from 'axios';

// 1inch API Configuration
const INCH_API_BASE = 'https://api.1inch.dev';
const ETHEREUM_CHAIN_ID = 1;

// Token Addresses (Ethereum Mainnet)
interface TokenAddresses {
  readonly WETH: string;
  readonly USDC: string;
  readonly USDC_CIRCLE: string;
}

const TOKENS: TokenAddresses = {
  WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  USDC: '0xA0b86a33E6417c5B9e8e5Cc0123458Ac3e62Ac6E', // 1inch USDC
  USDC_CIRCLE: '0xa0b86a33e6417c5b9e8e5cc0123458ac3e62ac6e' // Circle USDC
} as const;

// 1inch API Response Types
interface InchOrderData {
  readonly salt: string;
  readonly maker: string;
  readonly receiver: string;
  readonly makerAsset: string;
  readonly takerAsset: string;
  readonly makingAmount: string;
  readonly takingAmount: string;
  readonly makerTraits: string;
}

interface InchOrder {
  readonly orderHash: string;
  readonly signature: string;
  readonly data: InchOrderData;
  readonly createDateTime: string;
  readonly remains: string;
  readonly status: number;
}

// Enhanced PublicOrder Types
interface PriceProtection {
  readonly enabled: boolean;
  readonly tolerance: bigint; // percentage tolerance
}

interface WrappedToken {
  readonly original: string; // DOGE, BTC, etc.
  readonly wrapped: string;  // WDOGE, WBTC, etc.
  readonly unwrapAfter: boolean; // auto unwrap after execution
}

interface BalanceCheck {
  readonly enabled: boolean;
  readonly lastCheck: bigint;
  readonly autoAdjust: boolean; // adjust amount if insufficient
  readonly autoCancel: boolean; // cancel if insufficient + no gas
}

interface ExecutionTracking {
  attempts: number;
  lastAttempt: bigint;
  failureReason: string;
  readonly partialFills: bigint[]; // array of fill amounts
}

interface PublicOrder {
  readonly user: string;
  readonly amount: bigint;  
  readonly targetPrice: bigint;
  readonly timestamp: bigint;
  readonly expiry: bigint;
  readonly gasPrice: bigint;
  readonly queuePosition: bigint;
  readonly priceProtection: PriceProtection;
  readonly sourceChain: number;
  readonly targetChain: number;
  readonly wrappedToken: WrappedToken;
  readonly balanceCheck: BalanceCheck;
  readonly execution: ExecutionTracking;
  readonly originalOrder?: InchOrder;
}

interface OrderStructureAnalysis {
  readonly currentStructure: {
    readonly hash: string;
    readonly signature: string;
    readonly data: InchOrderData;
  };
  readonly dataStructure: InchOrderData | null;
  readonly timestamp: number;
  readonly remaining: string;
  readonly status: number;
}

interface PublicOrderStructureDesign {
  readonly [key: string]: string | object;
}

interface AnalysisResults {
  readonly totalOrders: number;
  readonly wethUsdcOrders: number;
  readonly structureAnalysis: OrderStructureAnalysis | null;
  readonly publicOrderDesign: PublicOrderStructureDesign;
  readonly sampleOrder?: InchOrder;
}

class OrderDataAnalyzer {
  private readonly apiKey: string | null;
  private readonly headers: AxiosHeaders;

  constructor(apiKey: string | null = null) {
    this.apiKey = apiKey;
    this.headers = new AxiosHeaders(apiKey ? {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    } : {
      'Content-Type': 'application/json'
    });
  }

  /**
   * Fetch all active orders from 1inch
   */
  async fetchAllOrders(): Promise<InchOrder[]> {
    try {
      const url = `${INCH_API_BASE}/orderbook/v4.0/${ETHEREUM_CHAIN_ID}/all`;
      console.log('Fetching all active orders from 1inch...');
      console.log('URL:', url);
      
      const response: AxiosResponse<InchOrder[]> = await axios.get(url, { 
        headers: this.headers,
        params: {
            page: 1,
            limit: 100
        },
        timeout: 30000
    });
      console.log(`Successfully fetched ${response.data.length} orders`);
      return response.data;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const responseData = axios.isAxiosError(error) ? error.response?.data : null;
            const status = axios.isAxiosError(error) ? error.response?.status : null;
      
      console.error('Error fetching orders:');
      console.error('Status:', status);
      console.error('Response:', responseData || errorMessage);
      return [];
    }
  }

  /**
   * Filter orders for WETH<->USDC pairs
   */
  filterWETHUSDCOrders(orders: InchOrder[]): InchOrder[] {
    const wethUsdcOrders = orders.filter(order => {
      const makerAsset = order.data?.makerAsset?.toLowerCase();
      const takerAsset = order.data?.takerAsset?.toLowerCase();
      
      return (
        (makerAsset === TOKENS.WETH.toLowerCase() && 
         (takerAsset === TOKENS.USDC.toLowerCase() || takerAsset === TOKENS.USDC_CIRCLE.toLowerCase())) ||
        ((makerAsset === TOKENS.USDC.toLowerCase() || makerAsset === TOKENS.USDC_CIRCLE.toLowerCase()) && 
         takerAsset === TOKENS.WETH.toLowerCase())
      );
    });

    console.log(`Found ${wethUsdcOrders.length} WETH<->USDC orders`);
    return wethUsdcOrders;
  }

  /**
   * Analyze order structure for our PublicOrder design
   */
  analyzeOrderStructure(orders: InchOrder[]): OrderStructureAnalysis | null {
    if (orders.length === 0) {
      console.log('No orders to analyze');
      return null;
    }

    const sampleOrder = orders[0];
    console.log('\nANALYZING ORDER STRUCTURE:');
    console.log('=====================================');
    
    // Current 1inch Order Structure Analysis
    const analysis: OrderStructureAnalysis = {
      currentStructure: {
        hash: sampleOrder.orderHash,
        signature: sampleOrder.signature,
        data: sampleOrder.data
      },
      dataStructure: sampleOrder.data ? {
        salt: sampleOrder.data.salt,
        maker: sampleOrder.data.maker,
        receiver: sampleOrder.data.receiver,
        makerAsset: sampleOrder.data.makerAsset,
        takerAsset: sampleOrder.data.takerAsset,
        makingAmount: sampleOrder.data.makingAmount,
        takingAmount: sampleOrder.data.takingAmount,
        makerTraits: sampleOrder.data.makerTraits
      } : null,
      timestamp: new Date(sampleOrder.createDateTime).getTime(),
      remaining: sampleOrder.remains,
      status: sampleOrder.status
    };

    console.log('Current Order Fields:', Object.keys(analysis.dataStructure || {}));
    console.log('Making Amount:', analysis.dataStructure?.makingAmount);
    console.log('Taking Amount:', analysis.dataStructure?.takingAmount);
    console.log('Maker Traits:', analysis.dataStructure?.makerTraits);
    
    return analysis;
  }

  /**
   * Design our enhanced PublicOrder structure
   */
  designPublicOrderStructure(currentAnalysis: OrderStructureAnalysis | null): PublicOrderStructureDesign {
    console.log('\nDESIGNING ENHANCED PUBLIC ORDER STRUCTURE:');
    console.log('==============================================');

    const publicOrderStructure: PublicOrderStructureDesign = {
      // Core order data (from current 1inch)
      user: 'string',                    // = maker
      amount: 'bigint',                  // = makingAmount  
      targetPrice: 'bigint',             // calculated from makingAmount/takingAmount
      timestamp: 'bigint',               // order creation time
      expiry: 'bigint',                  // extracted from makerTraits
      
      // NEW: Enhanced fields for transparent system
      gasPrice: 'bigint',                // max gas price for execution priority
      queuePosition: 'bigint',           // calculated execution priority
      priceProtection: {
        enabled: 'boolean',              // 90%-110% protection
        tolerance: 'bigint'              // percentage tolerance
      },
      
      // Cross-chain specific
      sourceChain: 'number',             // origin blockchain
      targetChain: 'number',             // destination blockchain  
      wrappedToken: {
        original: 'string',              // DOGE, BTC, etc.
        wrapped: 'string',               // WDOGE, WBTC, etc.
        unwrapAfter: 'boolean'           // auto unwrap after execution
      },
      
      // Balance monitoring
      balanceCheck: {
        enabled: 'boolean',
        lastCheck: 'bigint',
        autoAdjust: 'boolean',           // adjust amount if insufficient
        autoCancel: 'boolean'            // cancel if insufficient + no gas
      },

      // Execution tracking
      execution: {
        attempts: 'number',
        lastAttempt: 'bigint',
        failureReason: 'string',
        partialFills: 'bigint[]'         // array of fill amounts
      }
    };

    console.log('Enhanced PublicOrder fields:');
    Object.entries(publicOrderStructure).forEach(([key, type]) => {
      console.log(`  ${key}: ${typeof type === 'object' ? JSON.stringify(type, null, 4) : type}`);
    });

    return publicOrderStructure;
  }

  /**
   * Calculate execution priority based on gas price and queue position
   */
  calculateExecutionPriority(order: { gasPrice: bigint; timestamp: number; amount: bigint }): bigint {
    // Priority = gasPrice weight + time weight + amount weight
    const gasWeight = BigInt(order.gasPrice || 0) * 100n;
    const timeWeight = BigInt(Date.now()) - BigInt(order.timestamp);
    const amountWeight = BigInt(order.amount || 0) / 1000n;
    
    return gasWeight + amountWeight - (timeWeight / 1000n);
  }

  /**
   * Check if order is within 90%-110% price protection range
   */
  async checkPriceProtection(order: { takingAmount?: string; makingAmount?: string; amount?: bigint; targetPrice?: bigint }, currentMarketPrice: bigint): Promise<boolean> {
    let orderPrice: bigint;
    
    if (order.takingAmount && order.makingAmount) {
      orderPrice = BigInt(order.takingAmount) / BigInt(order.makingAmount);
    } else if (order.targetPrice) {
      orderPrice = order.targetPrice;
    } else {
      console.error('Cannot calculate order price - missing required fields');
      return false;
    }
    
    const lowerBound = (currentMarketPrice * 90n) / 100n;
    const upperBound = (currentMarketPrice * 110n) / 100n;
    
    const withinRange = orderPrice >= lowerBound && orderPrice <= upperBound;
    
    console.log(`Price Protection Check:`);
    console.log(`  Order Price: ${orderPrice}`);
    console.log(`  Market Price: ${currentMarketPrice}`);
    console.log(`  Range: ${lowerBound} - ${upperBound}`);
    console.log(`  Within Range: ${withinRange ? 'Yup' : 'Nah'}`);
    
    return withinRange;
  }

  /**
   * Convert 1inch order to our PublicOrder format
   */
  convertToPublicOrder(inchOrder: InchOrder, gasPrice: bigint = 20000000000n): PublicOrder {
    const makingAmount = BigInt(inchOrder.data.makingAmount);
    const takingAmount = BigInt(inchOrder.data.takingAmount);
    const targetPrice = takingAmount * 1000000n / makingAmount; // Price with precision
    const timestamp = BigInt(new Date(inchOrder.createDateTime).getTime());

    const publicOrder: PublicOrder = {
      user: inchOrder.data.maker,
      amount: makingAmount,
      targetPrice: targetPrice,
      gasPrice: gasPrice,
      timestamp: timestamp,
      expiry: BigInt(Date.now() + 24 * 60 * 60 * 1000), // 24h default
      queuePosition: this.calculateExecutionPriority({
        gasPrice,
        timestamp: new Date(inchOrder.createDateTime).getTime(),
        amount: makingAmount
      }),
      
      // Enhanced fields
      priceProtection: {
        enabled: true,
        tolerance: 10n // 10% tolerance
      },
      
      sourceChain: 1, // Ethereum
      targetChain: 1, // Same chain for now
      
      wrappedToken: {
        original: inchOrder.data.makerAsset,
        wrapped: inchOrder.data.makerAsset,
        unwrapAfter: false
      },
      
      balanceCheck: {
        enabled: true,
        lastCheck: BigInt(Date.now()),
        autoAdjust: true,
        autoCancel: true
      },
      
      execution: {
        attempts: 0,
        lastAttempt: 0n,
        failureReason: '',
        partialFills: []
      },
      
      // Original 1inch data for reference
      originalOrder: inchOrder
    };

    return publicOrder;
  }

  /**
   * Main analysis function
   */
  async runAnalysis(): Promise<AnalysisResults | null> {
    console.log('Starting 1inch Order Data Analysis...\n');
    
    try {
      // Step 1: Fetch all orders
      const allOrders = await this.fetchAllOrders();
      if (allOrders.length === 0) return null;

      // Step 2: Filter WETH<->USDC orders
      const wethUsdcOrders = this.filterWETHUSDCOrders(allOrders);
      
      // Step 3: Analyze structure
      const structureAnalysis = this.analyzeOrderStructure(wethUsdcOrders);
      
      // Step 4: Design enhanced structure
      const publicOrderDesign = this.designPublicOrderStructure(structureAnalysis);
      
      // Step 5: Convert sample orders
      if (wethUsdcOrders.length > 0) {
        console.log('\nCONVERTING TO PUBLIC ORDER FORMAT:');
        console.log('=====================================');
        
        const samplePublicOrder = this.convertToPublicOrder(wethUsdcOrders[0]);
        console.log('Sample PublicOrder:');
        console.log(JSON.stringify({
          user: samplePublicOrder.user,
          amount: samplePublicOrder.amount.toString(),
          targetPrice: samplePublicOrder.targetPrice.toString(),
          gasPrice: samplePublicOrder.gasPrice.toString(),
          queuePosition: samplePublicOrder.queuePosition.toString(),
          priceProtection: samplePublicOrder.priceProtection,
          sourceChain: samplePublicOrder.sourceChain,
          targetChain: samplePublicOrder.targetChain
        }, null, 2));

        // Step 6: Test price protection
        const mockMarketPrice = 4000n * 1000000n; // $4000 USDC per WETH
        await this.checkPriceProtection(samplePublicOrder, mockMarketPrice);
      }

      console.log('\nANALYSIS COMPLETE!');
      
      return {
        totalOrders: allOrders.length,
        wethUsdcOrders: wethUsdcOrders.length,
        structureAnalysis,
        publicOrderDesign,
        sampleOrder: wethUsdcOrders[0]
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error('Analysis failed:', errorMessage);
      return null;
    }
  }
}

// Usage example
async function main(): Promise<void> {
  // Initialize analyzer (add your 1inch API key if available)
  const analyzer = new OrderDataAnalyzer(process.env.INCH_API_KEY);
  
  // Run complete analysis
  const results = await analyzer.runAnalysis();
  
  if (results) {
    console.log(`\nAnalysis Results Summary:`);
    console.log(`Total Orders: ${results.totalOrders}`);
    console.log(`WETH<->USDC Orders: ${results.wethUsdcOrders}`);
  }
}

// Execute if run directly (CommonJS style)
if (require.main === module) {
  main().catch(console.error);
}

export { OrderDataAnalyzer, TOKENS };
export type { 
  InchOrder, 
  InchOrderData, 
  PublicOrder, 
  PriceProtection, 
  WrappedToken, 
  BalanceCheck, 
  ExecutionTracking,
  AnalysisResults,
  TokenAddresses 
};