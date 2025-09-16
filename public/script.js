// DOM Elements
const linkForm = document.getElementById('link-form');
const resultDiv = document.getElementById('result');
const trackingUrlElement = document.getElementById('trackingUrl');
const copyButton = document.getElementById('copyButton');
const linksListElement = document.getElementById('links-list');
const logoutButton = document.getElementById('logout-button');
const searchInput = document.getElementById('search-input');
const searchButton = document.getElementById('search-button');
const clearSearchButton = document.getElementById('clear-search-button');

// Global variable to store user role
let currentUserRole = 'user'; // Default role

// Get session ID from localStorage
let sessionId = localStorage.getItem('sessionId');

// Check if user is authenticated - but only after DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    // Check if we're on the login page
    if (window.location.pathname === '/login.html') {
        // On login page, check if user is already logged in
        if (sessionId) {
            // Verify session
            fetch('/api/user-role', {
                headers: {
                    'X-Session-ID': sessionId
                }
            })
            .then(response => {
                if (response.ok) {
                    // User is authenticated, redirect to main page
                    window.location.href = '/';
                } else {
                    // Session invalid, remove it
                    localStorage.removeItem('sessionId');
                }
            })
            .catch(error => {
                console.error('Error verifying session:', error);
                localStorage.removeItem('sessionId');
            });
        }
        return; // Don't continue with authentication checks on login page
    }
    
    // For other pages, check authentication
    if (!sessionId) {
        window.location.href = '/login.html';
        return;
    }
    
    // Verify session and get user role
    checkUserRole();
});

// Event Listeners
linkForm.addEventListener('submit', handleFormSubmit);
copyButton.addEventListener('click', copyToClipboard);

// Add logout button event listener if it exists
if (logoutButton) {
    logoutButton.addEventListener('click', logout);
}

// Add search event listeners
if (searchButton) {
    searchButton.addEventListener('click', performSearch);
}

if (searchInput) {
    searchInput.addEventListener('keyup', function(event) {
        if (event.key === 'Enter') {
            performSearch();
        }
    });
}

if (clearSearchButton) {
    clearSearchButton.addEventListener('click', clearSearch);
}

// Variable to track search state
let isSearchActive = false;

// Check user role when page loads
// Note: checkUserRole is already called in the DOMContentLoaded handler above
// We don't need to call it again to avoid duplicate button creation

// Check user role
function checkUserRole() {
    if (!sessionId) {
        // Not authenticated, redirect to login
        window.location.href = '/login.html';
        return;
    }
    
    // Fetch user role from server
    fetch('/api/user-role', {
        headers: {
            'X-Session-ID': sessionId
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            // Redirect to login if not authenticated
            window.location.href = '/login.html';
            return;
        }
        
        currentUserRole = data.role;
        
        // Update UI based on user role
        updateUIBasedOnRole();
    })
    .catch(error => {
        console.error('Error checking user role:', error);
        // Redirect to login if error
        window.location.href = '/login.html';
    });
}

// Update UI based on user role
function updateUIBasedOnRole() {
    // Hide create link section for regular users
    if (currentUserRole !== 'admin') {
        document.getElementById('create-link-section').style.display = 'none';
    }
    
    // Show user management button for admins
    if (currentUserRole === 'admin') {
        const userManagementButton = document.createElement('a');
        userManagementButton.href = '/users.html';
        userManagementButton.className = 'button user-mgmt-button';
        userManagementButton.textContent = 'User Management';
        document.getElementById('header-actions').insertBefore(userManagementButton, document.getElementById('header-actions').firstChild);
    }
}

// Handle form submission
function handleFormSubmit(event) {
    event.preventDefault();
    
    // Only allow admin users to create links
    if (currentUserRole !== 'admin') {
        alert('Only administrators can create new links.');
        return;
    }
    
    const title = document.getElementById('title').value || null;
    const originalUrl = document.getElementById('originalUrl').value;
    const maxDownloads = document.getElementById('maxDownloads').value || null;
    const expirationHours = document.getElementById('expirationHours').value || null;
    
    createTrackingLink(title, originalUrl, maxDownloads, expirationHours);
}

