// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @title TransparentOrderProtocol
 * @notice Enhanced limit order protocol with transparent order system,
 *         price protection, balance monitoring, and cross-chain support
 * @dev Extends 1inch limit order concepts with UTXO chain integration
 */
contract TransparentOrderProtocol is EIP712, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============= STRUCTS =============

    struct PublicOrder {
        address user;                    // Order creator
        uint256 amount;                  // Order amount
        uint256 targetPrice;             // Target execution price (scaled by 1e18)
        uint256 gasPrice;                // Max gas price for execution priority
        uint256 timestamp;               // Order creation timestamp
        uint256 expiry;                  // Order expiration timestamp
        uint256 queuePosition;           // Calculated execution priority
        uint256 sourceChain;             // Origin blockchain ID
        uint256 targetChain;             // Destination blockchain ID
        address makerAsset;              // Asset being sold
        address takerAsset;              // Asset being bought
        PriceProtection priceProtection; // Price protection settings
        WrappedToken wrappedToken;       // Cross-chain token info
        BalanceCheck balanceCheck;       // Balance monitoring settings
        ExecutionInfo execution;         // Execution tracking
    }

    struct PriceProtection {
        bool enabled;                    // Enable 90%-110% protection
        uint256 tolerance;               // Tolerance percentage (1-50)
        uint256 lastPriceCheck;          // Last market price check
        uint256 lastMarketPrice;         // Last known market price
    }

    struct WrappedToken {
        address originalToken;           // Original token (DOGE, BTC, etc.)
        address wrappedToken;            // Wrapped version (WDOGE, WBTC, etc.)
        bool unwrapAfter;                // Auto unwrap after execution
        uint256 bridgeFee;               // Cross-chain bridge fee
    }

    struct BalanceCheck {
        bool enabled;                    // Enable balance monitoring
        uint256 lastCheck;               // Last balance check timestamp
        bool autoAdjust;                 // Auto adjust amount if insufficient
        bool autoCancel;                 // Auto cancel if insufficient + no gas
        uint256 minBalance;              // Minimum required balance
    }

    struct ExecutionInfo {
        uint256 attempts;                // Number of execution attempts
        uint256 lastAttempt;             // Last execution attempt timestamp
        string failureReason;            // Last failure reason
        uint256 totalFilled;             // Total amount filled
        bool isCompleted;                // Order completion status
    }

    // ============= CONSTANTS =============

    uint256 public constant MAX_TOLERANCE = 50; // 50% max price tolerance
    uint256 public constant MIN_TOLERANCE = 1;  // 1% min price tolerance
    uint256 public constant PRICE_PRECISION = 1e18;
    uint256 public constant GAS_PRIORITY_MULTIPLIER = 100;
    
    // Cross-chain supported networks
    uint256 public constant ETHEREUM_CHAIN_ID = 1;
    uint256 public constant DOGECOIN_CHAIN_ID = 2; // Custom ID for Dogecoin
    uint256 public constant BITCOIN_CHAIN_ID = 3;  // Custom ID for Bitcoin

    // ============= STATE VARIABLES =============

    mapping(bytes32 => PublicOrder) public orders;
    mapping(address => bytes32[]) public userOrders;
    mapping(address => uint256) public userNonces;
    mapping(uint256 => address) public chainOracles; // Price oracles per chain
    
    bytes32[] public activeOrderHashes;
    uint256 public totalOrdersCreated;
    uint256 public totalOrdersFilled;
    
    // Price protection thresholds
    uint256 public globalTolerancePercent = 10; // 10% default tolerance

    // Balance monitoring
    mapping(address => uint256) public lastBalanceCheck;
    uint256 public balanceCheckInterval = 300; // 5 minutes

    // Gas optimization
    mapping(uint256 => uint256) public chainBaseFees; // Base fees per chain

    // ============= EVENTS =============

    event OrderCreated(
        bytes32 indexed orderHash,
        address indexed user,
        uint256 amount,
        uint256 targetPrice,
        uint256 queuePosition
    );

    event OrderExecuted(
        bytes32 indexed orderHash,
        address indexed executor,
        uint256 filledAmount,
        uint256 executionPrice
    );

    event OrderCancelled(
        bytes32 indexed orderHash,
        address indexed user,
        string reason
    );

    event OrderAdjusted(
        bytes32 indexed orderHash,
        uint256 oldAmount,
        uint256 newAmount,
        string reason
    );

    event PriceProtectionTriggered(
        bytes32 indexed orderHash,
        uint256 orderPrice,
        uint256 marketPrice,
        bool withinTolerance
    );

    event BalanceInsufficient(
        bytes32 indexed orderHash,
        address indexed user,
        uint256 required,
        uint256 available
    );

    event CrossChainOrderCreated(
        bytes32 indexed orderHash,
        uint256 sourceChain,
        uint256 targetChain,
        address wrappedToken
    );

    // ============= MODIFIERS =============

    modifier validChain(uint256 chainId) {
        require(
            chainId == ETHEREUM_CHAIN_ID || 
            chainId == DOGECOIN_CHAIN_ID || 
            chainId == BITCOIN_CHAIN_ID,
            "Unsupported chain"
        );
        _;
    }

    modifier orderExists(bytes32 orderHash) {
        require(orders[orderHash].user != address(0), "Order does not exist");
        _;
    }

    modifier onlyOrderCreator(bytes32 orderHash) {
        require(orders[orderHash].user == msg.sender, "Not order creator");
        _;
    }

    modifier withinTolerance(uint256 tolerance) {
        require(
            tolerance >= MIN_TOLERANCE && tolerance <= MAX_TOLERANCE,
            "Invalid tolerance range"
        );
        _;
    }

    // ============= CONSTRUCTOR =============

    constructor(address initialOwner) 
        EIP712("TransparentOrderProtocol", "1") 
        Ownable(initialOwner) 
    {
        // Initialize with current chain as supported
        chainOracles[block.chainid] = address(0); // Will be set later
    }

    // ============= CORE FUNCTIONS =============

    /**
     * @notice Create a new transparent public order
     * @param order The order parameters
     * @return orderHash The hash of the created order
     */
    function createOrder(PublicOrder memory order) external nonReentrant returns (bytes32) {
        require(order.user == msg.sender, "Invalid user");
        require(order.amount > 0, "Invalid amount");
        require(order.targetPrice > 0, "Invalid target price");
        require(order.expiry > block.timestamp, "Order already expired");
        require(order.makerAsset != order.takerAsset, "Same assets");

        // Validate cross-chain parameters
        if (order.sourceChain != order.targetChain) {
            require(order.wrappedToken.wrappedToken != address(0), "Wrapped token required");
        }

        // Calculate order hash
        bytes32 orderHash = getOrderHash(order);
        require(orders[orderHash].user == address(0), "Order already exists");

        // Check user balance
        uint256 userBalance = IERC20(order.makerAsset).balanceOf(msg.sender);
        if (order.balanceCheck.enabled) {
            require(userBalance >= order.amount, "Insufficient balance");
        }

        // Transfer tokens to contract for escrow
        IERC20(order.makerAsset).safeTransferFrom(msg.sender, address(this), order.amount);

        // Calculate queue position based on gas price and timestamp
        order.queuePosition = calculateQueuePosition(order.gasPrice, order.timestamp, order.amount);
        order.timestamp = block.timestamp;

        // Store order
        orders[orderHash] = order;
        userOrders[msg.sender].push(orderHash);
        activeOrderHashes.push(orderHash);
        totalOrdersCreated++;

        emit OrderCreated(orderHash, order.user, order.amount, order.targetPrice, order.queuePosition);

        // Emit cross-chain event if applicable
        if (order.sourceChain != order.targetChain) {
            emit CrossChainOrderCreated(
                orderHash,
                order.sourceChain,
                order.targetChain,
                order.wrappedToken.wrappedToken
            );
        }

        return orderHash;
    }

    /**
     * @notice Execute an order if conditions are met
     * @param orderHash The order to execute
     * @param executionPrice Current market price for validation
     */
    function executeOrder(bytes32 orderHash, uint256 executionPrice) 
        external 
        nonReentrant 
        orderExists(orderHash) 
    {
        PublicOrder storage order = orders[orderHash];
        require(order.expiry > block.timestamp, "Order expired");
        require(!order.execution.isCompleted, "Order already completed");

        // Check price protection
        if (order.priceProtection.enabled) {
            bool isWithinTolerance = checkPriceProtection(order, executionPrice);
            require(isWithinTolerance, "Price outside tolerance range");
        }

        // Check balance if enabled
        if (order.balanceCheck.enabled) {
            uint256 currentBalance = IERC20(order.makerAsset).balanceOf(order.user);
            if (currentBalance < order.amount) {
                emit BalanceInsufficient(orderHash, order.user, order.amount, currentBalance);
                
                if (order.balanceCheck.autoCancel) {
                    _cancelOrder(orderHash, "Insufficient balance - auto cancelled");
                    return;
                } else if (order.balanceCheck.autoAdjust) {
                    _adjustOrderAmount(orderHash, currentBalance);
                }
            }
        }

        // Calculate taker amount based on target price
        uint256 takerAmount = (order.amount * order.targetPrice) / PRICE_PRECISION;
        
        // Transfer taker tokens from executor
        IERC20(order.takerAsset).safeTransferFrom(msg.sender, order.user, takerAmount);
        
        // Transfer maker tokens to executor
        IERC20(order.makerAsset).safeTransfer(msg.sender, order.amount);

        // Update execution info
        order.execution.totalFilled = order.amount;
        order.execution.isCompleted = true;
        order.execution.attempts++;
        order.execution.lastAttempt = block.timestamp;

        totalOrdersFilled++;

        emit OrderExecuted(orderHash, msg.sender, order.amount, executionPrice);

        // Remove from active orders
        _removeFromActiveOrders(orderHash);
    }

    /**
     * @notice Cancel an order
     * @param orderHash The order to cancel
     */
    function cancelOrder(bytes32 orderHash) 
        external 
        orderExists(orderHash) 
        onlyOrderCreator(orderHash) 
    {
        _cancelOrder(orderHash, "Cancelled by user");
    }

    /**
     * @notice Check if order price is within protection tolerance
     * @param order The order to check
     * @param currentMarketPrice Current market price
     * @return isWithinTolerance True if price is within tolerance
     */
    function checkPriceProtection(PublicOrder memory order, uint256 currentMarketPrice) 
        public 
        returns (bool isWithinTolerance) 
    {
        uint256 tolerance = order.priceProtection.tolerance > 0 ? 
            order.priceProtection.tolerance : globalTolerancePercent;
        
        uint256 lowerBound = (currentMarketPrice * (100 - tolerance)) / 100;
        uint256 upperBound = (currentMarketPrice * (100 + tolerance)) / 100;
        
        isWithinTolerance = (order.targetPrice >= lowerBound && order.targetPrice <= upperBound);
        
        emit PriceProtectionTriggered(
            getOrderHash(order),
            order.targetPrice,
            currentMarketPrice,
            isWithinTolerance
        );
        
        return isWithinTolerance;
    }

    /**
     * @notice Calculate queue position based on gas price, time, and amount
     * @param gasPrice Gas price offered
     * @param timestamp Order timestamp
     * @param amount Order amount
     * @return queuePosition Calculated priority position
     */
    function calculateQueuePosition(uint256 gasPrice, uint256 timestamp, uint256 amount) 
        public 
        view 
        returns (uint256 queuePosition) 
    {
        // Priority = gasPrice weight + amount weight - time penalty
        uint256 gasWeight = gasPrice * GAS_PRIORITY_MULTIPLIER;
        uint256 amountWeight = amount / 1000; // Reduce impact of amount
        uint256 timePenalty = (block.timestamp - timestamp) / 60; // Per minute penalty
        
        queuePosition = gasWeight + amountWeight - timePenalty;
        return queuePosition;
    }

    /**
     * @notice Get order hash for a given order
     * @param order The order to hash
     * @return The keccak256 hash of the order
     */
    function getOrderHash(PublicOrder memory order) public pure returns (bytes32) {
        return keccak256(abi.encode(
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
        ));
    }

    // ============= BATCH OPERATIONS =============

    /**
     * @notice Execute multiple orders in a single transaction
     * @param orderHashes Array of order hashes to execute
     * @param executionPrices Array of current market prices
     */
    function batchExecuteOrders(bytes32[] calldata orderHashes, uint256[] calldata executionPrices) 
        external 
        nonReentrant 
    {
        require(orderHashes.length == executionPrices.length, "Array length mismatch");
        require(orderHashes.length <= 10, "Too many orders"); // Gas limit protection
        
        for (uint256 i = 0; i < orderHashes.length; i++) {
            try this.executeOrder(orderHashes[i], executionPrices[i]) {
                // Order executed successfully
            } catch {
                // Continue with next order if one fails
                orders[orderHashes[i]].execution.attempts++;
                orders[orderHashes[i]].execution.failureReason = "Batch execution failed";
            }
        }
    }

    // ============= VIEW FUNCTIONS =============

    /**
     * @notice Get all active orders for a user
     */
    function getUserOrders(address user) external view returns (bytes32[] memory) {
        return userOrders[user];
    }

    /**
     * @notice Get order details by hash
     */
    function getOrder(bytes32 orderHash) external view returns (PublicOrder memory) {
        return orders[orderHash];
    }

    /**
     * @notice Get all active order hashes
     */
    function getActiveOrders() external view returns (bytes32[] memory) {
        return activeOrderHashes;
    }

    /**
     * @notice Get orders sorted by queue position (highest priority first)
     */
    function getOrdersByPriority(uint256 limit) external view returns (bytes32[] memory) {
        require(limit <= activeOrderHashes.length, "Limit too high");
        
        bytes32[] memory sortedOrders = new bytes32[](limit);
        uint256[] memory priorities = new uint256[](limit);
        
        // Simple insertion sort for small arrays (gas efficient for small limits)
        for (uint256 i = 0; i < limit && i < activeOrderHashes.length; i++) {
            bytes32 orderHash = activeOrderHashes[i];
            uint256 priority = orders[orderHash].queuePosition;
            
            uint256 j = i;
            while (j > 0 && priorities[j-1] < priority) {
                sortedOrders[j] = sortedOrders[j-1];
                priorities[j] = priorities[j-1];
                j--;
            }
            sortedOrders[j] = orderHash;
            priorities[j] = priority;
        }
        
        return sortedOrders;
    }

    // ============= INTERNAL FUNCTIONS =============

    function _cancelOrder(bytes32 orderHash, string memory reason) internal {
        PublicOrder storage order = orders[orderHash];
        
        // Return escrowed tokens to user
        IERC20(order.makerAsset).safeTransfer(order.user, order.amount - order.execution.totalFilled);
        
        // Mark as cancelled
        order.execution.isCompleted = true;
        order.execution.failureReason = reason;
        
        emit OrderCancelled(orderHash, order.user, reason);
        
        // Remove from active orders
        _removeFromActiveOrders(orderHash);
    }

    function _adjustOrderAmount(bytes32 orderHash, uint256 newAmount) internal {
        PublicOrder storage order = orders[orderHash];
        uint256 oldAmount = order.amount;
        
        require(newAmount > 0, "Invalid new amount");
        require(newAmount < oldAmount, "Can only decrease amount");
        
        // Return excess tokens
        uint256 excessAmount = oldAmount - newAmount;
        IERC20(order.makerAsset).safeTransfer(order.user, excessAmount);
        
        // Update order
        order.amount = newAmount;
        
        emit OrderAdjusted(orderHash, oldAmount, newAmount, "Auto-adjusted for insufficient balance");
    }

    function _removeFromActiveOrders(bytes32 orderHash) internal {
        for (uint256 i = 0; i < activeOrderHashes.length; i++) {
            if (activeOrderHashes[i] == orderHash) {
                activeOrderHashes[i] = activeOrderHashes[activeOrderHashes.length - 1];
                activeOrderHashes.pop();
                break;
            }
        }
    }

    // ============= ADMIN FUNCTIONS =============

    function setGlobalTolerance(uint256 tolerance) external onlyOwner withinTolerance(tolerance) {
        globalTolerancePercent = tolerance;
    }

    function setChainOracle(uint256 chainId, address oracle) external onlyOwner {
        chainOracles[chainId] = oracle;
    }

    function setBalanceCheckInterval(uint256 interval) external onlyOwner {
        require(interval >= 60, "Minimum 1 minute interval");
        balanceCheckInterval = interval;
    }

    function emergencyPause() external onlyOwner {
        // Emergency function to pause all operations
        // Implementation depends on OpenZeppelin Pausable if needed
    }
}