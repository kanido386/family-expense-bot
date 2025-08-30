// Load environment variables in development
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const express = require('express');
const { Client } = require('@line/bot-sdk');
const moment = require('moment-timezone');
const { parseExpenseMessage } = require('./parser');
const ExpenseDatabase = require('./database');

// Check if running as Cloud Function
const isCloudFunction = process.env.FUNCTION_NAME || process.env.K_SERVICE;

let app;
let functionsFramework;

if (isCloudFunction) {
  // Cloud Functions setup
  functionsFramework = require('@google-cloud/functions-framework');
} else {
  // Local Express setup
  app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
}

const port = process.env.PORT || 8080;

// LINE Bot configuration
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

const client = new Client(config);
const database = new ExpenseDatabase();

// Helper function to get date with year for storage, M/D for display  
function getDateInfo() {
  const taipeiTime = moment.tz('Asia/Taipei');
  return {
    storageDate: taipeiTime.format('YYYY-MM-DD'),  // "2024-08-25" for storage
    displayDate: taipeiTime.format('M/D')          // "8/25" for display
  };
}

// Webhook handler function (shared between Express and Cloud Functions)
async function webhookHandler(req, res) {
  try {
    // Handle GET requests (for webhook verification)
    if (req.method === 'GET') {
      res.status(200).send('Family Expense Bot is running!');
      return;
    }

    // Handle POST requests (LINE webhook events)
    if (req.method === 'POST') {
      const events = req.body.events || [];
      
      for (const event of events) {
        if (event.type === 'message' && event.message.type === 'text') {
          await handleTextMessage(event);
        }
      }
      
      res.status(200).send('OK');
      return;
    }

    // Handle other methods
    res.status(405).send('Method Not Allowed');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).send('Internal Server Error');
  }
}

if (isCloudFunction) {
  // Cloud Function HTTP entry point
  functionsFramework.http('lineWebhook', webhookHandler);
} else {
  // Local Express routes
  app.get('/', webhookHandler);
  app.post('/webhook', webhookHandler);
}

async function handleTextMessage(event) {
  const message = event.message.text;
  const replyToken = event.replyToken;
  
  // Check if user wants to view expenses
  if (message.trim() === '查看') {
    await handleViewExpenses(replyToken);
    return;
  }
  
  // Check if user wants to undo last action
  if (message.trim() === '打錯') {
    await handleUndo(replyToken);
    return;
  }
  
  // Parse the message for expenses
  const parseResult = parseExpenseMessage(message);
  
  // If no items found, do nothing (stay silent)
  if (parseResult.items.length === 0) {
    return;
  }
  
  try {
    // Get current date for storage
    const { storageDate } = getDateInfo();
    const currentDate = storageDate;

    // Always reply with confirmation, regardless of database save result
    const total = parseResult.items.reduce((sum, item) => sum + item.price, 0);
    const replyMessage = `✅ 已記錄 ${parseResult.items.length} 項消費，總計：${total}`;
    
    await client.replyMessage(replyToken, {
      type: 'text',
      text: replyMessage
    });
    
    // Try to save to database (but don't fail if it doesn't work)
    try {
      const saveResult = await database.addExpenses(parseResult.items, currentDate);
      if (!saveResult.success) {
        console.error('Failed to save expenses:', saveResult.error);
      }
    } catch (dbError) {
      console.error('Database error (continuing anyway):', dbError.message);
    }
    
  } catch (error) {
    console.error('Error handling message:', error);
  }
}

async function handleViewExpenses(replyToken) {
  try {
    // Get all expenses from database
    const data = await database.getAggregatedExpenses();
    
    if (!data.entries || data.entries.length === 0) {
      await client.replyMessage(replyToken, {
        type: 'text',
        text: '目前沒有記錄'
      });
      return;
    }
    
    // Format expenses in the requested format  
    let formattedText = '';
    for (const entry of data.entries) {
      // Use moment to convert storage format "2024-08-25" to display format "8/25"
      const displayDate = entry.date.includes('-') 
        ? moment(entry.date, 'YYYY-MM-DD').format('M/D')
        : entry.date;
      formattedText += `${displayDate}\n`;
      for (const item of entry.items) {
        formattedText += `${item.name} ${item.price}\n`;
      }
    }
    
    // Remove trailing newline
    formattedText = formattedText.trim();
    
    await client.replyMessage(replyToken, {
      type: 'text',
      text: formattedText
    });
    
  } catch (error) {
    console.error('Error viewing expenses:', error);
    await client.replyMessage(replyToken, {
      type: 'text',
      text: '查看失敗，請稍後再試'
    });
  }
}

async function handleUndo(replyToken) {
  try {
    // Undo the last change
    const undoResult = await database.undoLastChange();
    
    await client.replyMessage(replyToken, {
      type: 'text',
      text: undoResult.message
    });
    
  } catch (error) {
    console.error('Error handling undo:', error);
    await client.replyMessage(replyToken, {
      type: 'text',
      text: '回復失敗，請稍後再試'
    });
  }
}

// Start server (only in local mode)
if (!isCloudFunction) {
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}