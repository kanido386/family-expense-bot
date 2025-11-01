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

// Format expense data for OpenAI prompt with structured JSON
function formatExpensesForAI(filteredEntries, yearMonth = null) {
  // Sort entries by date
  const sortedEntries = filteredEntries.sort((a, b) => a.date.localeCompare(b.date));

  // Create structured data with item IDs for tracking
  const structuredData = [];
  let itemId = 1;

  for (const entry of sortedEntries) {
    const displayDate = moment(entry.date, 'YYYY-MM-DD').format('M/D');

    for (const item of entry.items) {
      structuredData.push({
        id: itemId++,
        date: displayDate,
        name: item.name,
        price: item.price
      });
    }
  }

  // Determine year and month for display
  let year, monthNum, monthText;
  if (yearMonth) {
    year = yearMonth.substring(0, 4);
    monthNum = parseInt(yearMonth.substring(4, 6));
    monthText = `${year}年${monthNum}月`;
  } else {
    const now = moment.tz('Asia/Taipei');
    year = now.format('YYYY');
    monthNum = parseInt(now.format('M'));
    monthText = `${year}年${monthNum}月`;
  }

  return {
    items: structuredData,
    totalCount: structuredData.length,
    totalAmount: structuredData.reduce((sum, item) => sum + item.price, 0),
    year: year,
    monthNum: monthNum,
    monthText: monthText
  };
}

// Call OpenAI to organize expenses (returns structured JSON for validation)
async function organizeExpensesWithAI(expenseData) {
  const { items, totalCount, totalAmount, year, monthNum, monthText } = expenseData;

  // Create numbered list for easy verification
  const itemsList = items.map(item => `#${item.id}: ${item.date} ${item.name} ${item.price}`).join('\n');

  const prompt = `你是一個記帳分類專家。請為每個項目分配一個類別，並以JSON格式返回。

【輸入資料】
共 ${totalCount} 個項目：
${itemsList}

【分類規則】（每個項目只能分到一個類別）
1. 鮮奶：所有鮮奶相關產品
2. 水果：各種水果（但不包括蔬菜）
3. 麵包：麵包、饅頭
4. 零嘴：餅乾、飲料、冰棒、點心、可樂
5. 保健品：營養品、起司片、南瓜籽油
6. 機車：加油、維修
7. 生活用品：清潔用品、衛生紙、電費、瓦斯費、祭品、小配菜（如香菜）
8. 家裡煮：所有食材（肉類、蔬菜、海鮮、雞蛋、調料、湯品等）

【輸出格式】
請返回JSON object，包含一個items array：
{
  "items": [
    {"id": 項目編號, "category": "類別名稱"},
    ...
  ]
}

【範例】
如果輸入是：
#1: 7/1 鳳梨 79
#2: 7/2 里肌肉 75
#3: 7/3 鮮奶 100

則返回：
{
  "items": [
    {"id": 1, "category": "水果"},
    {"id": 2, "category": "家裡煮"},
    {"id": 3, "category": "鮮奶"}
  ]
}

【重要】
- 必須為全部 ${totalCount} 個項目分類
- 每個項目只能分到一個類別
- 返回JSON object with items array
- 確保JSON格式正確

請開始分類：`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "你是一個記帳分類專家。請仔細為每個項目分配正確的類別。每個項目只能分到一個類別。以JSON格式返回結果。"
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1
    });

    const aiResponse = completion.choices[0].message.content;

    // Parse JSON response
    let categorization;
    try {
      const parsed = JSON.parse(aiResponse);
      // Handle both array and object with array property
      categorization = Array.isArray(parsed) ? parsed : (parsed.categories || parsed.items || []);
    } catch (parseError) {
      console.error('Failed to parse AI response:', aiResponse);
      throw new Error('AI returned invalid JSON');
    }

    // Validate we have all items
    if (categorization.length !== totalCount) {
      console.warn(`⚠️ AI returned ${categorization.length} items, expected ${totalCount}`);
    }

    // Build categorized items map
    const categorizedItems = {};
    for (const cat of categorization) {
      const item = items.find(i => i.id === cat.id);
      if (!item) {
        console.warn(`⚠️ Unknown item ID: ${cat.id}`);
        continue;
      }

      const category = cat.category;
      if (!categorizedItems[category]) {
        categorizedItems[category] = [];
      }
      categorizedItems[category].push(item);
    }

    // Calculate totals and sort categories by total amount
    const categoryTotals = {};
    for (const [category, catItems] of Object.entries(categorizedItems)) {
      const total = catItems.reduce((sum, item) => sum + item.price, 0);
      categoryTotals[category] = { items: catItems, total };
    }

    // Sort categories by total (descending)
    const sortedCategories = Object.entries(categoryTotals)
      .sort((a, b) => b[1].total - a[1].total);

    // Format output
    let output = '';

    // First line with all amounts
    const allPrices = items.map(i => i.price).join('+');
    output += `總共 ${allPrices}=${totalAmount}\n\n`;

    // Each category section
    for (const [category, data] of sortedCategories) {
      const prices = data.items.map(i => i.price).join('+');
      const total = data.total;
      output += `${category} ${prices}=${total}\n`;

      for (const item of data.items) {
        output += `${item.date}   ${item.name}   ${item.price}\n`;
      }
      output += '\n';
    }

    output += '-----\n\n';
    output += `${monthText}家裡開銷：${totalAmount}\n\n`;
    output += '由高至低：\n';

    for (const [category, data] of sortedCategories) {
      output += `${category} ${data.total}\n`;
    }

    return output;
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
    const formattedData = formatExpensesForAI(filteredEntries, yearMonth);

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