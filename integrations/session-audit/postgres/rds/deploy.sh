#!/usr/bin/env bash

set -euo pipefail

# Configuration
FUNCTION_NAME="${FUNCTION_NAME:-session-audit-postgres-rds}"
REGION="${AWS_REGION:-us-east-1}"
RUNTIME="nodejs22.x"
HANDLER="index.handler"
ARCHITECTURE="${ARCHITECTURE:-arm64}"
S3_BUCKET="${S3_BUCKET:-p0-dev-audit}"
S3_KEY="${S3_KEY:-session-audit-postgres-rds/index.zip}"
LOG_LINE_PREFIX="${LOG_LINE_PREFIX:-%t:%r:%u@%d:[%p]:}"

# Check if required environment variables are set
if [ -z "${IAM_ROLE_ARN:-}" ]; then
  echo "Error: IAM_ROLE_ARN environment variable must be set"
  echo "Example: export IAM_ROLE_ARN=arn:aws:iam::123456789012:role/LambdaExecutionRole"
  exit 1
fi

if [ -z "${DB_IDENTIFIER:-}" ]; then
  echo "Error: DB_IDENTIFIER environment variable must be set"
  echo "Example: export DB_IDENTIFIER=my-postgres-instance"
  exit 1
fi

if [ -z "${S3_BUCKET:-}" ]; then
  echo "Error: S3_BUCKET environment variable must be set"
  echo "Example: export S3_BUCKET=my-lambda-deployments"
  exit 1
fi

echo "Building and bundling function..."
yarn bundle

echo ""
echo "Uploading to S3: s3://$S3_BUCKET/$S3_KEY"
aws s3 cp dist/index.zip "s3://$S3_BUCKET/$S3_KEY" --region "$REGION"
echo "Upload complete!"

echo ""
echo "Checking if Lambda function exists..."
if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" &>/dev/null; then
  echo "Function exists. Updating function code..."
  aws lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --s3-bucket "$S3_BUCKET" \
    --s3-key "$S3_KEY" \
    --region "$REGION" \
    --architectures "$ARCHITECTURE"

  echo "Waiting for code update to complete..."
  aws lambda wait function-updated \
    --function-name "$FUNCTION_NAME" \
    --region "$REGION"

  echo "Updating function configuration..."
  aws lambda update-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --region "$REGION" \
    --environment "{\"Variables\":{\"LOG_LEVEL\":\"info\",\"DB_IDENTIFIER\":\"$DB_IDENTIFIER\",\"LOG_LINE_PREFIX\":\"$LOG_LINE_PREFIX\"}}"

  echo "Waiting for configuration update to complete..."
  aws lambda wait function-updated \
    --function-name "$FUNCTION_NAME" \
    --region "$REGION"

  echo "Function updated successfully!"
else
  echo "Function does not exist. Creating new function..."
  aws lambda create-function \
    --function-name "$FUNCTION_NAME" \
    --runtime "$RUNTIME" \
    --handler "$HANDLER" \
    --code "S3Bucket=$S3_BUCKET,S3Key=$S3_KEY" \
    --role "$IAM_ROLE_ARN" \
    --region "$REGION" \
    --architectures "$ARCHITECTURE" \
    --timeout 300 \
    --memory-size 512 \
    --environment "{\"Variables\":{\"LOG_LEVEL\":\"info\",\"DB_IDENTIFIER\":\"$DB_IDENTIFIER\",\"LOG_LINE_PREFIX\":\"$LOG_LINE_PREFIX\"}}" \
    --tags Project=session-audit-postgres-rds

  echo "Function created successfully!"
fi

echo ""
echo "Deployment complete!"
echo "Function name: $FUNCTION_NAME"
echo "Region: $REGION"
echo "S3 location: s3://$S3_BUCKET/$S3_KEY"
echo ""
echo "To test the function, run:"
echo "  aws lambda invoke --function-name $FUNCTION_NAME --region $REGION --cli-binary-format raw-in-base64-out --payload file://payload.json response.json && cat response.json"
