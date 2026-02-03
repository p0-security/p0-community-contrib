# Postgres Session Audit — RDS / CloudWatch

This Lambda function enables P0 backend services to retrieve Postgres audit logs from an RDS instance via CloudWatch Logs. When invoked by the P0 platform, it queries CloudWatch for pgAudit session events matching the supplied principal, time range, and optional search terms, and returns them in a structured format.

## Prerequisites

- An RDS Postgres instance with [pgAudit](https://github.com/pgaudit/pgaudit) enabled and logs published to CloudWatch Logs.
- The RDS instance's `log_line_prefix` must be set to match the `LOG_LINE_PREFIX` variable used during deployment (default: `%t:%r:%u@%d:[%p]:`).
- An IAM role that grants the Lambda function permission to read CloudWatch Logs for the target log group.
- An S3 bucket to stage the deployment artifact.

## Deployment

### 1. Set environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `IAM_ROLE_ARN` | Yes | — | ARN of the IAM execution role for the Lambda function |
| `DB_IDENTIFIER` | Yes | — | RDS DB instance identifier (used to locate the CloudWatch log group) |
| `S3_BUCKET` | Yes | — | S3 bucket used to stage the Lambda ZIP artifact |
| `AWS_REGION` | No | `us-east-1` | AWS region to deploy into |
| `FUNCTION_NAME` | No | `session-audit-postgres-rds` | Name for the Lambda function |
| `S3_KEY` | No | `session-audit-postgres-rds/index.zip` | S3 key for the deployment artifact |
| `LOG_LINE_PREFIX` | No | `%t:%r:%u@%d:[%p]:` | Must match the `log_line_prefix` setting on the RDS instance |
| `ARCHITECTURE` | No | `arm64` | Lambda architecture (`arm64` or `x86_64`) |

```bash
export IAM_ROLE_ARN=arn:aws:iam::123456789012:role/LambdaExecutionRole
export DB_IDENTIFIER=my-postgres-instance
export S3_BUCKET=my-lambda-deployments

./deploy.sh
```

The script builds and bundles the function, uploads the artifact to S3, then creates or updates the Lambda function in the specified region.

### 2. Configure P0

After the Lambda is deployed, add a **Function Caller** component in the P0 console and point it at the deployed Lambda function. P0 will invoke the function with a `PostgresSessionQuery` payload to retrieve audit events for a given session.
