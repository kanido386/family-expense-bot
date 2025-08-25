// Load environment variables in development
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const fs = require('fs');
const path = require('path');
const ExpenseDatabase = require('../src/database');

function parseHistoricalData(text) {
  const lines = text.trim().split('\n');
  const entries = [];
  let currentDate = null;
  let currentItems = [];

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    // Check if this line is a date (format: 8/4, 8/6, etc.)
    const dateMatch = trimmedLine.match(/^(\d{1,2}\/\d{1,2})$/);
    
    if (dateMatch) {
      // Save previous date's items if any
      if (currentDate && currentItems.length > 0) {
        entries.push({
          date: currentDate,
          items: currentItems,
          timestamp: new Date()
        });
      }
      
      // Start new date
      currentDate = dateMatch[1];
      currentItems = [];
    } else {
      // This should be an item line - try to parse it
      const priceMatch = trimmedLine.match(/^(.+?)\s*(\d+)$/);
      if (priceMatch && currentDate) {
        const itemName = priceMatch[1].trim();
        const price = parseInt(priceMatch[2], 10);
        
        if (itemName && price > 0) {
          currentItems.push({
            name: itemName,
            price: price
          });
        }
      }
    }
  }

  // Don't forget the last date
  if (currentDate && currentItems.length > 0) {
    entries.push({
      date: currentDate,
      items: currentItems,
      timestamp: new Date()
    });
  }

  return entries;
}

async function loadFromFile() {
  try {
    const filePath = path.join(__dirname, '../historical-data.txt');
    
    console.log('🍱 Family Expense Bot - File Data Loader');
    console.log('==========================================');
    console.log(`📂 Reading from: ${filePath}`);
    
    if (!fs.existsSync(filePath)) {
      console.log('❌ File not found! Please create historical-data.txt in the project root.');
      return;
    }

    const historicalData = fs.readFileSync(filePath, 'utf8');
    
    console.log('🚀 Processing your data...');
    
    // Parse the historical data
    const entries = parseHistoricalData(historicalData);
    console.log(`📊 Parsed ${entries.length} date entries`);
    
    if (entries.length === 0) {
      console.log('❌ No valid entries found. Please check your data format.');
      return;
    }
    
    // Show preview of parsed data
    console.log('\n📋 Preview of parsed data:');
    entries.forEach(entry => {
      const total = entry.items.reduce((sum, item) => sum + item.price, 0);
      console.log(`  ${entry.date}: ${entry.items.length} items, total: ${total}`);
    });

    // Summary
    const totalItems = entries.reduce((sum, entry) => sum + entry.items.length, 0);
    const totalAmount = entries.reduce((sum, entry) => sum + entry.items.reduce((itemSum, item) => itemSum + item.price, 0), 0);
    
    console.log(`\n💰 Summary:`);
    console.log(`  Total entries: ${entries.length}`);
    console.log(`  Total items: ${totalItems}`);
    console.log(`  Total amount: ${totalAmount}`);
    
    console.log('\n💾 Saving to database...');
    
    // Create database instance
    const database = new ExpenseDatabase();
    
    // Prepare the complete data structure
    const completeData = {
      entries: entries,
      lastUpdated: new Date()
    };

    // Save directly to the aggregated document
    const docRef = database.db.collection(database.collectionName).doc(database.documentId);
    await docRef.set(completeData);
    
    console.log('✅ Historical data loaded successfully!');
    console.log('🎉 You can now use your LINE bot with all the historical data!');
    console.log('💡 Try typing "查看" in your LINE bot to see all expenses!');
    
  } catch (error) {
    console.error('❌ Error loading historical data:', error);
  }
}

// Run the script
loadFromFile();