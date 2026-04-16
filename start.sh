#!/bin/bash
# Replit AI Integrations provides proxy credentials in development.
# In production autoscale, those vars may be absent.
# Only overwrite OPENAI_KEY vars when the integrations vars are actually set —
# otherwise preserve any real secrets already in the environment.
if [ -n "$AI_INTEGRATIONS_OPENAI_API_KEY" ]; then
  export OPENAI_API_KEY="$AI_INTEGRATIONS_OPENAI_API_KEY"
fi
if [ -n "$AI_INTEGRATIONS_OPENAI_BASE_URL" ]; then
  export OPENAI_BASE_URL="$AI_INTEGRATIONS_OPENAI_BASE_URL"
fi
exec node /home/runner/workspace/artifacts/smartilr-server/server.js
