import * as cdk from "aws-cdk-lib";
import { CustomResource, Duration, RemovalPolicy } from "aws-cdk-lib";
import {
  Effect,
  PolicyDocument,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { Code, Function, Runtime } from "aws-cdk-lib/aws-lambda";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Provider } from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
import { resolve } from "path";

export class CustomLambdaWithReservedConcurrencyStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 0. Create NotificationsHandlerLambda
    const notificationHandlerLambda = new Function(
      this,
      "S3NotificationProcessor",
      {
        functionName: "S3NotificationProcessor",
        code: Code.fromAsset(
          resolve(process.cwd(), "./lambdas/s3-notification-processor")
        ),
        handler: "index.handler",
        runtime: Runtime.NODEJS_14_X,
        timeout: Duration.seconds(30),
      }
    );
    // 1. Create Notification Source Bucket
    const sourceBucket = new Bucket(this, "gova-test-bucket-1", {
      bucketName: "gova-test-bucket-1",
      publicReadAccess: false,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // 2. Create  LambdaIAMRole
    const policyStatementForS3 = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["s3:GetBucketNotification", "s3:PutBucketNotification"],
      resources: [sourceBucket.bucketArn],
    });
    const policyStatementForLogs = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
      ],
      resources: ["arn:aws:logs:*:*:*"],
    });

    const policyDocument = new PolicyDocument({
      statements: [policyStatementForS3, policyStatementForLogs],
    });

    const lambdaIamRole = new Role(this, "LambdaIAMRole", {
      roleName: "LambdaIAMRole",
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      path: "/",
      inlinePolicies: {
        root: policyDocument,
      },
    });

    // 3. Create LambdaInvokePermission
    notificationHandlerLambda.addPermission("LambdaInvokePermission", {
      principal: new ServicePrincipal("s3.amazonaws.com"),
      sourceArn: sourceBucket.bucketArn,
    });

    // 4. Create Custom Lambda
    const customLambda = new Function(this, "CustomLambda", {
      functionName: "CustomLambda",
      code: Code.fromAsset(resolve(process.cwd(), "./lambdas/custom-lambda")),
      handler: "index.lambda_handler",
      runtime: Runtime.PYTHON_3_7,
      timeout: Duration.seconds(30),
      role: lambdaIamRole,
    });

    // 5. Create CustomResource - Trigger
    const provider = new Provider(this, "provider", {
      onEventHandler: customLambda,
    });

    new CustomResource(this, "LambdaTrigger", {
      serviceToken: provider.serviceToken,
      resourceType: "Custom::LambdaTriggerGova",
      properties: {
        lambdaArn: notificationHandlerLambda.functionArn,
        bucket: sourceBucket.bucketArn,
      },
    });
  }
}
