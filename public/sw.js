const CACHE_NAME = 'tasksphere-v1.0.0';
const CACHE_VERSION = '1.0.0';
const STATIC_CACHE = `${CACHE_NAME}-static`;
const DYNAMIC_CACHE = `${CACHE_NAME}-dynamic`;
const API_CACHE = `${CACHE_NAME}-api`;
const IMAGE_CACHE = `${CACHE_NAME}-images`;

// Cache size limits to prevent storage bloat
const CACHE_LIMITS = {
  [STATIC_CACHE]: 50,
  [DYNAMIC_CACHE]: 100,
  [API_CACHE]: 200,
  [IMAGE_CACHE]: 60
};

// Cache expiration times (in milliseconds)
const CACHE_EXPIRY = {
  static: 7 * 24 * 60 * 60 * 1000, // 7 days
  dynamic: 24 * 60 * 60 * 1000,     // 1 day
  api: 5 * 60 * 1000,               // 5 minutes
  images: 30 * 24 * 60 * 60 * 1000  // 30 days
};

// Critical resources to cache immediately
const CRITICAL_RESOURCES = [
  '/',
  '/static/js/bundle.js',
  '/static/css/main.css',
  '/manifest.json'
];

// Optional resources (cache if accessed)
const OPTIONAL_RESOURCES = [
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/icons/icon-72x72.png'
];

// Install event - enhanced caching strategy
self.addEventListener('install', (event) => {
  console.log(`SW: Installing v${CACHE_VERSION}`);
  
  event.waitUntil(
    Promise.all([
      // Cache critical resources immediately
      caches.open(STATIC_CACHE).then(cache => {
        return cache.addAll(CRITICAL_RESOURCES).catch(error => {
          console.error('SW: Failed to cache critical resources:', error);
          // Cache individual resources that succeed
          return Promise.allSettled(
            CRITICAL_RESOURCES.map(url => cache.add(url))
          );
        });
      }),
      
      // Pre-cache optional resources (non-blocking)
      caches.open(IMAGE_CACHE).then(cache => {
        return Promise.allSettled(
          OPTIONAL_RESOURCES.map(url => cache.add(url))
        );
      })
    ]).then(() => {
      console.log('SW: Installation complete');
      return self.skipWaiting();
    }).catch(error => {
      console.error('SW: Installation failed:', error);
    })
  );
});

// Activate event - intelligent cache cleanup
self.addEventListener('activate', (event) => {
  console.log('SW: Activating...');
  
  event.waitUntil(
    Promise.all([
      // Clean up old caches
      cleanupOldCaches(),
      
      // Clean up oversized caches
      cleanupOversizedCaches(),
      
      // Clean up expired entries
      cleanupExpiredCaches()
    ]).then(() => {
      console.log('SW: Activation complete');
      return self.clients.claim();
    })
  );
});

// Advanced fetch handler with multiple strategies
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Skip non-GET requests and cross-origin requests
  if (request.method !== 'GET' || !url.origin.includes(self.location.origin)) {
    return;
  }
  
  // Route to appropriate caching strategy
  if (isStaticAsset(request)) {
    event.respondWith(cacheFirstStrategy(request, STATIC_CACHE));
  } else if (isAPICall(request)) {
    event.respondWith(networkFirstStrategy(request, API_CACHE));
  } else if (isImageRequest(request)) {
    event.respondWith(cacheFirstStrategy(request, IMAGE_CACHE));
  } else if (isNavigationRequest(request)) {
    event.respondWith(staleWhileRevalidateStrategy(request, DYNAMIC_CACHE));
  } else {
    event.respondWith(networkFirstStrategy(request, DYNAMIC_CACHE));
  }
});

