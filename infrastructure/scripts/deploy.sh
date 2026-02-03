#!/bin/bash

# AWS Step Functions Workflow Builder - Infrastructure Deployment Script

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default values
ENVIRONMENT="development"
REGION="us-east-1"
PROFILE=""
BOOTSTRAP=false
DESTROY=false

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -e, --environment    Environment (development|staging|production) [default: development]"
    echo "  -r, --region         AWS region [default: us-east-1]"
    echo "  -p, --profile        AWS profile to use"
    echo "  -b, --bootstrap      Bootstrap CDK in the account/region"
    echo "  -d, --destroy        Destroy the stack instead of deploying"
    echo "  -h, --help           Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 --environment development --region us-east-1"
    echo "  $0 --bootstrap --profile my-aws-profile"
    echo "  $0 --destroy --environment staging"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -e|--environment)
            ENVIRONMENT="$2"
            shift 2
            ;;
        -r|--region)
            REGION="$2"
            shift 2
            ;;
        -p|--profile)
            PROFILE="$2"
            shift 2
            ;;
        -b|--bootstrap)
            BOOTSTRAP=true
            shift
            ;;
        -d|--destroy)
            DESTROY=true
            shift
            ;;
        -h|--help)
            show_usage
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(development|staging|production)$ ]]; then
    print_error "Invalid environment: $ENVIRONMENT"
    print_error "Must be one of: development, staging, production"
    exit 1
fi

# Set AWS profile if provided
if [[ -n "$PROFILE" ]]; then
    export AWS_PROFILE="$PROFILE"
    print_status "Using AWS profile: $PROFILE"
fi

# Set environment variables
export NODE_ENV="$ENVIRONMENT"
export CDK_DEFAULT_REGION="$REGION"

print_status "Environment: $ENVIRONMENT"
print_status "Region: $REGION"

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    print_error "AWS CLI is not installed. Please install it first."
    exit 1
fi

# Check if CDK is installed
if ! command -v cdk &> /dev/null; then
    print_error "AWS CDK is not installed. Please install it first."
    print_error "Run: npm install -g aws-cdk"
    exit 1
fi

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    print_error "AWS credentials not configured or invalid."
    print_error "Please configure your AWS credentials using 'aws configure' or set environment variables."
    exit 1
fi

# Get account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export CDK_DEFAULT_ACCOUNT="$ACCOUNT_ID"

print_status "AWS Account: $ACCOUNT_ID"

# Change to infrastructure directory
cd "$(dirname "$0")/.."

# Install dependencies
print_status "Installing dependencies..."
npm install

# Build the project
print_status "Building CDK project..."
npm run build

# Bootstrap CDK if requested
if [[ "$BOOTSTRAP" == true ]]; then
    print_status "Bootstrapping CDK in account $ACCOUNT_ID, region $REGION..."
    cdk bootstrap aws://$ACCOUNT_ID/$REGION
fi

# Deploy or destroy
if [[ "$DESTROY" == true ]]; then
    print_warning "This will destroy the WorkflowBuilderStack and all its resources."
    read -p "Are you sure you want to continue? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        print_status "Destroying stack..."
        cdk destroy WorkflowBuilderStack --force
        print_status "Stack destroyed successfully!"
    else
        print_status "Destruction cancelled."
    fi
else
    print_status "Deploying WorkflowBuilderStack..."
    cdk deploy WorkflowBuilderStack --require-approval never
    
    if [[ $? -eq 0 ]]; then
        print_status "Deployment completed successfully!"
        print_status ""
        print_status "Stack outputs:"
        aws cloudformation describe-stacks \
            --stack-name WorkflowBuilderStack \
            --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' \
            --output table
    else
        print_error "Deployment failed!"
        exit 1
    fi
fi