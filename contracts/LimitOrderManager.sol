// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal ERC20 interface
interface IERC20 {
  function approve(address spender, uint256 value) external returns (bool);
  function transfer(address to, uint256 value) external returns (bool);
  function transferFrom(address from, address to, uint256 value) external returns (bool);
  function balanceOf(address) external view returns (uint256);
}

/// @notice Somnia Exchange Router V2 interface
interface ISomniaRouter {
  function swapExactTokensForTokens(
    uint amountIn,
    uint amountOutMin,
    address[] calldata path,
    address to,
    uint deadline
  ) external returns (uint[] memory amounts);

  function swapTokensForExactTokens(
    uint amountOut,
    uint amountInMax,
    address[] calldata path,
    address to,
    uint deadline
  ) external returns (uint[] memory amounts);
}

/**
 * @title LimitOrderManager
 * @notice Non-custodial limit-order executor for Somnia Exchange (V2-style).
 * Users sign EIP-712 orders off-chain. Anyone can execute when conditions are met.
 * Takes a platform fee (e.g. 1%) from the *input token* before swapping.
 * Users get the full output amount, but pay fees from their input.
 */
contract LimitOrderManager {
  // ---- immutable config ----
  address public immutable ROUTER; // Somnia Exchange Router
  address public immutable WSOMI;  // Wrapped Somnia

  // ---- fee config ----
  address public owner;
  address public feeRecipient; // where fees go
  uint256 public feeBps;       // 100 = 1%. Max guarded below.

  // ---- EIP-712 domain ----
  bytes32 public immutable DOMAIN_SEPARATOR;
  bytes32 private constant EIP712_DOMAIN_TYPEHASH =
    keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
  bytes32 private constant ORDER_TYPEHASH = keccak256(
    "Order(address trader,address tokenIn,address tokenOut,uint256 amountIn,uint256 amountOutMin,uint256 limitPriceE18,uint256 slippageBps,uint256 deadline,uint256 nonce)"
  );

  /// @notice trader => nonce => used
  mapping(address => mapping(uint256 => bool)) public nonceUsed;

  struct Order {
    address trader;
    address tokenIn;
    address tokenOut;
    uint256 amountIn;     // Total amount including fee
    uint256 amountOutMin; // Minimum output (for slippage protection)
    uint256 limitPriceE18; // tokenOut per 1 tokenIn, scaled by 1e18
    uint256 slippageBps;   // 50 = 0.50%
    uint256 deadline;      // unix time
    uint256 nonce;         // per-trader
  }

  // ---- events ----
  event OrderExecuted(address indexed trader, uint256 indexed nonce, uint256 amountOut);
  event OrderCanceled(address indexed trader, uint256 indexed nonce);
  event FeeUpdated(address indexed recipient, uint256 feeBps);
  event FeeTaken(address indexed recipient, address indexed token, uint256 feeAmount, uint256 bps);

  // ---- constructor ----
  constructor(
    address _router,
    address _wsomi,
    address _feeRecipient,
    uint256 _feeBps
  ) {
    require(_router != address(0), "router=0");
    ROUTER = _router;
    WSOMI  = _wsomi;
    owner  = msg.sender;

    _setFee(_feeRecipient, _feeBps);

    DOMAIN_SEPARATOR = keccak256(
      abi.encode(
        EIP712_DOMAIN_TYPEHASH,
        keccak256(bytes("Bingme LimitOrders")),
        keccak256(bytes("1")),
        block.chainid,
        address(this)
      )
    );
  }

  // ---------------- owner / fee controls ----------------
  modifier onlyOwner() {
    require(msg.sender == owner, "not owner");
    _;
  }

  function setOwner(address newOwner) external onlyOwner {
    require(newOwner != address(0), "owner=0");
    owner = newOwner;
  }

  function setFee(address _recipient, uint256 _feeBps) external onlyOwner {
    _setFee(_recipient, _feeBps);
  }

  function _setFee(address _recipient, uint256 _feeBps) internal {
    require(_recipient != address(0), "feeRecipient=0");
    require(_feeBps <= 1000, "fee too high"); // max 10%
    feeRecipient = _recipient;
    feeBps       = _feeBps;
    emit FeeUpdated(_recipient, _feeBps);
  }

  // ---------------- EIP-712 helpers ----------------
  function hashOrder(Order memory o) public pure returns (bytes32) {
    return keccak256(
      abi.encode(
        ORDER_TYPEHASH,
        o.trader,
        o.tokenIn,
        o.tokenOut,
        o.amountIn,
        o.amountOutMin,
        o.limitPriceE18,
        o.slippageBps,
        o.deadline,
        o.nonce
      )
    );
  }

  function _typedDataHash(Order memory o) internal view returns (bytes32) {
    return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, hashOrder(o)));
  }

  function _recover(Order memory o, bytes memory sig) internal view returns (address) {
    bytes32 digest = _typedDataHash(o);
    (bytes32 r, bytes32 s, uint8 v) = _split(sig);
    return ecrecover(digest, v, r, s);
  }

  function _split(bytes memory sig) internal pure returns (bytes32 r, bytes32 s, uint8 v) {
    require(sig.length == 65, "bad sig");
    assembly {
      r := mload(add(sig, 32))
      s := mload(add(sig, 64))
      v := byte(0, mload(add(sig, 96)))
    }
  }

  // ---------------- User controls ----------------
  function cancel(uint256 nonce) external {
    nonceUsed[msg.sender][nonce] = true;
    emit OrderCanceled(msg.sender, nonce);
  }

  // ---------------- Execution ----------------
  /**
   * @notice Execute a signed order.
   * @dev Pulls tokenIn from trader (requires prior ERC20 approval to this contract).
   * Takes platform fee from input token BEFORE swapping.
   * Enforces limit price and slippage protection.
   * Users receive full output amount; fees are deducted from their input.
   */
  function execute(Order calldata o, bytes calldata sig)
    external
    returns (uint256 amountOut)
  {
    require(block.timestamp <= o.deadline, "expired");
    require(!nonceUsed[o.trader][o.nonce], "nonce used");

    // Signature check
    address signer = _recover(o, sig);
    require(signer == o.trader, "bad signer");
    nonceUsed[o.trader][o.nonce] = true;

    // Pull full amount from trader (including fee portion)
    require(
      IERC20(o.tokenIn).transferFrom(o.trader, address(this), o.amountIn),
      "pull fail"
    );

    // ---- Take platform fee from input token FIRST ----
    uint256 feeIn;
    uint256 swapAmountIn = o.amountIn;

    if (feeBps > 0) {
      feeIn        = (o.amountIn * feeBps) / 10000;
      swapAmountIn = o.amountIn - feeIn;

      if (feeIn > 0) {
        require(IERC20(o.tokenIn).transfer(feeRecipient, feeIn), "fee xfer fail");
        emit FeeTaken(feeRecipient, o.tokenIn, feeIn, feeBps);
      }
    }

    // ---- Compute minimum output based on NET swap amount and limit price ----
    // limitPriceE18 represents expected tokenOut per 1 tokenIn
    // For the net swap amount, we expect: swapAmountIn * limitPriceE18 / 1e18
    uint256 minOutFromLimit = (swapAmountIn * o.limitPriceE18) / 1e18;

    // Apply slippage to the minimum expected output
    uint256 minOutNet = minOutFromLimit;
    if (o.slippageBps > 0) {
      minOutNet = (minOutFromLimit * (10000 - o.slippageBps)) / 10000;
    }

    // Use the higher of user-specified minOut or computed minOut
    uint256 finalMinOut = o.amountOutMin > minOutNet ? o.amountOutMin : minOutNet;

    // Approve router for the net swap amount
    _safeApprove(o.tokenIn, ROUTER, swapAmountIn);

    // Build swap path
    address[] memory path = new address[](2);
    path[0] = o.tokenIn;
    path[1] = o.tokenOut;

    // Execute swap
    uint[] memory amounts = ISomniaRouter(ROUTER).swapExactTokensForTokens(
      swapAmountIn,
      finalMinOut,
      path,
      o.trader, // Send directly to trader
      o.deadline
    );

    amountOut = amounts[amounts.length - 1];
    emit OrderExecuted(o.trader, o.nonce, amountOut);
  }

  // ---------------- Internals ----------------
  function _safeApprove(address token, address spender, uint256 amount) internal {
    // Reset to 0 then set to amount (covers non-standard ERC20s)
    (bool s1, ) = token.call(abi.encodeWithSignature("approve(address,uint256)", spender, 0));
    s1;
    (bool s2, ) = token.call(abi.encodeWithSignature("approve(address,uint256)", spender, amount));
    require(s2, "approve fail");
  }
}