// Cache-first strategy (for static assets)
async function cacheFirstStrategy(request, cacheName) {
  try {
    const cachedResponse = await caches.match(request);

    if (cachedResponse && !isExpired(cachedResponse, cacheName)) {
      return cachedResponse;
    }
    
    const networkResponse = await fetchWithTimeout(request, 3000);
    
    if (networkResponse.ok) {
      await cacheResponse(request, networkResponse.clone(), cacheName);
    }
    
    return networkResponse;
  } catch (error) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      console.log('SW: Serving stale content due to network error');
      return cachedResponse;
    }
    throw error;
  }
}

// Network-first strategy (for API calls)
async function networkFirstStrategy(request, cacheName) {
  try {
    const networkResponse = await fetchWithTimeout(request, 5000);
    
    if (networkResponse.ok) {
      await cacheResponse(request, networkResponse.clone(), cacheName);
    }
    
    return networkResponse;
  } catch (error) {
    console.log('SW: Network failed, trying cache');
    const cachedResponse = await caches.match(request);
    
    if (cachedResponse) {
      // Add stale indicator header
      const response = new Response(cachedResponse.body, {
        status: cachedResponse.status,
        statusText: cachedResponse.statusText,
        headers: {
          ...Object.fromEntries(cachedResponse.headers),
          'X-Served-From': 'cache-stale'
        }
      });
      return response;
    }
    
    // Return offline fallback for navigation requests
    if (isNavigationRequest(request)) {
      return await caches.match('/') || new Response('Offline', { status: 503 });
    }
    
    throw error;
  }
}

// Stale-while-revalidate strategy (for pages)
async function staleWhileRevalidateStrategy(request, cacheName) {
  const cachedResponse = caches.match(request);
  
  const networkResponse = fetchWithTimeout(request, 2000)
    .then(response => {
      if (response.ok) {
        cacheResponse(request, response.clone(), cacheName);
      }
      return response;
    })
    .catch(() => null);
  
  return (await cachedResponse) || (await networkResponse) || 
         (await caches.match('/')) || 
         new Response('Offline', { status: 503 });
}

// Enhanced caching with metadata
async function cacheResponse(request, response, cacheName) {
  if (!response.ok || response.type === 'opaque') return;
  
  try {
    const cache = await caches.open(cacheName);
    
    // Add cache metadata
    const responseWithMetadata = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: {
        ...Object.fromEntries(response.headers),
        'X-Cache-Date': new Date().toISOString(),
        'X-Cache-Version': CACHE_VERSION
      }
    });
    
    await cache.put(request, responseWithMetadata);
    
    // Trigger cache cleanup if needed
    await trimCache(cacheName);
    
  } catch (error) {
    console.error('SW: Cache storage failed:', error);
  }
}

// Intelligent fetch with timeout and retry
async function fetchWithTimeout(request, timeout = 5000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(request, {
      signal: controller.signal,
      cache: 'no-store' // Prevent double caching
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error.name === 'AbortError') {
      throw new Error('Network timeout');
    }
    throw error;
  }
}

// Cache size management
async function trimCache(cacheName) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  
  if (keys.length <= CACHE_LIMITS[cacheName]) return;
  
  // Sort by cache date (oldest first)
  const sortedKeys = await Promise.all(
    keys.map(async key => {
      const response = await cache.match(key);
      const cacheDate = response.headers.get('X-Cache-Date');
      return { key, date: new Date(cacheDate || 0) };
    })
  );
  
  sortedKeys.sort((a, b) => a.date - b.date);
  
  // Remove oldest entries
  const toDelete = sortedKeys.slice(0, keys.length - CACHE_LIMITS[cacheName]);
  await Promise.all(toDelete.map(item => cache.delete(item.key)));
  
  console.log(`SW: Trimmed ${toDelete.length} entries from ${cacheName}`);
}

// Cache expiry check
function isExpired(response, cacheName = DYNAMIC_CACHE) {
  const cacheDate = response.headers.get('X-Cache-Date');
  if (!cacheDate) return false;

  const age = Date.now() - new Date(cacheDate).getTime();
  let maxAge = CACHE_EXPIRY.dynamic; // Default expiry
  if (cacheName === STATIC_CACHE) maxAge = CACHE_EXPIRY.static;
  else if (cacheName === API_CACHE) maxAge = CACHE_EXPIRY.api;
  else if (cacheName === IMAGE_CACHE) maxAge = CACHE_EXPIRY.images;

  return age > maxAge;
}

