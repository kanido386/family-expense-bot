const { Firestore } = require('@google-cloud/firestore');

class ExpenseDatabase {
  constructor() {
    this.db = new Firestore();
    this.collectionName = 'expenses';
    this.documentId = 'aggregated'; // Single document for all expenses
    this.backupDocumentId = 'backup'; // Backup document for undo
  }

  async addExpenses(items, date) {
    try {
      const docRef = this.db.collection(this.collectionName).doc(this.documentId);
      const backupRef = this.db.collection(this.collectionName).doc(this.backupDocumentId);
      const doc = await docRef.get();
      
      let currentData = { entries: [] };
      if (doc.exists) {
        currentData = doc.data();
      }
      
      // Always create backup before making changes (even if empty)
      await backupRef.set({
        ...currentData,
        backupTime: new Date()
      });

      // Find existing entry for this date
      let existingEntryIndex = currentData.entries.findIndex(entry => entry.date === date);
      
      if (existingEntryIndex !== -1) {
        // Merge items with existing entry for the same date
        currentData.entries[existingEntryIndex].items.push(...items);
        currentData.entries[existingEntryIndex].timestamp = new Date();
      } else {
        // Create new entry for this date
        const newEntry = {
          date: date,
          items: items,
          timestamp: new Date()
        };
        currentData.entries.push(newEntry);
      }
      
      currentData.lastUpdated = new Date();

      await docRef.set(currentData);
      
      return {
        success: true,
        totalItems: items.length,
        total: items.reduce((sum, item) => sum + item.price, 0)
      };
    } catch (error) {
      console.error('Error adding expenses:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async getAggregatedExpenses() {
    try {
      const docRef = this.db.collection(this.collectionName).doc(this.documentId);
      const doc = await docRef.get();
      
      if (!doc.exists) {
        return { entries: [] };
      }
      
      return doc.data();
    } catch (error) {
      console.error('Error getting expenses:', error);
      throw error;
    }
  }

  formatAggregatedText(data) {
    if (!data.entries || data.entries.length === 0) {
      return '目前沒有記錄';
    }

    let result = '';
    for (const entry of data.entries) {
      result += `${entry.date}\n`;
      for (const item of entry.items) {
        result += `${item.name} ${item.price}\n`;
      }
    }
    
    return result.trim();
  }

  async undoLastChange() {
    try {
      const docRef = this.db.collection(this.collectionName).doc(this.documentId);
      const backupRef = this.db.collection(this.collectionName).doc(this.backupDocumentId);
      const backupDoc = await backupRef.get();
      
      if (!backupDoc.exists) {
        return {
          success: false,
          message: '沒有可以回復的記錄'
        };
      }
      
      // Restore from backup
      const backupData = backupDoc.data();
      // Remove backup metadata before restoring
      const { backupTime, ...dataToRestore } = backupData;
      dataToRestore.lastUpdated = new Date();
      
      await docRef.set(dataToRestore);
      
      return {
        success: true,
        message: '已回復到上一個狀態'
      };
    } catch (error) {
      console.error('Error undoing last change:', error);
      return {
        success: false,
        message: '回復失敗，請稍後再試'
      };
    }
  }
}

module.exports = ExpenseDatabase;