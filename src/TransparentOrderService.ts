/**
 * TransparentOrderService
 * Integration layer between our enhanced PublicOrder system and 1inch SDK
 * Handles cross-chain order management, price protection, and balance monitoring
 */

import { ethers, JsonRpcProvider, Wallet, Contract, keccak256, AbiCoder } from 'ethers';
import { LimitOrder, MakerTraits, Address, Sdk, FetchProviderConnector } from '@1inch/limit-order-sdk';
import axios from 'axios';

// ============= INTERFACES =============

interface PublicOrder {
  readonly user: string;
  readonly amount: bigint;
  readonly targetPrice: bigint;
  readonly gasPrice: bigint;
  readonly timestamp: bigint;
  readonly expiry: bigint;
  readonly queuePosition: bigint;
  readonly sourceChain: number;
  readonly targetChain: number;
  readonly makerAsset: string;
  readonly takerAsset: string;
  readonly priceProtection: PriceProtection;
  readonly wrappedToken: WrappedToken;
  readonly balanceCheck: BalanceCheck;
  readonly execution: ExecutionInfo;
}

interface PriceProtection {
  readonly enabled: boolean;
  readonly tolerance: bigint;
  readonly lastPriceCheck: bigint;
  readonly lastMarketPrice: bigint;
}

interface WrappedToken {
  readonly originalToken: string;  // DOGE, BTC address on source chain
  readonly wrappedToken: string;   // WDOGE, WBTC address on Ethereum
  readonly unwrapAfter: boolean;
  readonly bridgeFee: bigint;
}

interface BalanceCheck {
  readonly enabled: boolean;
  readonly lastCheck: bigint;
  readonly autoAdjust: boolean;
  readonly autoCancel: boolean;
  readonly minBalance: bigint;
}

interface ExecutionInfo {
  attempts: number;
  lastAttempt: bigint;
  failureReason: string;
  totalFilled: bigint;
  isCompleted: boolean;
}

interface CrossChainConfig {
  readonly sourceChainId: number;
  readonly targetChainId: number;
  readonly sourceRPC: string;
  readonly targetRPC: string;
  readonly wrappedTokens: Map<string, string>; // original -> wrapped mapping
}

interface OrderCreationParams {
  readonly makerAsset: string;
  readonly takerAsset: string;
  readonly makingAmount: bigint;
  readonly takingAmount: bigint;
  readonly gasPrice?: bigint;
  readonly enablePriceProtection?: boolean;
  readonly tolerance?: number;
  readonly enableBalanceCheck?: boolean;
  readonly autoAdjust?: boolean;
  readonly sourceChain?: number;
  readonly targetChain?: number;
  readonly expiryMinutes?: number;
}

interface OrderBookAnalytics {
  readonly totalOrders: number;
  readonly activeOrders: number;
  readonly totalVolume: bigint;
  readonly averageQueueTime: number;
}

// ============= MAIN SERVICE =============

export class TransparentOrderService {
  private readonly provider: JsonRpcProvider;
  private readonly signer: Wallet;
  private readonly contract: Contract;
  private readonly inchSdk: Sdk;
  private readonly crossChainConfigs: Map<number, CrossChainConfig>;
  private readonly priceOracles: Map<string, string>; // token -> oracle address
  private readonly abiCoder: AbiCoder;
  
  constructor(
    private readonly contractAddress: string,
    private readonly contractABI: readonly any[],
    private readonly privateKey: string,
    private readonly rpcUrl: string,
    private readonly inchApiKey: string
  ) {
    this.provider = new JsonRpcProvider(rpcUrl);
    this.signer = new Wallet(privateKey, this.provider);
    this.contract = new Contract(contractAddress, contractABI, this.signer);
    this.abiCoder = AbiCoder.defaultAbiCoder();
    
    // Initialize 1inch SDK
    this.inchSdk = new Sdk({
      authKey: inchApiKey,
      networkId: 1, // Ethereum mainnet
      httpConnector: new FetchProviderConnector()
    });

    this.crossChainConfigs = new Map();
    this.priceOracles = new Map();
    this.initializeCrossChainConfigs();
    this.initializePriceOracles();
  }

  // ============= INITIALIZATION =============

  private initializeCrossChainConfigs(): void {
    // Dogecoin configuration
    this.crossChainConfigs.set(2, {
      sourceChainId: 2,
      targetChainId: 1,
      sourceRPC: 'https://svc.blockdaemon.com/dogecoin/mainnet/native',
      targetRPC: this.rpcUrl,
      wrappedTokens: new Map([
        ['DOGE', '0x0000000000000000000000000000000000000000'], // Will be actual WDOGE address
      ])
    });

    // Bitcoin configuration
    this.crossChainConfigs.set(3, {
      sourceChainId: 3,
      targetChainId: 1,
      sourceRPC: 'https://bitcoin.api.blockdaemon.com',
      targetRPC: this.rpcUrl,
      wrappedTokens: new Map([
        ['BTC', '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'], // WBTC
      ])
    });
  }

