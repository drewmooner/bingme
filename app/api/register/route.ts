import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

interface UserSubscription {
  walletAddress: string;
  notificationPermission: 'granted' | 'denied' | 'default';
  tokens: Record<string, {
    address: string;
    symbol: string;
    alertEnabled: boolean;
    thresholdUp?: number;
    thresholdDown?: number;
    poolAddress: string | null;
  }>;
  createdAt: string;
  updatedAt: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { walletAddress, notificationPermission } = body;

    if (!walletAddress) {
      return NextResponse.json(
        { error: 'Wallet address is required' },
        { status: 400 }
      );
    }

    const subscriptionsDir = path.join(process.cwd(), 'subscriptions');
    if (!fs.existsSync(subscriptionsDir)) {
      fs.mkdirSync(subscriptionsDir, { recursive: true });
    }

    const subscriptionFile = path.join(
      subscriptionsDir,
      `${walletAddress.toLowerCase()}.json`
    );

    // Check if subscription already exists
    if (fs.existsSync(subscriptionFile)) {
      // Read existing subscription to preserve data
      const existing = JSON.parse(fs.readFileSync(subscriptionFile, 'utf-8'));
      return NextResponse.json({ success: true, subscription: existing });
    }

    const subscription: UserSubscription = {
      walletAddress: walletAddress.toLowerCase(),
      notificationPermission: notificationPermission || 'default',
      tokens: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Atomic write: write to temp file first, then rename
    const tempFile = `${subscriptionFile}.tmp`;
    try {
      fs.writeFileSync(tempFile, JSON.stringify(subscription, null, 2), 'utf8');
      fs.renameSync(tempFile, subscriptionFile);
    } catch (error) {
      // Clean up temp file if rename fails
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
      throw error;
    }

    return NextResponse.json({ success: true, subscription });
  } catch (error: any) {
    console.error('Registration error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to register user' },
      { status: 500 }
    );
  }
}

