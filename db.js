const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Ensure the database directory exists
const dbDir = path.join(__dirname, 'db');
const dbPath = path.join(dbDir, 'links.db');
// Create db directory if it doesn't exist
if (!fs.existsSync(dbDir)) {
  try {
    fs.mkdirSync(dbDir, { recursive: true, mode: 0o755 });
    console.log('Database directory created:', dbDir);
  } catch (err) {
    console.error('Error creating database directory:', err.message);
  }
}
// Check if we can write to the directory
try {
  const testFile = path.join(dbDir, 'test.tmp');
  fs.writeFileSync(testFile, 'test');
  fs.unlinkSync(testFile);
  console.log('Write permissions confirmed for database directory');
} catch (err) {
  console.error('Write permissions issue:', err.message);
  console.error('Database directory:', dbDir);
}

// Create or connect to the database
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    console.error('Database path:', dbPath);
    console.error('Current working directory:', process.cwd());
    console.error('Directory listing:', fs.readdirSync(path.dirname(dbPath)));
  } else {
    console.log('Connected to the SQLite database.');
    console.log('Database path:', dbPath);
  }
});

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

// Database functions
const dbFunctions = {
  // Create a new link
  createLink: (link) => {
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO links (
          id, title, originalUrl, maxDownloads, currentDownloads,
          expirationHours, createdAt, expiresAt, isActive, isValid, lastChecked, statusCode, error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      const params = [
        link.id,
        link.title || null,
        link.originalUrl,
        link.maxDownloads || null,
        link.currentDownloads || 0,
        link.expirationHours || null,
        link.createdAt.toISOString(),
        link.expiresAt ? link.expiresAt.toISOString() : null,
        link.isActive ? 1 : 0,
        link.isValid !== undefined ? (link.isValid ? 1 : 0) : 1,
        link.lastChecked ? link.lastChecked.toISOString() : null,
        link.statusCode || null,
        link.error || null
      ];
      
      db.run(sql, params, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ id: this.lastID });
        }
      });
    });
  },
  
  // Get a link by ID
  getLink: (id) => {
    return new Promise((resolve, reject) => {
      const sql = `SELECT * FROM links WHERE id = ?`;
      
      db.get(sql, [id], (err, row) => {
        if (err) {
          reject(err);
        } else {
          if (row) {
            // Convert SQLite data to JavaScript objects
            row.currentDownloads = row.currentDownloads || 0;
            row.isActive = row.isActive === 1;
            row.isValid = row.isValid === 1 || row.isValid === undefined;
            row.createdAt = new Date(row.createdAt);
            row.expiresAt = row.expiresAt ? new Date(row.expiresAt) : null;
            row.lastChecked = row.lastChecked ? new Date(row.lastChecked) : null;
          }
          resolve(row);
        }
      });
    });
  },
  
  // Get all links
  getAllLinks: () => {
    return new Promise((resolve, reject) => {
      const sql = `SELECT * FROM links ORDER BY createdAt DESC`;
      
      db.all(sql, [], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          // Convert SQLite data to JavaScript objects
          rows = rows.map(row => {
            row.currentDownloads = row.currentDownloads || 0;
            row.isActive = row.isActive === 1;
            row.isValid = row.isValid === 1 || row.isValid === undefined;
            row.createdAt = new Date(row.createdAt);
            row.expiresAt = row.expiresAt ? new Date(row.expiresAt) : null;
            row.lastChecked = row.lastChecked ? new Date(row.lastChecked) : null;
            return row;
          });
          resolve(rows);
        }
      });
    });
  },
  
  // Update link download count
  incrementDownloadCount: (id) => {
    return new Promise((resolve, reject) => {
      const sql = `UPDATE links SET currentDownloads = currentDownloads + 1 WHERE id = ?`;
      
      db.run(sql, [id], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ changes: this.changes });
        }
      });
    });
  },
  
  // Deactivate a link
  deactivateLink: (id) => {
    return new Promise((resolve, reject) => {
      const sql = `UPDATE links SET isActive = 0 WHERE id = ?`;
      
      db.run(sql, [id], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ changes: this.changes });
        }
      });
    });
  },
  
  // Update a link
  updateLink: (id, updates) => {
    return new Promise((resolve, reject) => {
      let sql = `UPDATE links SET `;
      const fields = [];
      const params = [];
      
      // Build the update query dynamically
      Object.keys(updates).forEach(key => {
        if (key !== 'id') { // Don't update the ID
          fields.push(`${key} = ?`);
          params.push(updates[key]);
        }
      });
      
      if (fields.length === 0) {
        return resolve({ changes: 0 });
      }
      
      sql += fields.join(', ') + ' WHERE id = ?';
      params.push(id);
      
      db.run(sql, params, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ changes: this.changes });
        }
      });
    });
  },
  
  // Delete a link
  deleteLink: (id) => {
    return new Promise((resolve, reject) => {
      const sql = `DELETE FROM links WHERE id = ?`;
      
      db.run(sql, [id], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ changes: this.changes });
        }
      });
    });
  },
  
  // User management functions
  
  // Create a new user
  createUser: (username, hashedPassword, role = 'user') => {
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO users (username, password, role, createdAt)
        VALUES (?, ?, ?, ?)
      `;
      
      const params = [
        username,
        hashedPassword,
        role,
        new Date().toISOString()
      ];
      
      db.run(sql, params, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ id: this.lastID });
        }
      });
    });
  },
  
  // Get user by username
  getUserByUsername: (username) => {
    return new Promise((resolve, reject) => {
      const sql = `SELECT * FROM users WHERE username = ?`;
      
      db.get(sql, [username], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  },
  
  // Get user by ID
  getUserById: (id) => {
    return new Promise((resolve, reject) => {
      const sql = `SELECT * FROM users WHERE id = ?`;
      
      db.get(sql, [id], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  },
  
  // Get all users
  getAllUsers: () => {
    return new Promise((resolve, reject) => {
      const sql = `SELECT id, username, role, createdAt FROM users ORDER BY createdAt DESC`;
      
      db.all(sql, [], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  },
  
  // Get all users with passwords (for internal use only)
  getAllUsersWithPasswords: () => {
    return new Promise((resolve, reject) => {
      const sql = `SELECT * FROM users ORDER BY createdAt DESC`;
      
      db.all(sql, [], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  },
  
  // Update user password
  updateUserPassword: (userId, hashedPassword) => {
    return new Promise((resolve, reject) => {
      const sql = `UPDATE users SET password = ? WHERE id = ?`;
      
      db.run(sql, [hashedPassword, userId], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ changes: this.changes });
        }
      });
    });
  },
  
  // Update user information
  updateUser: (userId, updates) => {
    return new Promise((resolve, reject) => {
      let sql = `UPDATE users SET `;
      const fields = [];
      const params = [];
      
      // Build the update query dynamically
      Object.keys(updates).forEach(key => {
        if (key !== 'id') { // Don't update the ID
          fields.push(`${key} = ?`);
          params.push(updates[key]);
        }
      });
      
      if (fields.length === 0) {
        return resolve({ changes: 0 });
      }
      
      sql += fields.join(', ') + ' WHERE id = ?';
      params.push(userId);
      
      db.run(sql, params, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ changes: this.changes });
        }
      });
    });
  },
  
  // Delete user
  deleteUser: (userId) => {
    return new Promise((resolve, reject) => {
      const sql = `DELETE FROM users WHERE id = ?`;
      
      db.run(sql, [userId], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ changes: this.changes });
        }
      });
    });
  },
  
  // Close the database connection
  close: () => {
    db.close((err) => {
      if (err) {
        console.error('Error closing database:', err.message);
      } else {
        console.log('Database connection closed.');
      }
    });
  }
};

module.exports = dbFunctions;