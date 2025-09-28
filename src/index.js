// Load environment variables in development
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const express = require('express');
const { Client } = require('@line/bot-sdk');
const moment = require('moment-timezone');
const OpenAI = require('openai');
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

// OpenAI configuration (only initialize if API key is available)
let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });
}

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

  // Check if user wants to organize expenses with AI
  if (message.trim() === '整理') {
    await handleOrganizeExpenses(replyToken);
    return;
  }

  // Check if user wants to organize expenses for specific month (整理yyyymm)
  const organizeMonthMatch = message.trim().match(/^整理(\d{6})$/);
  if (organizeMonthMatch) {
    const yearMonth = organizeMonthMatch[1]; // e.g., "202408"
    await handleOrganizeExpenses(replyToken, yearMonth);
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

// Helper function to filter expenses by month
function filterExpensesByMonth(entries, yearMonth) {
  if (!yearMonth) {
    // If no specific month, return current month
    const currentMonth = moment.tz('Asia/Taipei').format('YYYY-MM');
    return entries.filter(entry => entry.date.startsWith(currentMonth));
  } else {
    // Convert yyyymm to YYYY-MM format
    const year = yearMonth.substring(0, 4);
    const month = yearMonth.substring(4, 6);
    const targetMonth = `${year}-${month}`;
    return entries.filter(entry => entry.date.startsWith(targetMonth));
  }
}

// Format expense data for OpenAI prompt
function formatExpensesForAI(filteredEntries) {
  let formattedText = '';

  // Sort entries by date
  const sortedEntries = filteredEntries.sort((a, b) => a.date.localeCompare(b.date));

  for (const entry of sortedEntries) {
    // Convert YYYY-MM-DD to M/D format for display
    const displayDate = moment(entry.date, 'YYYY-MM-DD').format('M/D');
    formattedText += `${displayDate}\n`;

    for (const item of entry.items) {
      formattedText += `${item.name} ${item.price}\n`;
    }
  }

  return formattedText.trim();
}

// Call OpenAI to organize expenses
async function organizeExpensesWithAI(expenseData) {
  const prompt = `參考目前有的分類：
\`\`\`
- 家裡煮
- 生活用品
- 零嘴
- 鮮奶
- 水果
- 保健品
- 機車
- 麵包
（當然你覺得都不合適可以另創分類，但盡可能以上面為主）
\`\`\`

input 會像是：
\`\`\`
7/1
鳳梨 79
奇異果 99
里肌肉 78
空心菜 25
玉米 80
油豆腐 50
絲瓜 30
7/2
里肌肉 75
鯛魚 91
金針菇 29
天婦羅 56
電費(3/18～5/15) 1133
瓦斯 (4/12~6/11) 1032
7/4
地瓜12
7/5
鳳梨 100
南瓜 67
7/6
拉麵 35
洋蔥 100
杏鮑菇 50
黃金奇異果 200
木瓜 73
7/9
鳳梨100
\`\`\`

output 會像是：
\`\`\`
總共 79+99+78+25+80+50+30+75+91+29+56+1133+1032+12+100+67+35+100+50+200+73+100

家裡煮 78+25+80+50+30+75+91+29+56+12+67+35+100+50
7/1   里肌肉   78
7/1   空心菜   25
7/1   玉米  80
7/1   油豆腐   50
7/1   絲瓜  30
7/2   里肌肉   75
7/2   鯛魚   91
7/2   金針菇   29
7/2   天婦羅   56
7/4   地瓜   12
7/5   南瓜   67
7/6   拉麵   35
7/6   洋蔥   100
7/6   杏鮑菇   50

水果 79+99+100+200+73+100
7/1   鳳梨   79
7/1   奇異果   99
7/5   鳳梨   100
7/6   黃金奇異果   200
7/6   木瓜   73
7/9   鳳梨   100

生活用品 1133+1032
7/2   電費(3/18～5/15)   1133
7/2   瓦斯 (4/12~6/11)   1032

-----

2025七月家裡開銷：1133+1032+78+25+80+50+30+75+91+29+56+12+67+35+100+50+79+99+100+200+73+100

由高至低：
生活用品 1133+1032
家裡煮 78+25+80+50+30+75+91+29+56+12+67+35+100+50
水果 79+99+100+200+73+100
\`\`\`

別忘了，output 分類底下的細項需要按照日期來排序

重要：請直接輸出結果，不要用 markdown 格式包裝，不要用 \`\`\` 包圍

接下來，我會提供你新的 input，請根據範例來生成 output

${expenseData}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 2000,
      temperature: 0.1
    });

    return completion.choices[0].message.content;
  } catch (error) {
    console.error('OpenAI API error:', error);
    throw error;
  }
}

async function handleOrganizeExpenses(replyToken, yearMonth = null) {
  try {
    // Get expense data
    const data = await database.getAggregatedExpenses();

    if (!data || !data.entries || data.entries.length === 0) {
      await client.replyMessage(replyToken, {
        type: 'text',
        text: '目前沒有記帳資料可以整理'
      });
      return;
    }

    // Filter expenses by month
    const filteredEntries = filterExpensesByMonth(data.entries, yearMonth);

    if (filteredEntries.length === 0) {
      const monthText = yearMonth ? `${yearMonth.substring(0, 4)}年${parseInt(yearMonth.substring(4, 6))}月` : '本月';
      await client.replyMessage(replyToken, {
        type: 'text',
        text: `${monthText}沒有記帳資料可以整理`
      });
      return;
    }

    // Check if OpenAI API key is available
    if (!openai) {
      const monthText = yearMonth ? `${yearMonth.substring(0, 4)}年${parseInt(yearMonth.substring(4, 6))}月` : '本月';
      const totalItems = filteredEntries.reduce((sum, entry) => sum + entry.items.length, 0);

      await client.replyMessage(replyToken, {
        type: 'text',
        text: `🤖 準備整理${monthText}的記帳資料...\n找到 ${filteredEntries.length} 天，共 ${totalItems} 筆消費\n\n⚠️ OpenAI API 尚未設定，請聯絡管理員`
      });
      return;
    }

    // Format data for OpenAI
    const formattedData = formatExpensesForAI(filteredEntries);

    // Call OpenAI to organize expenses
    const organizedResult = await organizeExpensesWithAI(formattedData);

    // Send the organized result
    await client.replyMessage(replyToken, {
      type: 'text',
      text: organizedResult
    });

  } catch (error) {
    console.error('Error organizing expenses:', error);
    await client.replyMessage(replyToken, {
      type: 'text',
      text: '整理失敗，請稍後再試'
    });
  }
}

// Start server (only in local mode)
if (!isCloudFunction) {
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}