// Request type detection
function isStaticAsset(request) {
  return /\.(js|css|woff2?|ttf|eot)(\?.*)?$/i.test(request.url);
}

function isImageRequest(request) {
  return request.destination === 'image' || 
         /\.(jpg|jpeg|png|gif|webp|svg|ico)(\?.*)?$/i.test(request.url);
}

function isAPICall(request) {
  return request.url.includes('/api/') || 
         request.headers.get('Content-Type')?.includes('application/json');
}

function isNavigationRequest(request) {
  return request.mode === 'navigate' || request.destination === 'document';
}

// Background sync with queue management
const syncQueue = new Map();

self.addEventListener('sync', (event) => {
  console.log(`SW: Background sync triggered: ${event.tag}`);
  
  switch (event.tag) {
    case 'background-task-sync':
      event.waitUntil(syncTasks());
      break;
    case 'analytics-sync':
      event.waitUntil(syncAnalytics());
      break;
    default:
      console.log(`SW: Unknown sync tag: ${event.tag}`);
  }
});

// Enhanced task sync with retry logic
async function syncTasks() {
  const MAX_RETRIES = 3;
  let attempts = 0;
  
  while (attempts < MAX_RETRIES) {
    try {
      // Get offline tasks from IndexedDB or localStorage
      const offlineTasks = await getOfflineTasks();
      
      if (offlineTasks.length === 0) {
        console.log('SW: No offline tasks to sync');
        return;
      }
      
      // Sync tasks in batches
      const batchSize = 5;
      for (let i = 0; i < offlineTasks.length; i += batchSize) {
        const batch = offlineTasks.slice(i, i + batchSize);
        await Promise.all(batch.map(syncSingleTask));
      }
      
      console.log(`SW: Successfully synced ${offlineTasks.length} tasks`);
      await clearOfflineTasks();
      return;
      
    } catch (error) {
      attempts++;
      console.error(`SW: Sync attempt ${attempts} failed:`, error);
      
      if (attempts < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
      }
    }
  }
  
  throw new Error('SW: Task sync failed after maximum retries');
}

// Enhanced push notifications
self.addEventListener('push', (event) => {
  console.log('SW: Push received');
  
  let notificationData = {
    title: 'TaskSphere',
    body: 'New task reminder!',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png'
  };
  
  if (event.data) {
    try {
      notificationData = { ...notificationData, ...event.data.json() };
    } catch (error) {
      notificationData.body = event.data.text();
    }
  }
  
  const options = {
    body: notificationData.body,
    icon: notificationData.icon,
    badge: notificationData.badge,
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: notificationData.id || Date.now(),
      url: notificationData.url || '/'
    },
    actions: [
      {
        action: 'complete',
        title: 'Mark Complete',
        icon: '/icons/icon-72x72.png'
      },
      {
        action: 'snooze',
        title: 'Snooze 10min',
        icon: '/icons/icon-72x72.png'
      },
      {
        action: 'dismiss',
        title: 'Dismiss',
        icon: '/icons/icon-72x72.png'
      }
    ],
    requireInteraction: notificationData.urgent || false,
    silent: notificationData.silent || false
  };
  
  event.waitUntil(
    self.registration.showNotification(notificationData.title, options)
  );
});

