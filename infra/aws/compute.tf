data "aws_ec2_instance_type" "app" {
  instance_type = var.instance_type
}

locals {
  arm64 = contains(data.aws_ec2_instance_type.app.supported_architectures, "arm64")
  # The platform scripts/aws-deploy.sh builds images for.
  image_platform = local.arm64 ? "linux/arm64" : "linux/amd64"
}

data "aws_ssm_parameter" "al2023_ami" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-${local.arm64 ? "arm64" : "x86_64"}"
}

resource "aws_instance" "app" {
  ami                    = data.aws_ssm_parameter.al2023_ami.insecure_value
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.public.id
  availability_zone      = aws_subnet.public.availability_zone
  vpc_security_group_ids = [aws_security_group.app.id]
  iam_instance_profile   = aws_iam_instance_profile.instance.name
  # No key pair: shell access is through Session Manager only.

  user_data = templatefile("${path.module}/cloud-init.yaml", {
    data_volume_id        = aws_ebs_volume.data.id
    data_volume_id_nodash = replace(aws_ebs_volume.data.id, "-", "")
  })

  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  root_block_device {
    volume_type = "gp3"
    volume_size = 20
    encrypted   = true
  }

  tags = { Name = local.name }

  lifecycle {
    # A newer AMI or edited cloud-init must not silently replace the running instance. Use
    # `terraform apply -replace=aws_instance.app` to roll them out; data stays on the separate volume.
    ignore_changes = [ami, user_data]
  }
}

resource "aws_eip" "app" {
  domain = "vpc"
  tags   = { Name = local.name }
}

resource "aws_eip_association" "app" {
  instance_id   = aws_instance.app.id
  allocation_id = aws_eip.app.id
}

# Moves the instance to healthy hardware (same ID, EIP and volumes) when AWS's system check fails.
resource "aws_cloudwatch_metric_alarm" "auto_recover" {
  alarm_name          = "${local.name}-auto-recover"
  alarm_description   = "Recover the instance when the EC2 system status check fails"
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed_System"
  dimensions          = { InstanceId = aws_instance.app.id }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  alarm_actions       = ["arn:${data.aws_partition.current.partition}:automate:${var.region}:ec2:recover"]
}
