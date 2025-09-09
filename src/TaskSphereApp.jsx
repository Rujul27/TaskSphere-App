import React, { useState, useEffect } from 'react';
import { Plus, X, Check, Edit2, Trash2, ArrowLeft, Wifi, WifiOff, Download } from 'lucide-react';

// IndexedDB utility functions for offline sync
// saveOfwhy  is now defined locally for PWA compatibility
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

// Add Task Modal - Moved outside TaskSphereApp component
const AddTaskModal = ({ 
  showAddTask, 
  setShowAddTask, 
  selectedSphere, 
  setSpheres, 
  setPinnedTasks, 
  isOnline,
  setShowMoveTask 
}) => {
  const [step, setStep] = useState('type');
  const [taskType, setTaskType] = useState('');
  const [taskName, setTaskName] = useState('');
  const [priority, setPriority] = useState(1);
  const [pinToFront, setPinToFront] = useState(false);
  const [reminderFreq, setReminderFreq] = useState('none');
  const [groupName, setGroupName] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('');
  const [selectedTasks, setSelectedTasks] = useState([]);
  const [isSubgroup, setIsSubgroup] = useState(false);

  const resetModal = () => {
    setStep('type');
    setTaskType('');
    setTaskName('');
    setPriority(1);
    setPinToFront(false);
    setReminderFreq('none');
    setGroupName('');
    setSelectedGroup('');
    setSelectedTasks([]);
    setIsSubgroup(false);
    setShowAddTask(false);
  };

  const handleAddTask = async () => {
    if (taskType === 'task' && taskName.trim()) {
      const newTask = {
        id: Date.now(),
        name: taskName,
        priority,
        completed: false,
        createdAt: new Date().toISOString(),
        pinToFront,
        reminderFreq,
        group: selectedGroup || 'unassigned',
        sphereName: selectedSphere?.name || ''
      };

      if (!isOnline) {
        // Save to offline tasks store for background sync
        try {
          await saveOfflineTask(newTask);
          // Register background sync
          if ('serviceWorker' in navigator && 'SyncManager' in window) {
            navigator.serviceWorker.ready.then(reg => {
              reg.sync.register('background-task-sync');
            });
          }
        } catch (e) {
          console.error('Failed to save offline task:', e);
        }
      }

      setSpheres(prev => prev.map(sphere => 
        sphere.id === selectedSphere.id 
          ? { ...sphere, tasks: [...sphere.tasks, newTask] }
          : sphere
      ));

      if (pinToFront) {
        setPinnedTasks(prev => [...prev, { ...newTask, sphereName: selectedSphere.name }]);
      }

      resetModal();
    }
  };

  const handleAddGroup = () => {
    if (groupName.trim()) {
      const newGroup = {
        id: Date.now(),
        name: groupName,
        subgroups: [],
        parentGroup: isSubgroup ? selectedGroup : null,
        createdAt: new Date().toISOString()
      };

      setSpheres(prev => prev.map(sphere => {
        if (sphere.id === selectedSphere.id) {
          const updatedSphere = { ...sphere };
          
          updatedSphere.tasks = updatedSphere.tasks.map(task => 
            selectedTasks.includes(task.id) 
              ? { ...task, group: groupName }
              : task
          );

          if (isSubgroup) {
            updatedSphere.groups = updatedSphere.groups.map(group => 
              group.name === selectedGroup 
                ? { ...group, subgroups: [...(group.subgroups || []), newGroup] }
                : group
            );
          } else {
            updatedSphere.groups = [...(updatedSphere.groups || []), newGroup];
          }

          return updatedSphere;
        }
        return sphere;
      }));

      resetModal();
    }
  };

  const getAvailableTasks = () => {
    if (!selectedSphere || !selectedSphere.tasks) return [];
    
    if (isSubgroup && selectedGroup) {
      return selectedSphere.tasks.filter(task => task.group === selectedGroup);
    }
    return selectedSphere.tasks.filter(task => task.group === 'unassigned' || !task.group);
  };

  if (!showAddTask) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded-2xl shadow-xl w-96 max-h-[80vh] overflow-y-auto">
        <h3 className="text-xl font-semibold mb-4">Add to {selectedSphere?.name}</h3>
        
        {!isOnline && (
          <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-yellow-800 text-sm">You're offline. Changes will sync when online.</p>
          </div>
        )}
        
        {step === 'type' && (
          <div className="space-y-3">
            <button
              onClick={() => {
                setTaskType('task');
                setStep('task-details');
              }}
              className="w-full p-3 border border-gray-200 rounded-lg hover:bg-blue-50 text-left"
            >
              Add Task
            </button>
            <button
              onClick={() => {
                setTaskType('group');
                setStep('group-choice');
              }}
              className="w-full p-3 border border-gray-200 rounded-lg hover:bg-blue-50 text-left"
            >
              Add Group
            </button>
            <button
              onClick={resetModal}
              className="w-full p-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
            >
              Cancel
            </button>
          </div>
        )}

        {step === 'group-choice' && (
          <div className="space-y-3">
            <button
              onClick={() => {
                setIsSubgroup(false);
                setStep('group-details');
              }}
              className="w-full p-3 border border-gray-200 rounded-lg hover:bg-blue-50 text-left"
            >
              Create New Group
            </button>
            {selectedSphere?.groups && selectedSphere.groups.length > 0 && (
              <button
                onClick={() => {
                  setIsSubgroup(true);
                  setStep('group-details');
                }}
                className="w-full p-3 border border-gray-200 rounded-lg hover:bg-blue-50 text-left"
              >
                Create Subgroup
              </button>
            )}
            <button
              onClick={() => setStep('type')}
              className="w-full p-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
            >
              Back
            </button>
          </div>
        )}

        {step === 'task-details' && (
          <div className="space-y-4">
            <input
              type="text"
              placeholder="Task name"
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
              className="w-full p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
              autoFocus
            />
            
            <div>
              <label className="block text-sm font-medium mb-2">Priority Level</label>
              <select
                value={priority}
                onChange={(e) => setPriority(parseInt(e.target.value))}
                className="w-full p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
              >
                <option value={1}>Level 1 (3 days)</option>
                <option value={2}>Level 2 (1 day)</option>
                <option value={3}>Level 3 (hourly)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Reminder Frequency</label>
              <select
                value={reminderFreq}
                onChange={(e) => setReminderFreq(e.target.value)}
                className="w-full p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
              >
                <option value="none">No reminders</option>
                <option value="1-2-day">1-2 times a day</option>
                <option value="5-7-day">5-7 times a day</option>
                <option value="5-7-week">5-7 times a week</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Group</label>
              <select
                value={selectedGroup}
                onChange={(e) => setSelectedGroup(e.target.value)}
                className="w-full p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
              >
                <option value="">Unassigned</option>
                {selectedSphere?.groups?.map(group => (
                  <option key={group.id} value={group.name}>{group.name}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="pinToFront"
                checked={pinToFront}
                onChange={(e) => setPinToFront(e.target.checked)}
                className="w-4 h-4 text-blue-600"
              />
              <label htmlFor="pinToFront" className="text-sm">Pin to front dashboard</label>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleAddTask}
                disabled={!taskName.trim()}
                className="flex-1 bg-blue-400 text-white p-3 rounded-lg hover:bg-blue-500 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                Add Task
              </button>
              <button
                onClick={() => setStep('type')}
                className="flex-1 bg-gray-200 text-gray-700 p-3 rounded-lg hover:bg-gray-300"
              >
                Back
              </button>
            </div>
          </div>
        )}

        {step === 'group-details' && (
          <div className="space-y-4">
            <input
              type="text"
              placeholder={`${isSubgroup ? 'Subgroup' : 'Group'} name`}
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              className="w-full p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
              autoFocus
            />

            {isSubgroup && (
              <div>
                <label className="block text-sm font-medium mb-2">Parent Group</label>
                <select
                  value={selectedGroup}
                  onChange={(e) => setSelectedGroup(e.target.value)}
                  className="w-full p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
                >
                  <option value="">Select parent group</option>
                  {selectedSphere?.groups?.map(group => (
                    <option key={group.id} value={group.name}>{group.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-2">
                Add Tasks to {isSubgroup ? 'Subgroup' : 'Group'}
              </label>
              <div className="max-h-32 overflow-y-auto border border-gray-200 rounded-lg p-2">
                {getAvailableTasks().map(task => (
                  <label key={task.id} className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded">
                    <input
                      type="checkbox"
                      checked={selectedTasks.includes(task.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedTasks(prev => [...prev, task.id]);
                        } else {
                          setSelectedTasks(prev => prev.filter(id => id !== task.id));
                        }
                      }}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">{task.name}</span>
                  </label>
                ))}
                {getAvailableTasks().length === 0 && (
                  <p className="text-sm text-gray-500 p-2">No available tasks</p>
                )}
              </div>
            </div>
            
            <div className="flex gap-3">
              <button
                onClick={handleAddGroup}
                disabled={!groupName.trim() || (isSubgroup && !selectedGroup)}
                className="flex-1 bg-blue-400 text-white p-3 rounded-lg hover:bg-blue-500 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                Create {isSubgroup ? 'Subgroup' : 'Group'}
              </button>
              <button
                onClick={() => setStep('group-choice')}
                className="flex-1 bg-gray-200 text-gray-700 p-3 rounded-lg hover:bg-gray-300"
              >
                Back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const TaskSphereApp = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [spheres, setSpheres] = useState([]);
  const [selectedSphere, setSelectedSphere] = useState(null);
  const [showAddSphere, setShowAddSphere] = useState(false);
  const [showAddTask, setShowAddTask] = useState(false);
  const [pinnedTasks, setPinnedTasks] = useState([]);
  const [showMoveTask, setShowMoveTask] = useState(null);
  const [editingItem, setEditingItem] = useState(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isLoading, setIsLoading] = useState(true);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);

  // PWA Install Prompt
  useEffect(() => {
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setShowInstallPrompt(true);
      window.deferredPrompt = e;
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  // Online/Offline Detection
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    const handleConnectionChange = (event) => setIsOnline(event.detail.online);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('connectionchange', handleConnectionChange);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('connectionchange', handleConnectionChange);
    };
  }, []);

  // Handle PWA shortcuts
  useEffect(() => {
    const handlePWAShortcut = (event) => {
      if (event.detail.action === 'add-task' && selectedSphere) {
        setShowAddTask(true);
      }
    };

    window.addEventListener('pwa-shortcut', handlePWAShortcut);
    return () => window.removeEventListener('pwa-shortcut', handlePWAShortcut);
  }, [selectedSphere]);

  // Initialize app and load data from IndexedDB
  useEffect(() => {
    const initializeApp = async () => {
      try {
        setIsLoading(true);
        await dbManager.init();
        
        // Load spheres from IndexedDB
        const savedSpheres = await dbManager.loadData(STORES.SPHERES);
        if (savedSpheres && savedSpheres.length > 0) {
          setSpheres(savedSpheres);
        }

        // Load pinned tasks from IndexedDB
        const savedPinnedTasks = await dbManager.loadData(STORES.PINNED_TASKS);
        if (savedPinnedTasks && savedPinnedTasks.length > 0) {
          setPinnedTasks(savedPinnedTasks);
        }

        // Load app data (authentication state)
        const appData = await dbManager.loadData(STORES.APP_DATA);
        const authData = appData.find(item => item.key === 'isAuthenticated');
        if (authData && authData.value) {
          setIsAuthenticated(true);
        }

        setIsLoading(false);
      } catch (error) {
        console.error('Failed to initialize app:', error);
        setIsLoading(false);
      }
    };

    initializeApp();
  }, []);

  // Save spheres to IndexedDB whenever they change
  useEffect(() => {
    if (spheres.length > 0 && !isLoading) {
      dbManager.saveData(STORES.SPHERES, spheres).catch(console.error);
    }
  }, [spheres, isLoading]);

  // Save pinned tasks to IndexedDB whenever they change
  useEffect(() => {
    if (!isLoading) {
      dbManager.saveData(STORES.PINNED_TASKS, pinnedTasks).catch(console.error);
    }
  }, [pinnedTasks, isLoading]);

  // Save authentication state
  useEffect(() => {
    if (!isLoading) {
      dbManager.saveData(STORES.APP_DATA, { key: 'isAuthenticated', value: isAuthenticated }).catch(console.error);
    }
  }, [isAuthenticated, isLoading]);

  // Install PWA function
  const installPWA = async () => {
    if (window.deferredPrompt) {
      window.deferredPrompt.prompt();
      const { outcome } = await window.deferredPrompt.userChoice;
      console.log('Install prompt outcome:', outcome);
      window.deferredPrompt = null;
      setShowInstallPrompt(false);
    }
  };

  // Loading screen
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400 mx-auto mb-4"></div>
          <h2 className="text-xl font-semibold text-gray-800 mb-2">TaskSphere</h2>
          <p className="text-gray-600">Loading your tasks...</p>
        </div>
      </div>
    );
  }

  // Login component with PWA features
  const LoginScreen = () => {
    const [showError, setShowError] = useState(false);

    const handleLoginAttempt = () => {
      if (password === '123') {
        setIsAuthenticated(true);
        setShowError(false);
      } else {
        setShowError(true);
      }
    };

    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-white flex items-center justify-center">
        {/* Connection Status */}
        <div className={`fixed top-4 right-4 px-3 py-1 rounded-full text-sm flex items-center gap-2 ${
          isOnline ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
        }`}>
          {isOnline ? <Wifi size={16} /> : <WifiOff size={16} />}
          {isOnline ? 'Online' : 'Offline'}
        </div>

        {/* Install Prompt */}
        {showInstallPrompt && (
          <div className="fixed top-4 left-4 bg-blue-100 border border-blue-300 rounded-lg p-4 max-w-sm">
            <div className="flex items-start gap-3">
              <Download className="text-blue-600 flex-shrink-0 mt-1" size={20} />
              <div>
                <h3 className="font-semibold text-blue-900 mb-1">Install TaskSphere</h3>
                <p className="text-blue-700 text-sm mb-3">Install as an app for faster access and offline use!</p>
                <div className="flex gap-2">
                  <button
                    onClick={installPWA}
                    className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700"
                  >
                    Install
                  </button>
                  <button
                    onClick={() => setShowInstallPrompt(false)}
                    className="bg-gray-200 text-gray-700 px-3 py-1 rounded text-sm hover:bg-gray-300"
                  >
                    Later
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white p-8 rounded-2xl shadow-lg border border-blue-100 w-96">
          <h1 className="text-2xl font-bold text-gray-800 mb-6 text-center">Task Sphere</h1>
          <input
            type="password"
            placeholder="Enter password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setShowError(false);
            }}
            className="w-full p-3 border border-gray-200 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-blue-300"
            onKeyPress={(e) => e.key === 'Enter' && handleLoginAttempt()}
            autoFocus
          />
          <button
            onClick={handleLoginAttempt}
            className="w-full bg-blue-400 text-white p-3 rounded-lg hover:bg-blue-500 transition-colors"
          >
            Login
          </button>
          {showError && (
            <p className="text-red-500 text-sm mt-2 text-center">Incorrect password</p>
          )}
          
          {!isOnline && (
            <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p className="text-yellow-800 text-sm text-center">
                You're offline. The app will sync when you're back online.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Task priority color logic
  const getTaskColor = (task) => {
    const now = new Date();
    const created = new Date(task.createdAt);
    const timeDiff = now - created;
    
    let thresholds;
    switch (task.priority) {
      case 1: // 3 days
        thresholds = { yellow: 1 * 24 * 60 * 60 * 1000, red: 2 * 24 * 60 * 60 * 1000 };
        break;
      case 2: // 1 day
        thresholds = { yellow: 8 * 60 * 60 * 1000, red: 16 * 60 * 60 * 1000 };
        break;
      case 3: // hourly
        thresholds = { yellow: 20 * 60 * 1000, red: 40 * 60 * 1000 };
        break;
      default:
        return 'border-green-400';
    }
    
    if (timeDiff > thresholds.red) return 'border-red-400';
    if (timeDiff > thresholds.yellow) return 'border-yellow-400';
    return 'border-green-400';
  };

  // Auto-delete completed tasks
  useEffect(() => {
    const interval = setInterval(() => {
      setSpheres(prevSpheres => 
        prevSpheres.map(sphere => ({
          ...sphere,
          tasks: sphere.tasks.filter(task => {
            if (!task.completed) return true;
            
            const now = new Date();
            const completedAt = new Date(task.completedAt);
            const timeDiff = now - completedAt;
            
            switch (task.priority) {
              case 1: return timeDiff < 1 * 24 * 60 * 60 * 1000; // 1 day
              case 2: return timeDiff < 3 * 24 * 60 * 60 * 1000; // 3 days
              case 3: return timeDiff < 7 * 24 * 60 * 60 * 1000; // 7 days
              default: return true;
            }
          })
        }))
      );
    }, 60000);

    return () => clearInterval(interval);
  }, []);

  // Update selected sphere when spheres change
  useEffect(() => {
    if (selectedSphere) {
      const updatedSphere = spheres.find(s => s.id === selectedSphere.id);
      if (updatedSphere) {
        setSelectedSphere(updatedSphere);
      } else {
        setSelectedSphere(null);
      }
    }
  }, [spheres, selectedSphere]);

  // Add Sphere Modal
  const AddSphereModal = () => {
    const [sphereName, setSphereName] = useState('');
    
    const handleAddSphere = () => {
      if (sphereName.trim()) {
        const newSphere = {
          id: Date.now(),
          name: sphereName,
          tasks: [],
          groups: [],
          createdAt: new Date().toISOString()
        };
        setSpheres(prev => [...prev, newSphere]);
        setSphereName('');
        setShowAddSphere(false);
      }
    };

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white p-6 rounded-2xl shadow-xl w-96">
          <h3 className="text-xl font-semibold mb-4">Add New Sphere</h3>
          <input
            type="text"
            placeholder="Sphere name"
            value={sphereName}
            onChange={(e) => setSphereName(e.target.value)}
            className="w-full p-3 border border-gray-200 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-blue-300"
            onKeyPress={(e) => e.key === 'Enter' && handleAddSphere()}
            autoFocus
          />
          <div className="flex gap-3">
            <button
              onClick={handleAddSphere}
              className="flex-1 bg-blue-400 text-white p-3 rounded-lg hover:bg-blue-500"
            >
              Add Sphere
            </button>
            <button
              onClick={() => setShowAddSphere(false)}
              className="flex-1 bg-gray-200 text-gray-700 p-3 rounded-lg hover:bg-gray-300"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Move Task Modal
  const MoveTaskModal = ({ task, onClose }) => {
    const [selectedDestination, setSelectedDestination] = useState('');

    const getDestinationOptions = () => {
      const options = [
        { value: 'unassigned', label: 'Unassigned' }
      ];

      if (selectedSphere && selectedSphere.groups) {
        selectedSphere.groups.forEach(group => {
          options.push({
            value: group.name,
            label: group.name,
            type: 'group'
          });

          if (group.subgroups) {
            group.subgroups.forEach(subgroup => {
              options.push({
                value: subgroup.name,
                label: `├─ ${subgroup.name}`,
                type: 'subgroup'
              });
            });
          }
        });
      }

      return options.filter(option => option.value !== task.group);
    };

    const handleMoveTask = () => {
      if (selectedDestination !== '') {
        setSpheres(prev => prev.map(sphere => 
          sphere.id === selectedSphere.id 
            ? {
                ...sphere,
                tasks: sphere.tasks.map(t => 
                  t.id === task.id 
                    ? { ...t, group: selectedDestination || 'unassigned' }
                    : t
                )
              }
            : sphere
        ));
        onClose();
      }
    };

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white p-6 rounded-2xl shadow-xl w-96">
          <h3 className="text-xl font-semibold mb-4">Move Task: {task.name}</h3>
          
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Current location: {task.group || 'Unassigned'}</label>
            <label className="block text-sm font-medium mb-2">Move to:</label>
            <select
              value={selectedDestination}
              onChange={(e) => setSelectedDestination(e.target.value)}
              className="w-full p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
            >
              <option value="">Select destination...</option>
              {getDestinationOptions().map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleMoveTask}
              disabled={selectedDestination === ''}
              className="flex-1 bg-blue-400 text-white p-3 rounded-lg hover:bg-blue-500 disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              Move Task
            </button>
            <button
              onClick={onClose}
              className="flex-1 bg-gray-200 text-gray-700 p-3 rounded-lg hover:bg-gray-300"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  };

  const EditNameModal = ({ item, type, onSave, onCancel }) => {
    const [name, setName] = useState(item.name || '');

    const handleSave = () => {
      if (name.trim()) {
        onSave(name.trim());
      }
    };

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white p-6 rounded-2xl shadow-xl w-96">
          <h3 className="text-xl font-semibold mb-4">Edit {type} Name</h3>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full p-3 border border-gray-200 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-blue-300"
            onKeyPress={(e) => e.key === 'Enter' && handleSave()}
            autoFocus
          />
          <div className="flex gap-3">
            <button
              onClick={handleSave}
              className="flex-1 bg-blue-400 text-white p-3 rounded-lg hover:bg-blue-500"
            >
              Save
            </button>
            <button
              onClick={onCancel}
              className="flex-1 bg-gray-200 text-gray-700 p-3 rounded-lg hover:bg-gray-300"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Main Dashboard with PWA features
  const Dashboard = () => (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-white">
      {/* Connection Status Bar */}
      <div className={`fixed top-0 left-0 right-0 px-4 py-2 text-center text-sm z-40 ${
        isOnline ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
      }`}>
        <div className="flex items-center justify-center gap-2">
          {isOnline ? <Wifi size={16} /> : <WifiOff size={16} />}
          {isOnline ? 'Online - All changes saved' : 'Offline - Changes will sync when online'}
        </div>
      </div>

      {/* Install Prompt */}
      {showInstallPrompt && (
        <div className="fixed top-16 left-4 right-4 bg-blue-100 border border-blue-300 rounded-lg p-4 z-30">
          <div className="flex items-start gap-3">
            <Download className="text-blue-600 flex-shrink-0 mt-1" size={20} />
            <div className="flex-1">
              <h3 className="font-semibold text-blue-900 mb-1">Install TaskSphere</h3>
              <p className="text-blue-700 text-sm mb-3">Install as an app for faster access and offline use!</p>
              <div className="flex gap-2">
                <button
                  onClick={installPWA}
                  className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700"
                >
                  Install
                </button>
                <button
                  onClick={() => setShowInstallPrompt(false)}
                  className="bg-gray-200 text-gray-700 px-3 py-1 rounded text-sm hover:bg-gray-300"
                >
                  Later
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Welcome Message */}
      <div className="p-8 pt-16 text-center">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">Welcome Rujul, Let's Get Started!</h1>
        <div className="text-sm text-gray-600">
          {isOnline ? '🌐 Connected' : '📱 Working offline'}
        </div>
      </div>

      {/* Pinned Tasks Area */}
      {pinnedTasks.filter(task => !task.completed).length > 0 && (
        <div className="bg-gray-100 mx-8 rounded-2xl p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4 text-gray-700 flex items-center gap-2">
            📌 Pinned Tasks
            {!isOnline && <span className="text-xs bg-yellow-200 text-yellow-800 px-2 py-1 rounded">Offline</span>}
          </h2>
          <div className="flex flex-wrap gap-3">
            {pinnedTasks.map(task => {
              const currentSphere = spheres.find(s => s.name === task.sphereName);
              const currentTask = currentSphere?.tasks?.find(t => t.id === task.id);
              const isCompleted = currentTask?.completed || false;
              
              if (isCompleted) return null;
              
              return (
                <div
                  key={task.id}
                  className={`p-3 rounded-lg border-2 ${getTaskColor(currentTask || task)} bg-white cursor-pointer hover:shadow-md transition-shadow`}
                  onClick={() => {
                    const sphere = spheres.find(s => s.name === task.sphereName);
                    if (sphere) setSelectedSphere(sphere);
                  }}
                >
                  <span className="text-sm font-medium">{task.name}</span>
                  <div className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                    {task.sphereName}
                    {!isOnline && <span className="w-2 h-2 bg-orange-400 rounded-full"></span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Spheres in Circular Layout */}
      <div className="flex justify-center items-center min-h-[600px] p-8">
        <div className="relative" style={{ width: '800px', height: '800px' }}>
          {spheres.map((sphere, index) => {
            const numSpheres = spheres.length;
            let sphereSize, radius, fontSize;
            
            if (numSpheres === 1) {
              sphereSize = 200;
              radius = 0;
              fontSize = 'text-xl';
            } else if (numSpheres <= 3) {
              sphereSize = 170;
              radius = 180;
              fontSize = 'text-lg';
            } else if (numSpheres <= 6) {
              sphereSize = 140;
              radius = 220;
              fontSize = 'text-base';
            } else {
              sphereSize = 120;
              radius = 280;
              fontSize = 'text-sm';
            }

            const angle = (index * 360) / numSpheres;
            const x = Math.cos((angle * Math.PI) / 180) * radius;
            const y = Math.sin((angle * Math.PI) / 180) * radius;

            const incompleteTaskCount = sphere.tasks ? sphere.tasks.filter(task => !task.completed).length : 0;

            return (
              <div
                key={sphere.id}
                onClick={() => setSelectedSphere(sphere)}
                onDoubleClick={() => setEditingItem({ ...sphere, type: 'sphere' })}
                className={`absolute bg-white rounded-full shadow-lg border-2 cursor-pointer hover:shadow-xl transition-all flex flex-col items-center justify-center ${
                  isOnline ? 'border-blue-200 hover:border-blue-400' : 'border-orange-200 hover:border-orange-400'
                }`}
                style={{
                  width: `${sphereSize}px`,
                  height: `${sphereSize}px`,
                  left: `calc(50% + ${x}px - ${sphereSize/2}px)`,
                  top: `calc(50% + ${y}px - ${sphereSize/2}px)`,
                }}
              >
                <div className={`${fontSize} font-semibold text-gray-800 text-center px-2 leading-tight`}>
                  {sphere.name}
                </div>
                <div className={`${fontSize} text-gray-600 mt-1 flex items-center gap-1`}>
                  {incompleteTaskCount}
                  {!isOnline && <div className="w-2 h-2 bg-orange-400 rounded-full"></div>}
                </div>
              </div>
            );
          })}
          
          {spheres.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <p className="text-gray-500 text-lg mb-2">Click the + button to add your first sphere!</p>
                {!isOnline && (
                  <p className="text-orange-600 text-sm">Working offline - changes will sync when online</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add Sphere Button */}
      <button
        onClick={() => setShowAddSphere(true)}
        className={`fixed bottom-6 right-6 text-white p-4 rounded-full shadow-lg transition-colors ${
          isOnline ? 'bg-blue-400 hover:bg-blue-500' : 'bg-orange-400 hover:bg-orange-500'
        }`}
        title={isOnline ? 'Add new sphere' : 'Add new sphere (offline)'}
      >
        <Plus size={24} />
      </button>

      {showAddSphere && <AddSphereModal />}
      {editingItem && editingItem.type === 'sphere' && (
        <EditNameModal
          item={editingItem}
          type="Sphere"
          onSave={(newName) => {
            setSpheres(prev => prev.map(sphere => 
              sphere.id === editingItem.id ? { ...sphere, name: newName } : sphere
            ));
            setEditingItem(null);
          }}
          onCancel={() => setEditingItem(null)}
        />
      )}
    </div>
  );

  // Sphere Detail View with PWA features
  const SphereDetail = () => {
    const toggleTaskComplete = (taskId) => {
      setSpheres(prev => prev.map(sphere => 
        sphere.id === selectedSphere.id 
          ? {
              ...sphere,
              tasks: sphere.tasks.map(task => 
                task.id === taskId 
                  ? { 
                      ...task, 
                      completed: !task.completed,
                      completedAt: !task.completed ? new Date().toISOString() : null
                    }
                  : task
              )
            }
          : sphere
      ));
    };

    const deleteGroup = (groupId) => {
      setSpheres(prev => prev.map(sphere => 
        sphere.id === selectedSphere.id 
          ? {
              ...sphere,
              groups: sphere.groups.filter(group => group.id !== groupId),
              tasks: sphere.tasks.map(task => {
                const groupToDelete = sphere.groups.find(g => g.id === groupId);
                return task.group === groupToDelete?.name
                  ? { ...task, group: 'unassigned' }
                  : task;
              })
            }
          : sphere
      ));
    };

    const deleteSubgroup = (parentGroupId, subgroupId) => {
      setSpheres(prev => prev.map(sphere => 
        sphere.id === selectedSphere.id 
          ? {
              ...sphere,
              groups: sphere.groups.map(group => 
                group.id === parentGroupId
                  ? {
                      ...group,
                      subgroups: (group.subgroups || []).filter(sub => sub.id !== subgroupId)
                    }
                  : group
              ),
              tasks: sphere.tasks.map(task => {
                const parentGroup = sphere.groups.find(g => g.id === parentGroupId);
                const subgroupToDelete = parentGroup?.subgroups?.find(s => s.id === subgroupId);
                return task.group === subgroupToDelete?.name
                  ? { ...task, group: parentGroup?.name || 'unassigned' }
                  : task;
              })
            }
          : sphere
      ));
    };

    const organizeTasksAndGroups = () => {
      if (!selectedSphere || !selectedSphere.tasks) return [];
      
      const organized = [];
      
      const unassignedTasks = selectedSphere.tasks.filter(task => !task.group || task.group === 'unassigned');
      if (unassignedTasks.length > 0) {
        organized.push({
          type: 'group',
          name: 'unassigned',
          displayName: 'Unassigned Tasks',
          tasks: unassignedTasks,
          id: 'unassigned'
        });
      }

      if (selectedSphere.groups) {
        selectedSphere.groups.forEach(group => {
          const groupTasks = selectedSphere.tasks.filter(task => task.group === group.name);

          organized.push({
            type: 'group',
            name: group.name,
            displayName: group.name,
            tasks: groupTasks,
            id: group.id,
            group: group
          });

          if (group.subgroups) {
            group.subgroups.forEach(subgroup => {
              const subTasks = selectedSphere.tasks.filter(task => task.group === subgroup.name);
              organized.push({
                type: 'subgroup',
                name: subgroup.name,
                displayName: subgroup.name,
                tasks: subTasks,
                id: subgroup.id,
                parentGroupId: group.id,
                subgroup: subgroup
              });
            });
          }
        });
      }

      return organized;
    };

    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-white">
        {/* Connection Status Bar */}
        <div className={`fixed top-0 left-0 right-0 px-4 py-2 text-center text-sm z-40 ${
          isOnline ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
        }`}>
          <div className="flex items-center justify-center gap-2">
            {isOnline ? <Wifi size={16} /> : <WifiOff size={16} />}
            {isOnline ? 'Online - All changes saved' : 'Offline - Changes will sync when online'}
          </div>
        </div>

        <div className="p-6 pt-16">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setSelectedSphere(null)}
                className="p-2 text-gray-600 hover:bg-white rounded-lg"
              >
                <ArrowLeft size={20} />
              </button>
              <h1 
                className="text-2xl font-bold text-gray-800 cursor-pointer hover:text-blue-600 flex items-center gap-2"
                onDoubleClick={() => setEditingItem({ ...selectedSphere, type: 'sphere' })}
              >
                {selectedSphere.name}
                {!isOnline && <div className="w-3 h-3 bg-orange-400 rounded-full"></div>}
              </h1>
            </div>
          </div>

          {/* Organized Tasks and Groups */}
          <div className="space-y-6">
            {organizeTasksAndGroups().map((item) => (
              <div 
                key={`${item.type}-${item.id}`} 
                className={`bg-white rounded-2xl shadow-lg border p-6 ${
                  item.type === 'subgroup' 
                    ? 'ml-8 border-l-4 border-l-blue-300' 
                    : isOnline 
                      ? 'border-blue-100' 
                      : 'border-orange-100'
                }`}
              >
                <div className="flex items-center justify-between mb-4">
                  <h3 
                    className={`font-semibold capitalize text-gray-800 cursor-pointer hover:text-blue-600 flex items-center gap-2 ${
                      item.type === 'subgroup' ? 'text-base' : 'text-lg'
                    }`}
                    onDoubleClick={() => {
                      if (item.name !== 'unassigned') {
                        setEditingItem({ 
                          ...item.group || item.subgroup, 
                          type: item.type === 'subgroup' ? 'subgroup' : 'group',
                          parentGroupId: item.parentGroupId 
                        });
                      }
                    }}
                  >
                    {item.type === 'subgroup' && '├─ '}
                    {item.displayName}
                    {!isOnline && <div className="w-2 h-2 bg-orange-400 rounded-full"></div>}
                  </h3>
                  {item.name !== 'unassigned' && (
                    <button
                      onClick={() => {
                        const confirmMessage = `Delete this ${item.type}? ${
                          item.type === 'subgroup' 
                            ? 'Tasks will be moved to the parent group.' 
                            : 'Tasks will be moved to unassigned.'
                        }`;
                        if (window.confirm(confirmMessage)) {
                          if (item.type === 'subgroup') {
                            deleteSubgroup(item.parentGroupId, item.id);
                          } else {
                            deleteGroup(item.id);
                          }
                        }
                      }}
                      className="text-red-500 hover:text-red-700 p-1"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
                
                <div className="space-y-3">
                  {item.tasks.map(task => (
                    <div
                      key={task.id}
                      className={`flex items-center gap-3 p-3 rounded-lg border-2 ${getTaskColor(task)} ${
                        task.completed ? 'bg-gray-50' : 'bg-white'
                      } ${!isOnline ? 'border-opacity-70' : ''}`}
                    >
                      <button
                        onClick={() => toggleTaskComplete(task.id)}
                        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                          task.completed ? 'bg-green-400 border-green-400' : 'border-gray-300'
                        }`}
                      >
                        {task.completed && <Check size={12} className="text-white" />}
                      </button>
                      
                      <span className={`flex-1 ${task.completed ? 'line-through text-gray-500' : 'text-gray-800'}`}>
                        {task.name}
                      </span>
                      
                      <div className="text-xs text-gray-500 flex items-center gap-1">
                        Level {task.priority}
                        {!isOnline && <div className="w-1 h-1 bg-orange-400 rounded-full"></div>}
                      </div>

                      {!task.completed && (
                        <button
                          onClick={() => setShowMoveTask(task)}
                          className="text-blue-500 hover:text-blue-700 p-1"
                          title="Move task"
                        >
                          <Edit2 size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                  {item.tasks.length === 0 && (
                    <div className="text-sm text-gray-500 italic">
                      No tasks in this {item.type}
                    </div>
                  )}
                </div>
              </div>
            ))}
            
            {organizeTasksAndGroups().length === 0 && (
              <div className="text-center py-12">
                <p className="text-gray-500 text-lg mb-2">No tasks or groups yet. Click the + button to add some!</p>
                {!isOnline && (
                  <p className="text-orange-600 text-sm">Working offline - changes will sync when online</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Add Task Button */}
        <button
          onClick={() => setShowAddTask(true)}
          className={`fixed bottom-6 right-6 text-white p-4 rounded-full shadow-lg transition-colors ${
            isOnline ? 'bg-blue-400 hover:bg-blue-500' : 'bg-orange-400 hover:bg-orange-500'
          }`}
          title={isOnline ? 'Add new task' : 'Add new task (offline)'}
        >
          <Plus size={24} />
        </button>

        <AddTaskModal 
          showAddTask={showAddTask}
          setShowAddTask={setShowAddTask}
          selectedSphere={selectedSphere}
          setSpheres={setSpheres}
          setPinnedTasks={setPinnedTasks}
          isOnline={isOnline}
          setShowMoveTask={setShowMoveTask}
        />
        {showMoveTask && (
          <MoveTaskModal 
            task={showMoveTask} 
            onClose={() => setShowMoveTask(null)} 
          />
        )}
        {editingItem && editingItem.type === 'sphere' && (
          <EditNameModal
            item={editingItem}
            type="Sphere"
            onSave={(newName) => {
              setSpheres(prev => prev.map(sphere => 
                sphere.id === editingItem.id ? { ...sphere, name: newName } : sphere
              ));
              setEditingItem(null);
            }}
            onCancel={() => setEditingItem(null)}
          />
        )}
        {editingItem && editingItem.type === 'group' && (
          <EditNameModal
            item={editingItem}
            type="Group"
            onSave={(newName) => {
              setSpheres(prev => prev.map(sphere => 
                sphere.id === selectedSphere.id 
                  ? {
                      ...sphere,
                      groups: sphere.groups.map(group => 
                        group.id === editingItem.id ? { ...group, name: newName } : group
                      ),
                      tasks: sphere.tasks.map(task => 
                        task.group === editingItem.name ? { ...task, group: newName } : task
                      )
                    }
                  : sphere
              ));
              setEditingItem(null);
            }}
            onCancel={() => setEditingItem(null)}
          />
        )}
        {editingItem && editingItem.type === 'subgroup' && (
          <EditNameModal
            item={editingItem}
            type="Subgroup"
            onSave={(newName) => {
              setSpheres(prev => prev.map(sphere => 
                sphere.id === selectedSphere.id 
                  ? {
                      ...sphere,
                      groups: sphere.groups.map(group => 
                        group.id === editingItem.parentGroupId
                          ? {
                              ...group,
                              subgroups: (group.subgroups || []).map(subgroup =>
                                subgroup.id === editingItem.id 
                                  ? { ...subgroup, name: newName }
                                  : subgroup
                              )
                            }
                          : group
                      ),
                      tasks: sphere.tasks.map(task => 
                        task.group === editingItem.name ? { ...task, group: newName } : task
                      )
                    }
                  : sphere
              ));
              setEditingItem(null);
            }}
            onCancel={() => setEditingItem(null)}
          />
        )}
      </div>
    );
  };

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  if (selectedSphere) {
    return <SphereDetail />;
  }

  return <Dashboard />;
};

export default TaskSphereApp;