  private initializePriceOracles(): void {
    // Chainlink price feed addresses (Ethereum mainnet)
    this.priceOracles.set('ETH/USD', '0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419');
    this.priceOracles.set('DOGE/USD', '0x2465CefD3b488BE410b941b1d4b2767088e2A028');
    this.priceOracles.set('BTC/USD', '0xf4030086522a5beea4988f8ca5b36dbc97bee88c');
  }

  // ============= ORDER CREATION =============

  /**
   * Create a transparent public order with enhanced features
   */
  async createPublicOrder(orderParams: OrderCreationParams): Promise<{ orderHash: string; publicOrder: PublicOrder }> {
    
    console.log('Creating transparent public order...');

    // Calculate target price with 18 decimal precision
    const targetPrice = (orderParams.takingAmount * BigInt(1e18)) / orderParams.makingAmount;
    const feeData = await this.provider.getFeeData();
    const gasPrice = orderParams.gasPrice || (feeData.gasPrice || 0n);
    const expiry = BigInt(Date.now() + (orderParams.expiryMinutes || 1440) * 60 * 1000); // 24h default
    const timestamp = BigInt(Date.now());

    // Handle cross-chain logic
    const sourceChain = orderParams.sourceChain || 1; // Ethereum default
    const targetChain = orderParams.targetChain || 1;
    let wrappedToken: WrappedToken = {
      originalToken: orderParams.makerAsset,
      wrappedToken: orderParams.makerAsset,
      unwrapAfter: false,
      bridgeFee: 0n
    };

    // If cross-chain, handle wrapped tokens
    if (sourceChain !== targetChain) {
      const config = this.crossChainConfigs.get(sourceChain);
      if (config) {
        wrappedToken = await this.handleWrappedToken(orderParams.makerAsset, sourceChain, targetChain);
      }
    }

    // Create PublicOrder structure
    const publicOrder: PublicOrder = {
      user: await this.signer.getAddress(),
      amount: orderParams.makingAmount,
      targetPrice,
      gasPrice,
      timestamp,
      expiry,
      queuePosition: 0n, // Will be calculated by contract
      sourceChain,
      targetChain,
      makerAsset: orderParams.makerAsset,
      takerAsset: orderParams.takerAsset,
      priceProtection: {
        enabled: orderParams.enablePriceProtection ?? true,
        tolerance: BigInt(orderParams.tolerance || 10),
        lastPriceCheck: timestamp,
        lastMarketPrice: await this.getCurrentPrice(orderParams.makerAsset, orderParams.takerAsset)
      },
      wrappedToken,
      balanceCheck: {
        enabled: orderParams.enableBalanceCheck ?? true,
        lastCheck: timestamp,
        autoAdjust: orderParams.autoAdjust ?? true,
        autoCancel: true,
        minBalance: orderParams.makingAmount
      },
      execution: {
        attempts: 0,
        lastAttempt: 0n,
        failureReason: '',
        totalFilled: 0n,
        isCompleted: false
      }
    };

    // Submit to our contract
    console.log('Submitting order to TransparentOrderProtocol...');
    const tx = await this.contract.createOrder(publicOrder);
    const receipt = await tx.wait();
    
    const orderHash = this.getOrderHash(publicOrder);
    console.log(`Order created with hash: ${orderHash}`);

    // Also create corresponding 1inch limit order for execution
    if (sourceChain === 1 && targetChain === 1) { // Ethereum only
      await this.createInch1LimitOrder(publicOrder);
    }

    return { orderHash, publicOrder };
  }

  /**
   * Create corresponding 1inch limit order for Ethereum execution
   */
  private async createInch1LimitOrder(publicOrder: PublicOrder): Promise<void> {
    try {
      console.log('Creating corresponding 1inch limit order...');

      const expirationSeconds = Number(publicOrder.expiry / 1000n);
      const makerTraits = MakerTraits.default()
        .withExpiration(BigInt(expirationSeconds))
        .withNonce(BigInt(Math.floor(Math.random() * 1000000)));

      const order = await this.inchSdk.createOrder({
        makerAsset: new Address(publicOrder.makerAsset),
        takerAsset: new Address(publicOrder.takerAsset),
        makingAmount: BigInt(publicOrder.amount),
        takingAmount: (publicOrder.amount * publicOrder.targetPrice) / BigInt(1e18),
        maker: new Address(publicOrder.user),
      }, makerTraits);

      // Get current network chain ID
      const network = await this.provider.getNetwork();
      const chainId = Number(network.chainId);
      
      const typedData = order.getTypedData(chainId);
      const signature = await this.signer.signTypedData(
        typedData.domain,
        { Order: typedData.types.Order },
        typedData.message
      );

      await this.inchSdk.submitOrder(order, signature);
      console.log('1inch limit order submitted successfully');

    } catch (error) {
      console.error('Failed to create 1inch limit order:', error);
    }
  }

