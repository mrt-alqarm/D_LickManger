const express = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const cheerio = require('cheerio');
const bcrypt = require('bcrypt');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Session storage (in production, use a proper session store)
const sessions = new Map();

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Authentication middleware
function requireAuth(req, res, next) {
  const sessionId = req.headers['x-session-id'] || req.query.sessionId;
  
  // For simplicity, we're checking the session ID in the query string or header
  // In a real application, you would use proper session management
  if (sessionId && sessions.has(sessionId)) {
    req.session = { userId: sessions.get(sessionId) };
    next();
  } else {
    // For API routes, return JSON error
    if (req.path.startsWith('/api/')) {
      res.status(401).json({ error: 'Authentication required' });
    } else {
      // For page routes, redirect to login
      res.redirect('/login.html');
    }
  }
}

// Admin authorization middleware
async function requireAdmin(req, res, next) {
  const sessionId = req.headers['x-session-id'] || req.query.sessionId;
  
  if (!sessionId || !sessions.has(sessionId)) {
    // For API routes, return JSON error
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Authentication required' });
    } else {
      // For page routes, redirect to login
      return res.redirect('/login.html');
    }
  }
  
  // Get user from database
  const userId = sessions.get(sessionId);
  try {
    const user = await db.getUserById(userId);
    if (!user || user.role !== 'admin') {
      // For API routes, return JSON error
      if (req.path.startsWith('/api/')) {
        return res.status(403).json({ error: 'Admin access required' });
      } else {
        // For page routes, redirect to main page
        return res.redirect('/');
      }
    }
    
    req.session = { userId, user };
    next();
  } catch (err) {
    console.error('Error checking user role:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Generate a simple session ID (in production, use a proper session library)
function generateSessionId() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// In-memory storage for links (in production, use a database)
const links = new Map();

// Routes

// Serve the main page (requires authentication)
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve the login page
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Serve the users management page (requires authentication)
app.get('/users.html', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'users.html'));
});

// Create a new download link (requires authentication)
app.post('/api/links', requireAuth, (req, res) => {
  const { title, originalUrl, maxDownloads, expirationHours } = req.body;
  
  // Validate input
  if (!originalUrl) {
    return res.status(400).json({ error: 'Original URL is required' });
  }
  
  // Generate a unique ID for the link
  const id = uuidv4();
  
  // Calculate expiration time
  const createdAt = new Date();
  const expiresAt = expirationHours ?
    new Date(createdAt.getTime() + expirationHours * 60 * 60 * 1000) :
    null;
  
  // Create link object
  const link = {
    id,
    title: title || null,
    originalUrl,
    maxDownloads: maxDownloads || null,
    currentDownloads: 0,
    expirationHours: expirationHours || null,
    createdAt,
    expiresAt,
    isActive: true
  };
  
  // Store the link in the database
  db.createLink(link)
    .then(() => {
      // Generate the tracking URL
      const trackingUrl = `${req.protocol}://${req.get('host')}/download/${id}`;
      
      res.json({
        id,
        title,
        trackingUrl,
        originalUrl,
        maxDownloads,
        expirationHours,
        createdAt,
        expiresAt
      });
    })
    .catch(err => {
      console.error('Error creating link:', err);
      res.status(500).json({ error: 'Failed to create link' });
    });
});

// Get link info (requires authentication)
app.get('/api/links/:id', requireAuth, (req, res) => {
  db.getLink(req.params.id)
    .then(link => {
      if (!link) {
        return res.status(404).json({ error: 'Link not found' });
      }
      
      res.json(link);
    })
    .catch(err => {
      console.error('Error fetching link:', err);
      res.status(500).json({ error: 'Failed to fetch link' });
    });
});

// Function to extract download link and metadata from HTML content
function extractPcloudInfo(htmlContent, originalUrl) {
  // Parse HTML with cheerio
  const $ = cheerio.load(htmlContent);
  
  // Check if this is a pCloud link
  if (originalUrl.includes('pcloud.link') || originalUrl.includes('pcloud.com')) {
    // Look for the publinkData script
    const scripts = $('script');
    for (let i = 0; i < scripts.length; i++) {
      const scriptContent = $(scripts[i]).html();
      if (scriptContent && scriptContent.includes('publinkData')) {
        // Extract the downloadlink property
        const downloadLinkMatch = scriptContent.match(/"downloadlink"\s*:\s*"([^"]+)"/);
        let downloadLink = null;
        if (downloadLinkMatch && downloadLinkMatch[1]) {
          // Replace escaped forward slashes
          downloadLink = downloadLinkMatch[1].replace(/\\\//g, '/');
        }
        
        // Extract the metadata to get the filename
        const metadataMatch = scriptContent.match(/"metadata"\s*:\s*({[^}]+})/);
        let filename = null;
        if (metadataMatch && metadataMatch[1]) {
          try {
            // Parse the metadata JSON
            const metadata = JSON.parse(metadataMatch[1].replace(/\\/g, ''));
            if (metadata.name) {
              filename = metadata.name;
            }
          } catch (e) {
            console.error('Error parsing metadata:', e);
          }
        }
        
        return {
          downloadLink,
          filename
        };
      }
    }
  }
  
  // For other services, you could add similar extraction logic here
  // For now, we'll return null to indicate no special handling is needed
  return null;
}

