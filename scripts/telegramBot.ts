import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_API = 'https://api.telegram.org/bot';

if (!BOT_TOKEN || BOT_TOKEN === 'your_telegram_bot_token_here' || BOT_TOKEN.trim() === '') {
  // Exit silently if token not configured
  process.exit(0);
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: {
      id: number;
      is_bot: boolean;
      first_name: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
      title?: string;
      username?: string;
      first_name?: string;
    };
    date: number;
    text?: string;
  };
}

interface UserSubscription {
  walletAddress: string;
  chatId?: string;
  notificationPermission?: 'granted' | 'denied' | 'default';
  tokens: Record<string, any>;
  subscribedPools?: string[];
  createdAt: string;
  updatedAt: string;
}

// Store user states (waiting for wallet address)
const userStates = new Map<number, 'waiting_for_wallet'>();

async function getUpdates(offset?: number): Promise<TelegramUpdate[]> {
  try {
    const url = `${TELEGRAM_API}${BOT_TOKEN}/getUpdates${offset ? `?offset=${offset}` : ''}`;
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 404 || response.status === 401) {
        // Invalid token - exit cleanly without error
        process.exit(0);
      }
      // Other errors - return empty array and continue
      return [];
    }
    const data = await response.json();
    if (!data.ok) {
      return [];
    }
    return data.result || [];
  } catch (error: any) {
    // Silently handle errors - return empty array
    return [];
  }
}

