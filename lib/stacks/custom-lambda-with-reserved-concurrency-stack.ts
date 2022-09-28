import * as cdk from "aws-cdk-lib";
import {
  CustomResource,
  Duration,
  RemovalPolicy,
  Stack,
  StackProps,
} from "aws-cdk-lib";
import {
  Effect,
  PolicyDocument,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { Code, Function, Runtime } from "aws-cdk-lib/aws-lambda";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import { resolve } from "path";
import * as fs from "fs";
import * as path from "path";

export interface CustomLambdaWithReservedConcurrencyStackProps
  extends StackProps {
  version: string;
}

export class CustomLambdaWithReservedConcurrencyStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: CustomLambdaWithReservedConcurrencyStackProps
  ) {
    super(scope, id, props);

    // 1. Create Notification Source Bucket
    const sourceBucket = new Bucket(this, `gova-test-bucket-${props.version}`, {
      bucketName: `gova-test-bucket-${props.version}`,
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

    const lambdaIamRole = new Role(this, `LambdaIAMRole${props.version}`, {
      roleName: `LambdaIAMRole${props.version}`,
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      path: "/",
      inlinePolicies: {
        root: policyDocument,
      },
    });

    // 3. Create NotificationsHandlerLambda
    const notificationHandlerLambda = new Function(
      this,
      `S3NotificationProcessorLambda${props.version}`,
      {
        functionName: `S3NotificationProcessorLambda${props.version}`,
        code: Code.fromAsset(
          resolve(process.cwd(), "./lambdas/s3-notification-processor")
        ),
        handler: "index.handler",
        runtime: Runtime.NODEJS_14_X,
        timeout: Duration.seconds(30),
        role: lambdaIamRole,
      }
    );

    // 4. Create LambdaInvokePermission
    notificationHandlerLambda.addPermission(
      `LambdaInvokePermission${props.version}`,
      {
        principal: new ServicePrincipal("s3.amazonaws.com"),
        sourceArn: sourceBucket.bucketArn,
      }
    );

    // 5. Create Custom Lambda
    const handlerSource = fs.readFileSync(
      "/Users/govarthanank/Learnings/AWS/custom-resource/custom-lambda-with-reserved-concurrency/lambdas/custom-lambda/index.py",
      "utf8"
    );

    // Removing lines that starts with '#' (comment lines) in order to fit the 4096 limit
    const handlerSourceWithoutComments = handlerSource.replace(
      /^ *#.*\n?/gm,
      ""
    );

    if (handlerSourceWithoutComments.length > 4096) {
      throw new Error(
        `Source of Notifications Resource Handler is too large (${handlerSourceWithoutComments.length} > 4096)`
      );
    }

    const customLambda = new Function(
      this,
      `CustomLambdaFunction${props.version}`,
      {
        functionName: `CustomLambdaFunction${props.version}`,
        code: Code.fromInline(handlerSourceWithoutComments),
        handler: "index.lambda_handler",
        runtime: Runtime.PYTHON_3_9,
        timeout: Duration.seconds(300),
        reservedConcurrentExecutions: 1,
        role: lambdaIamRole,
      }
    );

    // 6. Create CustomResource - Trigger

    new CustomResource(this, `CustomLambdaTrigger${props.version}`, {
      serviceToken: customLambda.functionArn,
      resourceType: "Custom::LambdaTrigger",
      properties: {
        LambdaArn: notificationHandlerLambda.functionArn,
        Bucket: sourceBucket.bucketName,
      },
    });
  }
}