// Create tracking link
function createTrackingLink(title, originalUrl, maxDownloads, expirationHours) {
    const data = {
        title,
        originalUrl,
        maxDownloads: maxDownloads ? parseInt(maxDownloads) : null,
        expirationHours: expirationHours ? parseInt(expirationHours) : null
    };
    
    fetch('/api/links', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Session-ID': sessionId
        },
        body: JSON.stringify(data)
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            alert('Error: ' + data.error);
            return;
        }
        
        // Display the tracking URL
        trackingUrlElement.textContent = data.trackingUrl;
        resultDiv.classList.remove('hidden');
        
        // Refresh links list
        loadLinks();
        
        // Reset form
        document.getElementById('link-form').reset();
    })
    .catch(error => {
        console.error('Error:', error);
        alert('An error occurred while creating the link');
    });
}

// Copy to clipboard
function copyToClipboard() {
    const text = trackingUrlElement.textContent;
    
    navigator.clipboard.writeText(text)
        .then(() => {
            // Show feedback
            const originalText = copyButton.textContent;
            copyButton.textContent = 'Copied!';
            setTimeout(() => {
                copyButton.textContent = originalText;
            }, 2000);
        })
        .catch(err => {
            console.error('Failed to copy: ', err);
            alert('Failed to copy to clipboard');
        });
}

// Load and display links
function loadLinks() {
    fetch('/api/links', {
        headers: {
            'X-Session-ID': sessionId
        }
    })
        .then(response => response.json())
        .then(links => {
            displayLinks(links);
        })
        .catch(error => {
            console.error('Error loading links:', error);
            linksListElement.innerHTML = '<p>Error loading links</p>';
        });
}

// Perform search
function performSearch() {
    const searchTerm = searchInput.value.trim();
    
    if (searchTerm === '') {
        // If search is empty and we were in search mode, clear search
        if (isSearchActive) {
            clearSearch();
            return;
        }
        // Otherwise, just load all links
        loadLinks();
        return;
    }
    
    // Set search state
    isSearchActive = true;
    clearSearchButton.style.display = 'inline-block';
    
    // Filter links by title
    fetch('/api/links', {
        headers: {
            'X-Session-ID': sessionId
        }
    })
        .then(response => response.json())
        .then(links => {
            const filteredLinks = links.filter(link =>
                link.title && link.title.toLowerCase().includes(searchTerm.toLowerCase())
            );
            displayLinks(filteredLinks);
        })
        .catch(error => {
            console.error('Error searching links:', error);
            linksListElement.innerHTML = '<p>Error searching links</p>';
        });
}

// Clear search
function clearSearch() {
    searchInput.value = '';
    isSearchActive = false;
    clearSearchButton.style.display = 'none';
    loadLinks();
}

