# Link Manager - Secure Download Link Management System

A secure cloud file download link management application with expiration dates and download limits.

## Features

- Create tracking links for cloud file downloads
- Set expiration dates for links
- Limit the number of downloads per link
- User authentication with role-based access control
- Admin panel for link management
- Automatic link deactivation when limits are reached or expired

## Security Enhancements

This production version includes several security enhancements:

1. **Rate Limiting**: Prevents abuse and brute force attacks
2. **Security Headers**: Added HTTP security headers to prevent common attacks
3. **Input Validation**: Enhanced validation for all user inputs
4. **Password Strength**: Enforced minimum password length requirements
5. **Content Security Policy**: Restricts content loading to prevent XSS attacks
6. **HTTPS Support**: Ready for HTTPS deployment with proper headers

## Deployment Options

### 1. Docker Deployment (Recommended for Security)

```bash
# Build and run with Docker
docker-compose up -d

# Or build and run manually
docker build -t link-manager .
docker run -p 3000:3000 -v $(pwd)/db:/app/db link-manager
```

### 2. Direct Node.js Deployment

```bash
# Install dependencies
npm install

# Start the production server
npm run start:prod
```

### 3. Platform-as-a-Service Deployment

#### Render.com
The application includes a `render.yaml` file for easy deployment to Render.

#### Railway.app
The application will automatically deploy to Railway with the default settings.

#### Heroku
Create a new Heroku app and deploy using Git:
```bash
git push heroku main
```

## Environment Variables

- `PORT`: Port to run the server on (default: 3000)
- `NODE_ENV`: Environment (development/production)

## Default Admin User

On first run, the application creates a default admin user:
- Username: `admin`
- Password: `admin123`

**Important**: Change this password immediately after first login!

## Security Recommendations

1. **Use HTTPS**: Always deploy with HTTPS in production
2. **Change Default Password**: Update the default admin password immediately
3. **Regular Updates**: Keep dependencies updated
4. **Database Backups**: Regularly backup the SQLite database
5. **Firewall**: Restrict access to necessary ports only
6. **Monitoring**: Implement application monitoring for suspicious activity

## API Endpoints

### Authentication
- `POST /api/login` - User login
- `POST /api/logout` - User logout
- `GET /api/user-role` - Get current user role
- `GET /api/verify-session` - Verify session validity

### Link Management
- `POST /api/links` - Create a new tracking link (requires authentication)
- `GET /api/links` - Get all links (requires authentication)
- `GET /api/links/:id` - Get a specific link (requires authentication)
- `PUT /api/links/:id` - Update a link (requires authentication)
- `DELETE /api/links/:id` - Delete a link (requires authentication)
- `POST /api/links/:id/reset` - Reset download count (requires authentication)
- `POST /api/links/:id/check` - Check link validity (requires authentication)
- `POST /api/links/:id/refresh` - Refresh link status (requires authentication)

### User Management
- `POST /api/users` - Create a new user (admin only)
- `GET /api/users` - Get all users (requires authentication)
- `DELETE /api/users/:id` - Delete a user (requires authentication)
- `PUT /api/users/:id/password` - Change user password (requires authentication)
- `PUT /api/users/:id` - Update user information (requires authentication)

## Download Tracking

The system tracks downloads through the `/download/:id` endpoint, which:
1. Validates the link status (active, expired, limit reached)
2. Increments the download counter
3. Deactivates the link if limits are reached
4. Fetches and serves the original file to the user

## Supported File Sharing Services

The system includes special handling for:
- pCloud links (extracts direct download URLs)

Other services can be added by extending the extraction logic.

## License

MIT