#!/bin/bash

# Define backup directory and date format
BACKUP_DIR="/home/ubuntu/app/backups"
DATE=$(date +%Y-%m-%d_%H%M%S)
FILE_NAME="class_tool_backup_${DATE}.sql"
ENV_FILE="/home/ubuntu/app/server/.env"

# Create backup directory if not exists
mkdir -p "$BACKUP_DIR"

# Retrieve DB credentials dynamically from .env to prevent hardcoding secrets
if [ -f "$ENV_FILE" ]; then
    DB_USER=$(grep -E "^DB_USER=" "$ENV_FILE" | cut -d'=' -f2 | tr -d '\r')
    DB_PASSWORD=$(grep -E "^DB_PASSWORD=" "$ENV_FILE" | cut -d'=' -f2 | tr -d '\r')
    DB_NAME=$(grep -E "^DB_NAME=" "$ENV_FILE" | cut -d'=' -f2 | tr -d '\r')
else
    echo "Error: .env file not found at $ENV_FILE"
    exit 1
fi

# Fallback values if not defined in .env
DB_USER=${DB_USER:-root}
DB_NAME=${DB_NAME:-class_tool}

# Run mysqldump
if [ -n "$DB_PASSWORD" ]; then
    mysqldump -h localhost -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" > "${BACKUP_DIR}/${FILE_NAME}"
else
    mysqldump -h localhost -u "$DB_USER" "$DB_NAME" > "${BACKUP_DIR}/${FILE_NAME}"
fi

# Delete backups older than 7 days to conserve disk space
find "$BACKUP_DIR" -type f -name "class_tool_backup_*.sql" -mtime +7 -delete

echo "Backup completed successfully at ${DATE}: ${FILE_NAME}"
