import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

interface PendingNotification {
  walletAddress: string;
  tokenSymbol: string;
  direction: 'up' | 'down';
  changePercent: number;
  currentPrice: number;
  currentValue: number;
  previousValue: number;
  timestamp: string;
  read: boolean;
}

const notificationsDir = path.join(process.cwd(), 'notifications');

function ensureNotificationsDir() {
  if (!fs.existsSync(notificationsDir)) {
    fs.mkdirSync(notificationsDir, { recursive: true });
  }
}

function getNotificationFile(walletAddress: string): string {
  ensureNotificationsDir();
  return path.join(notificationsDir, `${walletAddress.toLowerCase()}.json`);
}

// GET - Fetch pending notifications for a wallet
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const walletAddress = searchParams.get('address');

    if (!walletAddress) {
      return NextResponse.json(
        { error: 'Wallet address is required' },
        { status: 400 }
      );
    }

    const notificationFile = getNotificationFile(walletAddress);
    
    if (!fs.existsSync(notificationFile)) {
      return NextResponse.json({ notifications: [] });
    }

    const notifications: PendingNotification[] = JSON.parse(
      fs.readFileSync(notificationFile, 'utf-8')
    );

    // Return only unread notifications
    const unread = notifications.filter(n => !n.read);

    return NextResponse.json({ notifications: unread });
  } catch (error: any) {
    console.error('Get notifications error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get notifications' },
      { status: 500 }
    );
  }
}

// POST - Mark notifications as read
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { walletAddress, notificationIds } = body;

    if (!walletAddress) {
      return NextResponse.json(
        { error: 'Wallet address is required' },
        { status: 400 }
      );
    }

    const notificationFile = getNotificationFile(walletAddress);
    
    if (!fs.existsSync(notificationFile)) {
      return NextResponse.json({ success: true });
    }

    const notifications: PendingNotification[] = JSON.parse(
      fs.readFileSync(notificationFile, 'utf-8')
    );

    // Mark specified notifications as read
    if (notificationIds && Array.isArray(notificationIds)) {
      notifications.forEach(notif => {
        const id = `${notif.timestamp}-${notif.tokenSymbol}-${notif.direction}`;
        if (notificationIds.includes(id)) {
          notif.read = true;
        }
      });
    } else {
      // Mark all as read
      notifications.forEach(notif => {
        notif.read = true;
      });
    }

    // Keep only last 100 notifications
    const sorted = notifications.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    const toKeep = sorted.slice(0, 100);

    // Atomic write
    const tempFile = `${notificationFile}.tmp`;
    try {
      fs.writeFileSync(tempFile, JSON.stringify(toKeep, null, 2), 'utf8');
      fs.renameSync(tempFile, notificationFile);
    } catch (error) {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
      throw error;
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Mark notifications read error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to mark notifications as read' },
      { status: 500 }
    );
  }
}

// PUT - Add a new notification (called by monitoring service)
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { walletAddress, tokenSymbol, direction, changePercent, currentPrice, currentValue, previousValue } = body;

    if (!walletAddress || !tokenSymbol || !direction) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const notificationFile = getNotificationFile(walletAddress);
    
    let notifications: PendingNotification[] = [];
    if (fs.existsSync(notificationFile)) {
      notifications = JSON.parse(fs.readFileSync(notificationFile, 'utf-8'));
    }

    const newNotification: PendingNotification = {
      walletAddress: walletAddress.toLowerCase(),
      tokenSymbol,
      direction,
      changePercent,
      currentPrice,
      currentValue,
      previousValue,
      timestamp: new Date().toISOString(),
      read: false,
    };

    notifications.push(newNotification);

    // Keep only last 100 notifications
    const sorted = notifications.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    const toKeep = sorted.slice(0, 100);

    // Atomic write
    const tempFile = `${notificationFile}.tmp`;
    try {
      fs.writeFileSync(tempFile, JSON.stringify(toKeep, null, 2), 'utf8');
      fs.renameSync(tempFile, notificationFile);
    } catch (error) {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
      throw error;
    }

    return NextResponse.json({ success: true, notification: newNotification });
  } catch (error: any) {
    console.error('Add notification error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to add notification' },
      { status: 500 }
    );
  }
}

