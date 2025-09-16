const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Ensure the database directory exists
let dbDir;
let dbPath;

// Check if we're in Railway environment
if (process.env.RAILWAY_VOLUME_MOUNT_PATH) {
  // Use Railway's volume mount path
  dbDir = path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'db');
} else {
  // Use local path
  dbDir = path.join(__dirname, 'db');
}

// Create db directory if it doesn't exist
if (!fs.existsSync(dbDir)) {
  try {
    fs.mkdirSync(dbDir, { recursive: true });
    console.log('Database directory created:', dbDir);
  } catch (err) {
    console.log('Using /tmp for database due to permission issues');
    dbDir = '/tmp/db';
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
  }
}

dbPath = path.join(dbDir, 'links.db');
console.log('Database path:', dbPath);

// Test write permissions
try {
  const testFile = path.join(dbDir, 'write-test.tmp');
  fs.writeFileSync(testFile, 'test');
  fs.unlinkSync(testFile);
  console.log('Write permissions confirmed for database directory');
} catch (err) {
  console.log('Write permissions issue, using /tmp instead');
  dbDir = '/tmp/db';
  dbPath = path.join(dbDir, 'links.db');
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
}

// Create or connect to the database
let db;
try {
  db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      console.error('Error opening database:', err.message);
    } else {
      console.log('Connected to the SQLite database at:', dbPath);
    }
  });
} catch (err) {
  console.error('Database connection failed, trying fallback');
  const fallbackPath = path.join('/tmp', 'links.db');
  db = new sqlite3.Database(fallbackPath, (err) => {
    if (err) {
      console.error('Fallback database connection also failed:', err.message);
    } else {
      console.log('Connected to fallback database at:', fallbackPath);
    }
  });
}

// Initialize the database tables
db.serialize(() => {
  // Create links table
  db.run(`
    CREATE TABLE IF NOT EXISTS links (
      id TEXT PRIMARY KEY,
      title TEXT,
      originalUrl TEXT NOT NULL,
      maxDownloads INTEGER,
      currentDownloads INTEGER DEFAULT 0,
      expirationHours INTEGER,
      createdAt TEXT NOT NULL,
      expiresAt TEXT,
      isActive INTEGER DEFAULT 1,
      isValid INTEGER DEFAULT 1,
      lastChecked TEXT,
      statusCode INTEGER,
      error TEXT
    )
  `, (err) => {
    if (err) {
      console.error('Error creating links table:', err.message);
    } else {
      console.log('Links table ready.');
    }
  });
  
  // Add isValid column if it doesn't exist (for existing databases)
  db.run(`ALTER TABLE links ADD COLUMN isValid INTEGER DEFAULT 1`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding isValid column:', err.message);
    }
  });
  
  // Add lastChecked column if it doesn't exist (for existing databases)
  db.run(`ALTER TABLE links ADD COLUMN lastChecked TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding lastChecked column:', err.message);
    }
  });
  
  // Add statusCode column if it doesn't exist (for existing databases)
  db.run(`ALTER TABLE links ADD COLUMN statusCode INTEGER`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding statusCode column:', err.message);
    }
  });
  
  // Add error column if it doesn't exist (for existing databases)
  db.run(`ALTER TABLE links ADD COLUMN error TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding error column:', err.message);
    }
  });
  
  // Create users table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      createdAt TEXT NOT NULL
    )
  `, (err) => {
    if (err) {
      console.error('Error creating users table:', err.message);
    } else {
      console.log('Users table ready.');
    }
  });
  
  // Add role column if it doesn't exist (for existing databases)
  db.run(`ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding role column:', err.message);
    }
  });
});

// Rest of your existing database functions...
// Keep all your existing functions exactly as they were
// (createLink, getLink, getAllLinks, etc.)
