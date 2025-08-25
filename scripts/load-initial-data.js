// Load environment variables in development
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const readline = require('readline');
const ExpenseDatabase = require('../src/database');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

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

async function getUserInput() {
  console.log('🍱 Family Expense Bot - Initial Data Loader');
  console.log('================================================');
  console.log('Please paste your historical expense data in this format:');
  console.log('8/4');
  console.log('鮮奶 255');
  console.log('8/6');
  console.log('紅蘿蔔 29');
  console.log('地瓜 130');
  console.log('...');
  console.log('');
  console.log('When finished, type "END" on a new line and press Enter:');
  console.log('');

  return new Promise((resolve) => {
    const lines = [];
    
    rl.on('line', (input) => {
      if (input.trim().toUpperCase() === 'END') {
        resolve(lines.join('\n'));
      } else {
        lines.push(input);
      }
    });
  });
}

async function loadInitialData() {
  try {
    // Get input from user
    const historicalData = await getUserInput();
    
    if (!historicalData.trim()) {
      console.log('❌ No data provided. Exiting...');
      rl.close();
      return;
    }

    console.log('\n🚀 Processing your data...');
    
    // Parse the historical data
    const entries = parseHistoricalData(historicalData);
    console.log(`📊 Parsed ${entries.length} date entries`);
    
    if (entries.length === 0) {
      console.log('❌ No valid entries found. Please check your data format.');
      rl.close();
      return;
    }
    
    // Show preview of parsed data
    console.log('\n📋 Preview of parsed data:');
    entries.forEach(entry => {
      const total = entry.items.reduce((sum, item) => sum + item.price, 0);
      console.log(`  ${entry.date}: ${entry.items.length} items, total: ${total}`);
    });

    // Ask for confirmation
    const totalItems = entries.reduce((sum, entry) => sum + entry.items.length, 0);
    const totalAmount = entries.reduce((sum, entry) => sum + entry.items.reduce((itemSum, item) => itemSum + item.price, 0), 0);
    
    console.log(`\n💰 Summary:`);
    console.log(`  Total entries: ${entries.length}`);
    console.log(`  Total items: ${totalItems}`);
    console.log(`  Total amount: ${totalAmount}`);
    
    rl.question('\nDo you want to save this data to the database? (yes/no): ', async (answer) => {
      if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
        try {
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
          
          console.log('✅ Initial data loaded successfully!');
          console.log('🎉 You can now use your LINE bot with all the historical data!');
          
        } catch (error) {
          console.error('❌ Error saving to database:', error);
        }
      } else {
        console.log('❌ Data not saved. Exiting...');
      }
      
      rl.close();
    });
    
  } catch (error) {
    console.error('❌ Error loading initial data:', error);
    rl.close();
  }
}

// Run the script
loadInitialData();