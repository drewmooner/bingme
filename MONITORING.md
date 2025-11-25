# Browser Notification Monitoring

This system provides **24/7 server-side monitoring** for price alerts with browser notifications.

## How It Works

1. **Server-Side Monitor** (`scripts/monitorBrowserNotifications.ts`)
   - Runs continuously in the background
   - Monitors all pools where users have alerts enabled
   - Detects swap events and checks price changes
   - Stores notifications in `notifications/` directory

2. **Client-Side Fetcher** (`hooks/useServerNotifications.ts`)
   - Polls `/api/notifications` every 10 seconds
   - Displays browser notifications when new alerts are found
   - Works even when browser tab is in background

3. **Notification API** (`app/api/notifications/route.ts`)
   - Stores pending notifications
   - Returns unread notifications for each wallet
   - Marks notifications as read after display

## Setup

### 1. Start the Server-Side Monitor

Run the monitoring service in a separate terminal:

```bash
npm run monitor-browser
```

Or run it as a background process:

```bash
# Linux/Mac
nohup npm run monitor-browser > monitor.log 2>&1 &

# Windows (PowerShell)
Start-Process npm -ArgumentList "run", "monitor-browser" -WindowStyle Hidden
```

### 2. Environment Variables

Make sure your `.env` file has:

```env
RPC_URL=https://dream-rpc.somnia.network
API_URL=http://localhost:3000  # Your Next.js app URL
```

### 3. Start Your Next.js App

```bash
npm run dev
```

## How It Works Together

1. **User enables alert** → Token added to subscription with baseline price
2. **Server monitor** → Detects swap events, checks price changes
3. **Price threshold met** → Notification stored in `notifications/` directory
4. **Client fetcher** → Polls for notifications every 10 seconds
5. **Browser notification** → Displayed to user automatically

## Features

- ✅ **24/7 Monitoring**: Works even when browser is closed
- ✅ **Background Notifications**: Browser can show notifications even when tab is in background
- ✅ **Deduplication**: Prevents duplicate notifications
- ✅ **History**: Keeps last 100 notifications per wallet
- ✅ **Atomic Writes**: Safe file operations

## Monitoring Status

The monitor will show:
- Number of subscriptions loaded
- Pools being monitored
- Swap events detected
- Notifications queued

## Stopping the Monitor

Press `Ctrl+C` to stop the monitoring service gracefully.

