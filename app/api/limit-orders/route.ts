import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

const ORDERS_FILE = path.join(process.cwd(), 'limit-orders.json');

interface LimitOrder {
  id: string;
  trader: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOutMin: string;
  limitPriceE18: string;
  slippageBps: number;
  deadline: number;
  nonce: number;
  signature: string;
  createdAt: string;
  status: 'pending' | 'executed' | 'canceled' | 'expired';
  orderType: 'buy' | 'sell';
  limitPriceWSOMI: string;
  limitPriceUSD: string;
}

interface OrdersData {
  orders: LimitOrder[];
  lastUpdated: string;
}

// Atomic write function
function atomicWrite(filePath: string, data: any) {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

// Load orders
function loadOrders(): OrdersData {
  if (!fs.existsSync(ORDERS_FILE)) {
    return { orders: [], lastUpdated: new Date().toISOString() };
  }
  try {
    return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf-8'));
  } catch (error) {
    console.error('Error loading orders:', error);
    return { orders: [], lastUpdated: new Date().toISOString() };
  }
}

// Save orders
function saveOrders(data: OrdersData) {
  data.lastUpdated = new Date().toISOString();
  atomicWrite(ORDERS_FILE, data);
}

// GET - Fetch orders for a trader
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const trader = searchParams.get('trader');

    const data = loadOrders();

    if (trader) {
      const traderOrders = data.orders.filter(
        o => o.trader.toLowerCase() === trader.toLowerCase()
      );
      return NextResponse.json({ orders: traderOrders });
    }

    return NextResponse.json({ orders: data.orders });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

// POST - Create new order
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      id,
      trader,
      tokenIn,
      tokenOut,
      amountIn,
      amountOutMin,
      limitPriceE18,
      slippageBps,
      deadline,
      nonce,
      signature,
      orderType,
      limitPriceWSOMI,
      limitPriceUSD,
    } = body;

    if (!trader || !tokenIn || !tokenOut || !signature) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const data = loadOrders();

    // Check if order with same trader+nonce already exists
    const existingOrder = data.orders.find(
      o => o.trader.toLowerCase() === trader.toLowerCase() && o.nonce === nonce
    );

    if (existingOrder) {
      return NextResponse.json(
        { error: 'Order with this nonce already exists' },
        { status: 400 }
      );
    }

    const newOrder: LimitOrder = {
      id: id || `${trader}-${nonce}-${Date.now()}`,
      trader: trader.toLowerCase(),
      tokenIn: tokenIn.toLowerCase(),
      tokenOut: tokenOut.toLowerCase(),
      amountIn,
      amountOutMin,
      limitPriceE18,
      slippageBps,
      deadline,
      nonce,
      signature,
      createdAt: new Date().toISOString(),
      status: 'pending',
      orderType: orderType || 'buy',
      limitPriceWSOMI: limitPriceWSOMI || '0',
      limitPriceUSD: limitPriceUSD || '0',
    };

    data.orders.push(newOrder);
    saveOrders(data);

    return NextResponse.json({ order: newOrder, success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

// PUT - Update order status
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderId, status } = body;

    if (!orderId || !status) {
      return NextResponse.json(
        { error: 'Missing orderId or status' },
        { status: 400 }
      );
    }

    const data = loadOrders();
    const order = data.orders.find(o => o.id === orderId);

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      );
    }

    order.status = status;
    saveOrders(data);

    return NextResponse.json({ order, success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

// DELETE - Cancel order
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get('orderId');

    if (!orderId) {
      return NextResponse.json(
        { error: 'Missing orderId' },
        { status: 400 }
      );
    }

    const data = loadOrders();
    const orderIndex = data.orders.findIndex(o => o.id === orderId);

    if (orderIndex === -1) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      );
    }

    data.orders[orderIndex].status = 'canceled';
    saveOrders(data);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