// Track download request and serve file content
app.get('/download/:id', (req, res) => {
  // Get link from database
  db.getLink(req.params.id)
    .then(link => {
      if (!link) {
        return res.status(404).json({ error: 'Link not found' });
      }
      
      // Check if link is active
      if (!link.isActive) {
        return res.status(400).json({ error: 'This link is no longer active' });
      }
      
      // Check expiration
      if (link.expiresAt && new Date() > new Date(link.expiresAt)) {
        // Deactivate the link
        db.deactivateLink(link.id)
          .then(() => {
            res.status(400).json({ error: 'This link has expired' });
          })
          .catch(err => {
            console.error('Error deactivating link:', err);
            res.status(400).json({ error: 'This link has expired' });
          });
        return;
      }
      
      // Check download limit
      if (link.maxDownloads && link.currentDownloads >= link.maxDownloads) {
        // Deactivate the link
        db.deactivateLink(link.id)
          .then(() => {
            res.status(400).json({ error: 'Download limit reached' });
          })
          .catch(err => {
            console.error('Error deactivating link:', err);
            res.status(400).json({ error: 'Download limit reached' });
          });
        return;
      }
      
      // Increment download counter
      db.incrementDownloadCount(link.id)
        .then(() => {
          // Check if we've reached the limit and need to deactivate
          if (link.maxDownloads && link.currentDownloads + 1 >= link.maxDownloads) {
            return db.deactivateLink(link.id);
          }
        })
        .catch(err => {
          console.error('Error updating download count:', err);
        });
      
      // Extract filename from URL for Content-Disposition header (fallback)
      const urlObj = new URL(link.originalUrl);
      const pathname = urlObj.pathname;
      let filename = pathname.split('/').pop() || 'download';
      
      // Set default headers for file download
      res.setHeader('Content-Type', 'application/octet-stream');
      
      // Function to download file from a given URL
      function downloadFile(fileUrl, originalFilename = null) {
        // Use the original filename if provided
        if (originalFilename) {
          filename = originalFilename;
        }
        
        // Set headers for file download
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        
        // Fetch file from URL and pipe to response
        const protocol = fileUrl.startsWith('https') ? https : http;
        
        const fileReq = protocol.get(fileUrl, (fileRes) => {
          // Handle redirects
          if (fileRes.statusCode >= 300 && fileRes.statusCode < 400 && fileRes.headers.location) {
            // For simplicity, we'll redirect in this case
            // A more robust solution would follow redirects
            res.redirect(fileRes.headers.location);
            return;
          }
          
          // Check if request was successful
          if (fileRes.statusCode !== 200) {
            return res.status(fileRes.statusCode).json({
              error: `Failed to fetch file: ${fileRes.statusCode}`
            });
          }
          
          // Set content type from original response if available
          if (fileRes.headers['content-type']) {
            res.setHeader('Content-Type', fileRes.headers['content-type']);
          }
          
          // Set content length if available
          if (fileRes.headers['content-length']) {
            res.setHeader('Content-Length', fileRes.headers['content-length']);
          }
          
          // Pipe the file content to the response
          fileRes.pipe(res);
        }).on('error', (err) => {
          console.error('Error fetching file:', err);
          // Only send error response if headers haven't been sent
          if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to fetch file' });
          }
        });
        
        // Set a timeout for the request
        fileReq.setTimeout(30000, () => {
          fileReq.destroy();
          if (!res.headersSent) {
            res.status(500).json({ error: 'Request timeout' });
          }
        });
      }
      
      // First, fetch the original URL to check if it's a file sharing service
      const protocol = link.originalUrl.startsWith('https') ? https : http;
      
      protocol.get(link.originalUrl, (initialRes) => {
        // Check if this is HTML content (indicating a file sharing service page)
        const contentType = initialRes.headers['content-type'];
        if (contentType && contentType.includes('text/html')) {
          // Collect the HTML content
          let htmlContent = '';
          initialRes.on('data', (chunk) => {
            htmlContent += chunk;
          });
          
          initialRes.on('end', () => {
                      // Try to extract the real download link and filename
                                  const pcloudInfo = extractPcloudInfo(htmlContent, link.originalUrl);
                                  
                                  if (pcloudInfo && pcloudInfo.downloadLink) {
                                    // Download from the extracted link with the correct filename
                                    downloadFile(pcloudInfo.downloadLink, pcloudInfo.filename);
                                  } else {
                                    // If we can't extract a link, just pipe the HTML content
                                    // This will likely result in the user downloading the HTML page
                                    // Set appropriate headers for HTML content
                                    res.setHeader('Content-Disposition', `attachment; filename="${filename}.html"`);
                                    res.setHeader('Content-Type', 'text/html');
                                    res.send(htmlContent);
                                  }
                    });
        } else {
          // This is likely a direct file link, pipe it directly
          // Set content type from original response if available
          if (initialRes.headers['content-type']) {
            res.setHeader('Content-Type', initialRes.headers['content-type']);
          }
          
          // Set content length if available
          if (initialRes.headers['content-length']) {
            res.setHeader('Content-Length', initialRes.headers['content-length']);
          }
          
          // Set the filename from the content disposition header if available
          const contentDisposition = initialRes.headers['content-disposition'];
          if (contentDisposition) {
            const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
            if (filenameMatch && filenameMatch[1]) {
              filename = filenameMatch[1].replace(/['"]/g, '');
              res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            }
          } else {
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
          }
          
          // Pipe the file content to the response
          initialRes.pipe(res);
        }
      }).on('error', (err) => {
        console.error('Error fetching initial URL:', err);
        // Only send error response if headers haven't been sent
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to fetch file' });
        }
      });
    })
    .catch(err => {
      console.error('Error fetching link:', err);
      res.status(500).json({ error: 'Failed to fetch link' });
    });
});