  // ============= PRICE MONITORING =============

  /**
   * Monitor all active orders for price protection triggers
   */
  async monitorPriceProtection(): Promise<void> {
    console.log('Monitoring price protection...');

    try {
      const activeOrders = await this.contract.getActiveOrders();
      
      for (const orderHash of activeOrders) {
        const order = await this.contract.getOrder(orderHash);
        
        if (order.priceProtection.enabled) {
          const currentPrice = await this.getCurrentPrice(order.makerAsset, order.takerAsset);
          const withinTolerance = await this.contract.checkPriceProtection(order, currentPrice);
          
          if (!withinTolerance) {
            console.log(`Order ${orderHash} price outside tolerance`);
          } else {
            console.log(`Order ${orderHash} ready for execution at price ${currentPrice}`);
            
            // Trigger execution if conditions met
            await this.attemptOrderExecution(orderHash, currentPrice);
          }
        }
      }
    } catch (error) {
      console.error('Price monitoring error:', error);
    }
  }

  /**
   * Get current market price from oracle
   */
  private async getCurrentPrice(makerAsset: string, takerAsset: string): Promise<bigint> {
    try {
      // For now, use a mock price - in production, integrate with Chainlink oracles
      // This would query the actual price feed contracts
      
      // Mock prices (in production, query actual oracles)
      if (makerAsset.toLowerCase().includes('weth') && takerAsset.toLowerCase().includes('usdc')) {
        return BigInt(4000) * BigInt(1e18); // $4000 per ETH
      }
      
      return BigInt(1) * BigInt(1e18); // 1:1 default
    } catch (error) {
      console.error('Error getting current price:', error);
      return BigInt(1) * BigInt(1e18);
    }
  }

  // ============= BALANCE MONITORING =============

  /**
   * Check all orders for balance sufficiency
   */
  async monitorBalances(): Promise<void> {
    console.log('Monitoring order balances...');

    try {
      const activeOrders = await this.contract.getActiveOrders();
      
      for (const orderHash of activeOrders) {
        const order = await this.contract.getOrder(orderHash);
        
        if (order.balanceCheck.enabled) {
          const userBalance = await this.getUserBalance(order.user, order.makerAsset);
          
          if (userBalance < order.amount) {
            console.log(`Insufficient balance for order ${orderHash}`);
            
            if (order.balanceCheck.autoCancel) {
              await this.contract.cancelOrder(orderHash);
              console.log(`Auto-cancelled order ${orderHash} due to insufficient balance`);
            } else if (order.balanceCheck.autoAdjust) {
              // Contract will handle auto-adjustment
              console.log(`Order ${orderHash} will be auto-adjusted`);
            }
          }
        }
      }
    } catch (error) {
      console.error('Balance monitoring error:', error);
    }
  }

  private async getUserBalance(user: string, token: string): Promise<bigint> {
    const tokenContract = new Contract(token, [
      'function balanceOf(address owner) view returns (uint256)'
    ], this.provider);
    
    const balance = await tokenContract.balanceOf(user);
    return BigInt(balance.toString());
  }

  // ============= ORDER EXECUTION =============

  /**
   * Attempt to execute an order
   */
  private async attemptOrderExecution(orderHash: string, currentPrice: bigint): Promise<boolean> {
    try {
      console.log(`Attempting to execute order ${orderHash}...`);

      const tx = await this.contract.executeOrder(orderHash, currentPrice);
      await tx.wait();
      
      console.log(`Order ${orderHash} executed successfully!`);
      return true;
    } catch (error) {
      console.error(`Failed to execute order ${orderHash}:`, error);
      return false;
    }
  }

  // ============= CROSS-CHAIN SUPPORT =============

  /**
   * Handle wrapped token logic for cross-chain orders
   */
  private async handleWrappedToken(
    originalToken: string, 
    sourceChain: number, 
    targetChain: number
  ): Promise<WrappedToken> {
    const config = this.crossChainConfigs.get(sourceChain);
    if (!config) {
      throw new Error(`Unsupported source chain: ${sourceChain}`);
    }

    // For DOGE -> WDOGE example
    if (sourceChain === 2) { // Dogecoin
      return {
        originalToken,
        wrappedToken: config.wrappedTokens.get('DOGE') || originalToken,
        unwrapAfter: true,
        bridgeFee: BigInt('1000000') // 0.001 DOGE bridge fee
      };
    }

    return {
      originalToken,
      wrappedToken: originalToken,
      unwrapAfter: false,
      bridgeFee: 0n
    };
  }