// Enhanced notification click handling
self.addEventListener('notificationclick', (event) => {
  console.log('SW: Notification clicked', event.action);
  event.notification.close();
  
  const notificationData = event.notification.data;
  
  event.waitUntil(
    (async () => {
      switch (event.action) {
        case 'complete':
          await handleTaskCompletion(notificationData.primaryKey);
          await sendMessageToClient({
            type: 'TASK_COMPLETED',
            taskId: notificationData.primaryKey
          });
          break;
          
        case 'snooze':
          await scheduleSnoozeNotification(notificationData, 10 * 60 * 1000);
          break;
          
        case 'dismiss':
          await sendMessageToClient({
            type: 'NOTIFICATION_DISMISSED',
            taskId: notificationData.primaryKey
          });
          break;
          
        default:
          const urlToOpen = notificationData.url || '/';
          const windowClients = await clients.matchAll({ type: 'window' });
          
          // Focus existing window or open new one
          if (windowClients.length > 0) {
            await windowClients[0].focus();
            await windowClients[0].navigate(urlToOpen);
          } else {
            await clients.openWindow(urlToOpen);
          }
      }
    })()
  );
});

// Cleanup functions
async function cleanupOldCaches() {
  const cacheNames = await caches.keys();
  const oldCaches = cacheNames.filter(name => 
    name.includes('tasksphere') && !name.includes(CACHE_VERSION)
  );
  
  return Promise.all(oldCaches.map(name => {
    console.log(`SW: Deleting old cache: ${name}`);
    return caches.delete(name);
  }));
}

async function cleanupOversizedCaches() {
  return Promise.all(
    Object.keys(CACHE_LIMITS).map(cacheName => trimCache(cacheName))
  );
}

async function cleanupExpiredCaches() {
  const cacheNames = await caches.keys();
  
  return Promise.all(cacheNames.map(async cacheName => {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    
    const expiredKeys = await Promise.all(
      keys.map(async key => {
        const response = await cache.match(key);
        return isExpired(response, cacheName) ? key : null;
      })
    );
    
    const toDelete = expiredKeys.filter(Boolean);
    return Promise.all(toDelete.map(key => cache.delete(key)));
  }));
}

// IndexedDB utility functions for offline task storage
const DB_NAME = 'TaskSphereDB';
const DB_VERSION = 1;
const STORE_NAME = 'offlineTasks';

function openDB() {
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
}

async function getOfflineTasks() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function clearOfflineTasks() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function removeOfflineTask(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function syncSingleTask(task) {
  // Replace '/api/tasks' with your real API endpoint
  try {
    const response = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task)
    });
    if (response.ok) {
      await removeOfflineTask(task.id);
      return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

async function handleTaskCompletion(taskId) {
  // Mark the task as completed in IndexedDB (offlineTasks store)
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getRequest = store.get(taskId);
    getRequest.onsuccess = async () => {
      const task = getRequest.result;
      if (task) {
        task.completed = true;
        task.completedAt = new Date().toISOString();
        const putRequest = store.put(task);
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject(putRequest.error);
      } else {
        resolve(); // Task not found, nothing to do
      }
    };
    getRequest.onerror = () => reject(getRequest.error);
  });
}

async function scheduleSnoozeNotification(data, delay) {
  // Schedule a snoozed notification after the specified delay (ms)
  // This works only while the service worker is alive (not persistent across restarts)
  if ('showTrigger' in Notification.prototype) {
    // Notification Triggers API (experimental, not widely supported)
    self.registration.showNotification(data.title || 'TaskSphere', {
      body: data.body || 'Task reminder',
      icon: data.icon || '/icons/icon-192x192.png',
      badge: data.badge || '/icons/icon-72x72.png',
      vibrate: [100, 50, 100],
      data: data,
      showTrigger: new TimestampTrigger(Date.now() + delay),
      actions: [
        { action: 'complete', title: 'Mark Complete', icon: '/icons/icon-72x72.png' },
        { action: 'snooze', title: 'Snooze 10min', icon: '/icons/icon-72x72.png' },
        { action: 'dismiss', title: 'Dismiss', icon: '/icons/icon-72x72.png' }
      ]
    });
  } else {
    // Fallback: setTimeout (works only if SW stays alive)
    setTimeout(() => {
      self.registration.showNotification(data.title || 'TaskSphere', {
        body: data.body || 'Task reminder',
        icon: data.icon || '/icons/icon-192x192.png',
        badge: data.badge || '/icons/icon-72x72.png',
        vibrate: [100, 50, 100],
        data: data,
        actions: [
          { action: 'complete', title: 'Mark Complete', icon: '/icons/icon-72x72.png' },
          { action: 'snooze', title: 'Snooze 10min', icon: '/icons/icon-72x72.png' },
          { action: 'dismiss', title: 'Dismiss', icon: '/icons/icon-72x72.png' }
        ]
      });
    }, delay);
    console.warn('SW: Notification Triggers API not supported. Snooze will only work while the service worker is alive.');
  }
}