// Display links as cards with toggle functionality
function displayLinks(links) {
    if (links.length === 0) {
        linksListElement.innerHTML = '<p>No links found</p>';
        return;
    }
    
    // Sort links by creation date (newest first)
    links.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    let html = '<div class="links-grid">';
    
    links.forEach(link => {
        const isExpired = link.expiresAt && new Date() > new Date(link.expiresAt);
        const isLimitReached = link.maxDownloads && link.currentDownloads >= link.maxDownloads;
        const isActive = link.isActive && !isExpired && !isLimitReached;
        
        const statusClass = isActive ? 'active' : (isExpired ? 'expired' : 'limit-reached');
        const statusText = isActive ? 'Active' : (isExpired ? 'Expired' : 'Limit Reached');
        
        // Format expiration date
        const expiresDate = link.expiresAt ? new Date(link.expiresAt).toLocaleDateString() : 'Never';
        
        // Format dates for expanded view
        const createdDate = new Date(link.createdAt).toLocaleString();
        const expiresDateTime = link.expiresAt ? new Date(link.expiresAt).toLocaleString() : 'Never';
        
        html += `
            <div class="link-card" data-id="${link.id}">
                <!-- Collapsed view -->
                <div class="link-card-collapsed">
                    <div class="link-card-header">
                        <h3 class="link-card-title">${link.title || 'Untitled Link'}</h3>
                        <span class="link-card-status ${statusClass}">${statusText}</span>
                    </div>
                    <div class="link-card-details">
                        <div>Downloads: ${link.currentDownloads}${link.maxDownloads ? ` / ${link.maxDownloads}` : ' (Unlimited)'}</div>
                        <div class="link-card-expiry">Expires: ${expiresDate}</div>
                    </div>
                </div>
                
                <!-- Expanded view (hidden by default) -->
                <div class="link-card-expanded hidden">
                    <div class="link-card-header">
                        <h3 class="link-card-title">${link.title || 'Untitled Link'}</h3>
                        <span class="link-card-status ${statusClass}">${statusText}</span>
                    </div>
                    <div class="link-card-details-expanded">
                        <div><strong>ID:</strong> ${link.id}</div>
                        <div><strong>Status:</strong> <span class="${statusClass}">${statusText}</span></div>
                        <div><strong>Downloads:</strong> ${link.currentDownloads}${link.maxDownloads ? ` / ${link.maxDownloads}` : ' (Unlimited)'}</div>
                        <div><strong>Created:</strong> ${createdDate}</div>
                        <div><strong>Expires:</strong> ${expiresDateTime}</div>
                        ${currentUserRole === 'admin' ? `<div><strong>Original URL:</strong> ${link.originalUrl}</div>` : ''}
                        <div><strong>Tracking URL:</strong> <a href="/download/${link.id}" target="_blank">/download/${link.id}</a></div>
                    </div>
                    ${currentUserRole === 'admin' ? `
                    <div class="link-actions">
                        <button class="edit-button" data-id="${link.id}">Edit</button>
                        <button class="delete-button" data-id="${link.id}">Delete</button>
                        <button class="reset-button" data-id="${link.id}">Reset Downloads</button>
                    </div>
                    ` : ''}
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    linksListElement.innerHTML = html;
    
    // Add event listeners for card clicks
    document.querySelectorAll('.link-card').forEach(card => {
        card.addEventListener('click', function(e) {
            // Prevent toggle when clicking on action buttons
            if (e.target.classList.contains('edit-button') ||
                e.target.classList.contains('delete-button') ||
                e.target.classList.contains('reset-button')) {
                return;
            }
            
            const id = card.getAttribute('data-id');
            toggleCard(card, id, links);
        });
    });
    
    // Add event listeners for action buttons (only for admin users)
    if (currentUserRole === 'admin') {
        document.querySelectorAll('.edit-button').forEach(button => {
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = e.target.getAttribute('data-id');
                editLink(id);
            });
        });
        
        document.querySelectorAll('.delete-button').forEach(button => {
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = e.target.getAttribute('data-id');
                deleteLink(id);
            });
        });
        
        document.querySelectorAll('.reset-button').forEach(button => {
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = e.target.getAttribute('data-id');
                resetLink(id);
            });
        });
    }
}

// Toggle card between collapsed and expanded views
function toggleCard(card, id, allLinks) {
    const collapsedView = card.querySelector('.link-card-collapsed');
    const expandedView = card.querySelector('.link-card-expanded');
    
    if (collapsedView && expandedView) {
        // Toggle visibility
        if (collapsedView.classList.contains('hidden')) {
            // Currently expanded, collapse it
            collapsedView.classList.remove('hidden');
            expandedView.classList.add('hidden');
        } else {
            // Currently collapsed, expand it
            collapsedView.classList.add('hidden');
            expandedView.classList.remove('hidden');
        }
    }
}

// Edit link
function editLink(id) {
    // Fetch the link data
    fetch(`/api/links/${id}`, {
        headers: {
            'X-Session-ID': sessionId
        }
    })
    .then(response => response.json())
    .then(link => {
        if (link.error) {
            alert('Error: ' + link.error);
            return;
        }
        
        // Create a form to edit the link
        const form = `
            <div id="edit-modal" class="modal">
                <div class="modal-content">
                    <span class="close">&times;</span>
                    <h2>Edit Link</h2>
                    <form id="edit-link-form">
                        <div class="form-group">
                            <label for="edit-title">Title:</label>
                            <input type="text" id="edit-title" value="${link.title || ''}">
                        </div>
                        <div class="form-group">
                            <label for="edit-originalUrl">Original URL:</label>
                            <input type="url" id="edit-originalUrl" value="${link.originalUrl}" required>
                        </div>
                        <div class="form-group">
                            <label for="edit-maxDownloads">Maximum Downloads (optional):</label>
                            <input type="number" id="edit-maxDownloads" value="${link.maxDownloads || ''}" min="1">
                        </div>
                        <div class="form-group">
                            <label for="edit-expirationHours">Expiration (hours, optional):</label>
                            <input type="number" id="edit-expirationHours" value="${link.expirationHours || ''}" min="1">
                        </div>
                        <button type="submit">Update Link</button>
                    </form>
                </div>
            </div>
        `;
        
        // Add the form to the page
        document.body.insertAdjacentHTML('beforeend', form);
        
        // Add event listeners
        const modal = document.getElementById('edit-modal');
        const closeBtn = modal.querySelector('.close');
        const editForm = document.getElementById('edit-link-form');
        
        closeBtn.onclick = function() {
            modal.remove();
        }
        
        window.onclick = function(event) {
            if (event.target == modal) {
                modal.remove();
            }
        }
        
        editForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            const title = document.getElementById('edit-title').value || null;
            const originalUrl = document.getElementById('edit-originalUrl').value;
            const maxDownloads = document.getElementById('edit-maxDownloads').value || null;
            const expirationHours = document.getElementById('edit-expirationHours').value || null;
            
            const data = {
                title,
                originalUrl,
                maxDownloads: maxDownloads ? parseInt(maxDownloads) : null,
                expirationHours: expirationHours ? parseInt(expirationHours) : null
            };
            
            fetch(`/api/links/${id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-ID': sessionId
                },
                body: JSON.stringify(data)
            })
            .then(response => response.json())
            .then(data => {
                if (data.error) {
                    alert('Error: ' + data.error);
                    return;
                }
                
                // Close the modal
                modal.remove();
                
                // Refresh links list
                loadLinks();
            })
            .catch(error => {
                console.error('Error:', error);
                alert('An error occurred while updating the link');
            });
        });
    })
    .catch(error => {
        console.error('Error:', error);
        alert('An error occurred while fetching the link');
    });
}