  // ============= QUEUE MANAGEMENT =============

  /**
   * Get orders sorted by execution priority
   */
  async getOrdersByPriority(limit: number = 10): Promise<string[]> {
    return await this.contract.getOrdersByPriority(limit);
  }

  /**
   * Process order queue and execute ready orders
   */
  async processOrderQueue(): Promise<void> {
    console.log('Processing order queue...');

    const prioritizedOrders = await this.getOrdersByPriority(5); // Process top 5
    
    for (const orderHash of prioritizedOrders) {
      const order = await this.contract.getOrder(orderHash);
      const currentPrice = await this.getCurrentPrice(order.makerAsset, order.takerAsset);
      
      if (order.priceProtection.enabled) {
        const withinTolerance = await this.contract.checkPriceProtection(order, currentPrice);
        if (withinTolerance) {
          await this.attemptOrderExecution(orderHash, currentPrice);
        }
      } else {
        await this.attemptOrderExecution(orderHash, currentPrice);
      }
    }
  }

  // ============= UTILITY FUNCTIONS =============

  /**
   * Get order hash (matches contract implementation) 
   */
  private getOrderHash(order: PublicOrder): string {
    return keccak256(
      this.abiCoder.encode(
        ['address', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'address', 'address'],
        [
          order.user,
          order.amount,
          order.targetPrice,
          order.gasPrice,
          order.timestamp,
          order.expiry,
          order.sourceChain,
          order.targetChain,
          order.makerAsset,
          order.takerAsset
        ]
      )
    );
  }

  /**
   * Get all user orders
   */
  async getUserOrders(userAddress: string): Promise<string[]> {
    return await this.contract.getUserOrders(userAddress);
  }

  /**
   * Get order details
   */
  async getOrderDetails(orderHash: string): Promise<PublicOrder> {
    return await this.contract.getOrder(orderHash);
  }

  // ============= MONITORING DAEMON =============

  /**
   * Start monitoring daemon for price protection and balance checks
   */
  startMonitoring(intervalMinutes: number = 5): void {
    console.log(`Starting monitoring daemon (${intervalMinutes}min intervals)...`);

    setInterval(async () => {
      try {
        await this.monitorPriceProtection();
        await this.monitorBalances();
        await this.processOrderQueue();
      } catch (error) {
        console.error('Monitoring error:', error);
      }
    }, intervalMinutes * 60 * 1000);

    console.log('Monitoring daemon started successfully');
  }

  // ============= ANALYTICS =============

  /**
   * Get order book analytics
   */
  async getOrderBookAnalytics(): Promise<OrderBookAnalytics> {
    const totalOrders = Number(await this.contract.totalOrdersCreated());
    const totalFilled = Number(await this.contract.totalOrdersFilled());
    const activeOrderHashes = await this.contract.getActiveOrders();

    let totalVolume = 0n;
    for (const orderHash of activeOrderHashes) {
      const order = await this.contract.getOrder(orderHash);
      totalVolume += order.amount;
    }

    return {
      totalOrders,
      activeOrders: activeOrderHashes.length,
      totalVolume,
      averageQueueTime: 0 // Calculate based on execution times
    };
  }
}

// ============= USAGE EXAMPLE =============

/**
 * Example usage of the TransparentOrderService
 */
export async function example(): Promise<void> {
  const service = new TransparentOrderService(
    '0x...', // Contract address
    [], // Contract ABI
    '0x...', // Private key
    'https://eth-mainnet.alchemyapi.io/v2/...', // RPC URL
    'your-1inch-api-key' // 1inch API key
  );

  // Create a WETH -> USDC order with price protection
  const { orderHash, publicOrder } = await service.createPublicOrder({
    makerAsset: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    takerAsset: '0xA0b86a33E6417c5B9e8e5Cc0123458Ac3e62Ac6E', // USDC
    makingAmount: ethers.parseEther('1'), // 1 WETH
    takingAmount: BigInt('4000000000'), // 4000 USDC (6 decimals)
    enablePriceProtection: true,
    tolerance: 10, // 10% tolerance
    enableBalanceCheck: true,
    autoAdjust: true,
    expiryMinutes: 1440 // 24 hours
  });

  console.log('Order created:', orderHash);

  // Start monitoring
  service.startMonitoring(5); // Check every 5 minutes
}