// Analytics sync logic
async function syncAnalytics() {
  // Open or create the analytics store
  const ANALYTICS_STORE = 'offlineAnalytics';
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(ANALYTICS_STORE)) {
        db.createObjectStore(ANALYTICS_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  // Get all analytics events
  const analyticsEvents = await new Promise((resolve, reject) => {
    const tx = db.transaction(ANALYTICS_STORE, 'readonly');
    const store = tx.objectStore(ANALYTICS_STORE);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  if (!analyticsEvents.length) {
    console.log('SW: No offline analytics to sync');
    return;
  }

  // Send analytics events to backend
  try {
    const response = await fetch('/api/analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(analyticsEvents)
    });
    if (response.ok) {
      // Clear analytics store after successful sync
      await new Promise((resolve, reject) => {
        const tx = db.transaction(ANALYTICS_STORE, 'readwrite');
        const store = tx.objectStore(ANALYTICS_STORE);
        const clearReq = store.clear();
        clearReq.onsuccess = () => resolve();
        clearReq.onerror = () => reject(clearReq.error);
      });
      console.log(`SW: Synced and cleared ${analyticsEvents.length} analytics events`);
    } else {
      console.error('SW: Analytics sync failed with status', response.status);
    }
  } catch (e) {
    console.error('SW: Analytics sync failed:', e);
  }
}

// Enhanced messaging
async function sendMessageToClient(message) {
  const clientList = await clients.matchAll({ includeUncontrolled: true });
  
  return Promise.all(
    clientList.map(client => {
      return client.postMessage({
        ...message,
        timestamp: Date.now(),
        source: 'service-worker'
      });
    })
  );
}

// Message handling with enhanced capabilities
self.addEventListener('message', (event) => {
  console.log('SW: Message received:', event.data);
  
  const { type, payload } = event.data || {};
  
  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
      
    case 'CLEAR_CACHE':
      event.waitUntil(clearAllCaches());
      break;
      
    case 'SYNC_TASKS':
      event.waitUntil(syncTasks());
      break;
      
    case 'GET_CACHE_STATUS':
      event.waitUntil(getCacheStatus().then(status => {
        event.ports[0]?.postMessage(status);
      }));
      break;
      
    default:
      console.log(`SW: Unknown message type: ${type}`);
  }
});

async function clearAllCaches() {
  const cacheNames = await caches.keys();
  await Promise.all(cacheNames.map(name => caches.delete(name)));
  console.log('SW: All caches cleared');
}

async function getCacheStatus() {
  const cacheNames = await caches.keys();
  const status = {};
  
  for (const name of cacheNames) {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    status[name] = keys.length;
  }
  
  return status;
}

// Performance monitoring
let performanceMetrics = {
  cacheHits: 0,
  cacheMisses: 0,
  networkRequests: 0,
  syncOperations: 0
};

// Update metrics and report periodically
setInterval(() => {
  if (performanceMetrics.networkRequests > 0) {
    console.log('SW Performance:', performanceMetrics);
    sendMessageToClient({
      type: 'PERFORMANCE_METRICS',
      metrics: performanceMetrics
    });
    
    // Reset metrics
    performanceMetrics = {
      cacheHits: 0,
      cacheMisses: 0,
      networkRequests: 0,
      syncOperations: 0
    };
  }
}, 60000); // Report every minute

console.log(`SW: High-performance service worker v${CACHE_VERSION} loaded`);