// Get all links (for admin purposes, requires authentication)
app.get('/api/links', requireAuth, (req, res) => {
  db.getAllLinks()
    .then(links => {
      res.json(links);
    })
    .catch(err => {
      console.error('Error fetching links:', err);
      res.status(500).json({ error: 'Failed to fetch links' });
    });
});

// Update a link (requires authentication)
app.put('/api/links/:id', requireAuth, (req, res) => {
  const { title, originalUrl, maxDownloads, expirationHours } = req.body;
  
  // Prepare updates object
  const updates = {};
  if (title !== undefined) updates.title = title;
  if (originalUrl !== undefined) updates.originalUrl = originalUrl;
  if (maxDownloads !== undefined) updates.maxDownloads = maxDownloads;
  if (expirationHours !== undefined) updates.expirationHours = expirationHours;
  
  // If expirationHours is provided, recalculate expiresAt
  if (expirationHours !== undefined) {
    if (expirationHours === null) {
      updates.expiresAt = null;
    } else {
      // Get the link to find its creation time
      db.getLink(req.params.id)
        .then(link => {
          if (!link) {
            return res.status(404).json({ error: 'Link not found' });
          }
          
          const createdAt = link.createdAt;
          const expiresAt = new Date(createdAt.getTime() + expirationHours * 60 * 60 * 1000);
          updates.expiresAt = expiresAt.toISOString();
          
          // Update the link
          return db.updateLink(req.params.id, updates);
        })
        .then(result => {
          if (result.changes === 0) {
            return res.status(404).json({ error: 'Link not found' });
          }
          
          // Fetch and return the updated link
          return db.getLink(req.params.id);
        })
        .then(updatedLink => {
          res.json(updatedLink);
        })
        .catch(err => {
          console.error('Error updating link:', err);
          res.status(500).json({ error: 'Failed to update link' });
        });
    }
  } else {
    // Update the link without recalculating expiresAt
    db.updateLink(req.params.id, updates)
      .then(result => {
        if (result.changes === 0) {
          return res.status(404).json({ error: 'Link not found' });
        }
        
        // Fetch and return the updated link
        return db.getLink(req.params.id);
      })
      .then(updatedLink => {
        res.json(updatedLink);
      })
      .catch(err => {
        console.error('Error updating link:', err);
        res.status(500).json({ error: 'Failed to update link' });
      });
  }
});

