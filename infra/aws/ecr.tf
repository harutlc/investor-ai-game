# One repository per image target of the root Dockerfile. Tags are short git SHAs (scripts/aws-deploy.sh).

locals {
  images = toset(["api", "web"])
}

resource "aws_ecr_repository" "image" {
  for_each = local.images

  name                 = "${local.project}/${each.key}"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "image" {
  for_each = local.images

  repository = aws_ecr_repository.image[each.key].name
  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images after 1 day"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep the last 20 tagged images (rollback targets)"
        selection = {
          tagStatus      = "tagged"
          tagPatternList = ["*"]
          countType      = "imageCountMoreThan"
          countNumber    = 20
        }
        action = { type = "expire" }
      },
    ]
  })
}
