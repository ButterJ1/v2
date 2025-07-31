// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title PriceProtectionOracle
 * @notice Advanced price oracle system for transparent order protection
 * @dev Integrates Chainlink feeds with custom price validation logic
 */
contract PriceProtectionOracle is Ownable, ReentrancyGuard {
    
    // ============= STRUCTS =============
    
    struct PriceFeed {
        AggregatorV3Interface oracle;
        uint256 heartbeat;          // Maximum time between updates
        uint256 deviationThreshold; // Maximum price deviation (basis points)
        bool isActive;
        bool isInverted;            // For pairs like ETH/BTC vs BTC/ETH
    }

    struct PriceData {
        uint256 price;
        uint256 timestamp;
        uint256 roundId;
        bool isValid;
    }

    struct TokenPair {
        address baseToken;
        address quoteToken;
        bytes32 pairId;
        PriceFeed primaryFeed;
        PriceFeed secondaryFeed; // Backup feed
        uint256 lastValidPrice;
        uint256 lastUpdateTime;
    }

    struct PriceValidation {
        bool withinTolerance;
        uint256 orderPrice;
        uint256 marketPrice;
        uint256 deviation;
        string validationResult;
    }

    // ============= CONSTANTS =============

    uint256 public constant BASIS_POINTS = 10000; // 100% = 10000 basis points
    uint256 public constant PRICE_PRECISION = 1e18;
    uint256 public constant MAX_DEVIATION = 2000; // 20% maximum deviation
    uint256 public constant STALE_PRICE_THRESHOLD = 3600; // 1 hour
    
    // Default tolerance ranges for different asset types
    uint256 public constant STABLE_TOLERANCE = 300;    // 3% for stablecoins
    uint256 public constant MAJOR_TOLERANCE = 1000;    // 10% for major assets (ETH, BTC)
    uint256 public constant ALT_TOLERANCE = 1500;      // 15% for altcoins (DOGE, etc.)

    // ============= STATE VARIABLES =============

    mapping(bytes32 => TokenPair) public tokenPairs;
    mapping(address => uint256) public tokenTolerances; // Custom tolerance per token
    mapping(address => bool) public supportedTokens;
    mapping(bytes32 => PriceData) public priceHistory;
    
    bytes32[] public activePairs;
    address[] public monitoredTokens;
    
    uint256 public globalTolerancePercent = 1000; // 10% default
    uint256 public priceUpdateInterval = 300; // 5 minutes
    uint256 public maxPriceAge = 900; // 15 minutes max age
    
    bool public emergencyPaused = false;

    // ============= EVENTS =============

    event PriceFeedAdded(
        bytes32 indexed pairId,
        address indexed baseToken,
        address indexed quoteToken,
        address oracle
    );

    event PriceUpdated(
        bytes32 indexed pairId,
        uint256 newPrice,
        uint256 oldPrice,
        uint256 timestamp
    );

    event PriceValidationResult(
        bytes32 indexed pairId,
        address indexed user,
        bool withinTolerance,
        uint256 orderPrice,
        uint256 marketPrice,
        uint256 deviation
    );

    event ToleranceExceeded(
        bytes32 indexed pairId,
        uint256 orderPrice,
        uint256 marketPrice,
        uint256 toleranceUsed,
        uint256 actualDeviation
    );

    event StalePriceDetected(
        bytes32 indexed pairId,
        uint256 lastUpdate,
        uint256 maxAge
    );

    event EmergencyPriceOverride(
        bytes32 indexed pairId,
        uint256 overridePrice,
        string reason
    );

    // ============= MODIFIERS =============

    modifier onlyActiveOracle(bytes32 pairId) {
        require(tokenPairs[pairId].primaryFeed.isActive, "Oracle not active");
        _;
    }

    modifier notPaused() {
        require(!emergencyPaused, "Price oracle paused");
        _;
    }

    modifier validTolerance(uint256 toleranceValue) {
        require(toleranceValue <= MAX_DEVIATION, "Tolerance too high");
        require(toleranceValue > 0, "Tolerance must be positive");
        _;
    }

    // ============= CONSTRUCTOR =============

    constructor(address initialOwner) Ownable(initialOwner) {
        // Initialize with common Ethereum mainnet price feeds
        _initializeMainnetFeeds();
    }

    // ============= PRICE FEED MANAGEMENT =============

    /**
     * @notice Add a new price feed for a token pair
     * @param baseToken Base token address
     * @param quoteToken Quote token address  
     * @param primaryOracle Primary Chainlink oracle address
     * @param secondaryOracle Secondary oracle for backup
     * @param heartbeat Maximum time between oracle updates
     * @param isInverted Whether the feed price is inverted
     */
    function addPriceFeed(
        address baseToken,
        address quoteToken,
        address primaryOracle,
        address secondaryOracle,
        uint256 heartbeat,
        bool isInverted
    ) external onlyOwner {
        require(baseToken != quoteToken, "Same token addresses");
        require(primaryOracle != address(0), "Invalid primary oracle");

        bytes32 pairId = keccak256(abi.encodePacked(baseToken, quoteToken));
        
        tokenPairs[pairId] = TokenPair({
            baseToken: baseToken,
            quoteToken: quoteToken,
            pairId: pairId,
            primaryFeed: PriceFeed({
                oracle: AggregatorV3Interface(primaryOracle),
                heartbeat: heartbeat,
                deviationThreshold: 500, // 5% default deviation threshold
                isActive: true,
                isInverted: isInverted
            }),
            secondaryFeed: PriceFeed({
                oracle: secondaryOracle != address(0) ? AggregatorV3Interface(secondaryOracle) : AggregatorV3Interface(address(0)),
                heartbeat: heartbeat,
                deviationThreshold: 1000, // 10% for secondary
                isActive: secondaryOracle != address(0),
                isInverted: isInverted
            }),
            lastValidPrice: 0,
            lastUpdateTime: 0
        });

        activePairs.push(pairId);
        supportedTokens[baseToken] = true;
        supportedTokens[quoteToken] = true;

        emit PriceFeedAdded(pairId, baseToken, quoteToken, primaryOracle);
    }

    // ============= PRICE RETRIEVAL =============

    /**
     * @notice Get current price for a token pair with validation
     * @param baseToken Base token address
     * @param quoteToken Quote token address
     * @return price Current price scaled to 1e18
     * @return isValid Whether the price is valid and fresh
     */
    function getCurrentPrice(address baseToken, address quoteToken) 
        external 
        view 
        notPaused 
        returns (uint256 price, bool isValid) 
    {
        bytes32 pairId = keccak256(abi.encodePacked(baseToken, quoteToken));
        return _getCurrentPriceInternal(pairId);
    }

    /**
     * @notice Get historical price data
     * @param baseToken Base token address
     * @param quoteToken Quote token address
     * @return priceData Historical price information
     */
    function getHistoricalPrice(address baseToken, address quoteToken) 
        external 
        view 
        returns (PriceData memory priceData) 
    {
        bytes32 pairId = keccak256(abi.encodePacked(baseToken, quoteToken));
        return priceHistory[pairId];
    }

    // ============= PRICE PROTECTION VALIDATION =============

    /**
     * @notice Validate order price against current market with tolerance
     * @param baseToken Base token address
     * @param quoteToken Quote token address  
     * @param orderPrice Order price to validate
     * @param customTolerance Custom tolerance (0 = use default)
     * @return validation Complete validation result
     */
    function validateOrderPrice(
        address baseToken,
        address quoteToken,
        uint256 orderPrice,
        uint256 customTolerance
    ) external returns (PriceValidation memory validation) {
        require(orderPrice > 0, "Invalid order price");
        
        bytes32 pairId = keccak256(abi.encodePacked(baseToken, quoteToken));
        (uint256 marketPrice, bool isValid) = _getCurrentPriceInternal(pairId);
        
        require(isValid, "Market price unavailable");

        // Determine tolerance to use
        uint256 toleranceToUse = customTolerance > 0 ? customTolerance : _getDefaultTolerance(baseToken);
        require(toleranceToUse <= MAX_DEVIATION, "Tolerance too high");

        // Calculate price bounds
        uint256 lowerBound = (marketPrice * (BASIS_POINTS - toleranceToUse)) / BASIS_POINTS;
        uint256 upperBound = (marketPrice * (BASIS_POINTS + toleranceToUse)) / BASIS_POINTS;
        
        bool isWithinTolerance = (orderPrice >= lowerBound && orderPrice <= upperBound);
        
        // Calculate actual deviation
        uint256 deviation;
        if (orderPrice > marketPrice) {
            deviation = ((orderPrice - marketPrice) * BASIS_POINTS) / marketPrice;
        } else {
            deviation = ((marketPrice - orderPrice) * BASIS_POINTS) / marketPrice;
        }

        validation = PriceValidation({
            withinTolerance: isWithinTolerance,
            orderPrice: orderPrice,
            marketPrice: marketPrice,
            deviation: deviation,
            validationResult: isWithinTolerance ? "WITHIN_TOLERANCE" : "OUTSIDE_TOLERANCE"
        });

        emit PriceValidationResult(
            pairId,
            msg.sender,
            isWithinTolerance,
            orderPrice,
            marketPrice,
            deviation
        );

        if (!isWithinTolerance) {
            emit ToleranceExceeded(pairId, orderPrice, marketPrice, toleranceToUse, deviation);
        }

        return validation;
    }

    /**
     * @notice Batch validate multiple order prices
     * @param baseTokens Array of base token addresses
     * @param quoteTokens Array of quote token addresses
     * @param orderPrices Array of order prices
     * @param tolerances Array of custom tolerances (0 = use default)
     * @return validations Array of validation results
     */
    function batchValidateOrderPrices(
        address[] calldata baseTokens,
        address[] calldata quoteTokens,
        uint256[] calldata orderPrices,
        uint256[] calldata tolerances
    ) external returns (PriceValidation[] memory validations) {
        require(baseTokens.length == quoteTokens.length, "Array length mismatch");
        require(baseTokens.length == orderPrices.length, "Array length mismatch");
        require(baseTokens.length == tolerances.length, "Array length mismatch");
        require(baseTokens.length <= 20, "Too many orders"); // Gas limit protection

        validations = new PriceValidation[](baseTokens.length);

        for (uint256 i = 0; i < baseTokens.length; i++) {
            validations[i] = this.validateOrderPrice(
                baseTokens[i],
                quoteTokens[i],
                orderPrices[i],
                tolerances[i]
            );
        }

        return validations;
    }

    // ============= PRICE MONITORING =============

    /**
     * @notice Update prices for all active pairs
     * @dev Can be called by anyone to update stale prices
     */
    function updateAllPrices() external nonReentrant notPaused {
        uint256 updatedCount = 0;
        
        for (uint256 i = 0; i < activePairs.length; i++) {
            bytes32 pairId = activePairs[i];
            if (_shouldUpdatePrice(pairId)) {
                _updatePriceForPair(pairId);
                updatedCount++;
            }
        }
        
        require(updatedCount > 0, "No prices needed updating");
    }

    /**
     * @notice Force update price for specific pair (emergency use)
     * @param baseToken Base token address
     * @param quoteToken Quote token address
     */
    function forceUpdatePrice(address baseToken, address quoteToken) 
        external 
        onlyOwner 
        nonReentrant 
    {
        bytes32 pairId = keccak256(abi.encodePacked(baseToken, quoteToken));
        _updatePriceForPair(pairId);
    }

    // ============= INTERNAL FUNCTIONS =============

    function _getCurrentPriceInternal(bytes32 pairId) 
        internal 
        view 
        returns (uint256 price, bool isValid) 
    {
        TokenPair storage pair = tokenPairs[pairId];
        require(pair.baseToken != address(0), "Pair not found");

        // Try primary feed first
        (price, isValid) = _getPriceFromFeed(pair.primaryFeed);
        
        // Fallback to secondary if primary fails
        if (!isValid && pair.secondaryFeed.isActive) {
            (price, isValid) = _getPriceFromFeed(pair.secondaryFeed);
        }

        // Use last valid price if both feeds fail but within acceptable time
        if (!isValid && pair.lastValidPrice > 0) {
            if (block.timestamp - pair.lastUpdateTime <= maxPriceAge) {
                price = pair.lastValidPrice;
                isValid = true;
            }
        }

        return (price, isValid);
    }

    function _getPriceFromFeed(PriceFeed memory feed) 
        internal 
        view 
        returns (uint256 price, bool isValid) 
    {
        if (!feed.isActive || address(feed.oracle) == address(0)) {
            return (0, false);
        }

        try feed.oracle.latestRoundData() returns (
            uint80 roundId,
            int256 rawPrice,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        ) {
            // Validate price data
            if (rawPrice <= 0 || updatedAt == 0 || block.timestamp - updatedAt > feed.heartbeat) {
                return (0, false);
            }

            // Convert to 1e18 precision
            uint8 decimals = feed.oracle.decimals();
            price = uint256(rawPrice) * (PRICE_PRECISION / (10 ** decimals));
            
            // Handle inverted feeds
            if (feed.isInverted && price > 0) {
                price = (PRICE_PRECISION * PRICE_PRECISION) / price;
            }

            isValid = true;
        } catch {
            return (0, false);
        }
    }

    function _shouldUpdatePrice(bytes32 pairId) internal view returns (bool) {
        TokenPair storage pair = tokenPairs[pairId];
        return block.timestamp - pair.lastUpdateTime >= priceUpdateInterval;
    }

    function _updatePriceForPair(bytes32 pairId) internal {
        TokenPair storage pair = tokenPairs[pairId];
        (uint256 newPrice, bool isValid) = _getCurrentPriceInternal(pairId);
        
        if (isValid) {
            uint256 oldPrice = pair.lastValidPrice;
            pair.lastValidPrice = newPrice;
            pair.lastUpdateTime = block.timestamp;
            
            // Store in history
            priceHistory[pairId] = PriceData({
                price: newPrice,
                timestamp: block.timestamp,
                roundId: 0, // Could get from oracle if needed
                isValid: true
            });

            emit PriceUpdated(pairId, newPrice, oldPrice, block.timestamp);
        }
    }

    function _getDefaultTolerance(address token) internal view returns (uint256) {
        // Check if custom tolerance is set
        if (tokenTolerances[token] > 0) {
            return tokenTolerances[token];
        }

        // Return default based on token type (simplified classification)
        // In production, this would use a more sophisticated token classification system
        return MAJOR_TOLERANCE; // 10% default
    }

    function _initializeMainnetFeeds() internal {
        // This would be called in constructor to set up common feeds
        // ETH/USD: 0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419
        // BTC/USD: 0xf4030086522a5beea4988f8ca5b36dbc97bee88c
        // DOGE/USD: 0x2465cefd3b488be410b941b1d4b2767088e2a028
        
        // Implementation would add these feeds here
    }

    // ============= ADMIN FUNCTIONS =============

    function setGlobalTolerance(uint256 toleranceValue) external onlyOwner validTolerance(toleranceValue) {
        globalTolerancePercent = toleranceValue;
    }

    function setTokenTolerance(address token, uint256 toleranceValue) 
        external 
        onlyOwner 
        validTolerance(toleranceValue) 
    {
        tokenTolerances[token] = toleranceValue;
    }

    function setPriceUpdateInterval(uint256 interval) external onlyOwner {
        require(interval >= 60, "Minimum 1 minute interval");
        priceUpdateInterval = interval;
    }

    function setMaxPriceAge(uint256 maxAge) external onlyOwner {
        require(maxAge >= 300, "Minimum 5 minutes");
        maxPriceAge = maxAge;
    }

    function toggleEmergencyPause() external onlyOwner {
        emergencyPaused = !emergencyPaused;
    }

    function emergencySetPrice(
        address baseToken, 
        address quoteToken, 
        uint256 price, 
        string calldata reason
    ) external onlyOwner {
        bytes32 pairId = keccak256(abi.encodePacked(baseToken, quoteToken));
        tokenPairs[pairId].lastValidPrice = price;
        tokenPairs[pairId].lastUpdateTime = block.timestamp;
        
        emit EmergencyPriceOverride(pairId, price, reason);
    }

    // ============= VIEW FUNCTIONS =============

    function getActivePairs() external view returns (bytes32[] memory) {
        return activePairs;
    }

    function getSupportedTokens() external view returns (address[] memory) {
        return monitoredTokens;
    }

    function getPairInfo(address baseToken, address quoteToken) 
        external 
        view 
        returns (TokenPair memory) 
    {
        bytes32 pairId = keccak256(abi.encodePacked(baseToken, quoteToken));
        return tokenPairs[pairId];
    }

    function isTokenSupported(address token) external view returns (bool) {
        return supportedTokens[token];
    }

    function getToleranceForToken(address token) external view returns (uint256) {
        return tokenTolerances[token] > 0 ? tokenTolerances[token] : globalTolerancePercent;
    }
}