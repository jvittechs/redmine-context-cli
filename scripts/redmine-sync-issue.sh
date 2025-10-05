#!/bin/bash

# JVIT Redmine Context CLI - Issue Sync Script
# Usage: ./scripts/redmine-sync-issue.sh <id|url>

if [ $# -eq 0 ]; then
    echo "Usage: $0 <issue-id|issue-url>"
    echo ""
    echo "Examples:"
    echo "  $0 12345"
    echo "  $0 https://redmine.example.com/issues/12345"
    exit 1
fi

INPUT="$1"

# Check if input is a URL
if [[ "$INPUT" =~ ^https?:// ]]; then
    # Extract issue ID from URL
    ISSUE_ID=$(echo "$INPUT" | sed -n 's/.*\/issues\/\([0-9]*\).*/\1/p')
    if [ -z "$ISSUE_ID" ]; then
        echo "❌ Could not extract issue ID from URL: $INPUT"
        exit 1
    fi
    echo "🔗 Detected URL, syncing issue ID: $ISSUE_ID"
    node "$(dirname "$0")/../dist/cli.js" sync issue --url "$INPUT"
else
    # Assume it's an issue ID
    if [[ ! "$INPUT" =~ ^[0-9]+$ ]]; then
        echo "❌ Invalid issue ID: $INPUT (must be a number)"
        exit 1
    fi
    echo "🔢 Detected issue ID: $INPUT"
    node "$(dirname "$0")/../dist/cli.js" sync issue --id "$INPUT"
fi