// Delete a link (requires authentication)
app.delete('/api/links/:id', requireAuth, (req, res) => {
  db.deleteLink(req.params.id)
    .then(result => {
      if (result.changes === 0) {
        return res.status(404).json({ error: 'Link not found' });
      }
      
      res.json({ message: 'Link deleted successfully' });
    })
    .catch(err => {
      console.error('Error deleting link:', err);
      res.status(500).json({ error: 'Failed to delete link' });
    });
});

// Reset download count for a link (requires authentication)
app.post('/api/links/:id/reset', requireAuth, (req, res) => {
  db.updateLink(req.params.id, { currentDownloads: 0, isActive: 1 })
    .then(result => {
      if (result.changes === 0) {
        return res.status(404).json({ error: 'Link not found' });
      }
      
      // Fetch and return the updated link
      return db.getLink(req.params.id);
    })
    .then(updatedLink => {
      res.json(updatedLink);
    })
    .catch(err => {
      console.error('Error resetting link:', err);
      res.status(500).json({ error: 'Failed to reset link' });
    });
});

// Check link validity (requires authentication)
app.post('/api/links/:id/check', requireAuth, async (req, res) => {
  try {
    // Get link from database
    const link = await db.getLink(req.params.id);
    
    if (!link) {
      return res.status(404).json({ error: 'Link not found' });
    }
    
    // Make a HEAD request to check if the link is valid
    const url = link.originalUrl;
    const protocol = url.startsWith('https') ? https : http;
    
    const checkResult = await new Promise((resolve) => {
      const request = protocol.request(url, { method: 'HEAD' }, (response) => {
        resolve({
          isValid: response.statusCode >= 200 && response.statusCode < 400,
          statusCode: response.statusCode,
          headers: response.headers
        });
      });
      
      request.on('error', (error) => {
        resolve({
          isValid: false,
          error: error.message,
          statusCode: null
        });
      });
      
      request.setTimeout(10000, () => {
        request.destroy();
        resolve({
          isValid: false,
          error: 'Request timeout',
          statusCode: null
        });
      });
      
      request.end();
    });
    
    // Update link with validity information
    const updates = {
      isValid: checkResult.isValid ? 1 : 0,
      lastChecked: new Date().toISOString(),
      statusCode: checkResult.statusCode,
      error: checkResult.error || null
    };
    
    await db.updateLink(req.params.id, updates);
    
    // Fetch and return the updated link
    const updatedLink = await db.getLink(req.params.id);
    res.json(updatedLink);
  } catch (err) {
    console.error('Error checking link validity:', err);
    res.status(500).json({ error: 'Failed to check link validity' });
  }
});

// Refresh link (check validity and update status) (requires authentication)
app.post('/api/links/:id/refresh', requireAuth, async (req, res) => {
  try {
    // Get link from database
    const link = await db.getLink(req.params.id);
    
    if (!link) {
      return res.status(404).json({ error: 'Link not found' });
    }
    
    // Make a HEAD request to check if the link is valid
    const url = link.originalUrl;
    const protocol = url.startsWith('https') ? https : http;
    
    const checkResult = await new Promise((resolve) => {
      const request = protocol.request(url, { method: 'HEAD' }, (response) => {
        resolve({
          isValid: response.statusCode >= 200 && response.statusCode < 400,
          statusCode: response.statusCode,
          headers: response.headers
        });
      });
      
      request.on('error', (error) => {
        resolve({
          isValid: false,
          error: error.message,
          statusCode: null
        });
      });
      
      request.setTimeout(10000, () => {
        request.destroy();
        resolve({
          isValid: false,
          error: 'Request timeout',
          statusCode: null
        });
      });
      
      request.end();
    });
    
    // Prepare updates
    const updates = {
      lastChecked: new Date().toISOString(),
      statusCode: checkResult.statusCode,
      error: checkResult.error || null
    };
    
    // If the link is valid and was previously inactive, reactivate it
    let message = '';
    if (checkResult.isValid) {
      updates.isValid = 1;
      // Only reactivate if it was inactive due to validity issues, not due to expiration or download limits
      const isExpired = link.expiresAt && new Date() > new Date(link.expiresAt);
      const isLimitReached = link.maxDownloads && link.currentDownloads >= link.maxDownloads;
      if (!isExpired && !isLimitReached) {
        updates.isActive = 1;
      }
      message = 'Link is valid and has been refreshed';
    } else {
      updates.isValid = 0;
      message = 'Link is invalid and has been marked as such';
    }
    
    // Update link with validity information
    await db.updateLink(req.params.id, updates);
    
    // Fetch and return the updated link
    const updatedLink = await db.getLink(req.params.id);
    res.json({ ...updatedLink, message });
  } catch (err) {
    console.error('Error refreshing link:', err);
    res.status(500).json({ error: 'Failed to refresh link' });
  }
});

