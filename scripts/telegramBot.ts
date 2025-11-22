import * as fs from 'fs';
import * as path from 'path';
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

const BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_API = 'https://api.telegram.org/bot';

if (!BOT_TOKEN) {
  throw new Error('BOT_TOKEN not found in .env file');
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

async function getUpdates(offset?: number): Promise<TelegramUpdate[]> {
  try {
    const url = `${TELEGRAM_API}${BOT_TOKEN}/getUpdates${offset ? `?offset=${offset}` : ''}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data.result || [];
  } catch (error: any) {
    console.error('Error fetching updates:', error.message);
    return [];
  }
}

async function sendMessage(chatId: number, text: string): Promise<void> {
  try {
    const url = `${TELEGRAM_API}${BOT_TOKEN}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
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
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data.result;
  } catch (error: any) {
    console.error('Error getting bot info:', error.message);
    return null;
  }
}

async function runBot() {
  console.log('🤖 Starting Telegram Bot\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Get bot info
  const botInfo = await getMe();
  if (botInfo) {
    console.log(`Bot Username: @${botInfo.username}`);
    console.log(`Bot Name: ${botInfo.first_name}`);
    console.log(`Bot ID: ${botInfo.id}\n`);
  }

  console.log('📱 Bot is ready!');
  console.log('💬 Send a message to your bot to get your Chat ID');
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
          const chatType = message.chat.type;
          const userName = message.from.first_name;
          const userUsername = message.from.username;
          const text = message.text || '';

          console.log(`\n📨 New message received:`);
          console.log(`   From: ${userName}${userUsername ? ` (@${userUsername})` : ''}`);
          console.log(`   Chat ID: <b>${chatId}</b>`);
          console.log(`   Chat Type: ${chatType}`);
          console.log(`   Message: ${text}`);

          // Send response with chat ID
          let responseText = `👋 Hello ${userName}!\n\n`;
          responseText += `📋 <b>Your Chat Information:</b>\n`;
          responseText += `   Chat ID: <code>${chatId}</code>\n`;
          responseText += `   Chat Type: ${chatType}\n`;
          responseText += `   Your Name: ${userName}\n`;
          
          if (userUsername) {
            responseText += `   Username: @${userUsername}\n`;
          }

          if (chatType === 'group' || chatType === 'supergroup') {
            responseText += `\n💡 <b>Group Chat Detected!</b>\n`;
            responseText += `   Use this Chat ID for group notifications.\n`;
          } else {
            responseText += `\n💡 <b>Private Chat</b>\n`;
            responseText += `   Use this Chat ID for personal notifications.\n`;
          }

          responseText += `\n📝 To subscribe, run:\n`;
          responseText += `   <code>npm run subscribe-user YOUR_WALLET ${chatId}</code>`;

          await sendMessage(chatId, responseText);
          console.log(`   ✅ Response sent to chat ${chatId}`);
        }
      }

      // Wait 1 second before checking for new updates
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error: any) {
      console.error('Error in bot loop:', error.message);
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

