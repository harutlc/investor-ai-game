# Off-site database backups. Hetzner cannot snapshot volumes, so the server uploads a daily SQLite backup here
# (cloud-init: investor-backup.timer). The uploader may only PutObject: it cannot read, list or delete backups.
# Terraform does not create its access key, so the key never enters state (see README "Deploy to Hetzner").

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

resource "aws_s3_bucket" "backup" {
  bucket = "${local.name}-backups-${data.aws_caller_identity.current.account_id}"

  lifecycle {
    # Backups outlive the stack. For a deliberate teardown see README "Deploy to Hetzner".
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_ownership_controls" "backup" {
  bucket = aws_s3_bucket.backup.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "backup" {
  bucket                  = aws_s3_bucket.backup.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backup" {
  bucket = aws_s3_bucket.backup.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "backup" {
  bucket = aws_s3_bucket.backup.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "backup" {
  bucket = aws_s3_bucket.backup.id

  rule {
    id     = "expire-daily-backups"
    status = "Enabled"
    filter {
      prefix = "daily/"
    }
    expiration {
      days = var.backup_retention_days
    }
    noncurrent_version_expiration {
      noncurrent_days = 7
    }
  }

  rule {
    id     = "abort-incomplete-uploads"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }

  depends_on = [aws_s3_bucket_versioning.backup]
}

data "aws_iam_policy_document" "backup_bucket" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.backup.arn,
      "${aws_s3_bucket.backup.arn}/*",
    ]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "backup" {
  bucket = aws_s3_bucket.backup.id
  policy = data.aws_iam_policy_document.backup_bucket.json

  depends_on = [aws_s3_bucket_public_access_block.backup]
}

resource "aws_iam_user" "backup" {
  name = "${local.name}-backup"
}

data "aws_iam_policy_document" "backup_uploader" {
  statement {
    sid       = "PutDailyBackups"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.backup.arn}/daily/*"]
  }
}

resource "aws_iam_user_policy" "backup" {
  name   = "${local.name}-backup-put-only"
  user   = aws_iam_user.backup.name
  policy = data.aws_iam_policy_document.backup_uploader.json
}
