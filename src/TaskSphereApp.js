import React, { useState, useEffect } from 'react';
import { Plus, X, Check, Edit2, Trash2, ArrowLeft, Wifi, WifiOff, Download } from 'lucide-react';

// IndexedDB utility functions for offline sync
const DB_NAME = 'TaskSphereDB';
const DB_VERSION = 1;
const STORES = {
  SPHERES: 'spheres',
  PINNED_TASKS: 'pinnedTasks',
  APP_DATA: 'appData'
};

class IndexedDBManager {
  constructor() {
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // Create spheres store
        if (!db.objectStoreNames.contains(STORES.SPHERES)) {
          const spheresStore = db.createObjectStore(STORES.SPHERES, { keyPath: 'id' });
          spheresStore.createIndex('name', 'name', { unique: false });
        }

        // Create pinned tasks store
        if (!db.objectStoreNames.contains(STORES.PINNED_TASKS)) {
          const pinnedStore = db.createObjectStore(STORES.PINNED_TASKS, { keyPath: 'id' });
          pinnedStore.createIndex('sphereName', 'sphereName', { unique: false });
        }

        // Create app data store (for settings, etc.)
        if (!db.objectStoreNames.contains(STORES.APP_DATA)) {
          db.createObjectStore(STORES.APP_DATA, { keyPath: 'key' });
        }
      };
    });
  }

  async saveData(storeName, data) {
    if (!this.db) await this.init();
    
    const transaction = this.db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    
    if (Array.isArray(data)) {
      // Clear store and add all items
      await store.clear();
      for (const item of data) {
        await store.add(item);
      }
    } else {
      await store.put(data);
    }
    
    return transaction.complete;
  }

  async loadData(storeName) {
    if (!this.db) await this.init();
    
    const transaction = this.db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.getAll();
    
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteData(storeName, id) {
    if (!this.db) await this.init();
    
    const transaction = this.db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    await store.delete(id);
    
    return transaction.complete;
  }
}

const dbManager = new IndexedDBManager();

const TaskSphereApp = () => {
  // SaveOfflineTask function inside the component for PWA compatibility
  const saveOfflineTask = async (task) => {
    const DB_NAME = 'TaskSphereDB';
    const DB_VERSION = 1;
    const STORE_NAME = 'offlineTasks';
    
    const openDB = () => {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    };

    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).add(task);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  };

  // ... rest of your TaskSphereApp component code ...

  // For brevity, you should copy the rest of your TaskSphereApp component here,
  // replacing all usages of saveOfflineTask with this local function.

  // At the end, export the component:
  return null; // Placeholder, replace with your actual component JSX
};

export default TaskSphereApp;