async function sendMessage(chatId: number, text: string, parseMode: 'HTML' | 'Markdown' = 'HTML'): Promise<void> {
  try {
    const url = `${TELEGRAM_API}${BOT_TOKEN}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: parseMode,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.description || 'Failed to send message');
    }
  } catch (error: any) {
    console.error(`Error sending message: ${error.message}`);
  }
}

async function getMe(): Promise<any> {
  try {
    const url = `${TELEGRAM_API}${BOT_TOKEN}/getMe`;
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 404 || response.status === 401) {
        // Invalid token - exit silently
        process.exit(0);
      }
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    if (!data.ok) {
      throw new Error(data.description || 'Failed to get bot info');
    }
    return data.result;
  } catch (error: any) {
    // Already handled above, just return null
    return null;
  }
}

function getSubscriptionFile(walletAddress: string): string {
  const subscriptionsDir = path.join(__dirname, '../subscriptions');
  if (!fs.existsSync(subscriptionsDir)) {
    fs.mkdirSync(subscriptionsDir, { recursive: true });
  }
  return path.join(subscriptionsDir, `${walletAddress.toLowerCase()}.json`);
}

function loadSubscription(walletAddress: string): UserSubscription | null {
  const subscriptionFile = getSubscriptionFile(walletAddress);
  
  if (!fs.existsSync(subscriptionFile)) {
    return null;
  }

  try {
    const data = JSON.parse(fs.readFileSync(subscriptionFile, 'utf-8'));
    return data;
  } catch (error) {
    console.error(`Error loading subscription for ${walletAddress}:`, error);
    return null;
  }
}

function saveSubscription(subscription: UserSubscription): void {
  const subscriptionFile = getSubscriptionFile(subscription.walletAddress);
  subscription.updatedAt = new Date().toISOString();
  
  // Atomic write
  const tempFile = `${subscriptionFile}.tmp`;
  try {
    fs.writeFileSync(tempFile, JSON.stringify(subscription, null, 2), 'utf8');
    fs.renameSync(tempFile, subscriptionFile);
  } catch (error) {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
    throw error;
  }
}

function createNewSubscription(walletAddress: string, chatId: string): UserSubscription {
  return {
    walletAddress: walletAddress.toLowerCase(),
    chatId: chatId,
    notificationPermission: 'granted', // Telegram users automatically grant permission
    tokens: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function isValidWalletAddress(address: string): boolean {
  try {
    return ethers.isAddress(address);
  } catch {
    return false;
  }
}

async function handleStartCommand(chatId: number, userName: string): Promise<void> {
  const welcomeMessage = `👋 <b>Welcome to Bingme Portfolio Bot, ${userName}!</b>\n\n` +
    `I'm here to help you track your token prices and get notified when they move.\n\n` +
    `📋 <b>What I can do:</b>\n` +
    `   • Link your wallet to receive Telegram notifications\n` +
    `   • Alert you when your tokens hit price thresholds\n` +
    `   • Keep you updated on your portfolio value changes\n\n` +
    `🔗 <b>To get started, please send me your wallet address.</b>\n\n` +
    `Example: <code>0x1234567890123456789012345678901234567890</code>`;

  await sendMessage(chatId, welcomeMessage);
  userStates.set(chatId, 'waiting_for_wallet');
}

async function handleWalletAddress(chatId: number, walletAddress: string, userName: string): Promise<void> {
  // Validate wallet address
  if (!isValidWalletAddress(walletAddress)) {
    await sendMessage(
      chatId,
      `❌ <b>Invalid wallet address!</b>\n\n` +
      `Please send a valid Ethereum wallet address.\n\n` +
      `Example: <code>0x1234567890123456789012345678901234567890</code>`
    );
    return;
  }

  const normalizedAddress = walletAddress.toLowerCase();
  const chatIdString = chatId.toString();

  // Load existing subscription or create new one
  let subscription = loadSubscription(normalizedAddress);

  if (subscription) {
    // Update existing subscription with chat ID
    subscription.chatId = chatIdString;
    subscription.updatedAt = new Date().toISOString();
    
    // Check if user already has tokens with alerts
    const activeAlerts = Object.values(subscription.tokens || {}).filter(
      (token: any) => token.alertEnabled === true
    ).length;

    saveSubscription(subscription);

    let responseMessage = `✅ <b>Wallet linked successfully!</b>\n\n` +
      `📝 <b>Wallet:</b> <code>${normalizedAddress}</code>\n` +
      `💬 <b>Telegram Chat ID:</b> <code>${chatIdString}</code>\n\n`;

    if (activeAlerts > 0) {
      responseMessage += `🔔 You have <b>${activeAlerts}</b> active alert(s) configured.\n` +
        `You'll receive notifications when your tokens hit price thresholds!\n\n`;
    } else {
      responseMessage += `💡 <b>Next steps:</b>\n` +
        `1. Go to your Bingme Portfolio app\n` +
        `2. Connect your wallet\n` +
        `3. Enable alerts on tokens you want to track\n` +
        `4. You'll receive Telegram notifications when prices move!\n\n`;
    }

    responseMessage += `🎉 You're all set! I'll notify you when your tokens move.`;

    await sendMessage(chatId, responseMessage);
  } else {
    // Create new subscription
    subscription = createNewSubscription(normalizedAddress, chatIdString);
    saveSubscription(subscription);

    const responseMessage = `✅ <b>Welcome to Bingme Portfolio!</b>\n\n` +
      `📝 <b>Wallet:</b> <code>${normalizedAddress}</code>\n` +
      `💬 <b>Telegram Chat ID:</b> <code>${chatIdString}</code>\n\n` +
      `🎉 Your wallet has been registered!\n\n` +
      `💡 <b>Next steps:</b>\n` +
      `1. Go to your Bingme Portfolio app\n` +
      `2. Connect your wallet (${normalizedAddress})\n` +
      `3. Enable alerts on tokens you want to track\n` +
      `4. You'll receive Telegram notifications when prices move!\n\n` +
      `🔔 I'll notify you whenever your token prices hit the thresholds you set.`;

    await sendMessage(chatId, responseMessage);
  }

  // Clear user state
  userStates.delete(chatId);

  console.log(`✅ Linked wallet ${normalizedAddress} to Telegram chat ${chatIdString}`);
}

async function handleMessage(chatId: number, text: string, userName: string): Promise<void> {
  const state = userStates.get(chatId);

  // Check if user is waiting for wallet address
  if (state === 'waiting_for_wallet') {
    await handleWalletAddress(chatId, text.trim(), userName);
    return;
  }

  // Check for commands
  if (text.startsWith('/')) {
    const command = text.split(' ')[0].toLowerCase();
    
    switch (command) {
      case '/start':
        await handleStartCommand(chatId, userName);
        break;
      case '/help':
        await sendMessage(
          chatId,
          `📚 <b>Bingme Portfolio Bot Commands:</b>\n\n` +
          `/<b>start</b> - Start the bot and link your wallet\n` +
          `/<b>help</b> - Show this help message\n\n` +
          `💡 <b>How it works:</b>\n` +
          `1. Use /start to link your wallet\n` +
          `2. Enable alerts in the Bingme Portfolio app\n` +
          `3. Receive Telegram notifications when prices move!\n\n` +
          `🔔 You'll get notified when your tokens hit price thresholds.`
        );
        break;
      default:
        await sendMessage(
          chatId,
          `❓ Unknown command. Use /start to link your wallet or /help for more info.`
        );
    }
    return;
  }

  // If message looks like a wallet address, try to process it
  if (text.trim().startsWith('0x') && text.trim().length === 42) {
    await handleWalletAddress(chatId, text.trim(), userName);
    return;
  }

  // Default response
  await sendMessage(
    chatId,
    `👋 Hi ${userName}!\n\n` +
    `Use /start to link your wallet and get started with price alerts.\n` +
    `Or use /help to see all available commands.`
  );
}

async function runBot() {
  console.log('🤖 Starting Bingme Portfolio Telegram Bot\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Get bot info - if invalid token, getMe will exit cleanly
  const botInfo = await getMe();
  if (!botInfo) {
    // Token is invalid, already exited
    return;
  }
  
  console.log(`Bot Username: @${botInfo.username}`);
  console.log(`Bot Name: ${botInfo.first_name}`);
  console.log(`Bot ID: ${botInfo.id}\n`);

  console.log('📱 Bot is ready!');
  console.log('💬 Users can now use /start to link their wallets');
  console.log('⏹️  Press Ctrl+C to stop\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  let lastUpdateId = 0;

  while (true) {
    try {
      const updates = await getUpdates(lastUpdateId > 0 ? lastUpdateId + 1 : undefined);

      for (const update of updates) {
        if (update.update_id >= lastUpdateId) {
          lastUpdateId = update.update_id;
        }

        if (update.message) {
          const { message } = update;
          const chatId = message.chat.id;
          const userName = message.from.first_name;
          const text = message.text || '';

          console.log(`\n📨 New message:`);
          console.log(`   From: ${userName} (Chat ID: ${chatId})`);
          console.log(`   Message: ${text}`);

          await handleMessage(chatId, text, userName);
        }
      }

      // Wait 1 second before checking for new updates
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error: any) {
      // Silently handle errors - continue polling
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n🛑 Stopping bot...');
  console.log('✅ Bot stopped. Goodbye!');
  process.exit(0);
});

runBot().catch((error) => {
  console.error('❌ Bot error:', error);
  process.exit(1);
});