// User authentication routes

// Get user role endpoint
app.get('/api/user-role', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const user = await db.getUserById(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ role: user.role });
  } catch (err) {
    console.error('Error getting user role:', err);
    res.status(500).json({ error: 'Failed to get user role' });
  }
});

// Verify session endpoint (for login page verification)
app.get('/api/verify-session', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const user = await db.getUserById(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ valid: true, role: user.role });
  } catch (err) {
    console.error('Error verifying session:', err);
    res.status(500).json({ error: 'Failed to verify session' });
  }
});

// Login route
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Validate input
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    console.log('Login attempt for user:', username);
    
    // Get user from database
    const user = await db.getUserByUsername(username);
    
    console.log('User found in database:', user);
    
    if (!user) {
      console.log('User not found in database');
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    // Compare passwords
    console.log('Comparing password with hash:', password, user.password);
    const isPasswordValid = await bcrypt.compare(password, user.password);
    console.log('Password valid:', isPasswordValid);
    
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    // Create session
    const sessionId = generateSessionId();
    sessions.set(sessionId, user.id);
    
    console.log('Login successful for user:', username, 'with session ID:', sessionId);
    
    // Return success with session ID
    res.json({
      success: true,
      sessionId,
      username: user.username
    });
  } catch (err) {
    console.error('Error during login:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Logout route
app.post('/api/logout', (req, res) => {
  const sessionId = req.headers['x-session-id'];
  
  if (sessionId && sessions.has(sessionId)) {
    sessions.delete(sessionId);
  }
  
  res.json({ success: true });
});

// User management routes (require authentication)

// Create user
app.post('/api/users', requireAdmin, async (req, res) => {
  try {
    const { username, password, role } = req.body;
    
    // Validate input
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    // Check if user already exists
    const existingUser = await db.getUserByUsername(username);
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create user in database with role
    const userRole = role === 'admin' ? 'admin' : 'user';
    const result = await db.createUser(username, hashedPassword, userRole);
    
    res.status(201).json({
      success: true,
      id: result.id,
      username,
      role: userRole
    });
  } catch (err) {
    console.error('Error creating user:', err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Get all users
app.get('/api/users', requireAuth, async (req, res) => {
  try {
    const users = await db.getAllUsers();
    res.json(users);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Delete user
app.delete('/api/users/:id', requireAuth, async (req, res) => {
  try {
    // Prevent deleting the last user
    const users = await db.getAllUsers();
    if (users.length <= 1) {
      return res.status(400).json({ error: 'Cannot delete the last user' });
    }
    
    // Prevent users from deleting themselves
    if (parseInt(req.params.id) === req.session.userId) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    
    const result = await db.deleteUser(req.params.id);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    console.error('Error deleting user:', err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Change user password
app.put('/api/users/:id/password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    // Validate input
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }
    
    // Get user from database by ID
    const user = await db.getUserById(req.params.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Compare current passwords
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    
    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    // Update password in database
    await db.updateUserPassword(req.params.id, hashedPassword);
    
    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    console.error('Error updating password:', err);
    res.status(500).json({ error: 'Failed to update password' });
  }
});

// Update user information (username)
app.put('/api/users/:id', requireAuth, async (req, res) => {
  try {
    const { username } = req.body;
    
    // Validate input
    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }
    
    // Check if username already exists (for other users)
    const existingUser = await db.getUserByUsername(username);
    if (existingUser && existingUser.id != req.params.id) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    
    // Update username in database
    const updates = { username };
    const result = await db.updateUser(req.params.id, updates);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ success: true, message: 'User updated successfully' });
  } catch (err) {
    console.error('Error updating user:', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Add updateUser function to db module
// This would need to be added to the db.js file

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
  
  // Create default admin user if no users exist
  db.getAllUsers()
    .then(users => {
      console.log('Existing users in database:', users);
      if (users.length === 0) {
        console.log('No existing users found, creating default admin user');
        bcrypt.hash('admin123', 10)
          .then(hashedPassword => {
            console.log('Password hashed successfully');
            return db.createUser('admin', hashedPassword, 'admin');
          })
          .then((result) => {
            console.log('Default admin user created (username: admin, password: admin123)', result);
          })
          .catch(err => {
            console.error('Error creating default admin user:', err);
          });
      } else {
        console.log('Users already exist in database, skipping default user creation');
      }
    })
    .catch(err => {
      console.error('Error checking for existing users:', err);
    });
});