// Delete link
function deleteLink(id) {
    if (!confirm('Are you sure you want to delete this link? This action cannot be undone.')) {
        return;
    }
    
    fetch(`/api/links/${id}`, {
        method: 'DELETE',
        headers: {
            'X-Session-ID': sessionId
        }
    })
    .then(response => {
        if (response.ok) {
            // Refresh links list
            loadLinks();
        } else {
            throw new Error('Failed to delete link');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        alert('An error occurred while deleting the link');
    });
}

// Reset link downloads
function resetLink(id) {
    if (!confirm('Are you sure you want to reset the download count for this link?')) {
        return;
    }
    
    fetch(`/api/links/${id}/reset`, {
        method: 'POST',
        headers: {
            'X-Session-ID': sessionId
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            alert('Error: ' + data.error);
            return;
        }
        
        // Refresh links list
        loadLinks();
    })
    .catch(error => {
        console.error('Error:', error);
        alert('An error occurred while resetting the link');
    });
}

// Logout function
function logout() {
    fetch('/api/logout', {
        method: 'POST',
        headers: {
            'X-Session-ID': sessionId
        }
    })
    .then(() => {
        // Remove session ID from localStorage
        localStorage.removeItem('sessionId');
        // Redirect to login page
        window.location.href = '/login.html';
    })
    .catch(error => {
        console.error('Error:', error);
        // Even if logout fails, redirect to login page
        localStorage.removeItem('sessionId');
        window.location.href = '/login.html';
    });
}

// Load links when page loads
document.addEventListener('DOMContentLoaded', () => {
    loadLinks();
    
    // Refresh links every 30 seconds
    setInterval(loadLinks, 30000);
});